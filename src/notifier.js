import { sendSmtpMail } from './smtp.js';

const LINE_PUSH_API = 'https://api.line.me/v2/bot/message/push';

/**
 * 通知用の本文・件名を生成
 */
export function formatAlertMessage(alert) {
  const { event, rule, reason } = alert;
  const holidayTag = event.holidayName ? ` [${event.holidayName}]` : '';
  const dateLabel = `${event.date}（${event.dayOfWeek}）${holidayTag} ${event.startTime}〜${event.endTime}`;
  const countLabel =
    event.booked !== null && event.capacity !== null
      ? `${event.booked} / ${event.capacity}人（残り ${event.remaining}人）`
      : `${event.status}`;

  let badge = '⚠️ 空き枠わずか';
  if (reason === 'full') badge = '🚫 満員になりました';
  else if (reason === 'reopen') badge = '🎉 キャンセルで空きが出ました！';

  const subject = `${badge}【${event.shopName}】${event.date}(${event.dayOfWeek}) ${event.startTime} 残り${event.remaining}人`;

  const text = [
    `${badge}`,
    ``,
    `■ 施設: ${event.shopName}`,
    `■ 日時: ${dateLabel}`,
    `■ 内容: ${event.title}`,
    `■ 状況: ${event.status} / ${countLabel}`,
    `■ ルール: ${rule.name}（しきい値: 残り${rule.thresholdRemaining}人以下）`,
    ``,
    `▼ 予約ページ`,
    `${event.url}`,
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: ${reason === 'full' ? '#dc2626' : reason === 'reopen' ? '#16a34a' : '#ea580c'}; color: #fff; padding: 16px 20px;">
        <h2 style="margin: 0; font-size: 18px;">${badge}</h2>
      </div>
      <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
        <p style="margin: 0 0 8px;"><strong>施設:</strong> ${escapeHtml(event.shopName)}</p>
        <p style="margin: 0 0 8px;"><strong>日時:</strong> ${escapeHtml(dateLabel)}</p>
        <p style="margin: 0 0 8px;"><strong>内容:</strong> ${escapeHtml(event.title)}</p>
        <p style="margin: 0 0 16px; font-size: 16px;"><strong>空き状況:</strong> <span style="color: #dc2626; font-weight: bold;">${escapeHtml(countLabel)}</span>（${escapeHtml(event.status)}）</p>
        <a href="${event.url}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: bold;">LaBOLAで予約ページを開く</a>
        <p style="margin: 16px 0 0; font-size: 12px; color: #64748b;">監視ルール: ${escapeHtml(rule.name)}</p>
      </div>
    </div>
  `;

  return { subject, text, html };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * メール送信（SMTP）
 */
export async function sendEmail(emailConfig, { subject, text, html }) {
  if (!emailConfig.host || !emailConfig.user || !emailConfig.pass || !emailConfig.to) {
    throw new Error('メール設定（SMTPホスト / ユーザー / パスワード / 送信先）が不足しています');
  }

  await sendSmtpMail({
    host: emailConfig.host,
    port: Number(emailConfig.port || 587),
    secure: Boolean(emailConfig.secure),
    user: emailConfig.user,
    pass: emailConfig.pass,
    from: emailConfig.from || emailConfig.user,
    to: emailConfig.to,
    subject,
    text,
    html,
  });
}

/**
 * LINE送信（LINE Messaging API Push）
 */
export async function sendLine(lineConfig, text) {
  if (!lineConfig.channelAccessToken || !lineConfig.userId) {
    throw new Error('LINE設定（チャネルアクセストークン / ユーザーID）が不足しています');
  }

  const res = await fetch(LINE_PUSH_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${lineConfig.channelAccessToken}`,
    },
    body: JSON.stringify({
      to: lineConfig.userId,
      messages: [
        {
          type: 'text',
          text: text.slice(0, 4900),
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE送信エラー (HTTP ${res.status}): ${body}`);
  }
}

/**
 * 有効なチャンネル（メール / LINE）すべてにアラートを送信
 */
export async function sendAlert(notifications, alert) {
  const { subject, text, html } = formatAlertMessage(alert);
  const results = [];

  if (notifications?.email?.enabled) {
    await sendEmail(notifications.email, { subject, text, html });
    results.push('email');
  }

  if (notifications?.line?.enabled) {
    await sendLine(notifications.line, text);
    results.push('line');
  }

  return results;
}

/**
 * テスト通知の送信
 */
export async function sendTestNotification(notifications, channel = 'all') {
  const nowStr = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const subject = '【テスト】LaBOLA個サル空き枠モニター 通知テスト';
  const text = `LaBOLA個サル空き枠モニターからのテスト通知です。\n送信時刻: ${nowStr}\nこのメッセージが届いていれば通知設定は正常です！`;
  const html = `<p>LaBOLA個サル空き枠モニターからのテスト通知です。</p><p>送信時刻: <strong>${nowStr}</strong></p><p>このメールが届いていれば設定は正常です！</p>`;

  const sent = [];
  if ((channel === 'all' || channel === 'email') && notifications?.email?.enabled) {
    await sendEmail(notifications.email, { subject, text, html });
    sent.push('email');
  }
  if ((channel === 'all' || channel === 'line') && notifications?.line?.enabled) {
    await sendLine(notifications.line, text);
    sent.push('line');
  }

  if (sent.length === 0) {
    throw new Error('有効な通知先がありません。メールまたはLINEを有効にして保存してください。');
  }
  return sent;
}
