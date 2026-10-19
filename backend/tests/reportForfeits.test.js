const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMainReportState, validateReportResult, buildTeamContext } = require('../utils/reportValidator');
const teams = buildTeamContext({ team_a_id: 1, team_b_id: 2 });
const normalize = body => normalizeMainReportState(body);
const goal = { player_team_id: 2, credited_team_id: 2, team_player_id: 3, minute_base: 12 };

test('主队、客队、双方弃权保存判定比分且无需球员进球，正常比赛仍逐球校验', () => {
  for (const [side, home, away] of [['home', 0, 3], ['away', 3, 0], ['both', 0, 0], ['home', 1, 5]]) {
    const state = normalize({ forfeit_side: side, home_score: home, away_score: away, goals: [] });
    assert.doesNotThrow(() => validateReportResult(state, teams));
    assert.equal(state.forfeit_side, side);
  }
  assert.throws(() => validateReportResult(normalize({ away_score: 3 }), teams), /必须一致/);
});

test('弃权拒绝非空进球和点球大战比分，不能用弃权绕过数据约束', () => {
  assert.throws(() => validateReportResult(normalize({ forfeit_side: 'home', home_score: 0, away_score: 3, goals: [goal] }), teams), /不能填写进球记录/);
  assert.throws(() => validateReportResult(normalize({ forfeit_side: 'away', home_score: 3, away_score: 0, home_penalty_score: 1 }), teams), /不能填写点球大战/);
  for (const value of [null, '', 'invalid', {}, true, 1]) assert.throws(() => normalize({ forfeit_side: value }), /弃权方必须/);
  for (const value of [null, '', undefined, -1, 31, 0.5]) assert.throws(() => normalize({ forfeit_side: 'both', home_score: value, away_score: 0 }), /不能为空|整数|不能超过/);
});

test('局部更新和提交沿用已保存弃权方，显式恢复正常后重新要求进球记录', () => {
  const saved = normalize({ forfeit_side: 'home', home_score: 0, away_score: 3 });
  const partial = normalizeMainReportState({ cards: [] }, saved);
  assert.equal(partial.forfeit_side, 'home');
  assert.doesNotThrow(() => validateReportResult(partial, teams));
  assert.throws(() => validateReportResult(normalizeMainReportState({ forfeit_side: 'none' }, saved), teams), /必须一致/);
});
