const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { assertMigrationsCurrent } = require('../utils/migrationRunner');
const {
  BACKEND_ROOT,
  REFEREE_UPLOAD_DIR,
  REPORT_UPLOAD_DIR,
  ensureUploadDirectories
} = require('../utils/uploadPaths');

const BCRYPT_ROUNDS = 12;
const LEAGUE_TYPES = ['足协杯', '大联赛', '新生杯'];
const REQUIRED_PRODUCTION_FLAG = 'true';
const ADVISORY_LOCK_TIMEOUT_SECONDS = 10;
const SIZE_PRESETS = Object.freeze({
  small: Object.freeze({ referees: 10, teamsPerType: 2, playersPerTeam: 18, schedulesPerType: 1 }),
  medium: Object.freeze({ referees: 20, teamsPerType: 4, playersPerTeam: 23, schedulesPerType: 6 }),
  large: Object.freeze({ referees: 100, teamsPerType: 10, playersPerTeam: 25, schedulesPerType: 30 })
});
const SCENARIOS = ['workflow', 'all-approved'];
const STATUS_LABELS = Object.freeze({
  unsubmitted: '未注册', pending: '审核中', approved: '已注册', rejected: '已驳回', returned: '已退回'
});

process.umask(0o077);

function parseArguments(argv = []) {
  const [command = 'seed', ...options] = argv;
  if (!['seed', 'clear'].includes(command)) {
    throw new Error('命令只能是 seed 或 clear');
  }

  let size = 'medium';
  let scenario = 'workflow';
  for (const option of options) {
    if (option.startsWith('--size=')) {
      size = option.slice('--size='.length).trim().toLowerCase();
      continue;
    }
    if (option.startsWith('--scenario=')) {
      scenario = option.slice('--scenario='.length).trim().toLowerCase();
      continue;
    }
    throw new Error(`未知参数: ${option}`);
  }

  if (!Object.prototype.hasOwnProperty.call(SIZE_PRESETS, size)) {
    throw new Error(`数据规模只能是 ${Object.keys(SIZE_PRESETS).join('、')}`);
  }

  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`样例场景只能是 ${SCENARIOS.join('、')}`);
  }

  return { command, size, scenario };
}

function assertResetAuthorized(env, databaseName) {
  const expectedConfirmation = `RESET_${databaseName}`;
  if (env.DEMO_SEED_CONFIRM !== expectedConfirmation) {
    throw new Error(
      `此命令会清空数据库 ${databaseName} 中除管理员和迁移记录外的全部业务数据；` +
      `请显式设置 DEMO_SEED_CONFIRM=${expectedConfirmation}`
    );
  }

  if (
    env.NODE_ENV === 'production' &&
    String(env.DEMO_SEED_ALLOW_PRODUCTION || '').toLowerCase() !== REQUIRED_PRODUCTION_FLAG
  ) {
    throw new Error(
      '当前 NODE_ENV=production；演示服务器必须额外设置 DEMO_SEED_ALLOW_PRODUCTION=true 才能重置数据'
    );
  }
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  return `${year}-${month}-${day}`;
}

function dateFromYearAndOffset(year, offsetDays) {
  const date = new Date(Date.UTC(year, 1, 15));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatDate(date);
}

function buildRefereeDefinitions(count, year, scenario) {
  const { REFEREE_GRADES: grades } = require('../utils/refereeProfileRules');
  return Array.from({ length: count }, (_, index) => ({
    student_id: `TEST-R${year}${pad(index + 1, 3)}`,
    name: `测试裁判${pad(index + 1, 3)}`,
    grade: grades[index % grades.length],
    target_level: grades[Math.min((index % grades.length) + 1, grades.length - 1)],
    shanghai_fa_registered: index % 2 === 0,
    level_promoted_at: `${year}-01-01`,
    match_types: LEAGUE_TYPES.join(','),
    gender: index % 2 === 0 ? '男' : '女',
    college: `测试学院${(index % 5) + 1}`,
    height_cm: 165 + (index % 25),
    weight_kg: (55 + (index % 30)).toFixed(2),
    officiated_count_base: index % 12,
    is_active: !(scenario === 'workflow' && index === count - 5),
    registration_status: scenario === 'workflow' && index >= count - 4
      ? ['pending', 'rejected', 'returned', 'unsubmitted'][index - (count - 4)]
      : 'approved'
  }));
}

