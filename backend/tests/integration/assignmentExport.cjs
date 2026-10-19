const assert = require('node:assert/strict');
const xlsx = require('xlsx');
module.exports = async ({ t, pool, state, request, expectStatus }) => {
  const f = await require('../../scripts/seedAssignmentExport')(pool);
  const query = new URLSearchParams({ season_id: f.seasonId, match_type: '大联赛', match_date: f.date });
  const url = '/api/match-signups/assignment-board/export?' + query;
  const token = state.tokens.admin;
  const records = result => {
    expectStatus(result, 200, '导出');
    assert.match(result.headers.get('content-type'), /text\/csv/);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const workbook = xlsx.read(result.data, { type: 'string', raw: true });
    return xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  };
  await t.test('比赛日CSV仅管理员可下载，缺少范围或非法日期不扩大导出', async () => {
    expectStatus(await request(url), 401, '匿名');
    const login = await request('/api/referee/login', { body: { student_id: f.refs[0].student_id, password: f.password } });
    expectStatus(login, 200, '裁判登录');
    expectStatus(await request(url, { token: login.data.data.token }), 403, '裁判');
    for (const key of ['season_id', 'match_type', 'match_date']) {
      const bad = new URLSearchParams(query); bad.delete(key);
      expectStatus(await request('/api/match-signups/assignment-board/export?' + bad, { token }), 400, '缺少' + key);
    }
    const bad = new URLSearchParams(query); bad.set('match_date', '2026-02-30');
    expectStatus(await request('/api/match-signups/assignment-board/export?' + bad, { token }), 400, '非法日期');
  });
  await t.test('当天全部比赛包含已开球和时间待定场次，正确显示系统/外部姓名及空岗位', async () => {
    const [before] = await pool.query('SELECT * FROM match_official_assignments ORDER BY id');
    const rows = records(await request(url, { token }));
    assert.deepEqual(rows.map(r => r['场序']), ['A01', 'A02', 'A03', 'A04']);
    assert.equal(rows[0]['裁判员'], '张裁判'); assert.equal(rows[0]['裁判监督'], '陈监督');
    assert.equal(rows[0]['比赛时间'], '00:01-01:30'); assert.equal(rows[1]['裁判员'], '周外部裁判');
    assert.equal(rows[1]['第二助理裁判员'], '未选派'); assert.equal(rows[1]['裁判监督'], '未选派');
    assert.equal(rows[2]['第四官员'], '无需第四官员'); assert.equal(rows[2]['裁判监督'], '无需监督');
    assert.equal(rows[3]['比赛时间'], '时间待定'); assert.equal(rows[3]['第一助理裁判员'], '不适用');
    assert.equal(rows[3]['第二裁判员'], '未选派'); assert.equal(rows[3]['计时员'], '赵四官');
    assert.ok(rows.every(r => r['场地'] === '嘉定校区西侧足球场'));
    assert.deepEqual((await pool.query('SELECT * FROM match_official_assignments ORDER BY id'))[0], before);
  });
  await t.test('导出读取最新保存姓名，正确转义且不加入其他日期、赛事或赛季', async () => {
    const name = '周,外部"裁判\n已更新';
    await pool.execute("UPDATE match_official_assignments SET name_snapshot=? WHERE schedule_id=? AND role='main'", [name, f.matches.A02]);
    assert.equal(records(await request(url, { token }))[1]['裁判员'], name);
    const next = new URLSearchParams(query); next.set('match_date', f.nextDate);
    assert.deepEqual(records(await request('/api/match-signups/assignment-board/export?' + next, { token })).map(r => r['场序']), ['A05']);
    const other = new URLSearchParams(query); other.set('match_type', '足协杯');
    assert.deepEqual(records(await request('/api/match-signups/assignment-board/export?' + other, { token })).map(r => r['场序']), ['B01']);
    const otherSeason = (await pool.execute("INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES ('EMPTY-CSV','空验收赛季','2026-01-01','2099-12-31',0)"))[0].insertId;
    other.set('season_id', otherSeason);
    expectStatus(await request('/api/match-signups/assignment-board/export?' + other, { token }), 400, '其他赛季空比赛日');
  });
  await t.test('超过一页仍全部导出，不受列表页码、报告状态和未来七天筛选影响', async () => {
    for (let i = 6; i <= 30; i++) await pool.execute(`INSERT INTO match_schedules(season_id,match_type,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot,match_date,match_time,field_order,venue,fourth_required,supervisor_required)
      SELECT season_id,match_type,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot,match_date,'23:56',?,venue,0,0 FROM match_schedules WHERE id=?`, ['A' + i, f.matches.A03]);
    const rows = records(await request(url + '&page=2&page_size=1&view=week&report_status=submitted', { token }));
    assert.equal(rows.length, 29); assert.equal(new Set(rows.map(r => r['场序'])).size, 29);
    assert.ok(rows.some(r => r['场序'] === 'A01')); assert.ok(rows.some(r => r['场序'] === 'A30'));
  });
};
