const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, normalize, fromMembers } = require('../utils/teamAutoReview');

test('规则可分别留空、零上限有效；错误区间与非整数拒绝', () => {
  assert.equal(normalize({min_players:11}).max_players,null);
  assert.equal(normalize({max_players:''}).max_players,null);
  assert.equal(normalize({max_foreign_players:0}).max_foreign_players,0);
  for(const values of [{min_players:12,max_players:11},{max_colleges:-1},{max_players:1.5},{max_foreign_players:true},{max_players:'25'}])assert.throws(()=>normalize(values));
});

test('学院按最新账号资料去重，旧审核快照留档；空学院不绕过学院限制', () => {
  const members=[
    {college:'新学院',review_profile_snapshot:{college:' 工程学院 '},is_foreign:true,is_sports_training:true},
    {college:'新学院',review_profile_snapshot:{college:'工程学院'}},
    {college:'新学院',review_profile_snapshot:{college:'工院'}}
  ];
  const result=fromMembers({max_colleges:1},members);
  assert.equal(result.passed,true);
  assert.deepEqual(result.counts,{total:3,colleges:1,foreign:1,sports_training:1,football_specialty:0});
  assert.equal(result.college_source,'account_profile');
  assert.equal(fromMembers({max_colleges:10},[{college:'',review_profile_snapshot:{college:'土木工程学院'}}]).passed,false);
  assert.equal(fromMembers({max_colleges:1},[{college:'中德'},{college:'中德学院'}]).passed,false);
  assert.equal(fromMembers({max_colleges:10},[{}]).passed,false);
  assert.equal(fromMembers({},[{}]).passed,true);
});

test('未配置限制不会按默认人数限制球队；零名外援和运训上限仍执行', () => {
  const counts = { total: 40, colleges: 5, foreign: 1, sports_training: 1 };
  const unrestricted = evaluate({ min_players: null, max_players: null, max_colleges: null }, counts);
  assert.equal(unrestricted.passed, true);
  assert.equal(unrestricted.checks.length, 0);
  const restricted = evaluate({ max_foreign_players: 0, max_sports_training_players: 0 }, counts);
  assert.equal(restricted.passed, false);
  assert.deepEqual(restricted.failures.map(v => v.rule), ['max_foreign_players', 'max_sports_training_players']);
});

test('人数上下限和各项数量限制均包含边界，超限返回实际值和要求', () => {
  const limits = { min_players: 11, max_players: 25, max_colleges: 2, max_foreign_players: 2, max_sports_training_players: 3 };
  const counts = { total: 11, colleges: 2, foreign: 2, sports_training: 3 };
  assert.equal(evaluate(limits, counts).passed, true);
  assert.equal(evaluate(limits, { ...counts, total: 25 }).passed, true);
  const tooFew = evaluate(limits, { ...counts, total: 10 });
  assert.equal(tooFew.passed, false);
  assert.deepEqual(tooFew.failures.map(v => [v.rule, v.actual, v.limit]), [['min_players', 10, 11]]);
  assert.match(tooFew.failures[0].message, /大名单人数为10，要求不少于11/);
});

test('同时违反多个类别时一次列出全部原因，不只显示第一个失败项', () => {
  const review = evaluate(
    { min_players: 11, max_players: 25, max_colleges: 2, max_foreign_players: 1, max_sports_training_players: 1 },
    { total: 26, colleges: 3, foreign: 2, sports_training: 2 }
  );
  assert.equal(review.passed, false);
  assert.equal(review.checks.length, 5);
  assert.deepEqual(review.failures.map(v => v.rule), ['max_players', 'max_colleges', 'max_foreign_players', 'max_sports_training_players']);
  assert.equal(review.failures.every(v => v.message.includes(String(v.actual)) && v.message.includes(String(v.limit))), true);
});