function isEligibleReferee(referee) {
  return referee.is_active && referee.registration_status === 'approved';
}

function summarizeReferees(referees) {
  const count = predicate => referees.filter(predicate).length;
  return {
    total_accounts: referees.length,
    active_accounts: count(referee => referee.is_active),
    inactive_accounts: count(referee => !referee.is_active),
    unsubmitted_accounts: count(referee => referee.registration_status === 'unsubmitted'),
    pending: count(referee => referee.registration_status === 'pending'),
    approved: count(referee => referee.registration_status === 'approved'),
    rejected: count(referee => referee.registration_status === 'rejected'),
    returned: count(referee => referee.registration_status === 'returned'),
    eligible_system_referees: count(isEligibleReferee),
    external_referees: 0
  };
}

function buildTeamDefinitions(teamsPerType, playersPerTeam) {
  const teams = [];
  for (const leagueType of LEAGUE_TYPES) {
    for (let teamIndex = 0; teamIndex < teamsPerType; teamIndex += 1) {
      const typeCode = LEAGUE_TYPES.indexOf(leagueType) + 1;
      const teamNumber = teamIndex + 1;
      teams.push({
        league_type: leagueType,
        team_name: `测试${leagueType}队${pad(teamNumber)}`,
        description: '由演示数据脚本生成，可随时重置',
        players: Array.from({ length: playersPerTeam }, (_, playerIndex) => ({
          jersey_number: String(playerIndex + 1),
          player_name: `测试球员${typeCode}-${pad(teamNumber)}-${pad(playerIndex + 1)}`,
          remark: playerIndex === 0 ? '测试队长' : null
        }))
      });
    }
  }
  return teams;
}

function buildRoundRobinPairs(teamCount) {
  const pairs = [];
  for (let home = 0; home < teamCount; home += 1) {
    for (let away = home + 1; away < teamCount; away += 1) {
      pairs.push([home, away]);
    }
  }
  return pairs;
}

function buildScheduleDefinitions(teams, referees, preset, year) {
  const schedules = [];
  const eligibleReferees = referees.filter(isEligibleReferee);
  if (eligibleReferees.length < 5) {
    throw new Error('生成赛程至少需要 5 名已通过赛季注册且启用的裁判');
  }
  let globalIndex = 0;

  for (const leagueType of LEAGUE_TYPES) {
    const leagueTeams = teams.filter(team => team.league_type === leagueType);
    const pairs = buildRoundRobinPairs(leagueTeams.length).slice(0, preset.schedulesPerType);

    pairs.forEach(([homeIndex, awayIndex], index) => {
      const refereeOffset = (globalIndex * 3) % eligibleReferees.length;
      const assigned = Array.from(
        { length: 5 },
        (_, roleIndex) => eligibleReferees[(refereeOffset + roleIndex) % eligibleReferees.length]
      );
      schedules.push({
        match_type: leagueType,
        team_a: leagueTeams[homeIndex],
        team_b: leagueTeams[awayIndex],
        match_date: dateFromYearAndOffset(year, globalIndex),
        match_time: '17:35',venue:'樱花人草',
        field_order: index + 1,
        main_referee: assigned[0],
        assistant1: assigned[1],
        assistant2: assigned[2],
        fourth_official: assigned[3],
        supervisor: assigned[4]
      });
      globalIndex += 1;
    });
  }

  return schedules;
}

function buildDemoDefinitions(size, now = new Date(), scenario = 'workflow') {
  const preset = SIZE_PRESETS[size];
  if (!preset) {
    throw new Error(`未知演示数据规模: ${size}`);
  }
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`未知样例场景: ${scenario}`);
  }
  const year = now.getUTCFullYear();
  const referees = buildRefereeDefinitions(preset.referees, year, scenario);
  const teams = buildTeamDefinitions(preset.teamsPerType, preset.playersPerTeam);
  const schedules = buildScheduleDefinitions(teams, referees, preset, year);
  return { year, preset, scenario, referees, teams, schedules };
}

function generateSharedDemoPassword() {
  return `Demo-${crypto.randomBytes(12).toString('base64url')}!9aA`;
}

