const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { smtpConfig, alertTransport, sendEmail } = require('../utils/mailAlert');
const env = { ALERT_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.test', SMTP_USER: 'sender@example.test', ALERT_EMAIL_TO: 'recipient@example.test', SMTP_PASSWORD_FILE: path.join(os.tmpdir(), 'test-smtp-secret') };
const payload = { time: '2026-09-19T00:00:00Z', status: 'firing', checks: ['backup_missing_or_stale'] };

test('邮件配置拒绝多收件人、头注入、明文端口及无效密钥路径；兼容HTTPS webhook', () => {
  assert.equal(alertTransport(env), 'smtp');
  assert.equal(alertTransport({ ALERT_WEBHOOK_URL: 'https://example.test/alert' }), 'webhook');
  for (const override of [{ ALERT_EMAIL_TO: 'one@example.test,two@example.test' }, { SMTP_FROM: 'sender@example.test\r\nBcc: other@example.test' }, { SMTP_PORT: '25' }, { SMTP_PASSWORD_FILE: 'relative' }]) assert.throws(() => smtpConfig({ ...env, ...override }));
  assert.throws(() => alertTransport({ ALERT_WEBHOOK_URL: 'http://example.test' }));
});

test('SMTP告警强制TLS，消息只含状态码且不携带授权码；成功、拒收和异常均关闭连接', async () => {
  let options, message, closes = 0, reject = false, fail = false;
  const deps = {
    readFile: async () => 'private-smtp-authorization\n',
    createTransport: config => {
      options = config;
      return {
        sendMail: async input => { message = input; if (fail) throw new Error('SMTP_FAILED'); return { accepted: reject ? [] : [env.ALERT_EMAIL_TO], rejected: reject ? [env.ALERT_EMAIL_TO] : [] }; },
        close: () => closes++
      };
    }
  };
  await sendEmail(payload, env, deps);
  assert.equal(options.secure, true); assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.debug, false); assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
  assert.equal(message.to, env.ALERT_EMAIL_TO); assert.match(message.text, /backup_missing_or_stale/);
  assert.doesNotMatch(JSON.stringify(message), /private-smtp-authorization/);
  await sendEmail({ ...payload, status: 'resolved', checks: [] }, { ...env, SMTP_PORT: '587' }, deps);
  assert.equal(options.secure, false); assert.equal(options.requireTLS, true); assert.match(message.subject, /恢复/);
  reject = true; await assert.rejects(sendEmail(payload, env, deps), /ALERT_RECIPIENT_REJECTED/);
  reject = false; fail = true; await assert.rejects(sendEmail(payload, env, deps), /SMTP_FAILED/);
  assert.equal(closes, 4);
  await assert.rejects(sendEmail({ ...payload, checks: ['password=secret'] }, env, deps), /INVALID_ALERT_PAYLOAD/);
});
