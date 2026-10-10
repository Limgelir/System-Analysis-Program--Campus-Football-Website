const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateRollout, readRollout, resolveAppearance, getAppearance } = require('../services/appearanceRollout');

test('默认关闭；角色与ID严格组合匹配，不暴露名单', () => {
  const accounts = [{ role: 'player', id: 7 }];
  assert.deepEqual(readRollout(), { enabled: false, accounts: [] });
  assert.equal(resolveAppearance({ role: 'player', id: 7 }, { enabled: false, accounts }).enabled, false);
  assert.equal(resolveAppearance({ role: 'player', id: 7 }, { enabled: true, accounts }).enabled, true);
  assert.equal(resolveAppearance({ role: 'referee', id: 7 }, { enabled: true, accounts }).enabled, false);
  assert.equal(resolveAppearance({ role: 'player', id: 8 }, { enabled: true, accounts }).enabled, false);
  assert.equal(Object.hasOwn(resolveAppearance(accounts[0], { enabled: true, accounts }), 'accounts'), false);
});

test('拒绝隐式全员、字符串ID、未知角色、重复名单和相对路径', () => {
  for (const config of [{ enabled: 'true', accounts: [] }, { enabled: true, accounts: '*'}, { enabled: true, all: true, accounts: [] }, ...[
    [{ role: 'player', id: '7' }], [{ role: 'player', id: 0 }], [{ role: 'superadmin', id: 1 }], [{ role: 'player', id: 7 }, { role: 'player', id: 7 }]
  ].map(accounts => ({ enabled: true, accounts }))]) assert.throws(() => validateRollout(config));
  assert.throws(() => readRollout('relative.json'), /绝对路径/);
});

test('配置热更新和总开关即时读取；损坏或丢失时关闭新版', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appearance-policy-')), file = path.join(dir, 'policy.json');
  const old = process.env.APPEARANCE_ROLLOUT_FILE, warn = console.warn;
  t.after(() => { if (old === undefined) delete process.env.APPEARANCE_ROLLOUT_FILE; else process.env.APPEARANCE_ROLLOUT_FILE = old; console.warn = warn; fs.unlinkSync(file); fs.rmdirSync(dir); });
  process.env.APPEARANCE_ROLLOUT_FILE = file; console.warn = () => {};
  const actor = { role: 'admin', id: 1 };
  assert.equal(getAppearance(actor).enabled, false);
  fs.writeFileSync(file, JSON.stringify({ enabled: true, accounts: [actor] }));
  assert.equal(getAppearance(actor).enabled, true);
  fs.writeFileSync(file, JSON.stringify({ enabled: false, accounts: [actor] }));
  assert.equal(getAppearance(actor).enabled, false);
  fs.writeFileSync(file, '{broken'); assert.equal(getAppearance(actor).enabled, false);
});

test('真实认证中间件验证会话；请求参数不能指定他人，撤销或停用账号被拒绝', async t => {
  const express = require('express'), jwt = require('jsonwebtoken');
  const services = { admin: require('../services/adminService'), referee: require('../services/refereeService'), player: require('../services/playerService') };
  const originals = Object.fromEntries(Object.entries(services).map(([role, service]) => [role, service.getSecurityState]));
  const secret = process.env.JWT_SECRET, configPath = process.env.APPEARANCE_ROLLOUT_FILE;
  process.env.JWT_SECRET = 'appearance-test-only-secret'; delete process.env.APPEARANCE_ROLLOUT_FILE;
  for (const service of Object.values(services)) service.getSecurityState = async () => ({ token_version: 2, is_active: 1 });
  const app = express(); app.use('/api/appearance', require('../routes/appearanceRoutes'));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); for (const [role, service] of Object.entries(services)) service.getSecurityState = originals[role]; if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret; if (configPath !== undefined) process.env.APPEARANCE_ROLLOUT_FILE = configPath; });
  const url = `http://127.0.0.1:${server.address().port}/api/appearance`;
  assert.equal((await fetch(url)).status, 401);
  for (const role of Object.keys(services)) {
    const token = jwt.sign({ role, id: 9, tokenVersion: 2 }, process.env.JWT_SECRET);
    const response = await fetch(url + '?role=admin&id=1', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).data, { enabled: false, account: { role, id: 9 } });
    const revoked = jwt.sign({ role, id: 9, tokenVersion: 1 }, process.env.JWT_SECRET);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${revoked}` } })).status, 401);
  }
  services.player.getSecurityState = async () => ({ token_version: 2, is_active: 0 });
  const disabled = jwt.sign({ role: 'player', id: 9, tokenVersion: 2 }, process.env.JWT_SECRET);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${disabled}` } })).status, 401);
});