async function acquireLock(connection) {
  const [rows] = await connection.execute(
    "SELECT GET_LOCK(CONCAT(DATABASE(), ':demo_seed'), ?) AS acquired",
    [ADVISORY_LOCK_TIMEOUT_SECONDS]
  );
  if (Number(rows[0]?.acquired) !== 1) {
    throw new Error('无法取得演示数据锁，可能已有另一个生成或清理任务正在运行');
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':demo_seed'))");
  } catch (error) {
    console.error(`释放演示数据锁失败: ${error.message}`);
  }
}

async function clearBusinessTables(connection) {
  const [[playerData]] = await connection.query('SELECT COUNT(*) AS n FROM player_accounts');
  if (playerData.n) throw new Error('数据库已有球员系统账号，请在独立演示库运行重建工具，避免破坏球员审核历史');
  const tables = [
    'competition_discipline_events',
    'match_publications',
    'match_roster_selection_events',
    'match_roster_selections',
    // 仅此显式 RESET 工具可清空整套演示数据；业务接口永不修改或删除历史。
    'report_section_history',
    'report_section_states',
    'report_actor_events',
    'match_cards',
    'match_goals',
    'match_referee_reviews',
    'match_referee_stats',
    'match_reports',
    'match_official_assignments',
    'match_schedules',
    'external_referees',
    'team_player',
    'team_roster_batches',
    'team',
    'referee_season_registration_events',
    'referee_season_registrations',
    'referee_profile',
    'referee',
    'roster_change_windows',
    'season_competitions',
    'player_season_setting_events',
    'player_season_settings',
    'seasons'
  ];
  for (const table of tables) {
    await connection.query(`DELETE FROM \`${table}\``);
  }
}

async function clearManagedUploadFiles() {
  ensureUploadDirectories();
  let removedCount = 0;
  for (const directory of [REFEREE_UPLOAD_DIR, REPORT_UPLOAD_DIR]) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        console.warn(`跳过上传目录中的子目录: ${path.join(directory, entry.name)}`);
        continue;
      }
      await fs.promises.unlink(path.join(directory, entry.name));
      removedCount += 1;
    }
  }
  return removedCount;
}

