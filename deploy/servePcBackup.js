// Restricted SSH entry point. Never grant this key an interactive shell.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { listBackups } = require('../backend/scripts/backupMaintenance');
const { verifyBackup } = require('../backend/utils/backupIntegrity');
const NAME = 'refweb-\\d{4}-\\d{2}-\\d{2}T[\\dTZ-]+-[a-f0-9]{8}';

function parseCommand(value) {
  if (value === 'latest') return { action: 'latest' };
  const match = new RegExp(`^(download|ack) (${NAME}) ([a-f0-9]{64})(?: ([a-f0-9]{64}))?$`).exec(value || '');
  if (!match || (match[1] === 'ack') !== Boolean(match[4])) throw new Error('invalid_backup_command');
  return { action: match[1], name: match[2], digest: match[3], snapshot: match[4] };
}
async function metadata(backup) {
  const bytes = await fs.readFile(path.join(backup.directory, 'manifest.json'));
  return { name: path.basename(backup.directory), created_at: new Date(backup.created).toISOString(), digest: createHash('sha256').update(bytes).digest('hex') };
}
async function selectBackup(command, env) {
  if (!path.isAbsolute(env.BACKUP_DIR || '')) throw new Error('invalid_backup_root');
  const backups = (await listBackups(env.BACKUP_DIR)).filter(b => b.manifest.consistency === 'service-stopped' && b.created <= Date.now() + 300000);
  const backup = command.action === 'latest' ? backups[0] : backups.find(b => path.basename(b.directory) === command.name);
  if (!backup) throw new Error('backup_not_found');
  const info = await metadata(backup);
  if (command.action !== 'latest' && info.digest !== command.digest) throw new Error('backup_digest_mismatch');
  if (command.action !== 'latest') await verifyBackup(backup.directory);
  return { backup, info };
}
async function acknowledge(info, snapshot, env) {
  const root = env.MONITOR_STATE_DIR || '/var/lib/tj-refweb/ops';
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, 'pc-backup-status.json');
  const record = { status: 'ok', time: new Date().toISOString(), backup_created_at: info.created_at, name: info.name, digest: info.digest, snapshot };
  await fs.writeFile(file + '.tmp', JSON.stringify(record), { mode: 0o600 });
  await fs.rename(file + '.tmp', file);
}
async function main(env = process.env) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('root_linux_required');
  const command = parseCommand(env.SSH_ORIGINAL_COMMAND);
  const { backup, info } = await selectBackup(command, env);
  if (command.action === 'latest') process.stdout.write(JSON.stringify(info) + '\n');
  else if (command.action === 'ack') {
    await acknowledge(info, command.snapshot, env);
    process.stdout.write('ok\n');
  } else {
    const rate = Number(env.PC_BACKUP_DOWNLOAD_KIB || 200) * 1024;
    if (!Number.isFinite(rate) || rate < 1024 || rate > 1024 * 1024) throw new Error('invalid_download_limit');
    const child = spawn('/usr/bin/tar', ['--sort=name', '-C', backup.directory, '-cf', '-', '.'], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error('tar_failed')));
    });
    // Keep tar stderr out of the archive and preserve a nonzero SSH exit on failure.
    const throttle = new Transform({ transform(chunk, encoding, callback) { setTimeout(() => callback(null, chunk), Math.ceil(chunk.length / rate * 1000)); } });
    try { await Promise.all([done, pipeline(child.stdout, throttle, process.stdout)]); }
    finally { if (child.exitCode === null) child.kill(); }
  }
}
if (require.main === module) main().catch(() => { console.error('backup_export_failed'); process.exitCode = 1; });
module.exports = { parseCommand, selectBackup, acknowledge };
