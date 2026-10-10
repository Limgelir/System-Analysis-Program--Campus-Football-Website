const assert = require('node:assert/strict');
const { runPendingMigrations } = require('../../utils/migrationRunner');
const gradeMigration = require('../../../db/migrations/0007_reserve_national_grade');
const flagMigration = require('../../../db/migrations/0008_shanghai_fa_registration');

module.exports = async function verifyPhase5b({ t, pool, state, request, expectStatus }) {
  if (process.env.REFWEB_INTEGRATION_TEST !== '1' || !process.env.DB_NAME.endsWith('_test')) {
    throw new Error('5B 迁移回归只能使用专用测试库');
  }
  const snapshotHistory = async () => {
    const tables = ['match_schedules', 'match_reports', 'match_goals', 'match_cards', 'match_referee_stats',
      'match_referee_reviews', 'referee_season_registrations', 'referee_season_registration_events'];
    const data = {};
    for (const table of tables) [data[table]] = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
    return data;
  };

  await t.test('5B 升级前已有账号、审核历史和提交报告无损迁移，迁移可重复执行', async () => {
    // 仅在隔离库还原升级前字段；真实开发库/生产库绝不执行此准备步骤。
    const connection = await pool.getConnection();
    try {
      const before = await snapshotHistory();
      assert.ok(before.match_reports.some(row => row.main_report_status === 'submitted'));
      const [accountsBefore] = await connection.query('SELECT * FROM referee ORDER BY id');
      await connection.query('ALTER TABLE referee DROP CHECK chk_referee_shanghai_fa_registered');
      await connection.query('ALTER TABLE referee DROP COLUMN shanghai_fa_registered');
      for (const [table, column] of [['referee', 'grade'], ['referee', 'target_level'], ['referee_season_registrations', 'grade_snapshot']]) {
        await connection.query(`ALTER TABLE ${table} MODIFY ${column} ENUM('三级','二级','一级','国家级') NOT NULL`);
      }
      await connection.query("DELETE FROM schema_migrations WHERE version >= '0007'");
      await runPendingMigrations(connection);
      const [accountsAfter] = await connection.query('SELECT * FROM referee ORDER BY id');
      assert.deepEqual(accountsAfter, accountsBefore, '旧账号所有值和默认否保持一致');
      assert.deepEqual(await snapshotHistory(), before, '历史申请、事件、比分、报告和岗位不变');
      await connection.execute('UPDATE referee SET shanghai_fa_registered = 1 WHERE id = ?', [state.refereeIds.applicant]);
      await gradeMigration.up(connection);
      await flagMigration.up(connection);
      await runPendingMigrations(connection);
      const [[account]] = await connection.execute('SELECT shanghai_fa_registered FROM referee WHERE id = ?', [state.refereeIds.applicant]);
      assert.equal(account.shanghai_fa_registered, 1, '重复迁移不能清除用户后来填报的值');
      await assert.rejects(connection.execute('UPDATE referee SET shanghai_fa_registered = 2 WHERE id = ?', [state.refereeIds.applicant]), /check constraint/i);
    } finally { connection.release(); }
  });

  await t.test('5B 真实注册、登录与管理员维护支持五个级别、足协是/否及旧请求', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=', 'base64');
    const register = async (suffix, grade, flag, target = grade) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({ student_id: `API-5B-${suffix}`, name: `5B测试${suffix}`, grade, target_level: target,
        level_promoted_at: '2026-01-01', match_types: JSON.stringify(['足协杯']), password: state.refereePassword,
        password_confirm: state.refereePassword, gender: '男', college: '土木工程学院', height_cm: 178, weight_kg: 68 })) form.append(key, value);
      if (flag !== undefined) form.append('shanghai_fa_registered', flag);
      form.append('id_photo', new Blob([png], { type: 'image/png' }), '5b.png');
      return request('/api/referee/register', { body: form });
    };
    state.phase5bAccounts = [];
    for (const [index, grade] of ['三级', '二级', '一级', '预备国家级', '国家级'].entries()) {
      const flag = index === 4 ? undefined : index % 2 === 0 ? 'true' : 'false';
      const created = await register(index, grade, flag);
      expectStatus(created, 201, `注册${grade}`);
      assert.equal(created.data.data.shanghai_fa_registered, flag === 'true');
      const login = await request('/api/referee/login', { body: { student_id: `API-5B-${index}`, password: state.refereePassword } });
      expectStatus(login, 200, '新账号登录');
      const user = login.data.data;
      assert.equal(user.grade, grade);
      assert.equal(user.target_level, grade);
      assert.equal(user.shanghai_fa_registered, flag === 'true');
      state.phase5bAccounts.push(user);
      const info = await request(`/api/referee/${user.id}`, { token: user.token });
      assert.equal(info.data.data.shanghai_fa_registered, flag === 'true');
    }
    // 真实注册仍保留每小时 5 次的安全限流；更多非法载荷在服务层/单元测试验证。
    const service = require('../../services/refereeService');
    for (const extra of [{ grade: '国际级' }, { target_level: '国际级' }, { shanghai_fa_registered: 'yes' }]) {
      await assert.rejects(service.register({ college: '土木工程学院', grade: '一级', target_level: '预备国家级', password: state.refereePassword,
        shanghai_fa_registered: false, ...extra }), /必须/);
    }
    const id = state.phase5bAccounts[0].id;
    const edited = await request(`/api/admin/referee/${id}`, { method: 'PUT', token: state.tokens.admin, body: { grade: '预备国家级', target_level: '预备国家级' } });
    expectStatus(edited, 200, '管理员维护预备国家级');
    expectStatus(await request(`/api/admin/referee/${id}`, { method: 'PUT', token: state.tokens.admin, body: { grade: '国际级' } }), 400, '管理员非法级别');
  });

  await t.test('5B 本人标记双向保存、权限隔离、无启用赛季独立维护且历史和资格不变', async () => {
    const user = state.phase5bAccounts[3];
    const url = `/api/referee/${user.id}/shanghai-fa-registration`;
    const history = await snapshotHistory();
    const eligibility = await request('/api/season-registration/admin/eligible', { token: state.tokens.admin });
    for (const flag of [true, false, 'true', 'false', false]) {
      const saved = await request(url, { method: 'PUT', token: user.token, body: { shanghai_fa_registered: flag } });
      expectStatus(saved, 200, '双向修改标记');
      const expected = flag === true || flag === 'true';
      assert.equal(saved.data.data.shanghai_fa_registered, expected);
      const login = await request('/api/referee/login', { body: { student_id: user.student_id, password: state.refereePassword } });
      assert.equal(login.data.data.shanghai_fa_registered, expected);
      const list = await request('/api/admin/referee/all', { token: state.tokens.admin });
      expectStatus(list, 200, '管理员账号列表');
      assert.equal(list.data.data.find(row => row.id === user.id).shanghai_fa_registered, expected);
      const detail = await request(`/api/admin/referee/${user.id}`, { token: state.tokens.admin });
      assert.equal(detail.data.data.shanghai_fa_registered, expected);
    }
    for (const [token, status] of [[undefined, 401], [state.tokens.admin, 403], [state.phase5bAccounts[0].token, 403]]) {
      expectStatus(await request(url, { method: 'PUT', token, body: { shanghai_fa_registered: true } }), status, '拒绝未登录/管理员身份/他人越权');
    }
    for (const extra of ['name', 'grade', 'target_level', 'officiated_count_base', 'is_active', 'status', 'referee_id']) {
      expectStatus(await request(url, { method: 'PUT', token: user.token, body: { shanghai_fa_registered: true, [extra]: 'x' } }), 400, `拒绝夹带${extra}`);
    }
    for (const body of [{}, [], { shanghai_fa_registered: null }, { shanghai_fa_registered: 'yes' }, { shanghai_fa_registered: 2 }]) {
      expectStatus(await request(url, { method: 'PUT', token: user.token, body }), 400, '拒绝非法标记');
    }
    expectStatus(await request(`/api/referee/${user.id}/profile`, { method: 'PUT', token: user.token, body: { grade: '一级' } }), 403, '原主资料接口仍锁定');
    const directory = await request('/api/referee/all', { token: user.token });
    assert.ok(directory.data.data.every(row => !Object.hasOwn(row, 'shanghai_fa_registered')), '不向其他裁判公开足协资料');
    const [[active]] = await pool.query('SELECT id FROM seasons WHERE is_active = 1');
    if (active) await pool.execute('UPDATE seasons SET is_active = 0 WHERE id = ?', [active.id]);
    try {
      expectStatus(await request(url, { method: 'PUT', token: user.token, body: { shanghai_fa_registered: true } }), 200, '无启用赛季仍可维护');
    } finally { if (active) await pool.execute('UPDATE seasons SET is_active = 1 WHERE id = ?', [active.id]); }
    assert.deepEqual(await snapshotHistory(), history);
    const after = await request('/api/season-registration/admin/eligible', { token: state.tokens.admin });
    assert.deepEqual(after.data.data, eligibility.data.data);
    for (const column of ['must_change_password', 'is_active']) {
      await pool.execute(`UPDATE referee SET ${column} = ? WHERE id = ?`, [column === 'is_active' ? 0 : 1, user.id]);
      expectStatus(await request(url, { method: 'PUT', token: user.token, body: { shanghai_fa_registered: false } }), column === 'is_active' ? 401 : 403, '停用或待改密仍受鉴权限制');
      await pool.execute(`UPDATE referee SET ${column} = ? WHERE id = ?`, [column === 'is_active' ? 1 : 0, user.id]);
    }
  });

  await t.test('5B 预备国家级申请可审核筛选，只有通过后可搜索选派', async () => {
    const user = state.phase5bAccounts[3];
    const submitted = await request('/api/season-registration/current/submit', { token: user.token,
      body: { name: '5B当季预备国家级', height_cm: 178, weight_kg: 68, college: '土木工程学院', grade: '预备国家级', match_types: ['足协杯'] } });
    expectStatus(submitted, 201, '预备国家级赛季申请');
    const id = submitted.data.data.id;
    const pending = await request('/api/season-registration/admin?grade=预备国家级&status=pending', { token: state.tokens.admin });
    expectStatus(pending, 200, '新级别审核筛选');
    assert.ok(pending.data.data.items.some(row => row.id === id));
    const candidateUrl = `/api/season-registration/admin/eligible?query=${encodeURIComponent(user.student_id)}`;
    assert.equal((await request(candidateUrl, { token: state.tokens.admin })).data.data.pagination.total, 0);
    expectStatus(await request(`/api/season-registration/admin/${id}/approve`, { token: state.tokens.admin, body: { reason: '5B验收' } }), 200, '审核通过');
    const eligible = await request(candidateUrl, { token: state.tokens.admin });
    assert.equal(eligible.data.data.pagination.total, 1);
    assert.equal(eligible.data.data.items[0].grade_snapshot, '预备国家级');
    const detail = await request(`/api/season-registration/admin/${id}`, { token: state.tokens.admin });
    assert.equal(detail.data.data.events.at(-1).after_snapshot.grade_snapshot, '预备国家级');
    expectStatus(await request('/api/season-registration/admin?grade=国际级', { token: state.tokens.admin }), 400, '级别筛选仍使用白名单');
  });
};
