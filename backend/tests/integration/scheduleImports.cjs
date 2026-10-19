const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
module.exports = async ({ t, pool, state, request, expectStatus }) => {
  const admin = state.tokens.admin;
  const call = async (url, body, status = 200, token = admin) => { const r = await request('/api' + url, { body, token }); expectStatus(r, status, url); return r.data?.data; };
  const season = await call('/season', { season_code: 'BULK-IMPORT', season_name: '批量导入测试', start_date: '2026-01-01', end_date: '2099-12-31', is_active: true }, 201);
  const league = '批量赛程验收赛';
  await pool.execute('INSERT INTO season_competitions(season_id,league_type,enable_sports_training,enable_football_specialty) VALUES (?,?,0,1)', [season.id, league]);
  const teams = [];
  for (const name of ['土木学院', '机械学院', '建筑学院']) teams.push((await pool.execute('INSERT INTO team(season_id,team_name,league_type) VALUES (?,?,?)', [season.id, name, league]))[0].insertId);
  const other = (await pool.execute('INSERT INTO team(season_id,team_name,league_type) VALUES (?,?,?)', [season.id, '其它赛事队', '其它赛事']))[0].insertId;
  const headers = require('../../utils/scheduleImportParser').HEADERS;
  const row = (order, home = '土木学院', away = '机械学院', date = '2026-10-20') => [order, date, '17:35', home, away, '樱花人草', ''];
  async function preview(rows, extra = {}, status = 200, token = admin) {
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), '赛程');
    const form = new FormData(); form.append('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), 'schedule.xlsx');
    for (const [k, v] of Object.entries({ season_id: season.id, match_type: league, ...extra })) form.append(k, String(v));
    return call('/schedule/import-preview', form, status, token);
  }
  const confirm = (p, status = 200, token = admin) => call('/schedule/import-confirm', { preview: p.preview, preview_token: p.preview_token }, status, token);
  const count = async () => Number((await pool.query('SELECT COUNT(*) AS n FROM match_schedules WHERE season_id=?', [season.id]))[0][0].n);

  await t.test('预览不写入；精确匹配批量导入创建报告，重复确认不重复添加', async () => {
    const p = await preview([row('001'), row('002', '机械学院', '建筑学院')]);
    assert.equal(p.can_confirm, true); assert.equal(await count(), 0);
    const result = await confirm(p); assert.equal(result.count, 2); assert.equal(await count(), 2);
    const [[report]] = await pool.query('SELECT COUNT(*) AS n FROM match_reports WHERE schedule_id IN (?,?)', result.schedule_ids);
    assert.equal(report.n, 2); await confirm(p, 409); assert.equal(await count(), 2);
  });
  await t.test('非精确队名必须确认；建议、取消、未知名及跨赛事映射', async () => {
    const p = await preview([row('SIM', '土木学院队')]);
    assert.equal(p.can_confirm, false); assert.equal(p.name_matches[0].team_id, null);
    assert.ok(p.name_matches[0].candidates.some(v => v.id === teams[0])); await confirm(p, 409);
    const wrong = await preview([row('SIM', '土木学院队')], { team_mappings: JSON.stringify({ 土木学院队: other }) });
    assert.equal(wrong.can_confirm, false);
    const mapped = await preview([row('SIM', '土木学院队')], { team_mappings: JSON.stringify({ 土木学院队: teams[0] }), futsal: true, supervisor_required: true });
    assert.equal(mapped.can_confirm, true); const result = await confirm(mapped);
    const data = await call('/schedule/' + result.schedule_ids[0]);
    assert.equal(data.team_a_name_snapshot, '土木学院'); assert.equal(data.futsal, true); assert.equal(data.fourth_required, false); assert.equal(data.supervisor_required, true);
    assert.equal((await preview([row('UNKNOWN', '不存在的新球队')])).can_confirm, false);
    assert.equal(await count(), 3);
  });
  await t.test('逐行提示无效日期时间场地、同队、文件重复场序及已存在场序', async () => {
    const invalidTime = row('TIME'); invalidTime[2] = '24:00';
    const invalidVenue = row('VENUE'); invalidVenue[5] = '其它';
    const p = await preview([row('GOOD'), row('BAD-DATE', undefined, undefined, '2026-02-30'), invalidTime, invalidVenue, row('SAME', '土木学院', '土木学院'), row('DUP'), row('dup'), row('001')]);
    assert.equal(p.can_confirm, false); assert.deepEqual(p.errors.map(e => e.row_number), [3, 4, 5, 6, 8]);
    assert.ok(p.rows.at(-1).replacement);
    await confirm(p, 409); assert.equal(await count(), 3);
  });
  await t.test('映射后主客队同队被拒绝', async () => {
    const p = await preview([row('SAME-MAP', '土木学院队', '土木学院')], { team_mappings: JSON.stringify({ 土木学院队: teams[0] }) });
    assert.match(p.errors[0].message, /主客队不能相同/); await confirm(p, 409);
  });
  await t.test('确认时重查场序、球队改名和撤销状态，整批保持不变', async () => {
    const p = await preview([row('STALE-1'), row('STALE-2')]);
    await call('/schedule', { match_type: league, team_a_id: teams[0], team_b_id: teams[1], match_date: '2026-10-20', match_time: '17:35', venue: '樱花人草', field_order: 'STALE-2' });
    await confirm(p, 409); assert.equal(await count(), 4);
    const renamed = await preview([row('RENAMED')]);
    await pool.execute('UPDATE team SET team_name=? WHERE id=?', ['土木新名称', teams[0]]); await confirm(renamed, 409);
    await pool.execute('UPDATE team SET team_name=?,registration_revoked=1 WHERE id=?', ['土木学院', teams[0]]);
    const revoked = await preview([row('REVOKED')]); assert.equal(revoked.can_confirm, false);
    await pool.execute('UPDATE team SET registration_revoked=0 WHERE id=?', [teams[0]]);
  });
  await t.test('第二场写入故障时，首场及自动创建的报告也回滚', async context => {
    const service = require('../../services/scheduleService'), original = service.createScheduleInTransaction;
    context.mock.method(service, 'createScheduleInTransaction', async function(c, data) {
      if (data.field_order === 'ROLL-2') throw Object.assign(new Error('模拟数据库写入故障'), { code: 'ER_DUP_ENTRY' });
      return original.call(this, c, data);
    });
    const p = await preview([row('ROLL-1'), row('ROLL-2')]); assert.equal(p.can_confirm, true);
    const [[beforeReports]] = await pool.query('SELECT COUNT(*) AS n FROM match_reports');
    const before = await count(); await confirm(p, 400); assert.equal(await count(), before);
    const [[afterReports]] = await pool.query('SELECT COUNT(*) AS n FROM match_reports'); assert.equal(afterReports.n, beforeReports.n);
    const [[r]] = await pool.execute("SELECT COUNT(*) AS n FROM match_schedules WHERE season_id=? AND field_order='ROLL-1'", [season.id]); assert.equal(r.n, 0);
  });
  await t.test('预览签名防篡改；过期和非管理员请求被拒绝', async () => {
    const p = await preview([row('TAMPER')]);
    p.preview.input.rows[0].field_order = 'CHANGED'; await confirm(p, 409);
    const expired = await preview([row('EXPIRED')]); expired.preview.expires_at = Date.now() - 1;
    expired.preview_token = crypto.createHmac('sha256', process.env.JWT_SECRET).update('schedule-import:' + JSON.stringify(expired.preview)).digest('hex');
    await confirm(expired, 409); await preview([row('AUTH')], {}, 401, null);
    const unauthorized = await request(`/api/team/${teams[0]}/current-roster/export`); expectStatus(unauthorized, 401, '名单导出需登录');
    const ref = (await pool.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,must_change_password) VALUES ('BULK-REF','导入权限测试','unused','三级','二级','2025-01-01','足协杯',0)"))[0].insertId;
    const refToken = require('jsonwebtoken').sign({ id: ref, role: 'referee', tokenVersion: 0 }, process.env.JWT_SECRET);
    await preview([row('REF-AUTH')], {}, 403, refToken);
    await confirm(await preview([row('REF-CONFIRM')]), 403, refToken);
    for (const path of [`/api/team/${teams[0]}/current-roster/export`, '/api/schedule/import-template']) expectStatus(await request(path, { token: refToken }), 403, '仅管理员允许导出或导入');
  });
  await t.test('导出当前有效名单，保留中文和引号转义，阻止CSV公式，隐藏未启用标签', async () => {
    const old = (await pool.execute("INSERT INTO team_roster_batches(team_id,season_id,version_no,effective_from) VALUES (?,?,1,'2020-01-01')", [teams[0], season.id]))[0].insertId;
    const current = (await pool.execute("INSERT INTO team_roster_batches(team_id,season_id,version_no,effective_from) VALUES (?,?,2,'2020-01-02')", [teams[0], season.id]))[0].insertId;
    const future = (await pool.execute("INSERT INTO team_roster_batches(team_id,season_id,version_no,effective_from) VALUES (?,?,3,'2099-01-01')", [teams[0], season.id]))[0].insertId;
    for (const [id, name] of [[old, '旧名单球员'], [current, '当前球员'], [future, '未来名单球员']]) await pool.execute('INSERT INTO team_player(roster_batch_id,team_id,jersey_number,player_name,is_sports_training,is_football_specialty,remark) VALUES (?,?,?, ?,1,1,?)', [id, teams[0], '01', name, '=SUM(1,2)\n含"引号"']);
    const r = await request(`/api/team/${teams[0]}/current-roster/export`, { token: admin }); expectStatus(r, 200, 'CSV导出');
    assert.match(r.data, /当前球员/); assert.doesNotMatch(r.data, /旧名单球员|未来名单球员|运训/);
    assert.match(r.data, /足球特长生/); assert.ok(r.data.includes('"\'=SUM(1,2)')); assert.match(r.data, /含""引号""/);
  });
  await t.test('切换启用赛季后旧预览不能提交', async () => {
    const p = await preview([row('SEASON')]);
    await call('/season', { season_code: 'BULK-NEXT', season_name: '批量导入下一测试赛季', start_date: '2026-01-01', end_date: '2099-12-31', is_active: true }, 201);
    await confirm(p, 409); assert.equal(await count(), 4);
  });
  await require('./scheduleReplacements.cjs')({ t, pool, state, request, expectStatus });
};
