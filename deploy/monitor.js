// 单机探测；整机断电/网络断开需另配外部 HTTP 监控，不能由本机自行保证告警。
const fs = require('node:fs/promises');
const path = require('node:path');
const tls = require('node:tls');
const { listBackups } = require('../backend/scripts/backupMaintenance');
const { validate } = require('./renderProduction');
const { alertTransport, sendEmail } = require('../backend/utils/mailAlert');

function number(env, name, fallback, min = 1, max = Infinity) {
  const value = Number(env[name] || fallback);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`无效运维参数: ${name}`);
  return value;
}
async function probe(url, expected = 'health') {
  const response = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: 'error' });
  if (!response.ok) throw new Error('HTTP_UNAVAILABLE');
  if (expected === 'health') {
    const result = await response.json();
    if (result.status !== 'ok' || result.checks?.database !== 'ok' || result.checks?.migrations !== 'ok') throw new Error('NOT_READY');
  } else if (expected === 'live' && (await response.json()).status !== 'ok') throw new Error('NOT_LIVE');
}
function certificateDays(host, port = 443) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true });
    socket.setTimeout(7000, () => socket.destroy(new Error('TLS_TIMEOUT')));
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      const days = (Date.parse(socket.getPeerCertificate().valid_to) - Date.now()) / 86400000;
      socket.end();
      Number.isFinite(days) ? resolve(days) : reject(new Error('TLS_INVALID'));
    });
  });
}
async function collect(env = process.env, deps = {}) {
  const io = { probe, certificateDays, statfs: fs.statfs.bind(fs), listBackups, readFile: fs.readFile.bind(fs), ...deps };
  const sites = validate(JSON.parse(await io.readFile(env.SITES_CONFIG || '/etc/tj-refweb/sites.json', 'utf8')));
  const issues = [];
  const check = async (id, fn) => { try { await fn(); } catch { issues.push(id); } };
  let backupStatus;
  try { backupStatus = JSON.parse(await io.readFile(path.join(env.MONITOR_STATE_DIR || '/var/lib/tj-refweb/ops', 'backup-status.json'), 'utf8')); } catch {}
  let maintenance = false;
  try {
    maintenance = backupStatus?.status === 'running' && Date.now() - Date.parse(backupStatus.time) >= 0 && Date.now() - Date.parse(backupStatus.time) < 600000 && (await io.readFile('/run/tj-refweb-backup/resume', 'utf8')) === 'resume\n';
  } catch {}
  await Promise.all([
    ...(!maintenance ? [
      check('service_unavailable', () => io.probe(`http://127.0.0.1:${sites.backendPort}/health/live`, 'live')),
      check('database_or_migrations_unavailable', () => io.probe(`http://127.0.0.1:${sites.backendPort}/health`)),
      ...[sites.refereeDomain, sites.playerDomain].map((domain, i) => check(i ? 'player_https_unavailable' : 'referee_https_unavailable', () => io.probe(`https://${domain}:${sites.httpsPort}/health`)))
    ] : []),
    ...[sites.refereeDomain, sites.playerDomain, ...sites.refereeAliases].map((domain, i) => check(`certificate_${i}_invalid_or_expiring`, async () => {
      if (await io.certificateDays(domain, sites.httpsPort) < number(env, 'MONITOR_CERT_DAYS', 21)) throw new Error('EXPIRING');
    }))
  ]);
  for (const [id, directory] of [['root', '/'], ['uploads', env.UPLOAD_DIR], ['backups', env.BACKUP_DIR]]) {
    await check(`disk_${id}_unavailable_or_full`, async () => {
      const stat = await io.statfs(directory);
      if (!stat.blocks || (1 - stat.bavail / stat.blocks) * 100 >= number(env, 'MONITOR_DISK_PERCENT', 80, 1, 99)) throw new Error('DISK_FULL');
    });
  }
  const maxAge = number(env, 'BACKUP_MAX_AGE_HOURS', 30) * 3600000;
  await check('backup_missing_or_stale', async () => {
    const recent = (await io.listBackups(env.BACKUP_DIR)).filter(b => b.manifest.consistency === 'service-stopped')[0];
    if (!recent || Date.now() - recent.created > maxAge || recent.created > Date.now() + 300000) throw new Error('BACKUP_STALE');
  });
  await check('scheduled_backup_failed', async () => {
    if (maintenance) return;
    const result = JSON.parse(await io.readFile(path.join(env.MONITOR_STATE_DIR || '/var/lib/tj-refweb/ops', 'backup-status.json'), 'utf8'));
    if (result.status !== 'ok' || !Number.isFinite(Date.parse(result.time)) || Date.now() - Date.parse(result.time) > maxAge) throw new Error('BACKUP_FAILED');
  });
  if (env.OFFSITE_BACKUP === 'restic') await check('offsite_backup_missing_or_stale', async () => {
    const result = JSON.parse(await io.readFile(path.join(env.MONITOR_STATE_DIR || '/var/lib/tj-refweb/ops', 'offsite-status.json'), 'utf8'));
    if (result.status !== 'ok' || !Number.isFinite(Date.parse(result.time)) || Date.now() - Date.parse(result.time) > maxAge) throw new Error('OFFSITE_FAILED');
  });
  else if (env.OFFSITE_BACKUP === 'pc-pull') await check('pc_backup_missing_or_stale', async () => {
    const result = JSON.parse(await io.readFile(path.join(env.MONITOR_STATE_DIR || '/var/lib/tj-refweb/ops', 'pc-backup-status.json'), 'utf8'));
    if (!pcBackupFresh(result, number(env, 'PC_BACKUP_MAX_AGE_HOURS', 48))) throw new Error('PC_BACKUP_STALE');
  });
  else issues.push('offsite_backup_not_configured');
  try { alertTransport(env); } catch { issues.push('alert_destination_not_configured'); }
  return issues.sort();
}
async function notify(payload, env = process.env) {
  if (alertTransport(env) === 'smtp') return sendEmail(payload, env);
  const url = new URL(env.ALERT_WEBHOOK_URL);
  if (url.protocol !== 'https:') throw new Error('告警地址必须是 HTTPS');
  const result = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!result.ok) throw new Error('告警接收端返回失败');
  // 该协议以 HTTP 2xx 为接收成功；上线时必须人工核对接收端，不能直接套用企业微信等不同协议。
}
function pcBackupFresh(result, hours = 48, now = Date.now()) {
  const source = Date.parse(result?.backup_created_at), ack = Date.parse(result?.time);
  // Repeatedly acknowledging an old snapshot must not hide a missed daily backup.
  return result?.status === 'ok' && /^[a-f0-9]{64}$/.test(result.snapshot || '') && [source, ack].every(t => Number.isFinite(t) && t <= now + 300000 && now - t <= hours * 3600000);
}
async function report(issues, previous = {}, send, now = Date.now(), repeatMs = 21600000) {
  const fingerprint = JSON.stringify(issues);
  const shouldSend = issues.length ? previous.fingerprint !== fingerprint || now - (previous.sentAt || 0) >= repeatMs : Boolean(previous.issues?.length);
  if (!shouldSend) return previous;
  await send({ source: 'tj-refweb', time: new Date(now).toISOString(), status: issues.length ? 'firing' : 'resolved', checks: issues });
  return { fingerprint, issues, sentAt: now };
}
async function main(env = process.env) {
  const stateRoot = env.MONITOR_STATE_DIR || '/var/lib/tj-refweb/ops';
  if (!path.isAbsolute(stateRoot)) throw new Error('MONITOR_STATE_DIR 必须为绝对路径');
  await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const file = path.join(stateRoot, 'monitor-state.json');
  let previous = {};
  try { previous = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const issues = await collect(env);
  console.log(JSON.stringify({ time: new Date().toISOString(), channel: 'monitor', checks: issues }));
  if (!issues.includes('alert_destination_not_configured')) {
    const next = await report(issues, previous, payload => notify(payload, env), Date.now(), number(env, 'MONITOR_ALERT_REPEAT_HOURS', 6) * 3600000);
    await fs.writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
  }
  if (issues.length) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ channel: 'monitor', event: 'monitor_failed_or_delivery_failed' })); process.exitCode = 1; });
module.exports = { collect, probe, certificateDays, report, notify, pcBackupFresh };
