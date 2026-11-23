import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env.js';
import { loadConfig, saveConfig, loadState } from './storage.js';
import { runMonitorCycle } from './monitor.js';
import { sendTestNotification } from './notifier.js';
import { extractShopId, fetchShopEvents } from './scraper.js';

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3456);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let timerHandle = null;
let isChecking = false;

function maskConfigForClient(config) {
  const copy = structuredClone(config);
  if (copy.notifications?.email?.pass) {
    copy.notifications.email.hasPass = true;
    copy.notifications.email.pass = '';
  }
  if (copy.notifications?.line?.channelAccessToken) {
    copy.notifications.line.hasToken = true;
    copy.notifications.line.channelAccessToken = '';
  }
  return copy;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const relPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, safePath);

  if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(fullPath).pipe(res);
}

async function safeRunCheck() {
  if (isChecking) return null;
  isChecking = true;
  try {
    const result = await runMonitorCycle();
    console.log(
      `[${new Date().toLocaleTimeString('ja-JP')}] チェック完了: 対象 ${result.matchedCount}件 / 通知 ${result.alertsCount}件`
    );
    return result;
  } catch (err) {
    console.error('監視エラー:', err.message);
    throw err;
  } finally {
    isChecking = false;
  }
}

function restartScheduler() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
  const config = loadConfig();
  const minutes = Math.max(1, Number(config.pollIntervalMinutes || 5));
  timerHandle = setInterval(() => {
    safeRunCheck().catch((err) => console.error('定期チェック失敗:', err.message));
  }, minutes * 60 * 1000);
  console.log(`定期監視タイマー設定: ${minutes}分間隔`);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const { pathname } = urlObj;
    const method = req.method || 'GET';

    // API Routes
    if (pathname === '/api/status' && method === 'GET') {
      const config = loadConfig();
      const state = loadState();
      return sendJson(res, 200, {
        config: maskConfigForClient(config),
        state,
        isChecking,
      });
    }

    if (pathname === '/api/rules' && method === 'POST') {
      const input = await readJsonBody(req);
      const config = loadConfig();
      const shopId = extractShopId(input.shopUrl);

      const rule = {
        id: input.id || `rule-${Date.now()}`,
        name: (input.name || `施設 ${shopId}`).trim(),
        enabled: input.enabled !== false,
        shopUrl: input.shopUrl.trim(),
        shopName: (input.shopName || '').trim(),
        kind: input.kind || 'individual',
        dayFilter: input.dayFilter || 'weekend_holiday',
        customDays: Array.isArray(input.customDays) ? input.customDays.map(Number) : [0, 6],
        includeHolidays: Boolean(input.includeHolidays),
        startTimeFrom: (input.startTimeFrom || '').trim(),
        startTimeTo: (input.startTimeTo || '').trim(),
        keyword: (input.keyword || '').trim(),
        lookaheadDays: Math.max(1, Number(input.lookaheadDays || 14)),
        thresholdRemaining: Math.max(0, Number(input.thresholdRemaining ?? 5)),
        notifyMode: input.notifyMode === 'once' ? 'once' : 'on_decrease',
        notifyFull: input.notifyFull !== false,
        notifyReopen: input.notifyReopen !== false,
      };

      const idx = config.rules.findIndex((r) => r.id === rule.id);
      if (idx >= 0) config.rules[idx] = rule;
      else config.rules.push(rule);

      saveConfig(config);
      return sendJson(res, 200, { ok: true, rule, config: maskConfigForClient(config) });
    }

    const toggleMatch = pathname.match(/^\/api\/rules\/([^/]+)\/toggle$/);
    if (toggleMatch && method === 'PATCH') {
      const ruleId = decodeURIComponent(toggleMatch[1]);
      const config = loadConfig();
      const rule = config.rules.find((r) => r.id === ruleId);
      if (!rule) return sendJson(res, 404, { ok: false, error: 'ルールが見つかりません' });
      rule.enabled = !rule.enabled;
      saveConfig(config);
      return sendJson(res, 200, { ok: true, rule });
    }

    const deleteMatch = pathname.match(/^\/api\/rules\/([^/]+)$/);
    if (deleteMatch && method === 'DELETE') {
      const ruleId = decodeURIComponent(deleteMatch[1]);
      const config = loadConfig();
      config.rules = config.rules.filter((r) => r.id !== ruleId);
      saveConfig(config);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/settings' && method === 'PUT') {
      const { pollIntervalMinutes, notifications } = await readJsonBody(req);
      const config = loadConfig();

      if (pollIntervalMinutes !== undefined) {
        config.pollIntervalMinutes = Math.max(1, Number(pollIntervalMinutes));
      }

      if (notifications?.email) {
        const prev = config.notifications.email || {};
        const next = notifications.email;
        config.notifications.email = {
          ...prev,
          enabled: Boolean(next.enabled),
          host: (next.host || 'smtp.gmail.com').trim(),
          port: Number(next.port || 587),
          secure: Boolean(next.secure),
          user: (next.user || '').trim(),
          pass: next.pass ? next.pass : prev.pass || '',
          from: (next.from || '').trim(),
          to: (next.to || '').trim(),
        };
      }

      if (notifications?.line) {
        const prev = config.notifications.line || {};
        const next = notifications.line;
        config.notifications.line = {
          ...prev,
          enabled: Boolean(next.enabled),
          channelAccessToken: next.channelAccessToken
            ? next.channelAccessToken.trim()
            : prev.channelAccessToken || '',
          userId: (next.userId || '').trim(),
        };
      }

      saveConfig(config);
      restartScheduler();
      return sendJson(res, 200, { ok: true, config: maskConfigForClient(config) });
    }

    if (pathname === '/api/check' && method === 'POST') {
      const result = await safeRunCheck();
      if (!result) return sendJson(res, 409, { ok: false, error: '現在チェック実行中です' });
      return sendJson(res, 200, { ok: true, result });
    }

    if (pathname === '/api/test-notify' && method === 'POST') {
      const body = await readJsonBody(req);
      const config = loadConfig();
      const sent = await sendTestNotification(config.notifications, body?.channel || 'all');
      return sendJson(res, 200, { ok: true, sent });
    }

    if (pathname === '/api/preview-shop' && method === 'POST') {
      const body = await readJsonBody(req);
      const data = await fetchShopEvents(body?.shopUrl, {
        kind: body?.kind || 'individual',
        maxPages: 1,
      });
      return sendJson(res, 200, {
        ok: true,
        shopId: data.shopId,
        shopName: data.shopName,
        sampleCount: data.events.length,
        sampleEvents: data.events.slice(0, 8),
      });
    }

    // Static files
    if (method === 'GET') {
      return serveStatic(res, pathname);
    }

    sendJson(res, 404, { ok: false, error: 'Not Found' });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`LaBOLA 個サル空き枠モニター 起動中`);
  console.log(`管理画面: http://localhost:${PORT}`);
  console.log(`==================================================`);
  restartScheduler();
  safeRunCheck().catch((err) => console.error('初回チェック失敗:', err.message));
});