async function insertSeason(connection, year) {
  const [result] = await connection.execute(
    `INSERT INTO seasons
       (season_code, season_name, start_date, end_date, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [`${year}-demo`, `${year}演示赛季`, `${year}-01-01`, `${year}-12-31`]
  );
  return Number(result.insertId);
}

async function insertReferees(connection, definitions, passwordHash) {
  const values = definitions.map(referee => [
    referee.student_id,
    referee.name,
    referee.grade,
    referee.target_level,
    referee.level_promoted_at,
    referee.match_types,
    passwordHash,
    new Date(),
    referee.is_active ? 1 : 0,
    referee.shanghai_fa_registered ? 1 : 0
  ]);
  await connection.query(
    `INSERT INTO referee
       (student_id, name, grade, target_level, level_promoted_at, match_types, password_hash, password_changed_at, is_active, shanghai_fa_registered)
     VALUES ?`,
    [values]
  );

  const [rows] = await connection.query(
    `SELECT id, student_id
       FROM referee
      WHERE student_id LIKE 'TEST-R%'
      ORDER BY student_id ASC`
  );
  const ids = new Map(rows.map(row => [row.student_id, Number(row.id)]));
  const profiles = definitions.map(referee => {
    referee.id = ids.get(referee.student_id);
    return [
      referee.id,
      referee.gender,
      referee.college,
      referee.height_cm,
      referee.weight_kg,
      null,
      referee.officiated_count_base
    ];
  });
  await connection.query(
    `INSERT INTO referee_profile
       (referee_id, gender, college, height_cm, weight_kg, id_photo_path, officiated_count_base)
     VALUES ?`,
    [profiles]
  );
}

function buildRegistrationEvents(referee, seasonId, adminId, now = new Date()) {
  if (referee.registration_status === 'unsubmitted') return [];
  if (!['pending', 'approved', 'rejected', 'returned'].includes(referee.registration_status)) {
    throw new Error(`未知样例注册状态: ${referee.registration_status}`);
  }
  const timestamp = Math.floor(now.getTime() / 1000) * 1000;
  // 待审核/驳回/退回样例故意保留与账号资料不同的身高，便于测试快照差异展示。
  const submitted = {
    season_id: seasonId,
    referee_id: referee.id,
    name_snapshot: referee.name,
    height_cm_snapshot: referee.height_cm + (referee.registration_status === 'approved' ? 0 : 1),
    weight_kg_snapshot: Number(referee.weight_kg),
    college_snapshot: referee.college,
    grade_snapshot: referee.grade,
    match_types_snapshot: [...LEAGUE_TYPES],
    status: 'pending',
    submitted_at: new Date(timestamp - 3000),
    reviewed_at: null,
    reviewed_by_admin_id: null,
    review_reason: null,
    application_version: 1
  };
  const events = [{
    event_type: 'submitted', actor_type: 'referee', actor_referee_id: referee.id, actor_admin_id: null,
    reason: null, before_snapshot: null, after_snapshot: submitted, created_at: submitted.submitted_at
  }];
  if (referee.registration_status === 'pending') return events;

  const status = referee.registration_status === 'rejected' ? 'rejected' : 'approved';
  const reviewed = {
    ...submitted,
    status,
    reviewed_at: new Date(timestamp - 2000),
    reviewed_by_admin_id: adminId,
    review_reason: status === 'rejected' ? '测试驳回：请核实身高后重新提交' : '演示数据自动审核通过'
  };
  events.push({
    event_type: status, actor_type: 'admin', actor_referee_id: null, actor_admin_id: adminId,
    reason: reviewed.review_reason, before_snapshot: submitted, after_snapshot: reviewed, created_at: reviewed.reviewed_at
  });
  if (referee.registration_status === 'returned') {
    const returned = {
      ...reviewed, status: 'returned', reviewed_at: new Date(timestamp - 1000),
      review_reason: '测试退回：请更新本赛季资料后重新提交'
    };
    events.push({
      event_type: 'returned', actor_type: 'admin', actor_referee_id: null, actor_admin_id: adminId,
      reason: returned.review_reason, before_snapshot: reviewed, after_snapshot: returned, created_at: returned.reviewed_at
    });
  }
  return events;
}

async function insertSeasonRegistrations(connection, seasonId, definitions, adminId) {
  for (const referee of definitions) {
    const events = buildRegistrationEvents(referee, seasonId, adminId);
    // “未注册”表示尚无申请行，而不是向数据库写入不存在的状态枚举。
    if (events.length === 0) continue;
    const snapshot = events.at(-1).after_snapshot;
    const [result] = await connection.execute(
      `INSERT INTO referee_season_registrations
         (season_id, referee_id, name_snapshot, height_cm_snapshot, weight_kg_snapshot,
          college_snapshot, grade_snapshot, match_types_snapshot, status, submitted_at,
          reviewed_at, reviewed_by_admin_id, review_reason, application_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        seasonId, referee.id, snapshot.name_snapshot, snapshot.height_cm_snapshot,
        snapshot.weight_kg_snapshot, snapshot.college_snapshot, snapshot.grade_snapshot,
        JSON.stringify(snapshot.match_types_snapshot), snapshot.status, snapshot.submitted_at,
        snapshot.reviewed_at, snapshot.reviewed_by_admin_id, snapshot.review_reason,
        snapshot.submitted_at, snapshot.reviewed_at || snapshot.submitted_at
      ]
    );
    const registrationId = Number(result.insertId);
    for (const event of events) {
      await connection.execute(
        `INSERT INTO referee_season_registration_events
           (registration_id, season_id, referee_id, event_type, from_status, to_status,
            application_version, actor_type, actor_referee_id, actor_admin_id, reason,
            before_snapshot, after_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [
          registrationId, seasonId, referee.id, event.event_type,
          event.before_snapshot?.status || null, event.after_snapshot.status,
          event.actor_type, event.actor_referee_id, event.actor_admin_id, event.reason,
          event.before_snapshot ? JSON.stringify({ id: registrationId, ...event.before_snapshot }) : null,
          JSON.stringify({ id: registrationId, ...event.after_snapshot }), event.created_at
        ]
      );
    }
  }
}

async function insertTeams(connection, seasonId, definitions) {
  for (const team of definitions) {
    await connection.execute('INSERT IGNORE INTO season_competitions(season_id,league_type) VALUES (?,?)',[seasonId,team.league_type]);
    const [teamResult] = await connection.execute(
      `INSERT INTO team (season_id, team_name, league_type, description)
       VALUES (?, ?, ?, ?)`,
      [seasonId, team.team_name, team.league_type, team.description]
    );
    team.id = Number(teamResult.insertId);

    const [batchResult] = await connection.execute(
      `INSERT INTO team_roster_batches (team_id, season_id, version_no)
       VALUES (?, ?, 1)`,
      [team.id, seasonId]
    );
    team.roster_batch_id = Number(batchResult.insertId);

    const playerValues = team.players.map(player => [
      team.roster_batch_id,
      team.id,
      player.jersey_number,
      player.player_name,
      player.remark
    ]);
    await connection.query(
      `INSERT INTO team_player
         (roster_batch_id, team_id, jersey_number, player_name, remark)
       VALUES ?`,
      [playerValues]
    );
  }
}

async function insertSchedules(connection, seasonId, definitions) {
  for (const schedule of definitions) {
    const [result] = await connection.execute(
      `INSERT INTO match_schedules
         (season_id, match_type, team_a_id, team_b_id,
         team_a_name_snapshot, team_b_name_snapshot, match_date, match_time, venue, field_order,
          main_referee_id, assistant1_id, assistant2_id, fourth_official_id, supervisor_id,
          main_referee_name_snapshot, assistant1_name_snapshot, assistant2_name_snapshot,
          fourth_official_name_snapshot, supervisor_name_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seasonId,
        schedule.match_type,
        schedule.team_a.id,
        schedule.team_b.id,
        schedule.team_a.team_name,
        schedule.team_b.team_name,
        schedule.match_date,
        schedule.match_time,
        schedule.venue,
        schedule.field_order,
        schedule.main_referee.id,
        schedule.assistant1.id,
        schedule.assistant2.id,
        schedule.fourth_official.id,
        schedule.supervisor.id,
        schedule.main_referee.name,
        schedule.assistant1.name,
        schedule.assistant2.name,
        schedule.fourth_official.name,
        schedule.supervisor.name
      ]
    );
    schedule.id = Number(result.insertId);
    await connection.execute('UPDATE match_schedules SET field_order_sort=? WHERE id=?',[require('../utils/competitionRules').fieldOrderSortKey(schedule.field_order),schedule.id]);
    const ROLES = require('../utils/officialAssignments').ROLES.filter(r=>require('../utils/officialRequirements').roleRequired({},r.code));
    for (const role of ROLES) {
      const person = schedule[{ main: 'main_referee', assistant1: 'assistant1', assistant2: 'assistant2', fourth: 'fourth_official', supervisor: 'supervisor' }[role.code]];
      await connection.execute(`INSERT INTO match_official_assignments (schedule_id,role,source_type,referee_id,name_snapshot) VALUES (?,?,'system',?,?)`, [schedule.id,role.code,person.id,person.name]);
    }
  }
}

