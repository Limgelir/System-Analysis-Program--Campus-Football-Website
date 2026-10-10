const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { render } = require('../../deploy/renderProduction');
const { inventory, verifyBackup, overlaps } = require('../utils/backupIntegrity');
const { prune } = require('../scripts/backupMaintenance');
const { withStoppedService } = require('../../deploy/runBackup');
const { collect, report } = require('../../deploy/monitor');
const { maintenanceConnection } = require('../utils/maintenanceConnection');

test('初始化/恢复仅允许Linux本机root显式socket维护，运行账户配置不变', () => {
  const env = { DB_HOST: '127.0.0.1', DB_USER: 'scoped_app', DB_PASSWORD: 'test-only' };
  assert.equal(maintenanceConnection(env, 'INIT').user, 'scoped_app');
  const init = { ...env, INIT_DB_SOCKET: '/var/run/mysqld/mysqld.sock' };
  assert.deepEqual(maintenanceConnection(init, 'INIT', 'linux', 0), { socketPath: init.INIT_DB_SOCKET, user: 'root' });
  assert.throws(() => maintenanceConnection(init, 'INIT', 'win32', 0));
  assert.throws(() => maintenanceConnection(init, 'INIT', 'linux', 1000));
  assert.throws(() => maintenanceConnection({ ...init, INIT_DB_SOCKET: 'relative' }, 'INIT', 'linux', 0));
});

test('生产入口拒绝配置注入，证书签发前不开放登录，别名固定跳转主站', () => {
  const config = render();
  assert.match(config, /server_name ref\.tongjifa\.com;/);
  assert.match(config, /return 308 https:\/\/referee\.tongjifa\.com\$request_uri/);
  assert.match(config, /proxy_set_header X-Forwarded-For \$remote_addr/);
  const initial = render({}, 'bootstrap');
  assert.doesNotMatch(initial, /ssl_certificate|proxy_pass/);
  assert.equal((initial.match(/return 503/g) || []).length, 3);
  assert.doesNotMatch(config.split('server {')[0], /\$request_uri|\$args|\$http_authorization|\$http_cookie/);
  for (const options of [{ refereeDomain: 'x; include y' }, { refereeAliases: ['player.tongjifa.com'] }, { httpsPort: 80 }, { logRoot: '/tmp/$secret' }]) assert.throws(() => render(options));
});

test('备份校验发现损坏、缺失和额外文件；清理仅处理过期受管备份且至少留两份', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'refweb-backup-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dirs = [];
  for (let i = 1; i <= 4; i++) {
    const directory = path.join(root, `refweb-2026-01-0${i}T00-00-00-000Z-aabbccdd`);
    await fs.mkdir(path.join(directory, 'uploads'), { recursive: true });
    await fs.writeFile(path.join(directory, 'database.sql'), 'isolated test data');
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ format: 2, created_at: `2026-01-0${i}T00:00:00Z`, files: await inventory(directory) }));
    dirs.push(directory);
  }
  await verifyBackup(dirs[0]);
  await fs.writeFile(path.join(dirs[0], 'extra'), 'unexpected');
  await assert.rejects(verifyBackup(dirs[0]), /校验失败/);
  await fs.unlink(path.join(dirs[0], 'extra'));
  await fs.writeFile(path.join(dirs[0], 'database.sql'), 'corrupted');
  await assert.rejects(verifyBackup(dirs[0]), /校验失败/);
  const removed = await prune(root, 7, Date.parse('2026-02-01'));
  assert.equal(removed.length, 1);
  assert.ok(await fs.stat(dirs[0]), '损坏备份保留以供排查');
  for (const directory of dirs.slice(2)) await verifyBackup(directory);
  assert.equal(overlaps(root, path.join(root, 'uploads')), true);
  assert.equal(overlaps(root, root + '-other'), false);
});

test('备份失败仍恢复原服务；原本停服时不自动启动', async () => {
  const calls = [];
  await assert.rejects(withStoppedService(async () => { throw new Error('dump_failed'); }, async (_command, args) => calls.push(args[0])), /dump_failed/);
  assert.deepEqual(calls, ['is-active', 'stop', 'start']);
  calls.length = 0;
  await assert.rejects(withStoppedService(async () => calls.push('backup'), async (_command, args) => { calls.push(args[0]); throw new Error('inactive'); }), /inactive/);
  assert.deepEqual(calls, ['is-active']);
});

