const { test } = require('node:test');
const assert = require('node:assert/strict');
const tags = require('../utils/teamTags');
const automatic = require('../utils/teamAutoReview');
const rules = require('../utils/playerRules');

test('性别仅接受男和女的明确取值，不猜测旧账号', () => {
  assert.equal(rules.gender('male'), 'male'); assert.equal(rules.gender('female'), 'female');
  for (const value of [null, undefined, '', 'unknown', 1, '男']) assert.throws(() => rules.gender(value));
});
test('合并限制只接受已启用标签的唯一组合和整数上限', () => {
  const base = { enable_sports_training: false, enable_football_specialty: true };
  const valid = { ...base, combined_player_limits: [{ tags: ['football_specialty', 'foreign'], max: 5 }] };
  assert.deepEqual(tags.normalize(valid).combined_player_limits, [{ tags: ['foreign', 'football_specialty'], max: 5 }]);
  for (const groups of [[{ tags: ['foreign'], max: 1 }], [{ tags: ['foreign', 'foreign'], max: 1 }], [{ tags: ['foreign', 'sports_training'], max: 1 }], [{ tags: ['foreign', 'invalid'], max: 1 }], [{ tags: ['foreign', 'football_specialty'], max: -1 }], [{ tags: ['foreign', 'football_specialty'], max: '1' }], [valid.combined_player_limits[0], valid.combined_player_limits[0]]]) assert.throws(() => tags.normalize({ ...base, combined_player_limits: groups }));
});
test('合并人数按球员去重，多个组合与单项限制同时生效，禁用标签不参检', () => {
  const members = [{ is_foreign: true, is_football_specialty: true, is_sports_training: true }, { is_football_specialty: true }];
  const limits = { enable_football_specialty: true, enable_sports_training: false, max_sports_training_players: 0, max_football_specialty_players: 2, combined_player_limits: [{ tags: ['foreign', 'football_specialty'], max: 2 }] };
  let result = automatic.fromMembers(limits, members);
  assert.equal(result.passed, true); assert.equal(result.checks.at(-1).actual, 2);
  result = automatic.fromMembers({ ...limits, max_football_specialty_players: 1, combined_player_limits: [{ tags: ['foreign', 'football_specialty'], max: 1 }] }, members);
  assert.equal(result.failures.length, 2);
  assert.equal(automatic.fromMembers({ ...limits, enable_football_specialty: false, max_football_specialty_players: 0 }, members).passed, true);
});
test('关闭标签后隐藏当前与历史结构化展示，但不修改原审计证据', () => {
  const review = automatic.fromMembers({ enable_football_specialty: true, max_sports_training_players: 0, combined_player_limits: [{ tags: ['foreign', 'football_specialty'], max: 0 }] }, [{ is_football_specialty: true, is_sports_training: true }]);
  const before = JSON.stringify(review);
  const result = tags.present({ enable_sports_training: false, enable_football_specialty: false }, { auto_review: review, events: [{ changes: ['甲：设为运训', '乙：设为足球特长生', '甲号码：1 → 2'], after_snapshot: { auto_review: review } }] });
  assert.equal(JSON.stringify(result).includes('足球特长生'), false);
  assert.equal(JSON.stringify(result).includes('运训'), false);
  assert.equal(JSON.stringify(review), before);
  assert.deepEqual(result.events[0].changes, ['甲号码：1 → 2']);
});