function resolveCredentialFile(env = process.env) {
  const configured = String(env.DEMO_SEED_OUTPUT || '').trim();
  const resolved = configured
    ? path.resolve(BACKEND_ROOT, configured)
    : path.join(BACKEND_ROOT, 'demo-credentials.seed');
  if (resolved === path.parse(resolved).root || resolved === BACKEND_ROOT) {
    throw new Error('DEMO_SEED_OUTPUT 不能指向磁盘根目录或 backend 根目录');
  }
  return resolved;
}

async function writeCredentials(filePath, payload) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  if (process.platform !== 'win32') {
    await fs.promises.chmod(filePath, 0o600);
  }
}

function buildCredentialPayload(databaseName, size, sharedPassword, definitions) {
  return {
    warning: '仅限演示测试；不得用于真实账号或其他网站',
    generated_at: new Date().toISOString(),
    database: databaseName,
    size,
    scenario: definitions.scenario,
    current_season: {
      id: definitions.seasonId,
      season_code: `${definitions.year}-demo`,
      season_name: `${definitions.year}演示赛季`
    },
    expected_summary: summarizeReferees(definitions.referees),
    shared_referee_password: sharedPassword,
    referee_accounts: definitions.referees.map(referee => ({
      id: referee.id,
      student_id: referee.student_id,
      name: referee.name,
      account_status: referee.is_active ? '启用' : '停用',
      grade: referee.grade,
      target_level: referee.target_level,
      shanghai_fa_registered: referee.shanghai_fa_registered,
      registration_status: referee.registration_status,
      registration_status_label: STATUS_LABELS[referee.registration_status],
      eligible_for_assignment: isEligibleReferee(referee),
      test_purpose: !referee.is_active
        ? '验证账号停用后无法登录、无法新选派；管理员重新启用后可恢复'
        : {
          unsubmitted: '从未注册开始提交本赛季资料，并等待管理员审核',
          pending: '管理员查看资料差异并通过或驳回；裁判端申请锁定',
          rejected: '查看驳回原因，修改资料后重新提交',
          returned: '查看退回原因，修改资料后重新提交',
          approved: '搜索选派、比赛报告、已通过申请锁定和管理员退回'
        }[referee.registration_status]
    })),
    schedule_assignments: definitions.schedules.map(schedule => ({
      id: schedule.id,
      match_type: schedule.match_type,
      field_order: schedule.field_order,
      home_team: schedule.team_a.team_name,
      away_team: schedule.team_b.team_name,
      main: schedule.main_referee.student_id,
      assistant1: schedule.assistant1.student_id,
      assistant2: schedule.assistant2.student_id,
      fourth: schedule.fourth_official.student_id,
      supervisor: schedule.supervisor.student_id
    }))
  };
}