test('备份恢复时等到HTTP就绪才撤去维护标记，启动失败仍保留恢复依据', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tj-backup-readiness-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'resume');
  let checked = false;
  await withStoppedService(async () => {}, async () => {}, marker, async () => {
    assert.equal(await fs.readFile(marker, 'utf8'), 'resume\n'); checked = true;
  });
  assert.equal(checked, true); await assert.rejects(fs.access(marker));
  await assert.rejects(withStoppedService(async () => {}, async () => {}, marker, async () => { throw new Error('not_ready'); }), /not_ready/);
  assert.equal(await fs.readFile(marker, 'utf8'), 'resume\n');
});

test('监控探测服务、磁盘、备份和证书故障，不依赖真实服务器或告警接收人', async () => {
  const sites = require('../../deploy/sites.example.json');
  const env = { UPLOAD_DIR: '/uploads', BACKUP_DIR: '/backups', OFFSITE_BACKUP: 'restic', ALERT_WEBHOOK_URL: 'https://example.test/hook' };
  const deps = {
    readFile: async file => file.endsWith('sites.json') ? JSON.stringify(sites) : JSON.stringify({ status: 'ok', time: new Date().toISOString() }),
    probe: async () => {}, certificateDays: async () => 60,
    statfs: async () => ({ blocks: 100, bavail: 50 }),
    listBackups: async () => [{ created: Date.now(), manifest: { consistency: 'service-stopped' } }]
  };
  assert.deepEqual(await collect(env, deps), []);
  const errors = await collect(env, { ...deps, probe: async () => { throw new Error('offline'); }, certificateDays: async () => 3, statfs: async () => ({ blocks: 100, bavail: 5 }), listBackups: async () => [] });
  for (const id of ['service_unavailable', 'database_or_migrations_unavailable', 'backup_missing_or_stale', 'disk_uploads_unavailable_or_full', 'certificate_0_invalid_or_expiring']) assert.ok(errors.includes(id));
  const maintenance = await collect(env, { ...deps,
    probe: async () => { throw new Error('stopped for backup'); },
    readFile: async file => file === '/run/tj-refweb-backup/resume' ? 'resume\n' : file.endsWith('backup-status.json') ? JSON.stringify({ status: 'running', time: new Date().toISOString() }) : deps.readFile(file)
  });
  assert.deepEqual(maintenance, [], '短时且有停服标记的正常备份不误报告警');
});

test('告警去重、失败重试和恢复通知：发送失败不记录已送达', async () => {
  const sent = [];
  const send = async p => sent.push(p);
  const state = await report(['offline'], {}, send, 1000, 60000);
  assert.equal(sent.length, 1);
  assert.equal(await report(['offline'], state, send, 2000, 60000), state);
  assert.equal(sent.length, 1);
  await assert.rejects(report(['disk'], state, async () => { throw new Error('delivery'); }, 3000), /delivery/);
  await report(['disk'], state, send, 4000);
  assert.equal(sent.length, 2);
  await report([], state, send, 5000);
  assert.equal(sent[2].status, 'resolved');
});

test('请求和错误日志不包含查询参数、凭据、个人资料，异常可通过请求ID关联', async t => {
  const express = require('express');
  const { requestLog } = require('../middleware/requestLog');
  const { safeLog } = require('../utils/safeLog');
  const app = express(); app.use(requestLog); app.use(express.json());
  const router = express.Router();
  router.post('/items/:id', (req, res) => {
    req.authenticatedActor = { role: 'admin', id: 7 };
    safeLog('database_failed', { code: 'ER_BAD_FIELD_ERROR', sql: req.body.password, message: 'private material' });
    res.status(500).json({ success: false });
  });
  app.use('/api', router);
  const logs = [], errors = [], originalLog = console.log, originalError = console.error;
  console.log = line => logs.push(line); console.error = line => errors.push(line);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { console.log = originalLog; console.error = originalError; return new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/items/private-id?token=secret-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer private-jwt', 'X-Request-ID': 'unsafe-header' }, body: JSON.stringify({ password: 'PrivatePassword' })
  });
  await response.text();
  assert.doesNotMatch([...logs, ...errors].join('\n'), /PrivatePassword|secret-token|private-id|private-jwt|unsafe-header|private material/);
  const request = JSON.parse(logs[0]), operation = JSON.parse(logs[1]), error = JSON.parse(errors[0]);
  assert.equal(request.route, '/api/items/:id');
  assert.equal(operation.actor_id, 7);
  assert.equal(error.request_id, request.request_id);
  assert.equal(response.headers.get('x-request-id'), request.request_id);
});
