// 由 root 的 systemd oneshot 执行。停服区间只包含本机一致性备份，异机传输在恢复服务后执行。
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { listBackups, prune } = require('../backend/scripts/backupMaintenance');
const { verifyBackup } = require('../backend/utils/backupIntegrity');
const root = path.resolve(__dirname, '..');

function run(command, args, env = process.env, capture = false, timeout = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd: root, shell: false, windowsHide: true, timeout, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    // 不收集原始输出，远端 URL、密码及 SQL 错误不进入日志。
    if (capture) { child.stdout.resume(); child.stderr.resume(); }
    child.once('error', () => reject(new Error('command_start_failed')));
    child.once('close', code => code === 0 ? resolve() : reject(new Error('command_failed')));
  });
}
async function status(file, value, env) {
  const directory = env.MONITOR_STATE_DIR || '/var/lib/tj-refweb/ops';
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(directory, file) + '.tmp', JSON.stringify({ status: value, time: new Date().toISOString() }), { mode: 0o600 });
  await fs.rename(path.join(directory, file) + '.tmp', path.join(directory, file));
}
async function waitForReady(env = process.env) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${Number(env.PORT || 3000)}/health`, { signal: AbortSignal.timeout(1000) });
      const result = await response.json();
      if (response.ok && result.status === 'ok' && result.checks?.database === 'ok' && result.checks?.migrations === 'ok') return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('service_not_ready_after_backup');
}
async function withStoppedService(action, runner = run, marker, ready = waitForReady) {
  // 非运行状态拒绝自动启停；防止管理员主动停服时被备份任务意外启动。
  await runner('systemctl', ['is-active', '--quiet', 'tj-refweb.service']);
  if (marker) await fs.writeFile(marker, 'resume\n', { flag: 'wx', mode: 0o600 });
  try {
    await runner('systemctl', ['stop', 'tj-refweb.service']);
    await action();
  } finally {
    await runner('systemctl', ['start', 'tj-refweb.service']);
    // systemd Type=simple returns before Node/MySQL startup completes. Keep the
    // maintenance marker until readiness, so the monitor cannot mistake startup for an outage.
    if (marker) await ready();
    if (marker) await fs.unlink(marker);
  }
}
async function main(env = process.env) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('仅支持 Linux root 运维服务');
  await status('backup-status.json', 'running', env);
  try {
    await withStoppedService(() => run(process.execPath, [path.join(root, 'backend/scripts/backup.js')], { ...env, BACKUP_CONSISTENCY: 'service-stopped', BACKUP_INCLUDE_DEPLOYMENT: 'true' }, false, 600000), run, '/run/tj-refweb-backup/resume');
    await status('backup-status.json', 'ok', env);
  } catch (error) { await status('backup-status.json', 'failed', env); throw error; }
  if (env.OFFSITE_BACKUP === 'restic') {
    try {
      if (!env.RESTIC_REPOSITORY || !env.RESTIC_PASSWORD_FILE) throw new Error('offsite_not_configured');
      const backup = (await listBackups(env.BACKUP_DIR))[0];
      if (!backup) throw new Error('backup_missing');
      await verifyBackup(backup.directory);
      const limit = Number(env.RESTIC_UPLOAD_KIB || 200);
      if (!Number.isInteger(limit) || limit < 1) throw new Error('invalid_upload_limit');
      await run('restic', ['backup', '--limit-upload', String(limit), '--tag', 'tj-refweb', '--host', 'tj-refweb-production', backup.directory], env, true);
      await status('offsite-status.json', 'ok', env);
      // 固定 host/tag 限定本项目的快照，不能误删同仓库其它主机备份。
      await run('restic', ['forget', '--tag', 'tj-refweb', '--host', 'tj-refweb-production', '--group-by', 'host,tags', '--keep-daily', '30', '--keep-weekly', '8', '--prune'], env, true);
      await run('restic', ['check'], env, true);
    } catch (error) { await status('offsite-status.json', 'failed', env); throw error; }
  } else if (!['disabled', 'pc-pull'].includes(env.OFFSITE_BACKUP)) throw new Error('unknown_offsite_mode');
  await prune(env.BACKUP_DIR, Number(env.BACKUP_RETENTION_DAYS || 7));
  console.log(JSON.stringify({ channel: 'backup', event: 'backup_cycle_complete', offsite: env.OFFSITE_BACKUP }));
}
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ channel: 'backup', event: 'backup_cycle_failed' })); process.exitCode = 1; });
module.exports = { withStoppedService, run };
