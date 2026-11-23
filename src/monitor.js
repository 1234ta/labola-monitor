import { extractShopId, fetchShopEvents, filterEventsByRule } from './scraper.js';
import { sendAlert } from './notifier.js';
import { loadConfig, loadState, saveState } from './storage.js';

/**
 * 単一イベントに対して通知すべきか判定
 * 返り値: 'threshold' | 'full' | 'reopen' | null
 */
function evaluateNotification(event, rule, prevRecord) {
  if (event.remaining === null) return null;
  // 受付け開始前・終了は対象外
  if (/開始前|終了|中止/.test(event.status)) return null;

  const threshold = Number(rule.thresholdRemaining ?? 5);
  const rem = event.remaining;
  const prevRem = prevRecord ? prevRecord.lastRemaining : null;

  // 1. 満員(0)からキャンセルで空きが出た場合
  if (rule.notifyReopen && prevRem === 0 && rem > 0) {
    return 'reopen';
  }

  // 2. 満員になった場合
  if (rem === 0) {
    if (!rule.notifyFull) return null;
    if (prevRem === 0) return null; // 既に満員通知済み
    return 'full';
  }

  // 3. 空き枠がしきい値以下の場合
  if (rem <= threshold) {
    if (!prevRecord || prevRecord.lastNotifiedRemaining === null) {
      return 'threshold';
    }
    if (rule.notifyMode === 'on_decrease' && rem < prevRecord.lastNotifiedRemaining) {
      return 'threshold';
    }
    return null;
  }

  return null;
}

/**
 * 全ルールをチェックし、必要なら通知を送信する
 */
export async function runMonitorCycle(options = {}) {
  const { dryRun = false } = options;
  const config = loadConfig();
  const state = loadState();

  const enabledRules = (config.rules || []).filter((r) => r.enabled);
  const shopCache = new Map(); // key: `${shopId}_${kind}` -> { shopName, events }
  const matchedEntries = [];
  const alertsTriggered = [];
  const errors = [];
  let succeededRules = 0;

  for (const rule of enabledRules) {
    try {
      const shopId = extractShopId(rule.shopUrl);
      const kind = rule.kind || 'individual';
      const cacheKey = `${shopId}_${kind}`;

      if (!shopCache.has(cacheKey)) {
        const fetched = await fetchShopEvents(shopId, { kind, maxPages: 3 });
        shopCache.set(cacheKey, fetched);
      }

      const { shopName, events } = shopCache.get(cacheKey);
      succeededRules++;
      const matched = filterEventsByRule(events, rule);

      for (const ev of matched) {
        const stateKey = `${rule.id}::${ev.id}`;
        const prev = state.notified[stateKey] || null;
        const reason = evaluateNotification(ev, rule, prev);

        matchedEntries.push({
          ruleId: rule.id,
          ruleName: rule.name,
          thresholdRemaining: Number(rule.thresholdRemaining ?? 5),
          shopName,
          ...ev,
          alertStatus:
            ev.remaining === 0
              ? 'full'
              : ev.remaining !== null && ev.remaining <= Number(rule.thresholdRemaining ?? 5)
                ? 'low'
                : 'ok',
        });

        if (reason) {
          const alert = { event: ev, rule, reason };
          alertsTriggered.push(alert);

          if (!dryRun) {
            try {
              const channels = await sendAlert(config.notifications, alert);
              state.logs.unshift({
                time: new Date().toISOString(),
                type: 'alert',
                reason,
                ruleName: rule.name,
                eventTitle: `${ev.date}(${ev.dayOfWeek}) ${ev.startTime} ${ev.shopName}`,
                remaining: ev.remaining,
                channels,
              });
            } catch (notifyErr) {
              errors.push(`通知失敗 (${ev.title}): ${notifyErr.message}`);
              state.logs.unshift({
                time: new Date().toISOString(),
                type: 'error',
                message: `通知失敗: ${notifyErr.message}`,
              });
            }
          }

          state.notified[stateKey] = {
            lastRemaining: ev.remaining,
            lastNotifiedRemaining: ev.remaining,
            lastNotifiedAt: new Date().toISOString(),
            date: ev.date,
          };
        } else {
          // 通知なしでも最新の残数だけ記録（満員→再オープン判定のため）
          state.notified[stateKey] = {
            lastRemaining: ev.remaining,
            lastNotifiedRemaining: prev?.lastNotifiedRemaining ?? null,
            lastNotifiedAt: prev?.lastNotifiedAt ?? null,
            date: ev.date,
          };
        }
      }
    } catch (err) {
      errors.push(`ルール「${rule.name}」の取得エラー: ${err.message}`);
      state.logs.unshift({
        time: new Date().toISOString(),
        type: 'error',
        message: `ルール「${rule.name}」: ${err.message}`,
      });
    }
  }

  // 開催日順にソート
  matchedEntries.sort((a, b) => {
    const ka = `${a.date || ''} ${a.startTime || ''}`;
    const kb = `${b.date || ''} ${b.startTime || ''}`;
    return ka.localeCompare(kb);
  });

  // 過去イベントの状態をクリーンアップ
  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const [k, v] of Object.entries(state.notified)) {
    if (v?.date && v.date < todayStr) {
      delete state.notified[k];
    }
  }

  state.lastCheckedAt = new Date().toISOString();
  state.lastError = errors.length > 0 ? errors.join(' / ') : null;
  if (succeededRules > 0 || enabledRules.length === 0) {
    state.latestEvents = matchedEntries;
  }
  saveState(state);

  return {
    checkedAt: state.lastCheckedAt,
    matchedCount: matchedEntries.length,
    alertsCount: alertsTriggered.length,
    events: matchedEntries,
    alerts: alertsTriggered,
    errors,
  };
}
