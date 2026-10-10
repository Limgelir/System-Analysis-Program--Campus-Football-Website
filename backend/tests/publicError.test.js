const test = require('node:test');
const assert = require('node:assert/strict');

const { publicErrorMessage } = require('../utils/publicError');

test('生产环境隐藏数据库和服务器内部错误，但保留业务校验消息', t => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  });

  assert.equal(
    publicErrorMessage({ code: 'ER_BAD_FIELD_ERROR', message: 'Unknown column secret' }, '操作失败', 400),
    '操作失败'
  );
  assert.equal(publicErrorMessage(new Error('disk path leaked'), '操作失败', 500), '操作失败');
  assert.equal(publicErrorMessage(new Error('赛程已锁定'), '操作失败', 400), '赛程已锁定');
});
