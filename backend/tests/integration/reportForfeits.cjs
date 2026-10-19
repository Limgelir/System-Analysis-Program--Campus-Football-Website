const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { businessDate } = require('../../utils/competitionTime');

module.exports = async ({ t, pool, state, request, expectStatus }) => {
  if (process.env.REFWEB_INTEGRATION_TEST !== '1' || !process.env.DB_NAME.endsWith('_test')) throw Error('仅隔离测试库');
  const login = await request('/api/admin/login', { body: state.admin });
  expectStatus(login, 200, '弃权验收管理员登录');
  const admin = login.data.data.token;
  const call = async (url, body, token = admin, expected = 200, headers) => {
    const r = await request(url, { body, token, headers });
    expectStatus(r, expected, url);
    return r.data?.data;
  };
  let home, away, main, player, match, goal, card, base, ext;
  const detail = () => call('/api/report/schedule/' + match.id);
  const save = body => call(`/api/report/schedule/${match.id}/main`, body, main.token);
  const submit = () => call(`/api/report/schedule/${match.id}/main/submit`, {}, main.token);
  const revise = data => call(`/api/report/admin/schedule/${match.id}/sections/main/revise`, { reason: '核实弃权判定', data });
  const results = () => call('/api/player/team-results/' + home.id, undefined, player.token);

  await t.test('0032增量迁移旧报告默认正常比赛，重复执行保留比分及历史', async () => {
    const [before] = await pool.query('SELECT * FROM match_reports ORDER BY id');
    const [history] = await pool.query('SELECT id,before_snapshot,after_snapshot FROM report_section_history ORDER BY id');
    await pool.query('ALTER TABLE match_reports DROP COLUMN forfeit_side');
    const c = await pool.getConnection();
    try {
      await require('../../../db/migrations/0032_report_forfeits').up(c);
      await require('../../../db/migrations/0032_report_forfeits').up(c);
    } finally { c.release(); }
    assert.deepEqual((await pool.query('SELECT * FROM match_reports ORDER BY id'))[0], before);
    assert.deepEqual((await pool.query('SELECT id,before_snapshot,after_snapshot FROM report_section_history ORDER BY id'))[0], history);
  });

  await t.test('裁判保存弃权报告可回显、提交并公开判定比分，球员进球为零', async () => {
    await call('/api/season', { season_code: 'FORFEIT', season_name: '弃权功能验收', start_date: businessDate(), end_date: '2099-12-31', is_active: true }, admin, 201);
    for (const name of ['主队', '客队']) {
      const team = await require('./legacyTeamFixture.cjs').create({ team_name: '弃权' + name, league_type: '弃权验收赛', roster_entries: [{ jersey_number: '7', player_name: name + '七号' }] });
      if (name === '主队') home = team; else away = team;
    }
    await pool.execute('UPDATE team_roster_batches SET effective_from=? WHERE team_id IN (?,?)', [businessDate(), home.id, away.id]);
    const password = 'Forfeit!Test2026';
    const hash = await bcrypt.hash(password, 4);
    await pool.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,must_change_password,is_active) VALUES ('FORFEIT-REF','弃权验收裁判',?,'一级','预备国家级','2025-01-01','足协杯',0,1)", [hash]);
    main = await call('/api/referee/login', { student_id: 'FORFEIT-REF', password }, null);
    const reg = await call('/api/season-registration/current/submit', { name: '弃权验收裁判', college: '土木工程学院', height_cm: 175, weight_kg: 65, grade: '一级', match_types: ['足协杯'] }, main.token, 201);
    await call('/api/season-registration/admin/' + reg.id + '/approve', { reason: '测试资格' });
    await call('/api/player/register', { student_id: 'FORFEIT-PLAYER', name: '弃权进球统计球员', college: '土木工程学院', gender: 'male', password, password_confirm: password }, null, 201);
    player = await call('/api/player/login', { student_id: 'FORFEIT-PLAYER', password }, null);
    await pool.execute('UPDATE team_player SET player_account_id=? WHERE team_id=?', [player.id, home.id]);
    ext = await call('/api/officials/external', { name: '弃权外部裁判' }, admin, 201);
    base = { match_type: '弃权验收赛', team_a_id: home.id, team_b_id: away.id, match_date: businessDate(), match_time: '00:00', venue: '樱花人草', supervisor_required: false, fourth_required: false, main_referee_id: main.id };
    match = await call('/api/schedule', { ...base, field_order: 'F-1' });
    const initial = await detail();
    const p = initial.match_rosters.find(r => r.team_id === home.id).players[0];
    goal = { player_team_id: home.id, credited_team_id: home.id, team_player_id: p.id, goal_type: 'normal', minute_base: 12 };
    card = { team_id: home.id, team_player_id: p.id, card_type: 'yellow', minute_base: 20 };
    const saved = await save({ forfeit_side: 'home', home_score: 0, away_score: 3, goals: [], cards: [card], stats: [{ role: 'main', running_distance_m: 400 }] });
    assert.equal(saved.report.forfeit_side, 'home');assert.equal(saved.goals.length, 0);assert.equal(saved.cards.length, 1);
    assert.equal((await detail()).report.away_score, 3);
    assert.equal((await results()).matches[0].result, null);
    await submit();
    const result = await results();
    assert.equal(result.my_goals, 0);assert.equal(result.matches[0].result.forfeit_side, 'home');assert.equal(result.matches[0].result.away_score, 3);assert.deepEqual(result.matches[0].result.goals, []);
    await call(`/api/report/schedule/${match.id}/main`, { home_score: 1 }, main.token, 400);
    await call(`/api/report/schedule/${match.id}/main`, { forfeit_side: 'both' }, admin, 403);
  });

  await t.test('修订、退回重提和局部更新保留弃权状态，正式结果不泄露草稿', async () => {
    await revise({ forfeit_side: 'none', home_score: 1, away_score: 0, goals: [goal] });
    assert.equal((await results()).my_goals, 1);
    const reverted = await revise({ forfeit_side: 'away', home_score: 5, away_score: 0, goals: [] });
    assert.equal(reverted.report.main_report_status, 'submitted');assert.equal((await results()).my_goals, 0);
    const history = await call(`/api/report/schedule/${match.id}/history/main`);
    const entry = await call(`/api/report/schedule/${match.id}/history-entry/${history.items[0].id}`);
    assert.equal(entry.before_snapshot.data.forfeit_side, 'none');assert.equal(entry.before_snapshot.data.goals.length, 1);
    assert.equal(entry.after_snapshot.data.forfeit_side, 'away');assert.equal(entry.after_snapshot.data.goals.length, 0);
    await call(`/api/report/admin/schedule/${match.id}/sections/main/return`, { reason: '重填双方弃权结果' });
    await save({ forfeit_side: 'both', home_score: 0, away_score: 0 });
    const partial = await save({ stats: [{ role: 'main', running_distance_m: 500 }] });
    assert.equal(partial.report.forfeit_side, 'both');assert.equal(partial.cards.length, 1);
    assert.equal((await results()).matches[0].result.forfeit_side, 'away');
    await submit();assert.equal((await results()).matches[0].result.forfeit_side, 'both');
    const publicTeam = await call('/api/public/teams/' + home.id, undefined, null);
    assert.deepEqual(publicTeam.matches[0].result, (await results()).matches[0].result);
  });

  await t.test('弃权负面请求不改版本或公开结果，恢复正常比赛必须逐球填写', async () => {
    const before = await detail();
    for (const data of [
      { forfeit_side: 'home', goals: [goal] }, { forfeit_side: 'away', home_penalty_score: 1 },
      { forfeit_side: 'both', away_score: null }, { forfeit_side: 'bad' },
      { forfeit_side: 'both', home_score: 31 }, { forfeit_side: 'none', home_score: 1, goals: [] }
    ]) await call(`/api/report/admin/schedule/${match.id}/sections/main/revise`, { reason: '负面测试', data }, admin, 400);
    assert.equal((await detail()).sections.main.revision, before.sections.main.revision);
    await call(`/api/report/admin/schedule/${match.id}/sections/main/revise`, { reason: '旧版本', data: { forfeit_side: 'home' } }, admin, 409, { 'If-Match': String(before.sections.main.revision - 1) });
    assert.equal((await results()).matches[0].result.forfeit_side, 'both');
  });

  await t.test('管理员代填弃权无需名单且可提交；审计接受弃权比分', async () => {
    const m = await call('/api/schedule', { ...base, field_order: 'F-PROXY', match_date: '2020-01-01', main_referee_id: 'external:' + ext.id });
    const url = `/api/report/admin/schedule/${m.id}/main`;
    const d = await call(url, { forfeit_side: 'home', home_score: 0, away_score: 3, goals: [] });
    assert.ok(d.match_rosters.every(r => r.players.length === 0));
    await call(url + '/submit', {});
    for (const check of require('../../scripts/audit').checks.filter(c => /报告比分与进球|弃权报告/.test(c.name))) {
      // 其它历史身份用例直接插入了未配比分的进球；这里只审计本功能的两场比赛。
      const [[row]] = await pool.query(check.sql + ' AND r.schedule_id IN (?,?)', [match.id, m.id]);
      assert.equal(Number(row.issue_count), 0, check.name);
    }
  });
};
