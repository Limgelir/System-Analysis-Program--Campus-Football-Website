const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertUnchanged } = require('../scripts/checkMigrationHistory');
const { safeLog } = require('../utils/safeLog');
test('已发布迁移只能追加，换行差异兼容，内容改写和删除必须失败', () => {
  assert.doesNotThrow(() => assertUnchanged('0001', 'a\r\nb\r\n', 'a\nb\n'));
  assert.throws(() => assertUnchanged('0001', 'a', 'b'), /不可修改/);
  assert.throws(() => assertUnchanged('0001', 'a', null), /不可修改/);
});
test('服务器错误日志只输出固定上下文和错误码，不序列化 SQL、密码、JWT 或个人资料', () => {
  const original=console.error, lines=[];
  console.error = line => lines.push(line);
  try {
    safeLog('test_event', {code:'ER_BAD_FIELD_ERROR',message:'password=secret',sql:'private',stack:'JWT=secret'});
    assert.equal(JSON.parse(lines[0]).event,'test_event');
    assert.equal(JSON.parse(lines[0]).code,'ER_BAD_FIELD_ERROR');
    assert.equal(JSON.parse(lines[0]).channel,'error');
    assert.doesNotMatch(lines[0],/secret|private|password|JWT/);
    safeLog('test_event', {code:'secret password',message:'secret'});
    assert.equal(JSON.parse(lines[1]).code,'INTERNAL_ERROR');
    safeLog('test_event', {statusCode:403,message:'预期业务错误'});
    assert.equal(lines.length,2);
  } finally {console.error=original;}
});
