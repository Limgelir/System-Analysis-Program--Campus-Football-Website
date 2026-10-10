const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const adminService = require('../services/adminService');
const refereeService = require('../services/refereeService');
const {
  requireAdmin,
  requireAdminAuth,
  requireReferee,
  requireRefereeAuth
} = require('../middleware/auth');

const TEST_SECRET = 'unit-test-jwt-secret-that-is-long-enough';

test('数据库认证异常返回503并脱敏记录，不伪装成账号密码错误', async t => {
  const previousSecret = process.env.JWT_SECRET;
  const original = adminService.getSecurityState, originalError = console.error, lines = [];
  process.env.JWT_SECRET = TEST_SECRET;
  console.error = line => lines.push(line);
  adminService.getSecurityState = async () => { throw Object.assign(new Error('secret SQL'), { code: 'ECONNREFUSED' }); };
  t.after(() => { adminService.getSecurityState = original; console.error = originalError; if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const token = jwt.sign({ id: 1, role: 'admin', tokenVersion: 0 }, TEST_SECRET);
  const result = await invokeMiddleware(requireAdmin, token);
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.parse(lines[0]).code, 'ECONNREFUSED');
  assert.doesNotMatch(lines.join(''), /secret SQL/);
});

function invokeMiddleware(middleware, token) {
  return new Promise((resolve, reject) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ type: 'response', statusCode: this.statusCode, body, req });
      }
    };
    try {
      middleware(req, res, () => resolve({ type: 'next', req }));
    } catch (error) {
      reject(error);
    }
  });
}

test('必须改密的管理员只能通过基础管理员认证，不能访问普通管理接口', async t => {
  const previousSecret = process.env.JWT_SECRET;
  const originalGetSecurityState = adminService.getSecurityState;
  process.env.JWT_SECRET = TEST_SECRET;
  adminService.getSecurityState = async () => ({ token_version: 4, must_change_password: 1 });
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    adminService.getSecurityState = originalGetSecurityState;
  });

  const token = jwt.sign(
    { id: 1, role: 'admin', tokenVersion: 4, mustChangePassword: true },
    TEST_SECRET,
    { algorithm: 'HS256', expiresIn: '5m' }
  );

  const passwordRouteResult = await invokeMiddleware(requireAdminAuth, token);
  assert.equal(passwordRouteResult.type, 'next');

  const normalAdminResult = await invokeMiddleware(requireAdmin, token);
  assert.equal(normalAdminResult.statusCode, 403);
  assert.equal(normalAdminResult.body.code, 'ADMIN_PASSWORD_CHANGE_REQUIRED');
});

test('管理员令牌版本变化后旧令牌失效', async t => {
  const previousSecret = process.env.JWT_SECRET;
  const originalGetSecurityState = adminService.getSecurityState;
  process.env.JWT_SECRET = TEST_SECRET;
  adminService.getSecurityState = async () => ({ token_version: 5, must_change_password: 0 });
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    adminService.getSecurityState = originalGetSecurityState;
  });

  const staleToken = jwt.sign(
    { id: 1, role: 'admin', tokenVersion: 4 },
    TEST_SECRET,
    { algorithm: 'HS256', expiresIn: '5m' }
  );
  const result = await invokeMiddleware(requireAdmin, staleToken);
  assert.equal(result.statusCode, 401);
});

test('必须改密的裁判只能访问改密所需的基础认证接口', async t => {
  const previousSecret = process.env.JWT_SECRET;
  const originalGetSecurityState = refereeService.getSecurityState;
  process.env.JWT_SECRET = TEST_SECRET;
  refereeService.getSecurityState = async () => ({
    token_version: 2,
    must_change_password: 1,
    is_active: 1
  });
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    refereeService.getSecurityState = originalGetSecurityState;
  });

  const token = jwt.sign(
    { id: 9, role: 'referee', tokenVersion: 2, mustChangePassword: true },
    TEST_SECRET,
    { algorithm: 'HS256', expiresIn: '5m' }
  );

  const passwordRouteResult = await invokeMiddleware(requireRefereeAuth, token);
  assert.equal(passwordRouteResult.type, 'next');

  const normalRefereeResult = await invokeMiddleware(requireReferee, token);
  assert.equal(normalRefereeResult.statusCode, 403);
  assert.equal(normalRefereeResult.body.code, 'REFEREE_PASSWORD_CHANGE_REQUIRED');
});

test('裁判令牌版本变化或账号停用后旧令牌失效', async t => {
  const previousSecret = process.env.JWT_SECRET;
  const originalGetSecurityState = refereeService.getSecurityState;
  process.env.JWT_SECRET = TEST_SECRET;
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    refereeService.getSecurityState = originalGetSecurityState;
  });

  const token = jwt.sign(
    { id: 9, role: 'referee', tokenVersion: 2 },
    TEST_SECRET,
    { algorithm: 'HS256', expiresIn: '5m' }
  );

  refereeService.getSecurityState = async () => ({ token_version: 3, must_change_password: 0, is_active: 1 });
  const staleResult = await invokeMiddleware(requireReferee, token);
  assert.equal(staleResult.statusCode, 401);

  refereeService.getSecurityState = async () => ({ token_version: 2, must_change_password: 0, is_active: 0 });
  const inactiveResult = await invokeMiddleware(requireReferee, token);
  assert.equal(inactiveResult.statusCode, 401);
});
