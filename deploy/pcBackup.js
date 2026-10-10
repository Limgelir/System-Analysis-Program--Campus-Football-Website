// Standalone Windows client: encrypted Restic repository; SQL never touches a plaintext PC file.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

function validate(config) {
  for (const key of ['repository', 'passwordFile', 'restic', 'ssh', 'identityFile', 'knownHostsFile']) {
    if (!path.isAbsolute(config[key] || '')) throw new Error('invalid_client_path');
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(config.host || '') || config.host.startsWith('-')) throw new Error('invalid_host');
  if (!/^[a-z_][a-z0-9_-]*$/.test(config.user || '')) throw new Error('invalid_user');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('invalid_port');
  return config;
}
function run(executable, args, env = process.env, timeout = 21600000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, env, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', oversized = false;
    child.stdout.on('data', data => { output += data.toString(); if (output.length > 8 * 1024 * 1024) { oversized = true; child.kill(); } });
    child.stderr.resume(); // Never log raw SSH/Restic output, paths, credentials or backup contents.
    child.once('error', () => reject(new Error('client_command_start_failed')));
    child.once('close', code => code === 0 && !oversized ? resolve(output) : reject(new Error('client_command_failed')));
  });
}
function sshArgs(config, command) {
  return ['-i', config.identityFile, '-p', String(config.port), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${config.knownHostsFile}`, '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', `${config.user}@${config.host}`, command];
}
function sourceInfo(raw) {
  const info = JSON.parse(raw);
  if (!/^refweb-\d{4}-\d{2}-\d{2}T[\dTZ-]+-[a-f0-9]{8}$/.test(info.name || '') || !/^[a-f0-9]{64}$/.test(info.digest || '') || !Number.isFinite(Date.parse(info.created_at)) || Date.parse(info.created_at) > Date.now() + 300000) throw new Error('invalid_source_metadata');
  return info;
}
function matchSnapshot(snapshots, info) {
  return snapshots.find(s => /^[a-f0-9]{64}$/.test(s.id || '') && s.hostname === 'tj-refweb-production' && ['tj-refweb-pc', `source:${info.name}`, `manifest:${info.digest}`].every(t => s.tags?.includes(t)));
}
async function synchronize(config, runner = run) {
  validate(config);
  await fs.access(config.passwordFile);
  // Missing repository is an error, not permission to silently initialize another disk.
  await fs.access(path.join(config.repository, 'config'));
  const env = { ...process.env, RESTIC_REPOSITORY: config.repository, RESTIC_PASSWORD_FILE: config.passwordFile };
  const restic = args => runner(config.restic, args, env);
  const ssh = command => runner(config.ssh, sshArgs(config, command), process.env, 90000);
  const info = sourceInfo(await ssh('latest'));
  const snapshots = () => restic(['snapshots', '--host', 'tj-refweb-production', '--tag', 'tj-refweb-pc', '--json']).then(JSON.parse);
  let snapshot = matchSnapshot(await snapshots(), info), downloaded = false;
  if (!snapshot) {
    // Restic creates no snapshot if SSH/tar fails, even after receiving partial bytes.
    await restic(['backup', '--quiet', '--host', 'tj-refweb-production', '--tag', 'tj-refweb-pc', '--tag', `source:${info.name}`, '--tag', `manifest:${info.digest}`, '--stdin-filename', 'tj-refweb-backup.tar', '--stdin-from-command', '--', config.ssh, ...sshArgs(config, `download ${info.name} ${info.digest}`)]);
    snapshot = matchSnapshot(await snapshots(), info);
    if (!snapshot) throw new Error('verified_snapshot_missing');
    downloaded = true;
  }
  // Also validate an existing snapshot: a previous run may have stopped before its check.
  await restic(['check']);
  // Unique source tags must not create separate retention groups; prune only after a good check.
  if (downloaded) await restic(['forget', '--host', 'tj-refweb-production', '--tag', 'tj-refweb-pc', '--group-by', 'host', '--keep-daily', '30', '--keep-weekly', '8', '--prune']);
  const acknowledged = await ssh(`ack ${info.name} ${info.digest} ${snapshot.id}`);
  if (acknowledged.trim() !== 'ok') throw new Error('acknowledgement_failed');
  return { event: downloaded ? 'backup_downloaded' : 'backup_already_present', source: info.name, created_at: info.created_at, snapshot: snapshot.id };
}
async function main() {
  if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw new Error('absolute_config_required');
  const config = validate(JSON.parse(await fs.readFile(process.argv[2], 'utf8')));
  const result = await synchronize(config);
  console.log(JSON.stringify({ time: new Date().toISOString(), ...result }));
}
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ time: new Date().toISOString(), event: 'pc_backup_failed' })); process.exitCode = 1; });
module.exports = { validate, sourceInfo, matchSnapshot, synchronize, sshArgs };
