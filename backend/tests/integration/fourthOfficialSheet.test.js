const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
if (process.env.REFWEB_INTEGRATION_TEST !== '1' || !process.env.DB_NAME?.endsWith('_test')) throw Error('仅限隔离测试库');
const pool = require('../../db'), app = require('../../server');
test('四官单下载 API', async t => {
  await pool.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())', ['fourth-admin', await bcrypt.hash('FourthAdmin!2026', 4)]);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (path, options = {}) => {
    const headers = new Headers(); if (options.token) headers.set('Authorization', 'Bearer ' + options.token);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(`http://127.0.0.1:${server.address().port}` + path, { method: options.body === undefined ? 'GET' : 'POST', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, data };
  };
  const expectStatus = (r, n, label) => assert.equal(r.status, n, label + ': ' + (typeof r.data === 'string' ? r.data.slice(0, 50) : JSON.stringify(r.data)));
  try {
    const login = await request('/api/admin/login', { body: { username: 'fourth-admin', password: 'FourthAdmin!2026' } }); expectStatus(login, 200, '登录');
    await require('./fourthOfficialSheet.cjs')({ t, pool, state: { tokens: { admin: login.data.data.token } }, request, expectStatus });
  } finally { await new Promise(resolve => server.close(resolve)); await pool.end(); }
});
