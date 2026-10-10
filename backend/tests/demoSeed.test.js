const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SIZE_PRESETS,
  parseArguments,
  assertResetAuthorized,
  buildDemoDefinitions,
  generateSharedDemoPassword,
  buildRegistrationEvents,
  summarizeReferees,
  buildCredentialPayload
} = require('../scripts/demoSeed');
const { validateRefereePassword } = require('../utils/passwordPolicy');

test('演示数据参数只接受明确命令和规模', () => {
  assert.deepEqual(parseArguments(['seed', '--size=small']), { command: 'seed', size: 'small', scenario: 'workflow' });
  assert.deepEqual(parseArguments(['clear']), { command: 'clear', size: 'medium', scenario: 'workflow' });
  assert.deepEqual(parseArguments(['seed', '--scenario=all-approved']), {
    command: 'seed', size: 'medium', scenario: 'all-approved'
  });
  assert.throws(() => parseArguments(['seed', '--size=huge']), /数据规模只能是/);
  assert.throws(() => parseArguments(['seed', '--scenario=unknown']), /样例场景只能是/);
  assert.throws(() => parseArguments(['seed', '--typo=true']), /未知参数/);
  assert.throws(() => parseArguments(['drop']), /命令只能是/);
});

test('演示数据重置要求数据库名称确认，生产环境还需额外授权', () => {
  assert.throws(
    () => assertResetAuthorized({}, 'referee_system'),
    /DEMO_SEED_CONFIRM=RESET_referee_system/
  );
  assert.doesNotThrow(() => assertResetAuthorized({
    NODE_ENV: 'development',
    DEMO_SEED_CONFIRM: 'RESET_referee_system'
  }, 'referee_system'));
  assert.throws(() => assertResetAuthorized({
    NODE_ENV: 'production',
    DEMO_SEED_CONFIRM: 'RESET_referee_system'
  }, 'referee_system'), /DEMO_SEED_ALLOW_PRODUCTION=true/);
  assert.doesNotThrow(() => assertResetAuthorized({
    NODE_ENV: 'production',
    DEMO_SEED_CONFIRM: 'RESET_referee_system',
    DEMO_SEED_ALLOW_PRODUCTION: 'true'
  }, 'referee_system'));
});

for (const [size, preset] of Object.entries(SIZE_PRESETS)) {
  for (const scenario of ['workflow', 'all-approved']) {
    test(`${size}/${scenario} 演示数据数量、唯一性和赛程选派符合约束`, () => {
      const data = buildDemoDefinitions(size, new Date('2026-09-02T00:00:00Z'), scenario);
      assert.equal(data.referees.length, preset.referees);
      assert.equal(data.teams.length, preset.teamsPerType * 3);
      assert.equal(data.schedules.length, preset.schedulesPerType * 3);
      assert.equal(new Set(data.referees.map(item => item.student_id)).size, data.referees.length);
      assert.equal(new Set(data.teams.map(item => `${item.league_type}:${item.team_name}`)).size, data.teams.length);
      const summary = summarizeReferees(data.referees);
      assert.equal(summary.eligible_system_referees, preset.referees - (scenario === 'workflow' ? 5 : 0));
      assert.equal(summary.approved, preset.referees - (scenario === 'workflow' ? 4 : 0));
      for (const key of ['inactive_accounts', 'unsubmitted_accounts', 'pending', 'rejected', 'returned']) {
        assert.equal(summary[key], scenario === 'workflow' ? 1 : 0);
      }

      for (const schedule of data.schedules) {
        const refereeIds = [
          schedule.main_referee.student_id,
          schedule.assistant1.student_id,
          schedule.assistant2.student_id,
          schedule.fourth_official.student_id,
          schedule.supervisor.student_id
        ];
        assert.equal(new Set(refereeIds).size, 5);
        assert.notEqual(schedule.team_a.team_name, schedule.team_b.team_name);
        assert.equal(schedule.team_a.league_type, schedule.match_type);
        assert.equal(schedule.team_b.league_type, schedule.match_type);
        for (const role of ['main_referee', 'assistant1', 'assistant2', 'fourth_official', 'supervisor']) {
          assert.equal(schedule[role].is_active, true);
          assert.equal(schedule[role].registration_status, 'approved');
        }
      }
    });
  }
}

test('样例未注册没有申请，其他状态具有合法的追加式审核历史和原因', () => {
  const data = buildDemoDefinitions('small');
  const expectedTypes = {
    unsubmitted: [], pending: ['submitted'], approved: ['submitted', 'approved'],
    rejected: ['submitted', 'rejected'], returned: ['submitted', 'approved', 'returned']
  };
  for (const [index, referee] of data.referees.entries()) {
    referee.id = index + 1;
    const events = buildRegistrationEvents(referee, 23, 99, new Date('2026-09-03T00:00:00Z'));
    assert.deepEqual(events.map(event => event.event_type), expectedTypes[referee.registration_status]);
    for (const [eventIndex, event] of events.entries()) {
      assert.equal(event.after_snapshot.season_id, 23);
      assert.equal(event.after_snapshot.referee_id, referee.id);
      assert.equal(event.after_snapshot.application_version, 1);
      if (eventIndex === 0) {
        assert.equal(event.before_snapshot, null);
        assert.equal(event.actor_referee_id, referee.id);
        assert.equal(event.actor_admin_id, null);
        assert.equal(event.after_snapshot.reviewed_at, null);
        assert.equal(event.after_snapshot.review_reason, null);
      } else {
        assert.deepEqual(event.before_snapshot, events[eventIndex - 1].after_snapshot);
        assert.ok(event.created_at > events[eventIndex - 1].created_at);
        assert.equal(event.actor_referee_id, null);
        assert.equal(event.actor_admin_id, 99);
        assert.ok(event.reason);
        assert.equal(event.after_snapshot.review_reason, event.reason);
      }
    }
    if (events.length) assert.equal(events.at(-1).after_snapshot.status, referee.registration_status);
  }
});

test('凭据文件附带各账号状态、用途和与管理员概览一致的初始统计', () => {
  const data = buildDemoDefinitions('medium');
  const payload = buildCredentialPayload('demo_test', 'medium', 'test-password-placeholder', data);
  assert.equal(payload.scenario, 'workflow');
  assert.equal(payload.expected_summary.eligible_system_referees, 15);
  assert.equal(payload.referee_accounts.at(-1).registration_status, 'unsubmitted');
  assert.equal(payload.referee_accounts.at(-5).account_status, '停用');
  assert.equal(payload.referee_accounts.filter(item => item.eligible_for_assignment).length, 15);
  assert.ok(payload.referee_accounts.every(item => item.test_purpose && item.registration_status_label));
});

test('自动生成的演示裁判密码符合裁判密码规则且每次随机', () => {
  const first = generateSharedDemoPassword();
  const second = generateSharedDemoPassword();
  assert.notEqual(first, second);
  assert.doesNotThrow(() => validateRefereePassword(first));
  assert.doesNotThrow(() => validateRefereePassword(second));
});
