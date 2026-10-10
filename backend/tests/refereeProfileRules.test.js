const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { REFEREE_GRADES, validateGrade, parseShanghaiFaRegistered, validateShanghaiFaUpdate } = require('../utils/refereeProfileRules');

test('级别白名单顺序一致，裁判学员低于三级，前后端均支持六个级别', async () => {
  const frontend = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/src/constants/refereeOptions.js')));
  assert.deepEqual(frontend.REFEREE_GRADES, REFEREE_GRADES);
  assert.deepEqual(REFEREE_GRADES, ['裁判学员', '三级', '二级', '一级', '预备国家级', '国家级']);
  for (const grade of REFEREE_GRADES) assert.equal(validateGrade(grade), grade);
  for (const grade of ['', null, undefined, '国际级', [], 1]) assert.throws(() => validateGrade(grade), /级别必须/);
});

test('足协标记严格解析 multipart / JSON 值，旧请求缺省为否', () => {
  for (const value of [true, 1, '1', 'true']) assert.equal(parseShanghaiFaRegistered(value), true);
  for (const value of [false, 0, '0', 'false']) assert.equal(parseShanghaiFaRegistered(value), false);
  assert.equal(parseShanghaiFaRegistered(undefined, { allowMissing: true }), false);
  for (const value of [undefined, null, '', 'yes', '否', 'False', ' false ', 2, [], {}, ['true']]) {
    assert.throws(() => parseShanghaiFaRegistered(value), /必须明确选择/);
  }
});

test('足协本人维护严格限制单字段，不能夹带其他资料', () => {
  assert.equal(validateShanghaiFaUpdate({ shanghai_fa_registered: false }), false);
  for (const payload of [null, [], {}, { name: 'x' }, { shanghai_fa_registered: true, grade: '国家级' }]) {
    assert.throws(() => validateShanghaiFaUpdate(payload), /只允许修改/);
  }
});