async function run(options, env = process.env) {
  const connection = await pool.getConnection();
  let databaseName;
  try {
    const [databaseRows] = await connection.query('SELECT DATABASE() AS database_name');
    databaseName = String(databaseRows[0]?.database_name || '');
    if (!databaseName) {
      throw new Error('当前连接没有选择数据库');
    }
    assertResetAuthorized(env, databaseName);
    await assertMigrationsCurrent(connection);
    await acquireLock(connection);

    const definitions = options.command === 'seed'
      ? buildDemoDefinitions(options.size, new Date(), options.scenario)
      : null;
    const sharedPassword = options.command === 'seed'
      ? generateSharedDemoPassword()
      : null;
    const passwordHash = sharedPassword
      ? await bcrypt.hash(sharedPassword, BCRYPT_ROUNDS)
      : null;

    await connection.beginTransaction();
    try {
      await clearBusinessTables(connection);
      if (definitions) {
        const [adminRows] = await connection.query('SELECT id FROM admin ORDER BY id ASC LIMIT 1');
        if (!adminRows[0]) {
          throw new Error('生成演示数据前必须先建立至少一个管理员账号');
        }
        const seasonId = await insertSeason(connection, definitions.year);
        definitions.seasonId = seasonId;
        await insertReferees(connection, definitions.referees, passwordHash);
        await insertSeasonRegistrations(connection, seasonId, definitions.referees, Number(adminRows[0].id));
        await insertTeams(connection, seasonId, definitions.teams);
        await insertSchedules(connection, seasonId, definitions.schedules);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const removedUploads = await clearManagedUploadFiles();
    const credentialFile = resolveCredentialFile(env);

    if (definitions) {
      await writeCredentials(
        credentialFile,
        buildCredentialPayload(databaseName, options.size, sharedPassword, definitions)
      );
      console.log(`✓ 已重置数据库 ${databaseName} 并生成 ${options.size} / ${definitions.scenario} 演示数据`);
      console.log(`✓ 裁判 ${definitions.referees.length} 名，队伍 ${definitions.teams.length} 支，赛程 ${definitions.schedules.length} 场`);
      console.log(`✓ 初始状态统计: ${JSON.stringify(summarizeReferees(definitions.referees))}`);
      console.log(`✓ 测试账号清单已写入受限文件: ${credentialFile}`);
      console.log(`✓ 已清理 ${removedUploads} 个旧上传文件；管理员账号和 schema_migrations 保持不变`);
      return;
    }

    try {
      await fs.promises.unlink(credentialFile);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    console.log(`✓ 已清空数据库 ${databaseName} 的全部业务数据`);
    console.log(`✓ 已清理 ${removedUploads} 个旧上传文件；管理员账号和 schema_migrations 保持不变`);
  } finally {
    if (databaseName) {
      await releaseLock(connection);
    }
    connection.release();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await run(options);
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error(`✗ 演示数据操作失败: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

module.exports = {
  LEAGUE_TYPES,
  SIZE_PRESETS,
  parseArguments,
  assertResetAuthorized,
  buildDemoDefinitions,
  buildRoundRobinPairs,
  generateSharedDemoPassword,
  buildRegistrationEvents,
  summarizeReferees,
  buildCredentialPayload
};
