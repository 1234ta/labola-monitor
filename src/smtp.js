import net from 'node:net';
import tls from 'node:tls';

function encodeBase64Lines(str) {
  const b64 = Buffer.from(str, 'utf-8').toString('base64');
  return b64.match(/.{1,76}/g)?.join('\r\n') || '';
}

function encodeMimeHeader(str) {
  return `=?UTF-8?B?${Buffer.from(str, 'utf-8').toString('base64')}?=`;
}

class SmtpConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.waiters = [];
    this.attachListeners(socket);
  }

  attachListeners(socket) {
    socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf-8');
      this.flush();
    });
    socket.on('error', (err) => {
      while (this.waiters.length > 0) {
        const w = this.waiters.shift();
        w.reject(err);
      }
    });
    socket.on('close', () => {
      while (this.waiters.length > 0) {
        const w = this.waiters.shift();
        w.reject(new Error('SMTP接続が予期せず閉じられました'));
      }
    });
  }

  flush() {
    while (this.waiters.length > 0) {
      const lines = this.buffer.split('\r\n');
      let completeIdx = -1;
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          completeIdx = i;
          break;
        }
      }
      if (completeIdx === -1) return;

      const respLines = lines.slice(0, completeIdx + 1);
      this.buffer = lines.slice(completeIdx + 1).join('\r\n');
      const code = Number(respLines[respLines.length - 1].slice(0, 3));
      const waiter = this.waiters.shift();
      waiter.resolve({ code, text: respLines.join('\n') });
    }
  }

  readResponse() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.flush();
    });
  }

  async command(cmd, expectedCodes) {
    this.socket.write(`${cmd}\r\n`);
    const resp = await this.readResponse();
    if (!expectedCodes.includes(resp.code)) {
      throw new Error(`SMTPエラー (${resp.code}): ${resp.text}`);
    }
    return resp;
  }

  upgradeToTls(host) {
    return new Promise((resolve, reject) => {
      const oldSocket = this.socket;
      oldSocket.removeAllListeners('data');
      oldSocket.removeAllListeners('error');
      oldSocket.removeAllListeners('close');

      const tlsSocket = tls.connect(
        { socket: oldSocket, servername: host },
        () => {
          this.socket = tlsSocket;
          this.buffer = '';
          this.attachListeners(tlsSocket);
          resolve();
        }
      );
      tlsSocket.once('error', reject);
    });
  }

  close() {
    try {
      this.socket.end();
    } catch {
      // ignore
    }
  }
}

/**
 * 依存パッケージ不要のSMTPメール送信（STARTTLS: 587 / SMTPS: 465対応）
 */
export async function sendSmtpMail({ host, port = 587, secure = false, user, pass, from, to, subject, text, html }) {
  const socket = await new Promise((resolve, reject) => {
    const conn = secure
      ? tls.connect({ host, port: Number(port), servername: host }, () => resolve(conn))
      : net.connect({ host, port: Number(port) }, () => resolve(conn));
    conn.setTimeout(15000, () => {
      conn.destroy(new Error('SMTP接続がタイムアウトしました'));
    });
    conn.once('error', reject);
  });

  const smtp = new SmtpConnection(socket);
  try {
    const greeting = await smtp.readResponse();
    if (greeting.code !== 220) {
      throw new Error(`SMTP挨拶エラー: ${greeting.text}`);
    }

    await smtp.command('EHLO localhost', [250]);

    if (!secure) {
      await smtp.command('STARTTLS', [220]);
      await smtp.upgradeToTls(host);
      await smtp.command('EHLO localhost', [250]);
    }

    // AUTH LOGIN
    await smtp.command('AUTH LOGIN', [334]);
    await smtp.command(Buffer.from(user, 'utf-8').toString('base64'), [334]);
    await smtp.command(Buffer.from(pass, 'utf-8').toString('base64'), [235]);

    const fromAddr = from || user;
    await smtp.command(`MAIL FROM:<${fromAddr}>`, [250]);

    const recipients = String(to)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const rcpt of recipients) {
      await smtp.command(`RCPT TO:<${rcpt}>`, [250, 251]);
    }

    await smtp.command('DATA', [354]);

    const boundary = `----labola_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const mimeLines = [
      `From: ${fromAddr}`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${encodeMimeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      encodeBase64Lines(text || ''),
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      encodeBase64Lines(html || text || ''),
      ``,
      `--${boundary}--`,
      `.`,
    ];

    smtp.socket.write(`${mimeLines.join('\r\n')}\r\n`);
    const dataResp = await smtp.readResponse();
    if (dataResp.code !== 250) {
      throw new Error(`SMTP本文送信エラー (${dataResp.code}): ${dataResp.text}`);
    }

    await smtp.command('QUIT', [221]).catch(() => {});
  } finally {
    smtp.close();
  }
}
