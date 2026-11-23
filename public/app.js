let currentConfig = null;
let currentState = null;

const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(iso) {
  if (!iso) return '未チェック';
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function dayFilterLabel(rule) {
  if (rule.dayFilter === 'weekend_holiday') return '土日祝';
  if (rule.dayFilter === 'weekday') return '平日';
  if (rule.dayFilter === 'all') return '毎日';
  const names = ['日', '月', '火', '水', '木', '金', '土'];
  const list = (rule.customDays || []).map((d) => names[d]).join('・');
  return `${list}${rule.includeHolidays ? '＋祝' : ''}`;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function renderEvents(events) {
  const container = $('eventsContainer');
  $('eventCountBadge').textContent = `${events.length}件`;

  if (!events || events.length === 0) {
    container.innerHTML =
      '<p class="muted">条件に一致する直近の個サルはありません。右上の「今すぐチェック」を押すか、ルール条件を確認してください。</p>';
    return;
  }

  container.innerHTML = events
    .map((ev) => {
      const pct =
        ev.capacity && ev.booked !== null
          ? Math.min(100, Math.round((ev.booked / ev.capacity) * 100))
          : 0;
      const remLabel =
        ev.remaining === 0
          ? '満員 (残り0人)'
          : ev.remaining !== null
            ? `残り ${ev.remaining}人`
            : ev.status;
      const countText =
        ev.booked !== null && ev.capacity !== null
          ? `予約 ${ev.booked} / 定員 ${ev.capacity}人`
          : ev.capacityText || '';
      const holTag = ev.holidayName
        ? `<span class="holiday-tag">${escapeHtml(ev.holidayName)}</span>`
        : '';

      return `
        <div class="event-card status-${escapeHtml(ev.alertStatus || 'ok')}">
          <div class="event-date">
            <span>${escapeHtml(ev.date)}（${escapeHtml(ev.dayOfWeek)}）${escapeHtml(ev.startTime)}〜${escapeHtml(ev.endTime)}</span>
            ${holTag}
          </div>
          <div class="event-shop">${escapeHtml(ev.shopName)} ・ ${escapeHtml(ev.status)}</div>
          <div class="event-title">${escapeHtml(ev.title)}</div>
          <div class="capacity-row">
            <span class="remaining-badge">${escapeHtml(remLabel)}</span>
            <span class="hint">${escapeHtml(countText)}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="event-footer">
            <span>通知しきい値: 残り${ev.thresholdRemaining}人以下</span>
            <a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">予約ページ ↗</a>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderRules(rules) {
  const container = $('rulesContainer');
  if (!rules || rules.length === 0) {
    container.innerHTML = '<p class="muted">監視ルールがありません。「＋ 施設・時間帯を追加」から登録してください。</p>';
    return;
  }

  container.innerHTML = rules
    .map((r) => {
      const timeRange =
        r.startTimeFrom || r.startTimeTo
          ? `${r.startTimeFrom || '00:00'}〜${r.startTimeTo || '23:59'}`
          : '全時間帯';
      return `
        <div class="rule-item ${r.enabled ? '' : 'disabled'}">
          <div>
            <div class="rule-title">${r.enabled ? '🟢' : '⚪'} ${escapeHtml(r.name)}</div>
            <div class="rule-meta">
              ${escapeHtml(r.shopUrl)} ｜ 曜日: ${escapeHtml(dayFilterLabel(r))} ｜ 開始: ${escapeHtml(timeRange)} ｜ 残り${r.thresholdRemaining}人以下で通知 ｜ ${r.lookaheadDays}日先まで
              ${r.keyword ? `｜ KW: ${escapeHtml(r.keyword)}` : ''}
            </div>
          </div>
          <div class="rule-actions">
            <button class="btn btn-secondary btn-sm" data-toggle-rule="${escapeHtml(r.id)}">${r.enabled ? '一時停止' : '有効にする'}</button>
            <button class="btn btn-outline btn-sm" data-edit-rule="${escapeHtml(r.id)}">編集</button>
            <button class="btn btn-danger btn-sm" data-delete-rule="${escapeHtml(r.id)}">削除</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderSettings(config) {
  $('pollInterval').value = config.pollIntervalMinutes ?? 5;

  const email = config.notifications?.email || {};
  $('emailEnabled').checked = Boolean(email.enabled);
  $('emailHost').value = email.host || 'smtp.gmail.com';
  $('emailPort').value = email.port || 587;
  $('emailUser').value = email.user || '';
  $('emailTo').value = email.to || '';
  $('emailPass').value = '';
  $('emailPassStatus').classList.toggle('hidden', !email.hasPass);

  const line = config.notifications?.line || {};
  $('lineEnabled').checked = Boolean(line.enabled);
  $('lineUserId').value = line.userId || '';
  $('lineToken').value = '';
  $('lineTokenStatus').classList.toggle('hidden', !line.hasToken);
}

function renderLogs(logs) {
  const container = $('logsContainer');
  if (!logs || logs.length === 0) {
    container.innerHTML = '<p class="muted">まだ通知・エラー履歴はありません。</p>';
    return;
  }
  container.innerHTML = logs
    .slice(0, 15)
    .map((log) => {
      const time = formatDateTime(log.time);
      if (log.type === 'error') {
        return `<div class="log-item error"><strong>[${time}] エラー:</strong> ${escapeHtml(log.message)}</div>`;
      }
      const ch = (log.channels || []).join(', ') || '通知先なし';
      return `<div class="log-item"><strong>[${time}] 通知 (${escapeHtml(ch)}):</strong> ${escapeHtml(log.eventTitle)}（残り ${log.remaining}人）</div>`;
    })
    .join('');
}

async function refreshStatus() {
  const data = await api('/api/status');
  currentConfig = data.config;
  currentState = data.state;

  $('lastChecked').textContent = `最終確認: ${formatDateTime(currentState.lastCheckedAt)}`;
  const errBanner = $('errorBanner');
  if (currentState.lastError) {
    errBanner.textContent = `最新のエラー: ${currentState.lastError}`;
    errBanner.classList.remove('hidden');
  } else {
    errBanner.classList.add('hidden');
  }

  renderEvents(currentState.latestEvents || []);
  renderRules(currentConfig.rules || []);
  renderSettings(currentConfig);
  renderLogs(currentState.logs || []);
}

function openRuleForm(rule = null) {
  const form = $('ruleForm');
  form.classList.remove('hidden');
  $('ruleFormTitle').textContent = rule ? '監視ルールを編集' : '新しい監視ルールを追加';
  $('ruleId').value = rule?.id || '';
  $('ruleShopUrl').value = rule?.shopUrl || '';
  $('ruleName').value = rule?.name || '';
  $('ruleDayFilter').value = rule?.dayFilter || 'weekend_holiday';
  $('ruleTimeFrom').value = rule?.startTimeFrom || '06:00';
  $('ruleTimeTo').value = rule?.startTimeTo || '06:30';
  $('ruleThreshold').value = rule?.thresholdRemaining ?? 5;
  $('ruleKeyword').value = rule?.keyword || '';
  $('ruleLookahead').value = rule?.lookaheadDays ?? 14;
  $('ruleNotifyMode').value = rule?.notifyMode || 'on_decrease';
  $('ruleNotifyFull').checked = rule ? rule.notifyFull !== false : true;
  $('ruleNotifyReopen').checked = rule ? rule.notifyReopen !== false : true;
  $('ruleIncludeHolidays').checked = rule ? Boolean(rule.includeHolidays) : true;

  const customDays = rule?.customDays || [0, 6];
  document.querySelectorAll('input[name="customDay"]').forEach((cb) => {
    cb.checked = customDays.includes(Number(cb.value));
  });
  $('customDaysRow').classList.toggle('hidden', $('ruleDayFilter').value !== 'custom');
  $('shopPreviewHint').textContent = '例: https://yoyaku.labola.jp/r/shop/3050/';
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- Event Listeners ---

$('btnCheckNow').addEventListener('click', async () => {
  const btn = $('btnCheckNow');
  btn.disabled = true;
  btn.textContent = '確認中...';
  try {
    const res = await api('/api/check', { method: 'POST' });
    await refreshStatus();
    showToast(`チェック完了！ 対象 ${res.result.matchedCount}件`);
  } catch (err) {
    showToast(`エラー: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '今すぐチェック';
  }
});

$('btnAddRule').addEventListener('click', () => openRuleForm(null));
$('btnCancelRule').addEventListener('click', () => $('ruleForm').classList.add('hidden'));

$('ruleDayFilter').addEventListener('change', (e) => {
  $('customDaysRow').classList.toggle('hidden', e.target.value !== 'custom');
});

$('btnPreviewShop').addEventListener('click', async () => {
  const shopUrl = $('ruleShopUrl').value.trim();
  if (!shopUrl) return showToast('施設URLを入力してください');
  const btn = $('btnPreviewShop');
  btn.disabled = true;
  btn.textContent = '確認中...';
  try {
    const data = await api('/api/preview-shop', {
      method: 'POST',
      body: JSON.stringify({ shopUrl }),
    });
    $('shopPreviewHint').textContent = `✅ 取得成功: ${data.shopName}（直近の個サル ${data.sampleCount}件）`;
    if (!$('ruleName').value.trim()) {
      $('ruleName').value = `${data.shopName} 個サル`;
    }
  } catch (err) {
    $('shopPreviewHint').textContent = `❌ 取得失敗: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '施設を確認';
  }
});

$('ruleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const customDays = Array.from(document.querySelectorAll('input[name="customDay"]:checked')).map(
    (cb) => Number(cb.value)
  );
  const payload = {
    id: $('ruleId').value || undefined,
    name: $('ruleName').value.trim(),
    shopUrl: $('ruleShopUrl').value.trim(),
    dayFilter: $('ruleDayFilter').value,
    customDays,
    includeHolidays: $('ruleIncludeHolidays').checked,
    startTimeFrom: $('ruleTimeFrom').value,
    startTimeTo: $('ruleTimeTo').value,
    keyword: $('ruleKeyword').value.trim(),
    lookaheadDays: Number($('ruleLookahead').value),
    thresholdRemaining: Number($('ruleThreshold').value),
    notifyMode: $('ruleNotifyMode').value,
    notifyFull: $('ruleNotifyFull').checked,
    notifyReopen: $('ruleNotifyReopen').checked,
  };

  try {
    await api('/api/rules', { method: 'POST', body: JSON.stringify(payload) });
    $('ruleForm').classList.add('hidden');
    showToast('監視ルールを保存しました。再チェックしています...');
    await api('/api/check', { method: 'POST' });
    await refreshStatus();
  } catch (err) {
    showToast(`保存エラー: ${err.message}`);
  }
});

$('rulesContainer').addEventListener('click', async (e) => {
  const toggleId = e.target.getAttribute('data-toggle-rule');
  const editId = e.target.getAttribute('data-edit-rule');
  const deleteId = e.target.getAttribute('data-delete-rule');

  if (toggleId) {
    await api(`/api/rules/${toggleId}/toggle`, { method: 'PATCH' });
    await refreshStatus();
    showToast('ルールの状態を切り替えました');
  } else if (editId) {
    const rule = (currentConfig.rules || []).find((r) => r.id === editId);
    if (rule) openRuleForm(rule);
  } else if (deleteId) {
    if (!confirm('この監視ルールを削除しますか？')) return;
    await api(`/api/rules/${deleteId}`, { method: 'DELETE' });
    await refreshStatus();
    showToast('ルールを削除しました');
  }
});

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    pollIntervalMinutes: Number($('pollInterval').value),
    notifications: {
      email: {
        enabled: $('emailEnabled').checked,
        host: $('emailHost').value.trim(),
        port: Number($('emailPort').value),
        secure: Number($('emailPort').value) === 465,
        user: $('emailUser').value.trim(),
        pass: $('emailPass').value,
        to: $('emailTo').value.trim(),
      },
      line: {
        enabled: $('lineEnabled').checked,
        channelAccessToken: $('lineToken').value.trim(),
        userId: $('lineUserId').value.trim(),
      },
    },
  };

  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    await refreshStatus();
    showToast('通知・監視設定を保存しました！');
  } catch (err) {
    showToast(`設定エラー: ${err.message}`);
  }
});

document.querySelectorAll('[data-test-channel]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const channel = btn.getAttribute('data-test-channel');
    btn.disabled = true;
    try {
      await api('/api/test-notify', { method: 'POST', body: JSON.stringify({ channel }) });
      showToast(`${channel === 'email' ? 'メール' : 'LINE'}のテスト通知を送信しました！`);
    } catch (err) {
      showToast(`送信失敗: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
});

// 初回読み込み & 60秒ごとに画面自動更新
refreshStatus().catch((err) => showToast(`読み込み失敗: ${err.message}`));
setInterval(() => refreshStatus().catch(() => {}), 60000);
