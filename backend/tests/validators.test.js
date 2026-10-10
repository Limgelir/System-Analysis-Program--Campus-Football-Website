const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toNullableInt,
  validateScheduleMutationPayload
} = require('../utils/scheduleValidator');
const {
  normalizeLimitedText,
  normalizeMainReportState,
  buildTeamContext,
  validateGoalRecordLimit,
  validateGoalCountAgainstScore
} = require('../utils/reportValidator');

const baseSchedule = {
  match_type: '足协杯',
  team_a_id: 1,
  team_b_id: 2,
  match_date: '2026-08-30',
  match_time: '17:35', venue:'樱花人草',
  field_order: 1,
  main_referee_id: 1,
  assistant1_id: 2
};

test('赛程整数不接受带尾随字符或小数', () => {
  assert.equal(toNullableInt('12abc'), null);
  assert.equal(toNullableInt('1.5'), null);
  assert.equal(toNullableInt('12'), 12);
});

test('赛程日期必须是真实存在的日期', () => {
  assert.throws(
    () => validateScheduleMutationPayload({ ...baseSchedule, match_date: '2026-02-30' }),
    /不是有效日期/
  );
  assert.equal(validateScheduleMutationPayload(baseSchedule).match_date, '2026-08-30');
});

test('同场裁判员可兼任第四官员，助理裁判员不能兼任其他场上岗位', () => {
  assert.equal(validateScheduleMutationPayload({ ...baseSchedule, fourth_official_id: 1 }).fourth_official_id,1);
  assert.throws(()=>validateScheduleMutationPayload({ ...baseSchedule, fourth_official_id: 2 }),/裁判不能重复指派/);
  assert.throws(
    () => validateScheduleMutationPayload({ ...baseSchedule, assistant1_id: 1 }),
    /裁判不能重复指派/
  );
});

test('报告比分必须与逐条进球记录一致', () => {
  const teamContext = buildTeamContext({ team_a_id: 1, team_b_id: 2 });
  assert.throws(
    () => validateGoalCountAgainstScore([], teamContext, 1, 0),
    /主队得分为 1/
  );
});

test('报告文本遵守数据库长度上限', () => {
  assert.equal(normalizeLimitedText('正常说明', '说明', 10), '正常说明');
  assert.throws(
    () => normalizeLimitedText('超'.repeat(11), '说明', 10),
    /不能超过 10 字/
  );
});

test('比分字段必须是非负整数', () => {
  assert.throws(
    () => normalizeMainReportState({ home_score: -1 }, {}),
    /大于等于 0 的整数/
  );
});

test('正常比分和点球比分只接受 0 到 30 的整数边界', () => {
  const accepted = normalizeMainReportState({
    home_score: 0,
    away_score: 30,
    home_penalty_score: '30',
    away_penalty_score: 0
  }, {});
  assert.equal(accepted.home_score, 0);
  assert.equal(accepted.away_score, 30);

  for (const invalidScore of [31, -1, 1.5, '1.5', Number.MAX_SAFE_INTEGER]) {
    assert.throws(
      () => normalizeMainReportState({ home_score: invalidScore }, {}),
      /不能超过 30|大于等于 0 的整数/
    );
  }
});

test('单队进球说明不能超过 30 条', () => {
  const teamContext = buildTeamContext({ team_a_id: 1, team_b_id: 2 });
  const goals = Array.from({ length: 31 }, () => ({ credited_team_id: 1 }));
  assert.throws(
    () => validateGoalRecordLimit(goals, teamContext),
    /主队进球说明不能超过 30 条/
  );
});
