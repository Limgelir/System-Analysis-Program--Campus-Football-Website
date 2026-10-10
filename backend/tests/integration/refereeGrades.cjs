const assert = require('node:assert/strict');

module.exports = async ({ t, pool, state, request, expectStatus }) => {
  const admin = state.tokens.admin;
  const call = async (url, body, method = 'GET', token = admin, status = 200) => {
    const result = await request(url, { body, method, token });
    expectStatus(result, status, url);
    return result.data?.data;
  };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=', 'base64');
  const form = (student_id, extra = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ student_id, name: '学员验收', grade: '裁判学员', target_level: '裁判学员',
      password: state.refereePassword, password_confirm: state.refereePassword, gender: '男', college: '土木工程学院',
      height_cm: 175, weight_kg: 65, match_types: JSON.stringify(['足协杯']), ...extra })) data.append(key, value);
    data.append('id_photo', new Blob([png], { type: 'image/png' }), 'trainee.png');
    return data;
  };
  let user, registrationId;
  await t.test('学员首次注册支持省略或填写日期；所有其他级别仍要求日期', async () => {
    await call('/api/referee/register', form('GRADE-TRAINEE'), 'POST', undefined, 201);
    user = await call('/api/referee/login', { student_id: 'GRADE-TRAINEE', password: state.refereePassword }, 'POST', undefined);
    assert.equal(user.grade, '裁判学员');
    const detail = await call('/api/referee/' + user.id, undefined, 'GET', user.token);
    assert.equal(detail.level_promoted_at, null);
    assert.equal(detail.target_level, '裁判学员');
    await call('/api/referee/register', form('GRADE-DATED', { level_promoted_at: '2026-09-28' }), 'POST', undefined, 201);
    for (const grade of ['三级', '二级', '一级', '预备国家级', '国家级']) {
      await call('/api/referee/register', form('GRADE-MISSING', { grade }), 'POST', undefined, 400);
    }
    await call('/api/referee/register', form('GRADE-BAD-DATE', { level_promoted_at: '2026-02-30' }), 'POST', undefined, 400);
  });
  await t.test('管理员两套新增和编辑接口支持学员空日期；晋级必须补齐，其他级别不能清空', async () => {
    const first = await call('/api/admin/referee', form('GRADE-ADMIN'), 'POST', admin, 201);
    const second = await call('/api/referee/admin/add', { student_id: 'GRADE-ALIAS', name: '学员兼容入口', grade: '裁判学员', target_level: '三级', match_types: ['足协杯'] }, 'POST', admin, 201);
    for (const [url, id] of [['/api/admin/referee/', first.id], ['/api/referee/admin/', second.id]]) {
      await call(url + id, { grade: '三级' }, 'PUT', admin, 400);
      await call(url + id, { grade: '三级', level_promoted_at: '2026-09-28' }, 'PUT');
      await call(url + id, { level_promoted_at: '' }, 'PUT', admin, 400);
      await call(url + id, { grade: '裁判学员', level_promoted_at: '' }, 'PUT');
      assert.equal((await call('/api/admin/referee/' + id)).level_promoted_at, null);
    }
    const list = await call('/api/admin/referee/all?query=GRADE-ADMIN');
    assert.equal(list[0].grade, '裁判学员');
    const csv = await request('/api/admin/referee/export?query=GRADE-ADMIN', { token: admin });
    expectStatus(csv, 200, '学员导出');
    assert.match(csv.data, /裁判学员/);
  });
  await t.test('学员赛季注册可以筛选、审核和选派；账号改级别不改赛季资料、事件或资格', async () => {
    await call('/api/season', { season_code: 'GRADE-SEASON', season_name: '级别验收', start_date: '2026-01-01', end_date: '2028-12-31', is_active: true }, 'POST', admin, 201);
    const registration = await call('/api/season-registration/current/submit', { name: '当季学员', college: '土木工程学院', height_cm: 175, weight_kg: 65, grade: '裁判学员', match_types: ['足协杯'] }, 'POST', user.token, 201);
    registrationId = registration.id;
    const pending = await call('/api/season-registration/admin?grade=' + encodeURIComponent('裁判学员') + '&status=pending');
    assert.ok(pending.items.some(row => row.id === registrationId));
    const url = '/api/referee/' + user.id + '/grade';
    const snapshot = async () => {
      const result = {};
      for (const table of ['referee_season_registrations', 'referee_season_registration_events', 'match_official_assignments']) {
        [result[table]] = await pool.query('SELECT * FROM ' + table + ' ORDER BY id');
      }
      return result;
    };
    const pendingBefore = await snapshot();
    await call(url, { grade: '三级', level_promoted_at: '2026-09-28' }, 'PUT', user.token);
    assert.deepEqual(await snapshot(), pendingBefore);
    await call('/api/season-registration/admin/' + registrationId + '/approve', { reason: '学员测试' }, 'POST');
    const eligibleUrl = '/api/season-registration/admin/eligible?query=GRADE-TRAINEE';
    const eligibleBefore = await call(eligibleUrl);
    assert.equal(eligibleBefore.items[0].grade_snapshot, '裁判学员');
    const before = await snapshot();
    // 固定旧时间，确保测试覆盖更新时间变化，不依赖请求是否落在同一秒。
    await pool.execute("UPDATE referee SET updated_at='2000-01-01 00:00:00' WHERE id=?", [user.id]);
    const [[accountBefore]] = await pool.execute('SELECT * FROM referee WHERE id=?', [user.id]);
    for (const data of [{ grade: '二级', level_promoted_at: '2026-09-27' }, { grade: '裁判学员', level_promoted_at: '' },
      { grade: '裁判学员', level_promoted_at: '2026-09-28' }, { grade: '裁判学员', level_promoted_at: null }]) {
      const saved = await call(url, data, 'PUT', user.token);
      assert.equal(saved.grade, data.grade);
      assert.equal(saved.level_promoted_at, data.level_promoted_at || null);
    }
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await call(eligibleUrl), eligibleBefore);
    const [[accountAfter]] = await pool.execute('SELECT * FROM referee WHERE id=?', [user.id]);
    const omitGrade = ({ grade, level_promoted_at, updated_at, ...rest }) => rest;
    assert.deepEqual(omitGrade(accountAfter), omitGrade(accountBefore), '其他资料、目标级别、密码和账号状态不变');
    assert.ok(new Date(accountAfter.updated_at).getTime() > new Date(accountBefore.updated_at).getTime(), '修改级别应刷新账号更新时间');
    const [[active]] = await pool.query('SELECT id FROM seasons WHERE is_active=1');
    await pool.execute('UPDATE seasons SET is_active=0 WHERE id=?', [active.id]);
    try { await call(url, { grade: '三级', level_promoted_at: '2026-09-28' }, 'PUT', user.token); }
    finally { await pool.execute('UPDATE seasons SET is_active=1 WHERE id=?', [active.id]); }
    assert.deepEqual(await snapshot(), before, '没有启用赛季也可立即改级别');
    assert.equal((await call('/api/referee/login', { student_id: 'GRADE-TRAINEE', password: state.refereePassword }, 'POST', undefined)).grade, '三级');
  });
  await t.test('本人改级别拒绝越权、夹带字段、非法级别日期；失败不改数据', async () => {
    const url = '/api/referee/' + user.id + '/grade';
    const other = await call('/api/referee/login', { student_id: 'GRADE-DATED', password: state.refereePassword }, 'POST', undefined);
    for (const [token, status] of [[null, 401], [admin, 403], [other.token, 403]]) {
      await call(url, { grade: '裁判学员' }, 'PUT', token, status);
    }
    const [[before]] = await pool.execute('SELECT * FROM referee WHERE id=?', [user.id]);
    for (const body of [{}, [], { grade: '国际级' }, { grade: '三级' }, { grade: '一级', level_promoted_at: '' },
      ...['2026-02-30', ['2026-09-28'], true, '2026-09-28bad'].map(level_promoted_at => ({ grade: '裁判学员', level_promoted_at })),
      ...['name', 'target_level', 'is_active', 'status', 'referee_id', 'shanghai_fa_registered'].map(key => ({ grade: '裁判学员', [key]: 'x' }))]) {
      await call(url, body, 'PUT', user.token, 400);
    }
    assert.deepEqual((await pool.execute('SELECT * FROM referee WHERE id=?', [user.id]))[0][0], before);
    for (const [column, value, status] of [['must_change_password', 1, 403], ['is_active', 0, 401]]) {
      await pool.execute('UPDATE referee SET ' + column + '=? WHERE id=?', [value, user.id]);
      try { await call(url, { grade: '裁判学员' }, 'PUT', user.token, status); }
      finally { await pool.execute('UPDATE referee SET ' + column + '=? WHERE id=?', [column === 'is_active' ? 1 : 0, user.id]); }
    }
    await call('/api/referee/' + user.id + '/profile', { grade: '裁判学员' }, 'PUT', user.token, 403);
  });
};
