import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const STATE_PATH = path.join(DATA_DIR, 'state.json');

export function getDefaultConfig() {
  return {
    pollIntervalMinutes: 5,
    rules: [
      {
        id: 'rule-vivaio-morning',
        name: 'VIVAIO豊富 土日祝 朝6:00〜個サル',
        enabled: true,
        shopUrl: 'https://yoyaku.labola.jp/r/shop/3050/',
        shopName: 'VIVAIOフットサルパーク豊富',
        kind: 'individual',
        dayFilter: 'weekend_holiday',
        customDays: [0, 6],
        includeHolidays: true,
        startTimeFrom: '06:00',
        startTimeTo: '06:30',
        keyword: '',
        lookaheadDays: 14,
        thresholdRemaining: 5,
        notifyMode: 'on_decrease',
        notifyFull: true,
        notifyReopen: true,
      },
    ],
    notifications: {
      email: {
        enabled: false,
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        user: '',
        pass: '',
        from: '',
        to: '',
      },
      line: {
        enabled: false,
        channelAccessToken: '',
        userId: '',
      },
    },
  };
}

export function getDefaultState() {
  return {
    lastCheckedAt: null,
    lastError: null,
    notified: {},
    latestEvents: [],
    logs: [],
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 設定ファイルを読み込み（環境変数によるシークレット上書きにも対応）
 */
export function loadConfig() {
  ensureDataDir();
  let config;
  if (!fs.existsSync(CONFIG_PATH)) {
    config = getDefaultConfig();
    saveConfig(config);
  } else {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      config = JSON.parse(raw);
    } catch {
      config = getDefaultConfig();
    }
  }

  // 環境変数があればシークレットを上書き（GitHub Actions / .env 利用時用）
  const email = config.notifications?.email || {};
  if (process.env.SMTP_HOST) email.host = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT) email.port = Number(process.env.SMTP_PORT);
  if (process.env.SMTP_USER) email.user = process.env.SMTP_USER;
  if (process.env.SMTP_PASS) email.pass = process.env.SMTP_PASS;
  if (process.env.MAIL_FROM) email.from = process.env.MAIL_FROM;
  if (process.env.MAIL_TO) email.to = process.env.MAIL_TO;
  if (process.env.EMAIL_ENABLED === 'true') email.enabled = true;

  const line = config.notifications?.line || {};
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    line.channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  }
  if (process.env.LINE_USER_ID) {
    line.userId = process.env.LINE_USER_ID;
  }
  if (process.env.LINE_ENABLED === 'true') line.enabled = true;

  config.notifications = { email, line };
  return config;
}

export function saveConfig(config) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_PATH)) {
    return getDefaultState();
  }
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    return { ...getDefaultState(), ...JSON.parse(raw) };
  } catch {
    return getDefaultState();
  }
}

export function saveState(state) {
  ensureDataDir();
  // ログは直近50件まで保持
  if (Array.isArray(state.logs) && state.logs.length > 50) {
    state.logs = state.logs.slice(0, 50);
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}
