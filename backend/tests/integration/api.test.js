const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const bcrypt = require('bcryptjs');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);

if (process.env.REFWEB_INTEGRATION_TEST !== '1' || process.env.NODE_ENV !== 'test') {
  throw new Error('API 集成测试只能通过 npm run test:integration 在隔离测试环境中执行');
}
if (!String(process.env.DB_NAME || '').toLowerCase().endsWith('_test')) {
  throw new Error('API 集成测试拒绝连接未以 _test 结尾的数据库');
}

const pool = require('../../db');
const app = require('../../server');

const state = {
  server: null,
  baseUrl: '',
  admin: { username: 'api-admin', password: 'Admin!Pass2026' },
  refereePassword: 'RefPass!2026',
  refereeIds: {},
  tokens: {},
  seasonId: null,
  teams: {},
  roster: {},
  scheduleId: null
};

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);

  // 测试客户端像新页面一样携带读到的分区版本；负面/并发测试可显式覆盖。
  const reportPath = /^\/api\/report\/(?:admin\/)?schedule\/(\d+)\/(.+)$/.exec(pathname);
  const method = options.method || (options.body === undefined ? 'GET' : 'POST');
  if (reportPath && method !== 'GET' && !headers.has('If-Match') && options.autoRevision !== false) {
    const detail = await fetch(`${state.baseUrl}/api/report/schedule/${reportPath[1]}`,{headers});
    if (detail.ok) {
      const payload = await detail.json();
      const section = reportPath[2].includes('supervisor') ? 'supervisor' : 'main';
      headers.set('If-Match',String(payload.data.sections[section].revision));
    }
  }

  let body = options.body;
  if (pathname==='/api/schedule' && method==='POST' && body && !Object.hasOwn(body,'venue') && options.autoVenue!==false) body={...body,venue:'樱花人草'};
  const schedulePath=/^\/api\/schedule\/(\d+)(?:\/assign-referees)?$/.exec(pathname);
  if(schedulePath && method==='PUT' && body && !Object.hasOwn(body,'schedule_revision') && options.autoScheduleRevision!==false){
    const detail=await fetch(state.baseUrl+'/api/schedule/'+schedulePath[1],{headers});
    if(detail.ok) body={...body,schedule_revision:(await detail.json()).data.schedule_revision};
  }
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }

  const response = await fetch(`${state.baseUrl}${pathname}`, {
    method: options.method || (body === undefined ? 'GET' : 'POST'),
    headers,
    body
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data, headers: response.headers };
}

function expectStatus(result, expected, context) {
  assert.equal(
    result.status,
    expected,
    `${context}: 期望 HTTP ${expected}，实际 ${result.status}；响应 ${JSON.stringify(result.data)}`
  );
}

async function seedAccounts() {
  const connection = await pool.getConnection();
  try {
    const adminHash = await bcrypt.hash(state.admin.password, 4);
    const refereeHash = await bcrypt.hash(state.refereePassword, 4);
    await connection.execute(
      `INSERT INTO admin
       (username, password_hash, must_change_password, password_changed_at, token_version)
       VALUES (?, ?, 0, NOW(), 0)`,
      [state.admin.username, adminHash]
    );

    const roles = ['main', 'assistant1', 'assistant2', 'fourth', 'supervisor', 'outsider', 'applicant'];
    for (let index = 0; index < roles.length; index += 1) {
      const role = roles[index];
      const studentId = `API-R-${String(index + 1).padStart(3, '0')}`;
      const [result] = await connection.execute(
        `INSERT INTO referee
         (student_id, name, grade, target_level, level_promoted_at, match_types,
          password_hash, must_change_password, password_changed_at, token_version, is_active)
         VALUES (?, ?, '三级', '二级', '2025-01-01', '足协杯,大联赛', ?, 0, NOW(), 0, 1)`,
        [studentId, `接口测试-${role}`, refereeHash]
      );
      await connection.execute(
        `INSERT INTO referee_profile
         (referee_id, gender, college, height_cm, weight_kg, officiated_count_base)
         VALUES (?, '男', '土木工程学院', 175, 65.5, 0)`,
        [result.insertId]
      );
      state.refereeIds[role] = result.insertId;
      state[`${role}StudentId`] = studentId;
    }
  } finally {
    connection.release();
  }
}

async function loginReferee(role, password = state.refereePassword) {
  const result = await request('/api/referee/login', {
    body: { student_id: state[`${role}StudentId`], password }
  });
  expectStatus(result, 200, `${role} 裁判登录`);
  state.tokens[role] = result.data.data.token;
  return result;
}

before(async () => {
  await seedAccounts();
  await new Promise((resolve, reject) => {
    state.server = app.listen(0, '127.0.0.1', resolve);
    state.server.once('error', reject);
  });
  const address = state.server.address();
  state.baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (state.server) {
    await new Promise(resolve => state.server.close(resolve));
  }
  await pool.end();
});

