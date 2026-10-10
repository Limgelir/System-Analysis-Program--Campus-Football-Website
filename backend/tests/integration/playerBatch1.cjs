const assert = require('node:assert/strict');
const { runPendingMigrations } = require('../../utils/migrationRunner');
const migration = require('../../../db/migrations/0013_player_foundation');
const rosterService = require('../../services/playerRosterService');
module.exports = async ({ t, pool, state, request, expectStatus }) => {
  if (process.env.REFWEB_INTEGRATION_TEST !== '1' || !process.env.DB_NAME.endsWith('_test')) throw Error('只允许隔离测试库');
  const admin = state.tokens.admin, pass = 'Player!Test2026', nextPass = 'Player!Next2026';
  let player, token, linked, historical;
  const body = student_id => ({ student_id, name: '同名球员', college: '土木工程学院', password: pass, gender:'male',password_confirm: pass });
  const login = async (student_id, password = pass) => { const r = await request('/api/player/login', { body: { student_id, password } }); expectStatus(r, 200, '球员登录'); token = r.data.data.token; player = r.data.data; return player; };
  const me = async () => { const r = await request('/api/player/me', { token }); expectStatus(r, 200, '个人资料'); player = r.data.data; return player; };
  const update = (path, data, rev = player.revision, auth = token, method = 'PUT') => request(path, { method, token: auth, body: data, headers: { 'If-Match': String(rev) } });

  await t.test('球员基础：从真实旧 0012 结构升级，新建结构及重复迁移均保留已有行', async () => {
    const c = await pool.getConnection();
    const tables = ['admin','referee','seasons','team','team_roster_batches','team_player','match_reports','match_goals','match_schedules','report_section_history'];
    const snapshot = async () => { const result = {}; for (const table of tables) result[table] = (await c.query(`SELECT * FROM ${table} ORDER BY id`))[0].map(row => { const copy = { ...row }; for (const [target, column] of migration.columns) if (target === table) delete copy[column]; return copy; }); return result; };
    try {
      const [[memberships]]=await c.query('SELECT COUNT(*) n FROM referee_competition_memberships');assert.equal(memberships.n,0);
      await c.query('DROP TABLE referee_competition_memberships');
      await c.query('DROP TABLE competition_discipline_events');
      const before = await snapshot();
      await require('./removeEmptyImportSchema.cjs')(c);
      // 0031 allows multiple approvals per application; reconstruct the original 0013 index before removing it.
      await c.query('ALTER TABLE team_roster_batches ADD UNIQUE INDEX uq_batch_application (application_id)');
      await c.query('ALTER TABLE team_roster_batches DROP INDEX uq_batch_application_revision');
      for (const version of ['0026_player_college_change_reviews','0017_public_results_and_cleanup','0016_roster_changes_and_imports','0015_team_application_workflow','0014_player_registration_workflow']) for (const sql of [...require('../../../db/migrations/'+version).tables].reverse()) await c.query(`DROP TABLE ${sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)[1]}`);
      for (const [table, name] of migration.constraints) await c.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${name}`);
      for (const [table, name] of migration.indexes) await c.query(`ALTER TABLE ${table} DROP INDEX ${name}`);
      for (const [table, column] of migration.columns) await c.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      for (const sql of [...migration.tables].reverse()) await c.query(`DROP TABLE ${sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)[1]}`);
      await c.query("DELETE FROM schema_migrations WHERE version>='0013'");
      await c.query("ALTER TABLE security_events MODIFY actor_role ENUM('admin','referee','anonymous','system') NOT NULL, MODIFY target_role ENUM('admin','referee') NOT NULL");
      await runPendingMigrations(c); assert.deepEqual(await snapshot(), before);
      await runPendingMigrations(c); assert.deepEqual(await snapshot(), before);
      const [[unlinked]] = await c.query('SELECT COUNT(*) AS n FROM team_player WHERE player_account_id IS NOT NULL'); assert.equal(Number(unlinked.n), 0);
    } finally { c.release(); }
  });
  await t.test('球员注册：字段校验、裁判同学号独立、同名不合并、并发学号唯一', async () => {
    const [[ref]] = await pool.query('SELECT student_id FROM referee ORDER BY id LIMIT 1');
    expectStatus(await request('/api/player/register', { body: { ...body('PB1-BAD'), role: 'admin' } }), 400, '拒绝越权字段');
    expectStatus(await request('/api/player/register', { body: { ...body('PB1-BAD'), password_confirm: 'different' } }), 400, '密码确认');
    const r = await request('/api/player/register', { body: body(ref.student_id) }); expectStatus(r, 201, '裁判同学号可注册');
    await login(ref.student_id); assert.equal(player.id, r.data.data.id);
    const both = await Promise.all([1,2].map(() => request('/api/player/register', { body: body('PB1-DUP') })));
    assert.deepEqual(both.map(r => r.status).sort(), [201,409]);
    const other = both.find(r => r.status === 201).data.data; assert.notEqual(other.id, player.id); assert.equal(other.name, player.name);
    const serialized = JSON.stringify(player); assert.equal(serialized.includes('password_hash'), false); assert.equal(serialized.includes('token_version'), false);
  });
  await t.test('球员会话：匿名、裁判、管理员和球员权限互不混用', async () => {
    expectStatus(await request('/api/player/me'), 401, '未登录');
    expectStatus(await request('/api/player/me', { token: admin }), 403, '管理员不能当球员');
    const [[r]] = await pool.query('SELECT id,token_version FROM referee ORDER BY id LIMIT 1');
    const jwt = require('jsonwebtoken');
    const refToken = jwt.sign({ id: r.id, role: 'referee', tokenVersion: r.token_version }, process.env.JWT_SECRET);
    expectStatus(await request('/api/player/me', { token: refToken }), 403, '裁判不能当球员');
    for (const path of ['/api/player-admin', '/api/schedule', '/api/season-registration/current', '/api/team/season/1', '/api/report/schedule/1']) expectStatus(await request(path, { token }), 403, path);
    const fake = jwt.sign({ id: player.id, role: 'guest', tokenVersion: 0 }, process.env.JWT_SECRET);
    expectStatus(await request('/api/player/me', { token: fake }), 401, '未知角色');
    const context = await request('/api/player/context', { token }); expectStatus(context, 200, '主页上下文');
    assert.equal(context.data.data.features.team_registration, true);
  });
  await t.test('资料修改：并发版本保护，当季名单读最新姓名，历史快照不改写', async () => {
    const [[row]] = await pool.query('SELECT p.*,r.id AS report_id FROM team_player p JOIN match_schedules s ON s.team_a_id=p.team_id JOIN match_reports r ON r.schedule_id=s.id ORDER BY p.id LIMIT 1');
    assert.ok(row); linked = row; historical = row.player_name;
    await pool.execute("INSERT INTO match_goals (report_id,player_team_id,credited_team_id,team_player_id,goal_type,minute_base,minute_label) VALUES (?,?,?,?,'normal',12,'12')", [row.report_id,row.team_id,row.team_id,row.id]);
    await pool.execute('UPDATE team_player SET player_account_id=?,profile_snapshot=? WHERE id=?', [player.id, JSON.stringify({ name: row.player_name, college: '历史学院' }), row.id]);
    expectStatus(await request('/api/player/me', { method: 'PUT', token, body: { name: '最新姓名', college: '环境科学与工程学院' } }), 409, '无版本');
    const rev = player.revision;
    expectStatus(await update('/api/player/me', { name: '最新姓名' }), 200, '修改资料');
    await require('./approvedCollegeChange.cjs')(request,expectStatus,token,admin,'环境科学与工程学院');
    expectStatus(await update('/api/player/me', { name: '旧页面覆盖', college: '材料科学与工程学院' }, rev), 409, '旧页面');
    await me(); assert.equal(player.name, '最新姓名');
    const live = await rosterService.roster(row.roster_batch_id, { currentProfile: true });
    assert.equal(live.find(p => p.id === row.id).player_name, '最新姓名');
    const current = await request(`/api/team/${row.team_id}/current-roster`, { token: admin });
    expectStatus(current, 200, '原管理员当前名单');
    assert.equal(current.data.data.players.find(p => p.id === row.id).player_name, '最新姓名');
    assert.equal(current.data.data.players.find(p => p.id === row.id).college, '环境科学与工程学院');
    const old = await rosterService.roster(row.roster_batch_id); assert.equal(old.find(p => p.id === row.id).player_name, historical);
  });
  await t.test('学号即时释放：需当前密码，原 ID/进球/历史归属不随旧号复用而改变', async () => {
    const oldId = player.id, oldStudent = player.student_id, oldToken = token;
    expectStatus(await update('/api/player/me/student-id', { student_id: 'PB1-NEW', current_password: 'wrong' }), 400, '验证密码');
    expectStatus(await update('/api/player/me/student-id', { student_id: 'PB1-DUP', current_password: pass }), 409, '学号冲突');
    expectStatus(await update('/api/player/me/student-id', { student_id: 'PB1-NEW', current_password: pass }), 200, '更换学号');
    expectStatus(await request('/api/player/me', { token: oldToken }), 401, '旧会话撤销');
    const other = await request('/api/player/register', { body: body(oldStudent) }); expectStatus(other, 201, '旧学号立即释放'); assert.notEqual(other.data.data.id, oldId);
    await login('PB1-NEW'); assert.equal(player.id, oldId);
    const [[row]] = await pool.execute('SELECT p.player_account_id,p.player_name,COUNT(g.id) AS goals FROM team_player p LEFT JOIN match_goals g ON g.team_player_id=p.id WHERE p.id=? GROUP BY p.id', [linked.id]);
    assert.equal(row.player_account_id, oldId); assert.equal(row.player_name, historical); assert.ok(Number(row.goals) > 0);
    const d = await request(`/api/player-admin/${oldId}`, { token: admin }); expectStatus(d, 200, '审计');
    assert.equal(d.data.data.history.find(e => e.operation === 'register').after_snapshot.student_id, oldStudent);
    expectStatus(await request(`/api/player-admin/${oldId}`, { token }), 403, '审计仅管理员');
  });
  await t.test('管理员：查询分页、必要原因、重置强制改密、启停与学号纠正撤销会话', async () => {
    const id = player.id, url = `/api/player-admin/${id}`;
    expectStatus(await request('/api/player-admin?page=0', { token: admin }), 400, '非法分页');
    const list = await request('/api/player-admin?q=PB1-NEW&page_size=1', { token: admin }); expectStatus(list, 200, '搜索'); assert.equal(list.data.data.players[0].id, id);
    expectStatus(await update(`${url}/reset-password`, { reason: '' }, player.revision, admin, 'POST'), 400, '重置要原因');
    const reset = await update(`${url}/reset-password`, { reason: '核实本人忘记密码' }, player.revision, admin, 'POST'); expectStatus(reset, 200, '重置');
    const temp = reset.data.data.temporary_password;
    expectStatus(await request('/api/player/me', { token }), 401, '重置撤销旧会话');
    await login('PB1-NEW', temp); assert.equal(player.must_change_password, true);
    expectStatus(await request('/api/player/context', { token }), 403, '强制改密');
    expectStatus(await update('/api/player/me', { name: '越过强制', college: '土木工程学院' }), 403, '强制改密不能修改资料');
    expectStatus(await update('/api/player/me/password', { current_password: temp, new_password: nextPass, password_confirm: nextPass }), 200, '改临时密码');
    await login('PB1-NEW', nextPass); assert.equal(player.must_change_password, false);
    const disabled = await update(`${url}/status`, { is_active: false, reason: '测试停用' }, player.revision, admin); expectStatus(disabled, 200, '停用');
    expectStatus(await request('/api/player/me', { token }), 401, '停用撤销');
    expectStatus(await request('/api/player/login', { body: { student_id: 'PB1-NEW', password: nextPass } }), 401, '停用不能登录');
    const enabled = await update(`${url}/status`, { is_active: true, reason: '恢复测试账号' }, disabled.data.data.revision, admin); expectStatus(enabled, 200, '启用');
    await login('PB1-NEW', nextPass);
    expectStatus(await update(`${url}/student-id`, { student_id: 'PB1-CORRECTED', reason: '核实误填' }, player.revision, admin), 200, '管理员纠正');
    expectStatus(await request('/api/player/me', { token }), 401, '纠正撤销');
    await login('PB1-CORRECTED', nextPass); assert.equal(player.id, id);
    const detail = await request(url, { token: admin });
    const serialized = JSON.stringify(detail.data); for (const secret of [temp, pass, nextPass, 'password_hash']) assert.equal(serialized.includes(secret), false);
    expectStatus(await update('/api/player/logout', {}, player.revision, token, 'POST'), 200, '退出');
    expectStatus(await request('/api/player/me', { token }), 401, '退出撤销');
  });
  await t.test('球员登录失败锁持久保存，独立账号与裁判不共用失败次数', async () => {
    for (let i = 0; i < 5; i++) expectStatus(await request('/api/player/login', { body: { student_id: 'PB1-DUP', password: 'wrong' } }), i === 4 ? 429 : 401, '失败计数');
    const locked = await request('/api/player/login', { body: { student_id: 'PB1-DUP', password: pass } }); expectStatus(locked, 429, '正确密码仍等待解锁'); assert.ok(Number(locked.headers.get('Retry-After')) > 0);
    await login('PB1-CORRECTED', nextPass);
    const [[events]] = await pool.query("SELECT COUNT(*) AS n FROM security_events WHERE target_role='player' AND event_type='login_blocked'"); assert.ok(Number(events.n) > 0);
  });
  await t.test('名单基础：未来版本不会提前生效，旧批次兜底，非法日期被拒绝', async () => {
    const [[team]] = await pool.query('SELECT id,season_id FROM team ORDER BY id LIMIT 1');
    const before = await rosterService.effectiveBatch(team.id, '2026-09-07'); assert.ok(before);
    const [[max]] = await pool.execute('SELECT MAX(version_no) AS n FROM team_roster_batches WHERE team_id=?', [team.id]);
    const [insert] = await pool.execute("INSERT INTO team_roster_batches (team_id,season_id,version_no,source_type,effective_from) VALUES (?,?,?,'online','2026-09-08')", [team.id, team.season_id, Number(max.n) + 1]);
    assert.equal((await rosterService.effectiveBatch(team.id, '2026-09-07')).id, before.id);
    assert.equal((await rosterService.effectiveBatch(team.id, '2026-09-08')).id, insert.insertId);
    for (const date of ['2026-02-30', '2026-99-99', 'invalid']) await assert.rejects(rosterService.effectiveBatch(team.id, date), /比赛日期/);
  });
};
