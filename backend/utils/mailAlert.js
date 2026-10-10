const fs = require('node:fs/promises');
const path = require('node:path');

function mailbox(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) throw new Error('INVALID_ALERT_MAILBOX');
  return value;
}
function smtpConfig(env) {
  const port = Number(env.SMTP_PORT || 465);
  if (![465, 587].includes(port) || !/^[A-Za-z0-9.-]+$/.test(env.SMTP_HOST || '')) throw new Error('INVALID_SMTP_ENDPOINT');
  const user = mailbox(env.SMTP_USER);
  const from = mailbox(env.SMTP_FROM || user), to = mailbox(env.ALERT_EMAIL_TO);
  if (!env.SMTP_PASSWORD_FILE || !path.isAbsolute(env.SMTP_PASSWORD_FILE)) throw new Error('SMTP_PASSWORD_FILE_REQUIRED');
  return { host: env.SMTP_HOST, port, user, from, to, passwordFile: env.SMTP_PASSWORD_FILE };
}
function alertTransport(env) {
  const type = env.ALERT_TRANSPORT || 'webhook';
  if (type === 'smtp') { smtpConfig(env); return type; }
  if (type !== 'webhook' || new URL(env.ALERT_WEBHOOK_URL).protocol !== 'https:') throw new Error('INVALID_ALERT_DESTINATION');
  return type;
}
async function sendEmail(payload, env = process.env, deps = {}) {
  const config = smtpConfig(env);
  const password = (await (deps.readFile || fs.readFile)(config.passwordFile, 'utf8')).trim();
  if (!password || /[\r\n\0]/.test(password)) throw new Error('INVALID_SMTP_PASSWORD_FILE');
  const titles = { firing: '故障告警', resolved: '恢复通知', test: '测试通知' };
  if (!titles[payload.status] || !Array.isArray(payload.checks) || payload.checks.some(id => !/^[a-z0-9_]{1,100}$/.test(id))) throw new Error('INVALID_ALERT_PAYLOAD');
  const createTransport = deps.createTransport || require('nodemailer').createTransport;
  const transport = createTransport({
    host: config.host, port: config.port, secure: config.port === 465, requireTLS: true,
    auth: { user: config.user, pass: password }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, dnsTimeout: 10000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true
  });
  try {
    const result = await transport.sendMail({
      from: { name: '同济足协网站监控', address: config.from }, to: config.to,
      subject: `[TJ足协] ${titles[payload.status]}`,
      text: `同济足协网站${titles[payload.status]}\n时间：${new Date(payload.time).toISOString()}\n${payload.checks.length ? '检查项：\n' + payload.checks.join('\n') : payload.status === 'test' ? '这是一封部署验收测试邮件，不代表网站发生故障。' : '此前报告的检查项已恢复。'}\n\n请通过服务器私有运维日志排查；此邮件不包含账号密码、个人资料或上传材料。`
    });
    if (!result.accepted?.some(address => String(address).toLowerCase() === config.to.toLowerCase()) || result.rejected?.length) throw new Error('ALERT_RECIPIENT_REJECTED');
  } finally { transport.close(); }
}
module.exports = { smtpConfig, alertTransport, sendEmail };
