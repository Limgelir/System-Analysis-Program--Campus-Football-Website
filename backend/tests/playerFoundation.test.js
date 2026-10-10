const { test } = require('node:test');
const assert = require('node:assert/strict');
const { businessDate, nextEffectiveDate } = require('../utils/competitionTime');
const rules = require('../utils/playerRules');
const { buildViewerContext } = require('../utils/reportAccess');
test('中国业务日期跨 UTC 日界、月末及闰年，次日生效不依赖进程时区', () => {
  assert.equal(businessDate('2026-09-07T15:59:59Z'), '2026-09-07');
  assert.equal(businessDate('2026-09-07T16:00:00Z'), '2026-09-08');
  // GitHub 失败运行发生在 UTC 9月9日16:39，中国已是9月10日。
  assert.equal(businessDate('2026-09-09T16:39:22Z'), '2026-09-10');
  assert.equal(nextEffectiveDate('2026-09-09T16:39:22Z'), '2026-09-11');
  assert.equal(nextEffectiveDate('2026-12-31T15:00:00Z'), '2027-01-01');
  assert.equal(nextEffectiveDate('2028-02-28T15:00:00Z'), '2028-02-29');
  assert.throws(() => businessDate('invalid'));
});
test('球员版本和密码严格校验，拒绝 bcrypt 静默截断', () => {
  for (const value of [null, undefined, '', '01', '-1', '1.2', '1e3', '9007199254740992']) assert.throws(() => rules.revision(value));
  assert.equal(rules.revision('0'), 0);
  assert.throws(() => rules.password('a1' + '中'.repeat(24)));
  assert.throws(() => rules.password('abcdefgh'));
  assert.equal(rules.password('Player!123'), 'Player!123');
  assert.throws(() => rules.studentId('123 456'));
  assert.throws(() => rules.onlyKeys({ role: 'admin' }, ['name']));
});
test('即使数字 ID 相同，球员和未知角色也不能成为报告上的裁判', () => {
  for (const role of ['player', 'unknown', null]) {
    const viewer = buildViewerContext({ main_referee_id: 7 }, { id: 7, role });
    assert.equal(viewer.viewer_permissions.can_view, false);
    assert.equal(viewer.viewer_permissions.can_edit_main, false);
  }
});
