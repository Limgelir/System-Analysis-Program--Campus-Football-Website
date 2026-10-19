const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
if (process.env.REFWEB_INTEGRATION_TEST !== '1' || !process.env.DB_NAME?.endsWith('_test')) throw Error('仅限隔离测试库');
const pool = require('../../db'), app = require('../../server');
test('批量赛程与当前名单导出 API', async t => {
  const password = 'BulkTest!2026';
  await pool.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())', ['bulk-admin', await bcrypt.hash(password, 4)]);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (path, options = {}) => {
    const headers = new Headers(); if (options.token) headers.set('Authorization', 'Bearer ' + options.token);
    let body = options.body;
    if (body !== undefined && !(body instanceof FormData)) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(body); }
    const response = await fetch(`http://127.0.0.1:${server.address().port}` + path, { method: options.method || (body === undefined ? 'GET' : 'POST'), headers, body });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  };
  const expectStatus = (r, n, label) => assert.equal(r.status, n, label + ': ' + JSON.stringify(r.data));
  try {
    const login = await request('/api/admin/login', { body: { username: 'bulk-admin', password } }); expectStatus(login, 200, '登录');
    await require('./scheduleImports.cjs')({ t, pool, state: { tokens: { admin: login.data.data.token } }, request, expectStatus });
  } finally { await new Promise(resolve => server.close(resolve)); await pool.end(); }
});