test('核心 API 业务规则在隔离数据库中完整回归', async t => {
  await t.test('登录、令牌身份和角色隔离', async () => {
    const adminLogin = await request('/api/admin/login', {
      body: state.admin
    });
    expectStatus(adminLogin, 200, '管理员登录');
    state.tokens.admin = adminLogin.data.data.token;

    for (const role of Object.keys(state.refereeIds)) {
      await loginReferee(role);
    }

    const wrongAdminPassword = await request('/api/admin/login', {
      body: { username: state.admin.username, password: 'wrong-password' }
    });
    expectStatus(wrongAdminPassword, 401, '管理员错误密码');

    const refereeCallingAdmin = await request('/api/season', { token: state.tokens.main });
    expectStatus(refereeCallingAdmin, 403, '裁判访问管理员赛季列表');

    const adminCallingReferee = await request(`/api/referee/${state.refereeIds.main}`, {
      token: state.tokens.admin
    });
    expectStatus(adminCallingReferee, 403, '管理员调用裁判本人接口');

    const refereeReadingOtherProfile = await request(`/api/referee/${state.refereeIds.assistant1}`, {
      token: state.tokens.main
    });
    expectStatus(refereeReadingOtherProfile, 403, '裁判读取他人资料');
  });

  await t.test('赛季、队伍名单导入、重新导入和历史批次', async () => {
    const season = await request('/api/season', {
      method: 'POST',
      token: state.tokens.admin,
      body: {
        season_code: 'api-2026',
        season_name: 'API测试赛季',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_active: true
      }
    });
    expectStatus(season, 201, '创建测试赛季');
    state.seasonId = season.data.data.id;

    const createTeam = async (name, firstPlayerName) => {
      const team = await require('./legacyTeamFixture.cjs').create({
          team_name: name,
          league_type: '足协杯',
          roster_entries: [
            { jersey_number: '1', player_name: firstPlayerName, remark: 'v1' },
            { jersey_number: '2', player_name: `${firstPlayerName}-二号`, remark: null }
          ]
      });
      return team;
    };

    state.teams.home = await createTeam('API主队', '主队旧球员');
    state.teams.away = await createTeam('API客队', '客队球员');

    const firstRoster = await request(`/api/team/${state.teams.home.id}/current-roster`, {
      token: state.tokens.admin
    });
    expectStatus(firstRoster, 200, '读取首版名单');
    const firstBatchId = firstRoster.data.data.roster_batch.id;
    state.roster.oldHomePlayerId = firstRoster.data.data.players[0].id;

    expectStatus(await request('/api/team/'+state.teams.home.id+'/roster',{token:state.tokens.admin,body:{roster_entries:[]}}),400,'旧导入不能绕过审核');
    const reimport=await require('./legacyTeamFixture.cjs').roster(state.teams.home.id,[{jersey_number:'10',player_name:'主队新球员',remark:'v2'},{jersey_number:'11',player_name:'主队新球员二号',remark:null}]);
    assert.equal(Number(reimport.version_no),2);

    const currentRoster = await request(`/api/team/${state.teams.home.id}/current-roster`, {
      token: state.tokens.admin
    });
    expectStatus(currentRoster, 200, '读取第二版当前名单');
    assert.equal(Number(currentRoster.data.data.roster_batch.version_no), 2);
    assert.equal(currentRoster.data.data.players[0].player_name, '主队新球员');
    state.roster.homePlayerId = currentRoster.data.data.players[0].id;

    const awayRoster = await request(`/api/team/${state.teams.away.id}/current-roster`, {
      token: state.tokens.admin
    });
    expectStatus(awayRoster, 200, '读取客队名单');
    state.roster.awayPlayerId = awayRoster.data.data.players[0].id;

    const batches = await request(`/api/team/${state.teams.home.id}/roster-batches`, {
      token: state.tokens.admin
    });
    expectStatus(batches, 200, '读取名单历史');
    assert.deepEqual(batches.data.data.batches.map(item => Number(item.version_no)), [2, 1]);

    const oldBatch = await request(`/api/team/${state.teams.home.id}/roster-batches/${firstBatchId}`, {
      token: state.tokens.admin
    });
    expectStatus(oldBatch, 200, '读取首版历史名单快照');
    assert.equal(oldBatch.data.data.players[0].player_name, '主队旧球员');
  });

  await t.test('赛季编码和名称按数据库20字符边界校验，失败不切换当前赛季', async () => {
    const body = { season_code: 'phase4-limit', season_name: '阶段4长度检查', start_date: '2026-01-01', end_date: '2026-12-31', is_active: true };
    for (const [field, value, message] of [
      ['season_code', 'x'.repeat(21), '赛季编码不能超过20个字符'],
      ['season_name', '赛'.repeat(21), '赛季名称不能超过20个字符']
    ]) {
      const result = await request('/api/season', { method: 'POST', token: state.tokens.admin, body: { ...body, [field]: value } });
      expectStatus(result, 400, message);
      assert.equal(result.data.message, message);
      const current = await request('/api/season/current', { token: state.tokens.admin });
      assert.equal(current.data.data.id, state.seasonId);
    }
    const edge = await request('/api/season', { method: 'POST', token: state.tokens.admin, body: { ...body, season_code: 'x'.repeat(20), season_name: '赛'.repeat(20), is_active: false } });
    expectStatus(edge, 201, '20字符边界可以创建');
    await pool.execute('DELETE FROM seasons WHERE id = ? AND is_active = 0', [edge.data.data.id]);
  });

  await t.test('只有当季审核通过且账号启用的裁判可以被新选派', async () => {
    const assignedRoles = ['main', 'assistant1', 'assistant2', 'fourth', 'supervisor'];
    for (const role of assignedRoles) {
      const submitted = await request('/api/season-registration/current/submit', {
        token: state.tokens[role],
        body: {
          name: `当季-${role}`,
          height_cm: 175,
          weight_kg: 66,
          college: '土木工程学院',
          grade: role === 'main' ? '二级' : '三级',
          match_types: ['足协杯', '大联赛']
        }
      });
      expectStatus(submitted, 201, `${role} 提交当季注册`);
      const approved = await request(`/api/season-registration/admin/${submitted.data.data.id}/approve`, {
        token: state.tokens.admin,
        body: { reason: '集成测试审核通过' }
      });
      expectStatus(approved, 200, `${role} 当季注册审核通过`);
    }

    const search = await request(`/api/season-registration/admin/eligible?season_id=${state.seasonId}&query=API-R-001&page=1&page_size=2`, {
      token: state.tokens.admin
    });
    expectStatus(search, 200, '按学号搜索当季可选派裁判');
    assert.equal(search.data.data.pagination.total, 1);
    assert.equal(search.data.data.items[0].name_snapshot, '当季-main');

    const forged = await request('/api/schedule', {
      method: 'POST',
      token: state.tokens.admin,
      body: {
        match_type: '足协杯',
        team_a_id: state.teams.home.id,
        team_b_id: state.teams.away.id,
        match_time: '17:35', match_date: '2026-09-01',
        field_order: 99,
        main_referee_id: state.refereeIds.applicant
      }
    });
    expectStatus(forged, 409, '伪造未审核裁判选派请求');
    assert.equal(forged.data.code, 'REFEREE_NOT_ELIGIBLE_FOR_SEASON');

    const emptySchedule = await request('/api/schedule', {
      method: 'POST',
      token: state.tokens.admin,
      body: {
        match_type: '足协杯',
        team_a_id: state.teams.home.id,
        team_b_id: state.teams.away.id,
        match_time: '17:35', match_date: '2099-01-01',
        field_order: 98
      }
    });
    expectStatus(emptySchedule, 200, '创建待选派赛程');
    const forgedAssignment = await request(`/api/schedule/${emptySchedule.data.data.id}/assign-referees`, {
      method: 'PUT',
      token: state.tokens.admin,
      body: { assistant1_id: state.refereeIds.applicant }
    });
    expectStatus(forgedAssignment, 409, '选派接口拒绝未审核裁判');
    assert.equal(forgedAssignment.data.code, 'REFEREE_NOT_ELIGIBLE_FOR_SEASON');
    const deletedEmpty = await request(`/api/schedule/${emptySchedule.data.data.id}`, {
      method: 'DELETE',
      token: state.tokens.admin
    });
    expectStatus(deletedEmpty, 200, '清理资格测试空赛程');
  });

  await t.test('赛程唯一性、队伍与岗位约束', async () => {
    const basePayload = {
      match_type: '足协杯',
      team_a_id: state.teams.home.id,
      team_b_id: state.teams.away.id,
      match_time: '17:35', match_date: '2026-09-02',
      field_order: 1,
      main_referee_id: state.refereeIds.main,
      assistant1_id: state.refereeIds.assistant1,
      assistant2_id: state.refereeIds.assistant2,
      fourth_official_id: state.refereeIds.fourth,
      supervisor_id: state.refereeIds.supervisor
    };

    const duplicateTeams = await request('/api/schedule', {
      method: 'POST', token: state.tokens.admin,
      body: { ...basePayload, team_b_id: state.teams.home.id }
    });
    expectStatus(duplicateTeams, 400, '主客队相同');

    const duplicateOfficials = await request('/api/schedule', {
      method: 'POST', token: state.tokens.admin,
      body: { ...basePayload, assistant1_id: state.refereeIds.main }
    });
    expectStatus(duplicateOfficials, 400, '岗位裁判重复');

    const created = await request('/api/schedule', {
      method: 'POST', token: state.tokens.admin, body: basePayload
    });
    expectStatus(created, 200, '创建有效赛程');
    state.scheduleId = created.data.data.id;

    const duplicateFieldOrder = await request('/api/schedule', {
      method: 'POST', token: state.tokens.admin,
      body: { ...basePayload, match_time: '17:35', match_date: '2026-09-03' }
    });
    expectStatus(duplicateFieldOrder, 400, '同赛季同赛事类型场序重复');
  });

  await t.test('报告查看权限和分区写权限', async () => {
    const outsiderRead = await request(`/api/report/schedule/${state.scheduleId}`, {
      token: state.tokens.outsider
    });
    expectStatus(outsiderRead, 403, '非当值裁判查看报告');

    const outsiderWrite = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.outsider,
      body: { home_score: 0, away_score: 0, goals: [] }
    });
    expectStatus(outsiderWrite, 403, '非当值裁判修改裁判员区');

    const assistantRead = await request(`/api/report/schedule/${state.scheduleId}`, {
      token: state.tokens.assistant1
    });
    expectStatus(assistantRead, 200, '当值助理裁判员查看报告');
    assert.equal(assistantRead.data.data.viewer_permissions.is_readonly, true);

    const assistantWrite = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.assistant1,
      body: { home_score: 0, away_score: 0, goals: [] }
    });
    expectStatus(assistantWrite, 403, '助理裁判员修改裁判员区');

    const mainWritesSupervisor = await request(`/api/report/schedule/${state.scheduleId}/supervisor`, {
      token: state.tokens.main,
      body: { reviews: [] }
    });
    expectStatus(mainWritesSupervisor, 403, '裁判员修改裁判监督区');

    const supervisorWritesMain = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.supervisor,
      body: { home_score: 0, away_score: 0, goals: [] }
    });
    expectStatus(supervisorWritesMain, 403, '裁判监督修改裁判员区');
  });

  await t.test('比分、进球、红黄牌、统计、文本和图片约束', async () => {
    for (const invalidScore of [31, -1, 0.5, 1000000]) {
      const invalid = await request(`/api/report/schedule/${state.scheduleId}/main`, {
        token: state.tokens.main,
        body: { home_score: invalidScore, away_score: 0, goals: [] }
      });
      expectStatus(invalid, 400, `无效比分 ${invalidScore}`);
    }

    const scoreGoalMismatch = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.main,
      body: { home_score: 1, away_score: 0, goals: [] }
    });
    expectStatus(scoreGoalMismatch, 400, '比分与进球条数不一致');

    const invalidGoalType = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.main,
      body: {
        home_score: 1,
        away_score: 0,
        goals: [{
          player_team_id: state.teams.home.id,
          credited_team_id: state.teams.home.id,
          team_player_id: state.roster.homePlayerId,
          goal_type: 'invalid',
          minute_base: 1,
          minute_extra: 0
        }]
      }
    });
    expectStatus(invalidGoalType, 400, '非法进球类型');

    const invalidCard = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.main,
      body: {
        home_score: 0,
        away_score: 0,
        goals: [],
        cards: [{
          team_id: state.teams.home.id,
          team_player_id: state.roster.homePlayerId,
          card_type: 'blue',
          minute_base: 2,
          minute_extra: 0
        }]
      }
    });
    expectStatus(invalidCard, 400, '非法红黄牌类型');

    const textTooLong = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.main,
      body: {
        home_score: 1,
        away_score: 0,
        goals: [{
          player_team_id: state.teams.home.id,
          credited_team_id: state.teams.home.id,
          team_player_id: state.roster.homePlayerId,
          goal_type: 'normal',
          minute_base: 3,
          minute_extra: 0,
          description: '过'.repeat(256)
        }]
      }
    });
    expectStatus(textTooLong, 400, '进球说明超长');

    const invalidStat = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.main,
      body: {
        home_score: 0, away_score: 0, goals: [],
        stats: [{ role: 'main', running_distance_m: -1 }]
      }
    });
    expectStatus(invalidStat, 400, '负数执法统计');

    const outsiderUpload = new FormData();
    outsiderUpload.append('fourth_official_image', new Blob([Buffer.from('not-an-image')], { type: 'image/png' }), 'fake.png');
    const outsiderUploadResult = await request(`/api/report/schedule/${state.scheduleId}/fourth-official-image`, {
      token: state.tokens.outsider,
      body: outsiderUpload
    });
    expectStatus(outsiderUploadResult, 400, '伪造图片签名');

    const wrongMime = new FormData();
    wrongMime.append('fourth_official_image', new Blob([Buffer.from('text')], { type: 'text/plain' }), 'fake.txt');
    const wrongMimeResult = await request(`/api/report/schedule/${state.scheduleId}/fourth-official-image`, {
      token: state.tokens.main,
      body: wrongMime
    });
    expectStatus(wrongMimeResult, 400, '不允许的图片 MIME');

    const oversizedImage = new FormData();
    oversizedImage.append(
      'fourth_official_image',
      new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], { type: 'image/png' }),
      'oversized.png'
    );
    const oversizedImageResult = await request(`/api/report/schedule/${state.scheduleId}/fourth-official-image`, {
      token: state.tokens.main,
      body: oversizedImage
    });
    expectStatus(oversizedImageResult, 400, '图片超过 10MB');

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const validImage = new FormData();
    validImage.append('fourth_official_image', new Blob([pngBytes], { type: 'image/png' }), 'valid.png');
    const validUpload = await request(`/api/report/schedule/${state.scheduleId}/fourth-official-image`, {
      token: state.tokens.main,
      body: validImage
    });
    expectStatus(validUpload, 200, '裁判员上传有效 PNG');
    assert.match(validUpload.data.data.report.fourth_official_image_path, /^\/uploads\/reports\//);

    const removeImage = await request(`/api/report/schedule/${state.scheduleId}/fourth-official-image`, {
      method: 'DELETE', token: state.tokens.main
    });
    expectStatus(removeImage, 200, '裁判员删除第四官员记录单');
  });

  await t.test('报告开始后比赛信息锁定，选派仍检查候选人资格', async () => {
    const existing = await request(`/api/schedule/${state.scheduleId}`, { token: state.tokens.admin });
    expectStatus(existing, 200, '读取赛程详情');

    const coreLocked = await request(`/api/schedule/${state.scheduleId}`, {
      method: 'PUT', token: state.tokens.admin,
      body: {
        match_type: '足协杯',
        team_a_id: state.teams.home.id,
        team_b_id: state.teams.away.id,
        match_time: '17:35', match_date: '2026-09-04',
        field_order: 1,
        main_referee_id: state.refereeIds.main,
        assistant1_id: state.refereeIds.assistant1,
        assistant2_id: state.refereeIds.assistant2,
        fourth_official_id: state.refereeIds.fourth,
        supervisor_id: state.refereeIds.supervisor
      }
    });
    expectStatus(coreLocked, 400, '报告开始后修改赛程日期');

    const rolesLocked = await request(`/api/schedule/${state.scheduleId}/assign-referees`, {
      method: 'PUT', token: state.tokens.admin,
      body: { fourth_official_id: state.refereeIds.outsider }
    });
    expectStatus(rolesLocked, 409, '未通过赛季审核的裁判仍不能选派');
  });

  await t.test('裁判员与裁判监督提交后各自分区锁定', async () => {
    const saveMain = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.main,
      body: {
        home_score: 1,
        away_score: 0,
        home_penalty_score: 0,
        away_penalty_score: 0,
        goals: [{
          player_team_id: state.teams.home.id,
          credited_team_id: state.teams.home.id,
          team_player_id: state.roster.homePlayerId,
          goal_type: 'normal',
          minute_base: 10,
          minute_extra: 0,
          description: '有效进球'
        }],
        cards: [{
          team_id: state.teams.away.id,
          team_player_id: state.roster.awayPlayerId,
          card_type: 'yellow',
          minute_base: 20,
          minute_extra: 1,
          description: '战术犯规'
        }],
        stats: [{ role: 'main', running_distance_m: 9000, red_card_accuracy: 100 }]
      }
    });
    expectStatus(saveMain, 200, '保存有效裁判员报告');

    const submitMain = await request(`/api/report/schedule/${state.scheduleId}/main/submit`, {
      token: state.tokens.main,
      body: {}
    });
    expectStatus(submitMain, 200, '提交裁判员报告');

    const saveMainAgain = await request(`/api/report/schedule/${state.scheduleId}/main`, {
      token: state.tokens.main,
      body: { home_score: 1, away_score: 0 }
    });
    expectStatus(saveMainAgain, 400, '提交后再次保存裁判员报告');

    const submitMainAgain = await request(`/api/report/schedule/${state.scheduleId}/main/submit`, {
      token: state.tokens.main,
      body: {}
    });
    expectStatus(submitMainAgain, 400, '重复提交裁判员报告');

    const invalidScore = await request(`/api/report/schedule/${state.scheduleId}/supervisor`, {
      token: state.tokens.supervisor,
      body: { reviews: [{ target_role: 'main', score: 10.01, advice: '精度非法' }] }
    });
    expectStatus(invalidScore, 400, '裁判监督评分小数位超限');

    const longAdvice = await request(`/api/report/schedule/${state.scheduleId}/supervisor`, {
      token: state.tokens.supervisor,
      body: { reviews: [{ target_role: 'main', score: 9.5, advice: '长'.repeat(101) }] }
    });
    expectStatus(longAdvice, 400, '裁判监督建议超长');

    const saveSupervisor = await request(`/api/report/schedule/${state.scheduleId}/supervisor`, {
      token: state.tokens.supervisor,
      body: {
        reviews: ['main', 'assistant1', 'assistant2', 'fourth'].map((targetRole, index) => ({
          target_role: targetRole,
          score: 8 + index * 0.5,
          advice: `${targetRole} 表现正常`
        }))
      }
    });
    expectStatus(saveSupervisor, 200, '保存完整裁判监督报告');

    const submitSupervisor = await request(`/api/report/schedule/${state.scheduleId}/supervisor/submit`, {
      token: state.tokens.supervisor,
      body: {}
    });
    expectStatus(submitSupervisor, 200, '提交裁判监督报告');

    const saveSupervisorAgain = await request(`/api/report/schedule/${state.scheduleId}/supervisor`, {
      token: state.tokens.supervisor,
      body: { reviews: [] }
    });
    expectStatus(saveSupervisorAgain, 400, '提交后再次保存裁判监督报告');

    const submitSupervisorAgain = await request(`/api/report/schedule/${state.scheduleId}/supervisor/submit`, {
      token: state.tokens.supervisor,
      body: {}
    });
    expectStatus(submitSupervisorAgain, 400, '重复提交裁判监督报告');
  });

  await t.test('裁判改密和停用后旧令牌立即失效', async () => {
    const oldToken = state.tokens.outsider;
    const newPassword = 'NewRef!Pass2026';
    const changed = await request(`/api/referee/${state.refereeIds.outsider}/password`, {
      method: 'PUT',
      token: oldToken,
      body: { oldPassword: state.refereePassword, newPassword }
    });
    expectStatus(changed, 200, '裁判修改密码');

    const oldTokenAfterChange = await request(`/api/referee/${state.refereeIds.outsider}`, {
      token: oldToken
    });
    expectStatus(oldTokenAfterChange, 401, '改密后的旧令牌');

    const relogin = await loginReferee('outsider', newPassword);
    const newToken = relogin.data.data.token;

    const disabled = await request(`/api/admin/referee/${state.refereeIds.outsider}/status`, {
      method: 'PATCH',
      token: state.tokens.admin,
      body: { is_active: false }
    });
    expectStatus(disabled, 200, '管理员停用裁判');

    const disabledToken = await request(`/api/referee/${state.refereeIds.outsider}`, {
      token: newToken
    });
    expectStatus(disabledToken, 401, '停用后的旧令牌');

    const disabledLogin = await request('/api/referee/login', {
      body: { student_id: state.outsiderStudentId, password: newPassword }
    });
    expectStatus(disabledLogin, 401, '停用账号登录');
  });

  await t.test('赛季注册提交、驳回、重新提交、通过和退回状态机', async () => {
    const currentBefore = await request('/api/season-registration/current', {
      token: state.tokens.applicant
    });
    expectStatus(currentBefore, 200, '读取未提交状态');
    assert.equal(currentBefore.data.data.registration_status, 'unsubmitted');
    assert.equal(Number(currentBefore.data.data.current_season.id), Number(state.seasonId));
    assert.equal(currentBefore.data.data.account_prefill.name, '接口测试-applicant');

    const invalidMatchType = await request('/api/season-registration/current/submit', {
      token: state.tokens.applicant,
      body: {
        name: '当季裁判员姓名',
        height_cm: 176,
        weight_kg: 66.5,
        college: '经济与管理学院',
        grade: '二级',
        match_types: ['不存在的赛事']
      }
    });
    expectStatus(invalidMatchType, 400, '赛季注册赛事白名单');

    const invalidHeight = await request('/api/season-registration/current/submit', {
      token: state.tokens.applicant,
      body: {
        name: '当季裁判员姓名',
        height_cm: 0,
        weight_kg: 66.5,
        college: '经济与管理学院',
        grade: '二级',
        match_types: ['足协杯']
      }
    });
    expectStatus(invalidHeight, 400, '赛季注册身高正数约束');

    const submitted = await request('/api/season-registration/current/submit', {
      token: state.tokens.applicant,
      body: {
        name: '当季裁判员姓名',
        height_cm: 176,
        weight_kg: 66.5,
        college: '经济与管理学院',
        grade: '二级',
        match_types: ['足协杯', '校大联赛']
      }
    });
    expectStatus(submitted, 201, '首次提交赛季注册');
    const registrationId = submitted.data.data.id;
    state.registrationId = registrationId;
    assert.equal(submitted.data.data.status, 'pending');
    assert.equal(submitted.data.data.application_version, 1);
    assert.deepEqual(submitted.data.data.match_types_snapshot, ['足协杯', '大联赛']);

    const duplicateSubmit = await request('/api/season-registration/current/submit', {
      token: state.tokens.applicant,
      body: {
        name: '不可覆盖', height_cm: 176, weight_kg: 66.5,
        college: '经济与管理学院', grade: '二级', match_types: ['足协杯']
      }
    });
    expectStatus(duplicateSubmit, 409, '审核中禁止重复提交');

    const refereeAdminList = await request('/api/season-registration/admin', {
      token: state.tokens.applicant
    });
    expectStatus(refereeAdminList, 403, '裁判访问管理员审核列表');

    const pendingList = await request('/api/season-registration/admin?status=pending&page=1&page_size=10', {
      token: state.tokens.admin
    });
    expectStatus(pendingList, 200, '管理员查询待审核申请');
    assert.equal(pendingList.data.data.pagination.total, 1);
    assert.equal(pendingList.data.data.items[0].id, registrationId);
    assert.equal(pendingList.data.data.summary.total_accounts, 7);
    assert.equal(pendingList.data.data.summary.pending, 1);
    assert.equal(pendingList.data.data.summary.approved, 5);
    assert.equal(pendingList.data.data.summary.unsubmitted_accounts, 1);

    const detailAfterSubmit = await request(`/api/season-registration/admin/${registrationId}`, {
      token: state.tokens.admin
    });
    expectStatus(detailAfterSubmit, 200, '管理员读取申请详情和历史');
    assert.equal(detailAfterSubmit.data.data.events.length, 1);
    assert.equal(detailAfterSubmit.data.data.events[0].event_type, 'submitted');
    assert.equal(detailAfterSubmit.data.data.account.name, '接口测试-applicant');
    assert.equal(detailAfterSubmit.data.data.registration.name_snapshot, '当季裁判员姓名');

    const rejectWithoutReason = await request(`/api/season-registration/admin/${registrationId}/reject`, {
      token: state.tokens.admin,
      body: {}
    });
    expectStatus(rejectWithoutReason, 400, '驳回必须填写原因');

    const rejected = await request(`/api/season-registration/admin/${registrationId}/reject`, {
      token: state.tokens.admin,
      body: { reason: '材料需要补充' }
    });
    expectStatus(rejected, 200, '管理员驳回申请');
    assert.equal(rejected.data.data.status, 'rejected');

    const eligibleAfterReject = await request('/api/season-registration/admin/eligible', {
      token: state.tokens.admin
    });
    expectStatus(eligibleAfterReject, 200, '查询可选派裁判');
    assert.equal(eligibleAfterReject.data.data.pagination.total, 5);

    const resubmitted = await request('/api/season-registration/current/submit', {
      token: state.tokens.applicant,
      body: {
        name: '当季裁判员姓名-修订',
        height_cm: 177,
        weight_kg: 67,
        college: '经济与管理学院',
        grade: '二级',
        match_types: ['足协杯', '大联赛']
      }
    });
    expectStatus(resubmitted, 201, '驳回后重新提交');
    assert.equal(resubmitted.data.data.application_version, 2);
    assert.equal(resubmitted.data.data.status, 'pending');
    assert.equal(resubmitted.data.data.review_reason, null);

    const approved = await request(`/api/season-registration/admin/${registrationId}/approve`, {
      token: state.tokens.admin,
      body: { comment: '资料符合要求' }
    });
    expectStatus(approved, 200, '管理员通过申请');
    assert.equal(approved.data.data.status, 'approved');

    const approvedCannotSubmit = await request('/api/season-registration/current/submit', {
      token: state.tokens.applicant,
      body: {
        name: '不得自行修改', height_cm: 177, weight_kg: 67,
        college: '经济与管理学院', grade: '二级', match_types: ['足协杯']
      }
    });
    expectStatus(approvedCannotSubmit, 409, '已通过后裁判不能自行修改');

    const approvedAgain = await request(`/api/season-registration/admin/${registrationId}/approve`, {
      token: state.tokens.admin,
      body: {}
    });
    expectStatus(approvedAgain, 409, '不能重复通过申请');

    const eligibleApproved = await request('/api/season-registration/admin/eligible?query=修订&match_type=足协杯', {
      token: state.tokens.admin
    });
    expectStatus(eligibleApproved, 200, '通过申请进入可选派集合');
    assert.equal(eligibleApproved.data.data.pagination.total, 1);
    assert.equal(eligibleApproved.data.data.items[0].name_snapshot, '当季裁判员姓名-修订');
    assert.equal(eligibleApproved.data.data.items[0].is_eligible, true);

    const returnWithoutReason = await request(`/api/season-registration/admin/${registrationId}/return`, {
      token: state.tokens.admin,
      body: {}
    });
    expectStatus(returnWithoutReason, 400, '退回必须填写原因');

    const returned = await request(`/api/season-registration/admin/${registrationId}/return`, {
      token: state.tokens.admin,
      body: { reason: '级别资料需要重新确认' }
    });
    expectStatus(returned, 200, '管理员退回已通过申请');
    assert.equal(returned.data.data.status, 'returned');

    const resubmittedAfterReturn = await request('/api/season-registration/current/submit', {
      token: state.tokens.applicant,
      body: {
        name: '当季裁判员最终姓名',
        height_cm: 177,
        weight_kg: 67,
        college: '经济与管理学院',
        grade: '一级',
        match_types: ['足协杯']
      }
    });
    expectStatus(resubmittedAfterReturn, 201, '退回后重新提交');
    assert.equal(resubmittedAfterReturn.data.data.application_version, 3);

    const finalApproval = await request(`/api/season-registration/admin/${registrationId}/approve`, {
      token: state.tokens.admin,
      body: { reason: '最终审核通过' }
    });
    expectStatus(finalApproval, 200, '再次审核通过');

    const finalDetail = await request(`/api/season-registration/admin/${registrationId}`, {
      token: state.tokens.admin
    });
    expectStatus(finalDetail, 200, '读取完整追加式历史');
    assert.deepEqual(
      finalDetail.data.data.events.map(event => event.event_type),
      ['submitted', 'rejected', 'resubmitted', 'approved', 'returned', 'resubmitted', 'approved']
    );
    assert.equal(finalDetail.data.data.events[0].after_snapshot.name_snapshot, '当季裁判员姓名');
    assert.equal(finalDetail.data.data.events[2].before_snapshot.status, 'rejected');
    assert.equal(finalDetail.data.data.registration.application_version, 3);
  });

  await t.test('新赛季不继承资格且不改变历史赛程岗位', async () => {
    const newSeason = await request('/api/season', {
      method: 'POST',
      token: state.tokens.admin,
      body: {
        season_code: 'api-2027',
        season_name: 'API新赛季',
        start_date: '2027-01-01',
        end_date: '2027-12-31',
        is_active: true
      }
    });
    expectStatus(newSeason, 201, '创建并启用新赛季');
    state.newSeasonId = newSeason.data.data.id;

    const currentAfterSwitch = await request('/api/season-registration/current', {
      token: state.tokens.main
    });
    expectStatus(currentAfterSwitch, 200, '切换赛季后读取注册状态');
    assert.equal(Number(currentAfterSwitch.data.data.current_season.id), Number(state.newSeasonId));
    assert.equal(currentAfterSwitch.data.data.registration_status, 'unsubmitted');

    const oldRegistrationWrite = await request(`/api/season-registration/admin/${state.registrationId}/return`, {
      token: state.tokens.admin,
      body: { reason: '不允许修改旧赛季' }
    });
    expectStatus(oldRegistrationWrite, 409, '旧赛季申请禁止写入');

    const newSeasonSubmission = await request('/api/season-registration/current/submit', {
      token: state.tokens.main,
      body: {
        name: '新赛季裁判员',
        height_cm: 178,
        weight_kg: 68,
        college: '环境科学与工程学院',
        grade: '一级',
        match_types: ['足协杯']
      }
    });
    expectStatus(newSeasonSubmission, 201, '新赛季独立提交申请');
    assert.notEqual(newSeasonSubmission.data.data.id, state.registrationId);
    assert.equal(newSeasonSubmission.data.data.application_version, 1);

    const currentEligible = await request('/api/season-registration/admin/eligible', {
      token: state.tokens.admin
    });
    expectStatus(currentEligible, 200, '新赛季可选派集合');
    assert.equal(currentEligible.data.data.pagination.total, 0);

    const historicalEligible = await request(`/api/season-registration/admin/eligible?season_id=${state.seasonId}`, {
      token: state.tokens.admin
    });
    expectStatus(historicalEligible, 200, '历史赛季通过资格仍可读取');
    assert.equal(historicalEligible.data.data.pagination.total, 6);

    const historicalSchedule = await request(`/api/schedule/${state.scheduleId}`, {
      token: state.tokens.admin
    });
    expectStatus(historicalSchedule, 200, '赛季切换后读取历史赛程');
    assert.equal(historicalSchedule.data.data.main_referee_id, state.refereeIds.main);
    assert.equal(historicalSchedule.data.data.main_referee_name, '当季-main');
    assert.equal(historicalSchedule.data.data.main_referee_name_snapshot, '当季-main');
    assert.equal(historicalSchedule.data.data.team_a_name_snapshot, 'API主队');
    assert.equal(historicalSchedule.data.data.team_b_name_snapshot, 'API客队');
  });

  await t.test('管理员赛程按赛季隔离，默认当前、空赛季、历史与类型组合筛选', async () => {
    const token = state.tokens.admin;
    const empty = await request('/api/schedule', { token });
    expectStatus(empty, 200, '新启用的空赛季');
    assert.deepEqual(empty.data.data, []);
    assert.equal(empty.data.meta.selected_season.id, state.newSeasonId);

    const newTeams = [];
    for (const name of ['新季主队', '新季客队']) {
      const created = await require('./legacyTeamFixture.cjs').create({
        team_name: name, league_type: '足协杯',
        roster_entries: [{ jersey_number: '1', player_name: `${name}球员` }]
      });
      newTeams.push(created.id);
    }
    const created = await request('/api/schedule', { token, body: {
      match_type: '足协杯', team_a_id: newTeams[0], team_b_id: newTeams[1],
      match_time: '17:35', match_date: '2027-09-02', field_order: 1
    } });
    expectStatus(created, 200, '新季独立赛程');
    const newId = created.data.data.id;

    // Snapshot every history-bearing table, not just row counts: filtering and
    // season activation must not rewrite associations, content or snapshots.
    const historicalTables = ['match_schedules', 'match_reports', 'match_goals', 'match_cards',
      'match_referee_stats', 'match_referee_reviews', 'team_roster_batches', 'team_player'];
    const snapshot = async () => Promise.all(historicalTables.map(async table =>
      (await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0]));
    const before = await snapshot();

    const current = await request('/api/schedule', { token });
    expectStatus(current, 200, '默认列表');
    assert.deepEqual(current.data.data.map(item => item.id), [newId]);
    assert.equal(current.data.meta.total, 1);
    assert.equal(current.data.meta.current_season.id, state.newSeasonId);
    const old = await request(`/api/schedule?season_id=${state.seasonId}`, { token });
    expectStatus(old, 200, '历史列表');
    assert.ok(old.data.data.some(item => item.id === state.scheduleId));
    assert.ok(old.data.data.every(item => item.season_id === state.seasonId));
    assert.equal(old.data.meta.selected_season.id, state.seasonId);
    assert.equal(old.data.meta.current_season.id, state.newSeasonId);
    for (const seasonId of [state.seasonId, state.newSeasonId]) {
      const typed = await request(`/api/schedule/type/${encodeURIComponent('足协杯')}?season_id=${seasonId}`, { token });
      expectStatus(typed, 200, '赛事类型与赛季组合');
      assert.ok(typed.data.data.length > 0);
      assert.ok(typed.data.data.every(item => item.season_id === seasonId && item.match_type === '足协杯'));
    }
    const noMatches = await request(`/api/schedule/type/${encodeURIComponent('新生杯')}`, { token });
    expectStatus(noMatches, 200, '当前赛季无此类型');
    assert.deepEqual(noMatches.data.data, []);
    const teams = await request(`/api/team/season/${state.seasonId}`, { token });
    expectStatus(teams, 200, '历史编辑队伍候选');
    assert.ok(teams.data.data.teams.every(team => team.season_id === state.seasonId));
    assert.ok(teams.data.data.teams.some(team => team.id === state.teams.home.id));
    expectStatus(await request(`/api/team/season/${state.seasonId}`, { token: state.tokens.main }), 403, '裁判不可调用管理员队伍候选');

    expectStatus(await request(`/api/season/${state.newSeasonId}/deactivate`, { token, method: 'PUT' }), 200, '停用赛季');
    const noActive = await request('/api/schedule', { token });
    expectStatus(noActive, 200, '无启用赛季默认空');
    assert.deepEqual(noActive.data.data, []);
    assert.equal(noActive.data.meta.selected_season, null);
    assert.equal(noActive.data.meta.current_season, null);
    const historical = await request(`/api/schedule?season_id=${state.seasonId}`, { token });
    expectStatus(historical, 200, '无启用赛季仍可查历史');
    assert.deepEqual(historical.data.data.map(item => item.id), old.data.data.map(item => item.id));
    const detail = await request(`/api/schedule/${state.scheduleId}`, { token });
    expectStatus(detail, 200, '无启用赛季历史详情仍可读');
    assert.equal(detail.data.data.main_referee_name_snapshot, '当季-main');
    expectStatus(await request(`/api/season/${state.newSeasonId}/activate`, { token, method: 'PUT' }), 200, '恢复启用新赛季');
    assert.deepEqual(await snapshot(), before, '查询和切换不改变历史数据');
  });

  await t.test('赛季参数非法或不存在时明确报错，不退回其他赛季', async () => {
    const token = state.tokens.admin;
    for (const prefix of ['/api/schedule?', `/api/schedule/type/${encodeURIComponent('足协杯')}?`]) {
      for (const query of ['season_id=', 'season_id=0', 'season_id=-1', 'season_id=1.5',
        'season_id=1abc', 'season_id=1e1', 'season_id=%201', 'season_id=9007199254740992',
        'season_id=1&season_id=2', 'season_id[]=1', 'season_id[x]=1']) {
        expectStatus(await request(prefix + query, { token }), 400, query);
      }
      expectStatus(await request(prefix + 'season_id=2147483647', { token }), 404, '不存在赛季');
    }
    expectStatus(await request('/api/team/season/invalid', { token }), 400, '非法队伍赛季');
    expectStatus(await request('/api/team/season/2147483647', { token }), 404, '不存在队伍赛季');
    expectStatus(await request('/api/schedule'), 401, '列表需登录');
    expectStatus(await request('/api/schedule', { token: state.tokens.main }), 403, '列表仅管理员可读');
  });

  await require('./phase5b.cjs')({ t, pool, state, request, expectStatus });
  await require('./phase67.cjs')({ t, pool, state, request, expectStatus });
  await require('./phase8.cjs')({ t, pool, state, request, expectStatus });
  await require('./phase911.cjs')({ t, pool, state, request, expectStatus });
  await require('./demoAppend.cjs')({ t, pool, state, request, expectStatus });

  // 必须放在业务回归之后：仅重置运行器专门创建的 *_test 数据库和临时上传目录。
  await t.test('样例生成 CLI 的多状态、全通过模式、审核历史及可选派集合一致', async () => {
    const [adminsBefore] = await pool.query('SELECT * FROM admin ORDER BY id');
    const [migrationsBefore] = await pool.query('SELECT * FROM schema_migrations ORDER BY version');
    const credentialFile = path.join(process.env.UPLOAD_DIR, 'demo-credentials.seed');
    const env = {
      ...process.env,
      DEMO_SEED_CONFIRM: `RESET_${process.env.DB_NAME}`,
      DEMO_SEED_OUTPUT: credentialFile
    };
    const runScript = (script, args = [], scriptEnv = env) => execFile(
      process.execPath, [path.resolve(__dirname, '../../scripts', script), ...args],
      { env: scriptEnv, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }
    );
    const [accountsBefore] = await pool.query('SELECT id FROM referee ORDER BY id');
    await assert.rejects(
      runScript('demoSeed.js', ['seed'], { ...env, DEMO_SEED_CONFIRM: '' }),
      /DEMO_SEED_CONFIRM/
    );
    const [accountsAfterDenied] = await pool.query('SELECT id FROM referee ORDER BY id');
    assert.deepEqual(accountsAfterDenied, accountsBefore, '未确认重置时不能改动数据库');

    for (const scenario of ['workflow', 'all-approved']) {
      const size = scenario === 'workflow' ? 'medium' : 'small';
      const { stdout } = await runScript('demoSeed.js', ['seed', `--size=${size}`, `--scenario=${scenario}`]);
      const credentials = JSON.parse(await fs.readFile(credentialFile, 'utf8'));
      assert.equal(credentials.scenario, scenario);
      assert.ok(credentials.referee_accounts.some(row => row.grade === '预备国家级'));
      assert.ok(credentials.referee_accounts.some(row => row.shanghai_fa_registered === true));
      assert.ok(credentials.referee_accounts.some(row => row.shanghai_fa_registered === false));
      assert.equal(stdout.includes(credentials.shared_referee_password), false, '控制台不输出密码');
      if (process.platform !== 'win32') {
        assert.equal((await fs.stat(credentialFile)).mode & 0o777, 0o600);
      }
      const [adminsAfter] = await pool.query('SELECT * FROM admin ORDER BY id');
      const [migrationsAfter] = await pool.query('SELECT * FROM schema_migrations ORDER BY version');
      assert.deepEqual(adminsAfter, adminsBefore);
      assert.deepEqual(migrationsAfter, migrationsBefore);

      const summary = await request('/api/season-registration/admin', { token: state.tokens.admin });
      expectStatus(summary, 200, '生成样例后读取管理员统计');
      assert.deepEqual(summary.data.data.summary, credentials.expected_summary);
      const eligible = await request('/api/season-registration/admin/eligible?page_size=100', { token: state.tokens.admin });
      expectStatus(eligible, 200, '样例可选派集合');
      assert.equal(eligible.data.data.pagination.total, scenario === 'workflow' ? 15 : 10);
      const eligibleIds = new Set(eligible.data.data.items.map(item => Number(item.referee_id)));
      const [schedules] = await pool.query('SELECT * FROM match_schedules');
      assert.equal(schedules.length, scenario === 'workflow' ? 18 : 3);
      for (const schedule of schedules) {
        const assignedIds = [];
        for (const role of ['main_referee', 'assistant1', 'assistant2', 'fourth_official', 'supervisor']) {
          const id = Number(schedule[`${role}_id`]);
          assignedIds.push(id);
          assert.ok(eligibleIds.has(id), '赛程不能使用未通过或停用的裁判');
          const account = credentials.referee_accounts.find(item => item.id === id);
          assert.equal(schedule[`${role}_name_snapshot`], account.name);
        }
        assert.equal(new Set(assignedIds).size, 5);
      }
      const [registrations] = await pool.query('SELECT * FROM referee_season_registrations');
      for (const registration of registrations) {
        const detail = await request(`/api/season-registration/admin/${registration.id}`, { token: state.tokens.admin });
        expectStatus(detail, 200, '样例申请审核历史');
        const events = detail.data.data.events;
        assert.equal(events[0].event_type, 'submitted');
        assert.equal(events[0].before_snapshot, null);
        const latest = events.at(-1).after_snapshot;
        assert.equal(latest.id, registration.id);
        assert.equal(latest.status, registration.status);
        assert.equal(latest.review_reason, registration.review_reason);
        assert.equal(latest.reviewed_by_admin_id, registration.reviewed_by_admin_id);
        assert.equal(latest.submitted_at, registration.submitted_at.toISOString());
        assert.equal(latest.reviewed_at, registration.reviewed_at?.toISOString() || null);
        for (let index = 1; index < events.length; index += 1) {
          assert.deepEqual(events[index].before_snapshot, events[index - 1].after_snapshot);
        }
      }
      const tokensByStatus = new Map();
      for (const account of [credentials.referee_accounts[0], ...credentials.referee_accounts.slice(-5)]) {
        const login = await request('/api/referee/login', {
          body: { student_id: account.student_id, password: credentials.shared_referee_password }
        });
        if (account.account_status === '停用') {
          expectStatus(login, 401, '停用样例账号不能登录');
          continue;
        }
        expectStatus(login, 200, '样例账号登录');
        assert.equal(login.data.data.shanghai_fa_registered, account.shanghai_fa_registered);
        assert.equal(login.data.data.grade, account.grade);
        tokensByStatus.set(account.registration_status, login.data.data.token);
        const current = await request('/api/season-registration/current', { token: login.data.data.token });
        expectStatus(current, 200, '裁判当前赛季状态');
        assert.equal(current.data.data.registration_status, account.registration_status);
        if (account.registration_status === 'unsubmitted') {
          assert.equal(current.data.data.registration, null);
        }
      }
      if (scenario === 'workflow') {
        for (const status of ['unsubmitted', 'rejected', 'returned']) {
          const submission = await request('/api/season-registration/current/submit', {
            token: tokensByStatus.get(status),
            body: { name: '样例重新注册', height_cm: 175, weight_kg: 65, college: '土木工程学院', grade: '一级', match_types: ['足协杯'] }
          });
          expectStatus(submission, 201, `${status} 样例可继续提交`);
          assert.equal(submission.data.data.status, 'pending');
          assert.equal(submission.data.data.application_version, status === 'unsubmitted' ? 1 : 2);
          const approval = await request(`/api/season-registration/admin/${submission.data.data.id}/approve`, {
            token: state.tokens.admin, body: { reason: '样例提交后继续审核' }
          });
          expectStatus(approval, 200, `${status} 样例可继续通过审核`);
        }
        const afterApproval = await request('/api/season-registration/admin/eligible', { token: state.tokens.admin });
        assert.equal(afterApproval.data.data.pagination.total, 18);
      }
      // 审计子进程只连接隔离库，非零退出码会直接令测试失败。
      await runScript('audit.js');
    }
  });
  await require('./playerBatch1.cjs')({ t, pool, state, request, expectStatus });
  await require('./playerBatch2.cjs')({ t, pool, state, request, expectStatus });
  await require('./playerBatch3.cjs')({ t, pool, state, request, expectStatus });
  await require('./playerBatch4.cjs')({ t, pool, state, request, expectStatus });
  await require('./playerBatch5.cjs')({ t, pool, state, request, expectStatus });
  await require('./playerBatch6.cjs')({ t, pool, state, request, expectStatus });
  await require('./scheduleTime.cjs')({ t, pool, state, request, expectStatus });
  await require('./matchSignups.cjs')({ t, pool, state, request, expectStatus });
  await require('./competitions.cjs')({ t, pool, state, request, expectStatus });
  await require('./adminImports.cjs')({ t, pool, state, request, expectStatus });
  await require('./supervision.cjs')({ t, pool, state, request, expectStatus });
  await require('./scheduleDeletion.cjs')({ t, pool, state, request, expectStatus });
  await require('./teamAutoReview.cjs')({ t, pool, state, request, expectStatus });
  await require('./refereeGrades.cjs')({ t, pool, state, request, expectStatus });
  await require('./collegeCatalog.cjs')({ t, pool, state, request, expectStatus });
  await require('./collegeChanges.cjs')({ t, pool, state, request, expectStatus });
  await require('./reportForfeits.cjs')({ t, pool, state, request, expectStatus });
  await require('./scheduleImports.cjs')({ t, pool, state, request, expectStatus });
  await require('./fourthOfficialSheet.cjs')({ t, pool, state, request, expectStatus });
  await require('./assignmentExport.cjs')({ t, pool, state, request, expectStatus });
  if (process.env.REFWEB_OPS_INTEGRATION === '1') await require('./operations.cjs')({ t, pool });
});
