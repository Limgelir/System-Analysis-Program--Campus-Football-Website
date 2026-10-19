const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const service = require('../../services/fourthOfficialSheetService');
const { buildFields, MIME } = require('../../utils/fourthOfficialDocument');
module.exports = async ({ t, pool, state, request, expectStatus }) => {
  const f = await require('../../scripts/seedFourthOfficialSheet')(pool);
  const url = id => `/api/schedule/${id}/fourth-official-sheet?template=eleven`;
  const admin = state.tokens.admin;
  await t.test('四官单只允许管理员下载，未知模板和不存在赛程明确报错', async () => {
    expectStatus(await request(url(f.matches[0])), 401, '匿名不能下载');
    await pool.execute("INSERT INTO referee(student_id,name,password_hash,must_change_password,is_active) VALUES ('fourth-test-ref','测试裁判',?,0,1)", [await bcrypt.hash('FourthTest!2026', 4)]);
    const login = await request('/api/referee/login', { body: { student_id: 'fourth-test-ref', password: 'FourthTest!2026' } });
    expectStatus(login, 200, '裁判登录');
    expectStatus(await request(url(f.matches[0]), { token: login.data.data.token }), 403, '裁判不能下载');
    expectStatus(await request(`/api/schedule/${f.matches[0]}/fourth-official-sheet?template=unknown`, { token: admin }), 400, '未知模板');
    expectStatus(await request(url(2147483647), { token: admin }), 404, '赛程不存在');
    expectStatus(await request(url('bad'), { token: admin }), 400, '赛程编号无效');
  });
  await t.test('8人制17人名单、颜色和停赛，下载成功且超过容量时明确拒绝', async () => {
    const data = await service.loadData(pool, f.eight.matches[0]);
    const fields = buildFields(data, 'eight');
    assert.equal(fields.a_number_17, '17'); assert.equal(fields.b_number_17, '17');
    assert.equal(fields.a_suspended_2, '×'); assert.equal(fields.b_suspended_10, '×');
    assert.equal(fields.a_name_1, '阿卜杜热合曼·买买提江(C)(GK)(F)(S)');
    assert.equal(fields.a_name_2, '李一明(F)(S)');
    assert.equal(fields.a_name_6, '张二明(S)');
    assert.equal(fields.a_kit, '红/白/红'); assert.equal(fields.b_kit, '蓝/白/蓝');
    assert.equal(fields.match_datetime, `${data.schedule.match_date} 15:00-16:30`);
    assert.equal(fields.venue, '嘉定校区西侧足球场');
    assert.ok(!Object.values(fields).includes('张裁判'));
    const response = await request(`/api/schedule/${f.eight.matches[0]}/fourth-official-sheet?template=eight`, { token: admin });
    expectStatus(response, 200, '8人制下载'); assert.equal(response.headers.get('content-type'), MIME);
    assert.ok(decodeURIComponent(response.headers.get('content-disposition')).includes('四官单-8人制-B01-'));
    expectStatus(await request(`/api/schedule/${f.matches[0]}/fourth-official-sheet?template=eight`, { token: admin }), 409, '30人不能误导出为17行');
  });
  await t.test('两队30人，颜色和监督正确，按本场预计停赛标记且导出不写业务数据', async () => {
    const fields = buildFields(await service.loadData(pool, f.matches[0]));
    assert.equal(fields.a_number_1, '1'); assert.equal(fields.a_number_30, '30');
    assert.equal(fields.a_suspended_2, '×'); assert.equal(fields.b_suspended_10, '×');
    assert.equal(fields.a_shirt, '红'); assert.equal(fields.a_shorts, '白'); assert.equal(fields.a_socks, '红');
    assert.equal(fields.supervisor, '陈监督'); assert.equal(fields.venue, '嘉定校区西侧足球场');
    const second = buildFields(await service.loadData(pool, f.matches[1]));
    assert.equal(second.supervisor, ''); assert.equal(second.venue, '樱花人草');
    assert.equal(second.a_suspended_2, ''); assert.equal(second.b_suspended_10, '');
    const snapshot = async () => {
      const result = {};
      for (const table of ['match_roster_selections', 'match_roster_selection_events', 'match_reports', 'competition_discipline_events']) result[table] = (await pool.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n;
      result.schedules = (await pool.query('SELECT id,schedule_revision FROM match_schedules WHERE season_id=? ORDER BY id', [f.seasonId]))[0];
      return result;
    };
    const before = await snapshot();
    const response = await request(url(f.matches[0]), { token: admin });
    expectStatus(response, 200, '下载'); assert.equal(response.headers.get('content-type'), MIME);
    assert.match(response.headers.get('content-disposition'), /attachment;.*\.docx/);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.ok(response.data.startsWith('PK'));
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('保留指定的历史名单及其颜色，不擅自替换成新名单或负责人', async () => {
    await pool.execute("INSERT INTO match_roster_selections(schedule_id,team_id,roster_batch_id,revision,selection_reason,created_at,updated_at) VALUES (?,?,?,1,'测试指定历史名单',NOW(3),NOW(3))", [f.matches[0], f.teams[0], f.batches[0]]);
    await pool.execute("UPDATE team SET shirt_color='新颜色' WHERE id=?", [f.teams[0]]);
    const next = (await pool.execute("INSERT INTO team_roster_batches(team_id,season_id,version_no,effective_from,metadata_snapshot) VALUES (?,?,2,'2026-01-02',?)", [f.teams[0], f.seasonId, JSON.stringify({ shirt_color: '绿', shorts_color: null, socks_color: null })]))[0].insertId;
    await pool.execute("INSERT INTO team_player(roster_batch_id,team_id,jersey_number,player_name) VALUES (?,?,'99','后来加入球员')", [next, f.teams[0]]);
    const old = buildFields(await service.loadData(pool, f.matches[0]));
    assert.equal(old.a_number_30, '30'); assert.equal(old.a_shirt, '红');
    assert.equal(old.a_name_1, '阿卜杜热合曼·买买提江(C)(GK)(F)(S)');
    assert.ok(!Object.values(old).includes('后来加入球员'));
    const latest = buildFields(await service.loadData(pool, f.matches[1]));
    assert.equal(latest.a_name_1, '后来加入球员'); assert.equal(latest.a_shirt, '绿'); assert.equal(latest.a_shorts, '');
  });
  await t.test('四官单遵循本赛事标签开关，不把关闭的历史标记重新显示出来', async () => {
    await pool.execute('UPDATE season_competitions SET enable_sports_training=0,enable_football_specialty=0 WHERE id=?', [f.eight.competitionId]);
    const fields = buildFields(await service.loadData(pool, f.eight.matches[0]), 'eight');
    assert.equal(fields.a_name_1, '阿卜杜热合曼·买买提江(C)(GK)(F)');
    assert.equal(fields.a_name_2, '李一明(F)');
    assert.equal(fields.a_name_6, '张二明');
  });
  await t.test('已公布比赛使用当场停赛执行记录，不能因已服满而漏标', async () => {
    const [[report]] = await pool.execute('SELECT id FROM match_reports WHERE schedule_id=?', [f.matches[0]]);
    await pool.execute("INSERT INTO match_publications(report_id,version_no,result_snapshot,published_at) VALUES (?,1,'{}',NOW(3))", [report.id]);
    await pool.execute("INSERT INTO competition_discipline_events(competition_id,operation,report_id,payload,created_at) VALUES (?,'report',?,?,NOW(3))", [f.competitionId, report.id, JSON.stringify({ schedule_id: f.matches[0], served: f.bannedKeys.map(key => ({ key, origin: 0 })), team_ids: f.teams, kickoff: '2099-01-01 15:00', cards: [] })]);
    const fields = buildFields(await service.loadData(pool, f.matches[0]));
    assert.equal(fields.a_suspended_2, '×'); assert.equal(fields.b_suspended_10, '×');
  });
};
