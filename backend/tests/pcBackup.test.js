const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inventory } = require('../utils/backupIntegrity');
const { parseCommand, selectBackup, acknowledge } = require('../../deploy/servePcBackup');
const { sourceInfo, synchronize } = require('../../deploy/pcBackup');
const { pcBackupFresh } = require('../../deploy/monitor');
const name = 'refweb-2026-01-01T00-00-00-000Z-aabbccdd', digest = 'a'.repeat(64), snapshot = 'b'.repeat(64);

test('受限备份入口拒绝路径、任意命令、参数注入和无效确认', () => {
  assert.equal(parseCommand('latest').action, 'latest');
  assert.equal(parseCommand(`download ${name} ${digest}`).action, 'download');
  assert.equal(parseCommand(`ack ${name} ${digest} ${snapshot}`).snapshot, snapshot);
  for (const command of ['', 'sh', 'latest; id', 'latest\n', `download ../${name} ${digest}`, `download ${name} ${digest} ${snapshot}`, `ack ${name} ${digest}`, `ack ${name} ${digest} ${snapshot}\n`]) assert.throws(() => parseCommand(command));
  assert.throws(() => sourceInfo(JSON.stringify({ name: '../../etc/passwd', digest, created_at: new Date().toISOString() })));
});

test('导出只允许停写一致备份，文件损坏或清单改变不能确认成功', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tj-pc-export-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, name);
  await fs.mkdir(path.join(dir, 'uploads'), { recursive: true });
  await fs.writeFile(path.join(dir, 'database.sql'), 'isolated test');
  const manifest = { format: 2, created_at: '2026-01-01T00:00:00Z', consistency: 'test-isolated', files: await inventory(dir) };
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const env = { BACKUP_DIR: root, MONITOR_STATE_DIR: path.join(root, 'ops') };
  await assert.rejects(selectBackup(parseCommand('latest'), env), /not_found/);
  manifest.consistency = 'service-stopped';
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const { info } = await selectBackup(parseCommand('latest'), env);
  await assert.rejects(selectBackup(parseCommand(`download ${name} ${digest}`), env), /digest_mismatch/);
  await selectBackup(parseCommand(`download ${name} ${info.digest}`), env);
  await acknowledge(info, snapshot, env);
  const record = JSON.parse(await fs.readFile(path.join(env.MONITOR_STATE_DIR, 'pc-backup-status.json')));
  assert.equal(record.backup_created_at, info.created_at);
  await fs.writeFile(path.join(dir, 'database.sql'), 'corrupted');
  await assert.rejects(selectBackup(parseCommand(`ack ${name} ${info.digest} ${snapshot}`), env), /校验失败/);
});

test('48小时检测使用源备份时间，重复确认旧文件不能掩盖漏备份', () => {
  const now = Date.now(), fresh = new Date(now).toISOString();
  const record = { status: 'ok', time: fresh, backup_created_at: fresh, snapshot };
  assert.equal(pcBackupFresh(record, 48, now), true);
  for (const override of [{ backup_created_at: new Date(now - 49 * 3600000).toISOString() }, { time: new Date(now - 49 * 3600000).toISOString() }, { backup_created_at: 'invalid' }, { time: new Date(now + 600000).toISOString() }, { snapshot: '' }]) assert.equal(pcBackupFresh({ ...record, ...override }, 48, now), false);
});

test('PC传输或仓库校验失败不回报成功，已有快照不重复下载，保留策略不按唯一标签分组', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tj-pc-client-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'config'), 'fake test repository marker');
  await fs.writeFile(path.join(root, 'password'), 'fake test secret');
  const config = { repository: root, passwordFile: path.join(root, 'password'), restic: path.join(root, 'restic'), ssh: path.join(root, 'ssh'), identityFile: path.join(root, 'id'), knownHostsFile: path.join(root, 'known'), host: 'example.test', user: 'root', port: 22 };
  const info = { name, digest, created_at: '2026-01-01T00:00:00Z' };
  let exists = false, fail = '', calls = [];
  const runner = async (exe, args) => {
    calls.push(args);
    if (exe === config.ssh) return args.at(-1) === 'latest' ? JSON.stringify(info) : 'ok\n';
    if (args[0] === fail) throw new Error('failure');
    if (args[0] === 'snapshots') return JSON.stringify(exists ? [{ id: snapshot, hostname: 'tj-refweb-production', tags: ['tj-refweb-pc', `source:${name}`, `manifest:${digest}`] }] : []);
    if (args[0] === 'backup') exists = true;
    return '';
  };
  for (const step of ['backup', 'check']) {
    fail = step; exists = false; calls = [];
    await assert.rejects(synchronize(config, runner), /failure/);
    assert.equal(calls.some(c => c.at(-1).startsWith('ack ')), false);
  }
  fail = ''; exists = false; calls = [];
  assert.equal((await synchronize(config, runner)).event, 'backup_downloaded');
  assert.ok(calls.find(c => c[0] === 'backup').includes('--stdin-from-command'));
  const forget = calls.find(c => c[0] === 'forget');
  assert.equal(forget[forget.indexOf('--group-by') + 1], 'host');
  calls = [];
  assert.equal((await synchronize(config, runner)).event, 'backup_already_present');
  assert.equal(calls.some(c => c[0] === 'backup'), false);
  assert.ok(calls.some(c => c[0] === 'check'));
  fail = 'check'; calls = [];
  await assert.rejects(synchronize(config, runner), /failure/);
  assert.equal(calls.some(c => c.at(-1).startsWith('ack ')), false);
});
