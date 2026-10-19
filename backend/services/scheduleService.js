const { safeLog } = require('../utils/safeLog');
const pool = require('../db');
const officials = require('../utils/officialAssignments');
const { resolveSeasonScope } = require('../utils/seasonScope');
const {
  SCHEDULE_ROLE_FIELDS,
  SCHEDULE_ROLE_LABELS,
  validateScheduleMutationPayload,
  createBusinessError,
  isBusinessError,
  normalizeScheduleMutationPayload,
  collectAssignedReferees
} = require('../utils/scheduleValidator');

const { readMatchTime } = require('../utils/matchTime');
const SCHEDULE_CONTRACT_VERSION = 'schedule-signup-v1';
const {checkScheduleRevision}=require('../utils/matchSignup');
const signupService=require('./matchSignupService');
const deletion=require('../utils/scheduleDeletion');

const ROLE_NAME_SNAPSHOT_FIELDS = Object.freeze({
  main_referee_id: 'main_referee_name_snapshot',
  assistant1_id: 'assistant1_name_snapshot',
  assistant2_id: 'assistant2_name_snapshot',
  fourth_official_id: 'fourth_official_name_snapshot',
  second_referee_id: 'second_referee_name_snapshot',
  timekeeper_id: 'timekeeper_name_snapshot',
  supervisor_id: 'supervisor_name_snapshot'
});

const SCHEDULE_MUTATION_FIELDS = Object.freeze([
  'match_type',
  'team_a_id',
  'team_b_id',
  'match_date',
  'match_time', 'match_end_time', 'venue', 'venue_detail', 'schedule_revision', 'supervisor_required', 'fourth_required', 'futsal', 'confirm_format_change',
  'field_order',
  ...SCHEDULE_ROLE_FIELDS
]);

const SCHEDULE_RESPONSE_FIELDS = Object.freeze([
  'futsal','second_referee_id','second_referee_name','second_referee_name_snapshot','second_referee_id_selection','second_source_type','timekeeper_id','timekeeper_name','timekeeper_name_snapshot','timekeeper_id_selection','timekeeper_source_type',
  'id',
  'season_id',
  'season_code',
  'season_name',
  'season_is_active',
  'match_type',
  'team_a_id',
  'team_b_id',
  'team_a_name_snapshot',
  'team_b_name_snapshot',
  'match_date',
  'match_time', 'match_end_time', 'venue', 'venue_detail', 'schedule_revision',
  'field_order',
  'main_referee_id',
  'main_referee_name_snapshot',
  'main_referee_name',
  'assistant1_id',
  'assistant1_name_snapshot',
  'assistant1_name',
  'assistant2_id',
  'assistant2_name_snapshot',
  'assistant2_name',
  'fourth_official_id',
  'fourth_official_name_snapshot',
  'fourth_official_name',
  'supervisor_id',
  'supervisor_required',
    'fourth_required',
  'supervisor_locked',
  'delete_state',
  'my_role_codes',
  'supervisor_name_snapshot',
  'supervisor_name',
  'created_at',
  'updated_at',
  'report_id',
  'report_exists',
  'report_main_status',
  'report_supervisor_status',
  'main_report_started_at',
  'supervisor_review_started_at',
  'main_report_submitted_at',
  'supervisor_review_submitted_at',
  'assignment_status',
  'is_assignment_complete',
  'pending_assignment_roles',
  'assignment',
  'display_teams',
  'match_count',
  'season',
  'match',
  'teams',
  'referees',
  'report',
  'report_entry',
  'template_prefill',
  'my_role',
  'my_role_code',
  'my_role_key',
  'my_assignment',
  'officials',
  'main_referee_id_selection',
  'assistant1_id_selection',
  'assistant2_id_selection',
  'fourth_official_id_selection',
  'supervisor_id_selection',
  'main_source_type',
  'assistant1_source_type',
  'assistant2_source_type',
  'fourth_source_type',
  'supervisor_source_type'
]);

function toNullableInt(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }

  const normalized = String(value).trim();
  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function toNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'y'].includes(value.toLowerCase());
  }
  return false;
}

function buildPendingAssignmentRoles(record = {}) {
  return officials.ROLES.filter(role => require('../utils/officialRequirements').roleRequired(record,role.code) && !record[role.field] && !record.officials?.some(a => a.role === role.code)).map(role => SCHEDULE_ROLE_LABELS[role.field]);
}

function buildAssignmentState(record = {}) {
  const pendingAssignmentRoles = buildPendingAssignmentRoles(record);
  return {
    status: pendingAssignmentRoles.length === 0 ? 'assigned' : 'pending',
    is_complete: pendingAssignmentRoles.length === 0,
    pending_roles: pendingAssignmentRoles
  };
}

function buildReportEntry(record = {}, options = {}) {
  const {
    scheduleId = toNullableInt(record.id),
    source = 'schedule-driven'
  } = options;

  const reportId = toNullableInt(record.report_id);
  const reportExists = reportId !== null || toBoolean(record.report_exists);

  return {
    schedule_id: scheduleId,
    report_id: reportId,
    report_exists: reportExists,
    source
  };
}

function normalizeScheduleRecord(record = {}) {
  const normalizedRoles = {
    main_referee_id: toNullableInt(record.main_referee_id),
    assistant1_id: toNullableInt(record.assistant1_id),
    assistant2_id: toNullableInt(record.assistant2_id),
    fourth_official_id: toNullableInt(record.fourth_official_id),
    second_referee_id: toNullableInt(record.second_referee_id),
    timekeeper_id: toNullableInt(record.timekeeper_id),
    supervisor_id: toNullableInt(record.supervisor_id)
  };

  const teamANameSnapshot =
    toNullableString(record.team_a_name_snapshot) ||
    toNullableString(record.team_a_name) ||
    null;
  const teamBNameSnapshot =
    toNullableString(record.team_b_name_snapshot) ||
    toNullableString(record.team_b_name) ||
    null;

  const assignmentState = buildAssignmentState(record);
  const reportEntry = buildReportEntry(record);
  const reportId = reportEntry.report_id;
  const matchCount =
    record.match_count === null || record.match_count === undefined
      ? null
      : Number.parseInt(record.match_count, 10);

  const myRole = toNullableString(record.my_role);
  const myRoleCode = toNullableString(record.my_role_code);
  const myRoleKey = toNullableString(record.my_role_key);

  return {
    delete_state: record.delete_checked_at ? deletion.decision(record) : undefined,
    futsal: require('../utils/officialRequirements').isFutsal(record),
    ...Object.fromEntries(officials.ROLES.flatMap(role=>[[role.field,toNullableInt(record[role.field])],[role.name,toNullableString(record[role.name])],[role.name+'_snapshot',toNullableString(record[role.name+'_snapshot'])]])),
    supervisor_required: require('../utils/supervisionRules').required(record.supervisor_required),
    fourth_required: require('../utils/officialRequirements').required(record.fourth_required),
    field_locked: require('../utils/supervisionRules').fieldLocked(record),
    supervisor_locked: require('../utils/supervisionRules').supervisorLocked(record),
    my_role_codes: record.my_role_codes || [],
    officials: record.officials || [],
    ...Object.fromEntries(officials.ROLES.flatMap(role => [[`${role.field}_selection`, record[`${role.field}_selection`] || null], [`${role.code}_source_type`, record[`${role.code}_source_type`] || null]])),
    id: toNullableInt(record.id),
    schedule_revision: Number(record.schedule_revision||0),
    signup_count: Number(record.signup_count||0),
    venue: record.venue||null, venue_detail:record.venue_detail||null,
    season_id: toNullableInt(record.season_id),
    season_code: toNullableString(record.season_code),
    season_name: toNullableString(record.season_name),
    season_is_active: toBoolean(record.season_is_active),
    match_type: toNullableString(record.match_type),
    team_a_id: toNullableInt(record.team_a_id),
    team_b_id: toNullableInt(record.team_b_id),
    team_a_name_snapshot: teamANameSnapshot,
    team_b_name_snapshot: teamBNameSnapshot,
    match_date: record.match_date || null,
    match_time: readMatchTime(record.match_time),
    match_end_time: readMatchTime(record.match_end_time),
    field_order: toNullableString(record.field_order),
    ...normalizedRoles,
    main_referee_name_snapshot: toNullableString(record.main_referee_name_snapshot),
    assistant1_name_snapshot: toNullableString(record.assistant1_name_snapshot),
    assistant2_name_snapshot: toNullableString(record.assistant2_name_snapshot),
    fourth_official_name_snapshot: toNullableString(record.fourth_official_name_snapshot),
    supervisor_name_snapshot: toNullableString(record.supervisor_name_snapshot),
    main_referee_name: toNullableString(record.main_referee_name),
    assistant1_name: toNullableString(record.assistant1_name),
    assistant2_name: toNullableString(record.assistant2_name),
    fourth_official_name: toNullableString(record.fourth_official_name),
    supervisor_name: toNullableString(record.supervisor_name),
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    report_id: reportId,
    report_exists: reportEntry.report_exists,
    report_entry: reportEntry,
    report_main_status: toNullableString(record.report_main_status),
    report_supervisor_status: toNullableString(record.report_supervisor_status),
    home_score: toNullableInt(record.home_score),
    away_score: toNullableInt(record.away_score),
    main_report_started_at: record.main_report_started_at || null,
    supervisor_review_started_at: record.supervisor_review_started_at || null,
    main_report_submitted_at: record.main_report_submitted_at || null,
    supervisor_review_submitted_at: record.supervisor_review_submitted_at || null,
    assignment_status: assignmentState.status,
    is_assignment_complete: assignmentState.is_complete,
    pending_assignment_roles: assignmentState.pending_roles,
    assignment: assignmentState,
    my_role: myRole,
    my_role_code: myRoleCode,
    my_role_key: myRoleKey,
    my_assignment: myRole ? {
      role: myRole,
      role_code: myRoleCode,
      role_key: myRoleKey,
      referee_id: myRoleKey ? normalizedRoles[myRoleKey] || null : null
    } : null,
    display_teams:
      teamANameSnapshot && teamBNameSnapshot
        ? `${teamANameSnapshot} vs ${teamBNameSnapshot}`
        : null,
    match_count: Number.isNaN(matchCount) ? null : matchCount
  };
}

function buildTeamMap(teams = []) {
  const teamMap = new Map();
  for (const team of teams) {
    teamMap.set(toNullableInt(team.id), team);
  }
  return teamMap;
}


function buildRefereeRoleDetail(record = {}, options = {}) {
  const {
    idField,
    nameField,
    roleKey,
    roleCode,
    label
  } = options;

  const assignment = record.officials?.find(a => a.role === roleCode);
  return {
    id: assignment ? assignment.referee_id || assignment.external_referee_id : toNullableInt(record[idField]),
    assignment_id: assignment?.id || null,
    source_type: assignment?.source_type || 'system',
    referee_id: assignment?.referee_id || null,
    external_referee_id: assignment?.external_referee_id || null,
    name: toNullableString(record[nameField]),
    role_key: roleKey,
    role_code: roleCode,
    label
  };
}

function buildScheduleDetailRecord(record = {}) {
  const normalized = normalizeScheduleRecord(record);

  const teams = {
    home: {
      id: normalized.team_a_id,
      name_snapshot: normalized.team_a_name_snapshot,
      current_name: toNullableString(record.team_a_current_name) || normalized.team_a_name_snapshot,
      league_type: toNullableString(record.team_a_league_type),
      display_name: normalized.team_a_name_snapshot || toNullableString(record.team_a_current_name)
    },
    away: {
      id: normalized.team_b_id,
      name_snapshot: normalized.team_b_name_snapshot,
      current_name: toNullableString(record.team_b_current_name) || normalized.team_b_name_snapshot,
      league_type: toNullableString(record.team_b_league_type),
      display_name: normalized.team_b_name_snapshot || toNullableString(record.team_b_current_name)
    }
  };

  const referees = {
    main_referee: buildRefereeRoleDetail(record, {
      idField: 'main_referee_id',
      nameField: 'main_referee_name',
      roleKey: 'main_referee_id',
      roleCode: 'main',
      label: '裁判员'
    }),
    assistant1: buildRefereeRoleDetail(record, {
      idField: 'assistant1_id',
      nameField: 'assistant1_name',
      roleKey: 'assistant1_id',
      roleCode: 'assistant1',
      label: '第一助理裁判员'
    }),
    assistant2: buildRefereeRoleDetail(record, {
      idField: 'assistant2_id',
      nameField: 'assistant2_name',
      roleKey: 'assistant2_id',
      roleCode: 'assistant2',
      label: '第二助理裁判员'
    }),
    fourth_official: buildRefereeRoleDetail(record, {
      idField: 'fourth_official_id',
      nameField: 'fourth_official_name',
      roleKey: 'fourth_official_id',
      roleCode: 'fourth',
      label: '第四官员'
    }),
    supervisor: buildRefereeRoleDetail(record, {
      idField: 'supervisor_id',
      nameField: 'supervisor_name',
      roleKey: 'supervisor_id',
      roleCode: 'supervisor',
      label: '裁判监督'
    })
  };

  for(const role of officials.ROLES.filter(r=>['second','timekeeper'].includes(r.code)))referees[role.code]=buildRefereeRoleDetail(record,{idField:role.field,nameField:role.name,roleKey:role.field,roleCode:role.code,label:role.label});
  const assignment = {
    status: normalized.assignment_status,
    is_complete: normalized.is_assignment_complete,
    pending_roles: normalized.pending_assignment_roles
  };

  const reportEntry = normalized.report_entry || buildReportEntry(record, { scheduleId: normalized.id });

  const report = {
    id: normalized.report_id,
    exists: normalized.report_exists,
    main_report_status: normalized.report_main_status,
    supervisor_review_status: normalized.report_supervisor_status,
    main_report_started_at: record.main_report_started_at || null,
    supervisor_review_started_at: record.supervisor_review_started_at || null,
    main_report_submitted_at: record.main_report_submitted_at || null,
    supervisor_review_submitted_at: record.supervisor_review_submitted_at || null,
    home_score: toNullableInt(record.home_score) || 0,
    forfeit_side: record.forfeit_side || 'none',
    away_score: toNullableInt(record.away_score) || 0,
    home_penalty_score: toNullableInt(record.home_penalty_score) || 0,
    away_penalty_score: toNullableInt(record.away_penalty_score) || 0,
    fourth_official_image_path: toNullableString(record.fourth_official_image_path),
    created_at: record.report_created_at || null,
    updated_at: record.report_updated_at || null
  };

  const templatePrefill = {
    field_order: normalized.field_order,
    match_type: normalized.match_type,
    match_date: normalized.match_date,
    match_time: normalized.match_time,
    match_end_time: normalized.match_end_time,
    venue:normalized.venue, venue_detail:normalized.venue_detail,
    display_teams: normalized.display_teams,
    teams: {
      home_name: teams.home.display_name,
      away_name: teams.away.display_name
    },
    referees: {
      main_referee_name: normalized.main_referee_name,
      assistant1_name: normalized.assistant1_name,
      assistant2_name: normalized.assistant2_name,
      fourth_official_name: normalized.fourth_official_name,
      second_referee_name: normalized.second_referee_name,
      timekeeper_name: normalized.timekeeper_name,
      supervisor_name: normalized.supervisor_name
    }
  };

  return {
    ...normalized,
    season: {
      id: normalized.season_id,
      season_code: normalized.season_code,
      season_name: normalized.season_name,
      is_active: normalized.season_is_active
    },
    match: {
      id: normalized.id,
      futsal: normalized.futsal,
      match_type: normalized.match_type,
      match_date: normalized.match_date,
      match_time: normalized.match_time,
      match_end_time: normalized.match_end_time,
      venue:normalized.venue, venue_detail:normalized.venue_detail,
      field_order: normalized.field_order,
      display_teams: normalized.display_teams,
      created_at: normalized.created_at,
      updated_at: normalized.updated_at
    },
    teams,
    referees,
    assignment,
    report,
    report_entry: reportEntry,
    template_prefill: templatePrefill
  };
}

class ScheduleService {
  getFieldContract() {
    return {
      version: SCHEDULE_CONTRACT_VERSION,
      mutation_fields: [...SCHEDULE_MUTATION_FIELDS],
      response_fields: [...SCHEDULE_RESPONSE_FIELDS],
      role_fields: [...SCHEDULE_ROLE_FIELDS],
      deprecated_input_fields: ['team_a_name', 'team_b_name'],
      deprecated_endpoints: {
        get_available_schedules: {
          path: '/schedule/available/:matchType',
          status: 'disabled',
          replacement: '/schedule 或 /schedule/type/:matchType',
          reason: '阶段 3-0.4 已停止基于旧 matches 表推导“可用赛程”'
        }
      },
      list_endpoints: {
        admin_all: {
          path: '/schedule',
          access: 'admin-only',
          scope: '管理员所选赛季赛程列表；season_id 可选，省略时仅当前启用赛季，无启用赛季时为空',
          sort: 'match_date ASC、时间待定置后、match_time ASC、field_order ASC、id ASC'
        },
        admin_filtered: {
          path: '/schedule/type/:matchType',
          access: 'admin-only',
          scope: '管理员所选赛季内按比赛类型筛选赛程列表；season_id 规则同 /schedule'
        },
        detail: {
          path: '/schedule/:scheduleId',
          access: 'authenticated',
          scope: '赛程详情（赛程主信息 + 五位裁判 + 报告关联信息）'
        },
        admin_assign_referees: {
          path: '/schedule/:scheduleId/assign-referees',
          access: 'admin-only',
          scope: '管理员裁判选派接口（支持五个裁判角色部分更新）'
        },
        referee_assignments_service: {
          service: 'listSchedulesForReferee(refereeId)',
          access: 'service-only (阶段 3-3.1)',
          scope: '裁判按身份查询自己的执法场次（与管理员赛程列表同源）'
        }
      },
      validation_rules: {
        active_season_required: true,
        match_date_required: true,
        match_time: '新建必填HH:mm或HH:mm-HH:mm；读取为开始时间HH:mm；旧比赛可为null；中国标准时间',
        match_end_time: '可选同日结束时间HH:mm，仅用于展示；须晚于开始时间；单时间输入移除结束时间',
        field_order: '1—50个字符，去除首尾空格后在同一赛事内精确唯一（区分大小写）',
        team_scope: '主客队都必须属于当前启用赛季',
        team_distinct: true,
        referee_distinct_roles: true
      },
      acceptance: {
        phase_3_status: 'sealed',
        canonical_business_entry: 'schedule',
        canonical_backend: {
          routes: 'scheduleRoutes',
          service: 'scheduleService'
        },
        legacy_match_write_frozen: true,
        legacy_available_endpoint_disabled: true,
        admin_schedule_uses_available_endpoint: false,
        notes: '阶段 3 验收封边完成后，新增能力统一只挂到赛程中心，不再继续扩展旧 matches 写入链路；旧文件保留但冻结。'
      },
      notes: {
        team_name_input: '前端不再上传 team_a_name / team_b_name 作为真值；队名最终由后端按 team_id 生成快照',
        match_time: 'match_date + match_time（HH:mm或null），按Asia/Shanghai解释；不使用旧start_time/end_time',
        assignment_status: '若所需岗位未全部选派完成，则 assignment_status=pending，并返回 pending_assignment_roles',
        admin_full_list: '阶段 3-1.1 起，GET /schedule 返回管理员全量赛程列表，并携带赛季信息、五位裁判姓名、报告主表状态与待选派状态',
        schedule_detail: '阶段 3-1.2 起，GET /schedule/:scheduleId 返回结构化详情，包含赛程主信息、五位裁判、报告关联信息与模板预填内容',
        schedule_update: '阶段 3-1.3 起，PUT /schedule/:scheduleId 更新成功后返回与详情接口同结构的数据，便于赛程页、报告入口和模板预填内容同步刷新',
        schedule_assignment_write: 'scheduleService.assignReferees 支持部分更新；裁判员可兼任第四官员，裁判监督可兼任场上岗位，其余场上岗位不得重复',
        schedule_assignment_route: '阶段 3-2.2 起，PUT /schedule/:scheduleId/assign-referees 对外开放，仅管理员可调用，返回更新后的结构化赛程详情',
        pending_assignment_state: '阶段 3-2.3 起，列表与详情均由后端直接派生待选派状态：若五个角色有空位，则 is_assignment_complete=false，并返回 pending_assignment_roles / assignment',
        referee_assignment_list_service: '阶段 3-3.1 起，scheduleService 新增 listSchedulesForReferee(refereeId)，从同一套赛程主数据中返回裁判自己的执法场次，并附带 my_role / my_assignment / report_id 等字段',
        report_entry_placeholder: '阶段 3-3.3 起，赛程列表、赛程详情与裁判我的执法列表都会稳定返回 report_entry / report_id / report_exists，后续阶段 4/5/6 可直接据此进入报告详情',
        phase3_seal: '阶段 3-3.4 起，赛程已成为唯一新增业务入口；AdminSchedule.vue 不再调 getAvailableSchedules，旧 match 路径不再承接新的真实写入',
        report_placeholder: '创建赛程后依赖 match_schedules -> match_reports 触发器自动生成空报告',
        match_count: '阶段 3-0.4 起不再读取旧 matches 表；为兼容旧前端，match_count 字段暂时保留并固定为 null',
        delete_rule: '仅开球前允许删除；报名、选派、报告及关联结果一起删除；时间待定先补齐；到达开球时间即禁止删除'
      }
    };
  }

  normalizeScheduleMutationPayload(data = {}) {
    return normalizeScheduleMutationPayload(data);
  }

  normalizeScheduleRecord(record = {}) {
    return normalizeScheduleRecord(record);
  }

  async getCurrentActiveSeason(connection) {
    const [rows] = await connection.execute(
      `SELECT id, season_code, season_name
       FROM seasons
       WHERE is_active = 1
       ORDER BY id DESC
       LIMIT 1`
    );

    return rows.length > 0 ? rows[0] : null;
  }

  async getSeasonById(connection, seasonId) {
    const [rows] = await connection.execute(
      `SELECT id, season_code, season_name, is_active
       FROM seasons
       WHERE id = ?
       LIMIT 1`,
      [seasonId]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  async getScheduleByIdForWrite(connection, scheduleId) {
    const [rows] = await connection.execute(
      `SELECT s.id,
              s.season_id, s.schedule_revision, s.futsal, s.supervisor_required, s.fourth_required, s.venue, s.venue_detail,
              s.match_type,
              s.team_a_id,
              s.team_b_id,
              s.match_date,
              s.match_time, s.match_end_time,
              s.field_order,
              s.main_referee_id,
              s.assistant1_id,
              s.assistant2_id,
              s.fourth_official_id,
              s.supervisor_id,
              s.main_referee_name_snapshot,
              s.assistant1_name_snapshot,
              s.assistant2_name_snapshot,
              s.fourth_official_name_snapshot,
              s.supervisor_name_snapshot,
              mr.id AS report_id,
              mr.main_report_started_at,
              mr.supervisor_review_started_at,
              mr.main_report_status,
              mr.supervisor_review_status
       FROM match_schedules s
       LEFT JOIN match_reports mr ON mr.schedule_id = s.id
       WHERE s.id = ?
       LIMIT 1 FOR UPDATE`,
      [scheduleId]
    );

    await officials.hydrate(connection, rows);
    return rows.length > 0 ? rows[0] : null;
  }

  async getSeasonTeamsByIds(connection, seasonId, teamIds = []) {
    const normalizedIds = [...new Set(teamIds.filter(id => Number.isInteger(id) && id > 0))];
    if (normalizedIds.length === 0) {
      return [];
    }

    const placeholders = normalizedIds.map(() => '?').join(', ');
    const [rows] = await connection.execute(
      `SELECT id, season_id, team_name, league_type, registration_revoked
       FROM team
       WHERE season_id = ?
         AND id IN (${placeholders}) FOR SHARE`,
      [seasonId, ...normalizedIds]
    );

    return rows;
  }

  getChangedRoleFields(existingSchedule = {}, nextAssignment = {}) {
    return SCHEDULE_ROLE_FIELDS.filter(field => (
      toNullableInt(existingSchedule[field]) !== toNullableInt(nextAssignment[field])
    ));
  }

  async ensureAssignmentEligibility(connection, seasonId, assignment = {}, fields = SCHEDULE_ROLE_FIELDS) {
    const requested = fields
      .map(field => ({ field, refereeId: toNullableInt(assignment[field]) }))
      .filter(item => item.refereeId !== null);
    const refereeIds = [...new Set(requested.map(item => item.refereeId))];
    if (refereeIds.length === 0) return new Map();

    const placeholders = refereeIds.map(() => '?').join(', ');
    const [rows] = await connection.execute(
      `SELECT rsr.referee_id, rsr.name_snapshot, rsr.grade_snapshot,
              rsr.match_types_snapshot, r.student_id
         FROM referee_season_registrations rsr
         INNER JOIN referee r ON r.id = rsr.referee_id
        WHERE rsr.season_id = ?
          AND rsr.status = 'approved'
          AND r.is_active = 1
          AND rsr.referee_id IN (${placeholders})`,
      [seasonId, ...refereeIds]
    );
    const eligibleById = new Map(rows.map(row => [Number(row.referee_id), row]));
    const invalid = requested.filter(item => !eligibleById.has(item.refereeId));
    if (invalid.length > 0) {
      const labels = invalid.map(item => `${SCHEDULE_ROLE_LABELS[item.field]}（裁判 ID ${item.refereeId}）`);
      throw createBusinessError(
        `${labels.join('、')}未通过该赛季注册审核、账号已停用或不存在，不能被新选派`,
        { statusCode: 409, code: 'REFEREE_NOT_ELIGIBLE_FOR_SEASON' }
      );
    }
    return eligibleById;
  }

  buildRoleNameSnapshots(existingSchedule = {}, nextAssignment = {}, changedFields = SCHEDULE_ROLE_FIELDS, eligibleById = new Map()) {
    const changed = new Set(changedFields);
    const snapshots = {};
    for (const roleField of SCHEDULE_ROLE_FIELDS) {
      const snapshotField = ROLE_NAME_SNAPSHOT_FIELDS[roleField];
      if (!changed.has(roleField)) {
        snapshots[snapshotField] = toNullableString(existingSchedule[snapshotField]);
        continue;
      }
      const refereeId = toNullableInt(nextAssignment[roleField]);
      snapshots[snapshotField] = refereeId === null
        ? null
        : toNullableString(eligibleById.get(refereeId)?.name_snapshot);
    }
    return snapshots;
  }

  async getScheduleWithReportById(connection, scheduleId) {
    const [rows] = await connection.execute(
      `SELECT
         s.*, ${signupService.validCount} AS signup_count,
         DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d %H:%i:%s') AS delete_checked_at,
         mr.id AS report_id,
         CASE WHEN mr.id IS NULL THEN 0 ELSE 1 END AS report_exists,
         NULL AS match_count
       FROM match_schedules s
       LEFT JOIN match_reports mr ON mr.schedule_id = s.id
       WHERE s.id = ?
       LIMIT 1`,
      [scheduleId]
    );

    return rows.length > 0 ? this.normalizeScheduleRecord(rows[0]) : null;
  }

  async ensureFieldOrderAvailable(connection, seasonId, matchType, fieldOrder, excludeScheduleId = null) {
    const params = [seasonId, matchType, fieldOrder];
    let query = `
      SELECT id
      FROM match_schedules
      WHERE season_id = ?
        AND match_type = ?
        AND field_order = ?
    `;

    if (excludeScheduleId !== null) {
      query += ' AND id <> ?';
      params.push(excludeScheduleId);
    }

    query += ' LIMIT 1';

    const [rows] = await connection.execute(query, params);
    if (rows.length > 0) {
      throw createBusinessError('当前启用赛季内同一比赛类型场序已存在，请更换场序后重试', {
        code: 'FIELD_ORDER_CONFLICT'
      });
    }
  }

  async validateScheduleWritePayload(connection, data, options = {}) {
    const {
      scheduleId = null,
      seasonId = null,
      requireActiveSeason = true
    } = options;

    const payload = validateScheduleMutationPayload(data, { allowUnknownTime: options.allowUnknownTime === true, allowUnknownVenue:options.allowUnknownVenue === true });

    let targetSeason = null;
    if (seasonId !== null && seasonId !== undefined) {
      targetSeason = await this.getSeasonById(connection, seasonId);
      if (!targetSeason) {
        throw createBusinessError('赛季不存在，无法写入赛程', {
          statusCode: 400,
          code: 'SEASON_NOT_FOUND'
        });
      }
    } else {
      targetSeason = await this.getCurrentActiveSeason(connection);
      if (requireActiveSeason && !targetSeason) {
        throw createBusinessError('请先启用赛季', {
          code: 'ACTIVE_SEASON_REQUIRED'
        });
      }
    }

    if (!targetSeason) {
      throw createBusinessError('请先启用赛季', {
        code: 'ACTIVE_SEASON_REQUIRED'
      });
    }

    const teams = await this.getSeasonTeamsByIds(connection, targetSeason.id, [payload.team_a_id, payload.team_b_id]);
    const teamIdsInSeason = new Set(teams.map(team => team.id));

    if (!teamIdsInSeason.has(payload.team_a_id) || !teamIdsInSeason.has(payload.team_b_id)) {
      throw createBusinessError('主客队必须属于当前启用赛季', {
        code: 'TEAM_NOT_IN_ACTIVE_SEASON'
      });
    }

    const teamMap = buildTeamMap(teams);
    if (teams.some(team => team.registration_revoked)) {
      const [[existing]] = scheduleId ? await connection.execute('SELECT team_a_id,team_b_id FROM match_schedules WHERE id=?', [scheduleId]) : [[]];
      if (teams.some(team => team.registration_revoked && ![existing?.team_a_id,existing?.team_b_id].includes(team.id))) {
        throw createBusinessError('球队报名通过已撤销，重新审核通过前不能安排新赛程', { code: 'TEAM_REGISTRATION_REVOKED' });
      }
    }
    const homeTeam = teamMap.get(payload.team_a_id);
    const awayTeam = teamMap.get(payload.team_b_id);
    if (homeTeam?.league_type !== payload.match_type || awayTeam?.league_type !== payload.match_type) {
      throw createBusinessError('主客队的赛事类型必须与赛程比赛类型一致', {
        code: 'TEAM_MATCH_TYPE_MISMATCH'
      });
    }

    await require('./competitionService').requireCompetition(connection,targetSeason.id,payload.match_type);
    await this.ensureFieldOrderAvailable(connection, targetSeason.id, payload.match_type, payload.field_order, scheduleId);

    return {
      payload,
      activeSeason: targetSeason,
      teams,
      teamMap
    };
  }


  normalizeAssignmentPayload(data = {}) {
    const payload = {};

    for (const field of SCHEDULE_ROLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const rawValue = data[field];
        const normalizedValue = toNullableInt(rawValue);
        const explicitlyEmpty = rawValue === null || rawValue === undefined || rawValue === '';
        if (!explicitlyEmpty && (!Number.isInteger(normalizedValue) || normalizedValue <= 0)) {
          throw createBusinessError(`${SCHEDULE_ROLE_LABELS[field]}的裁判 ID 必须是正整数或留空`, {
            code: 'REFEREE_ID_INVALID'
          });
        }
        payload[field] = normalizedValue;
      }
    }

    return payload;
  }

  mergeAssignmentPayload(existingSchedule = {}, patch = {}) {
    const merged = {};
    for (const field of SCHEDULE_ROLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) {
        merged[field] = patch[field];
      } else {
        merged[field] = toNullableInt(existingSchedule[field]);
      }
    }
    return merged;
  }

  validateAssignmentPayload(data = {}, options = {}) {
    const { requireAnyField = true } = options;
    const patch = this.normalizeAssignmentPayload(data);

    if (requireAnyField && Object.keys(patch).length === 0) {
      throw createBusinessError('至少提供一个裁判角色字段进行选派', {
        code: 'ASSIGNMENT_PAYLOAD_EMPTY'
      });
    }

    const assignedReferees = collectAssignedReferees(patch);
    const seen = new Map();
    for (const item of assignedReferees) {
      if(item.field==='supervisor_id')continue;
      if (seen.has(item.refereeId)) {
        const previous = seen.get(item.refereeId);
        if(previous.field==='main_referee_id'&&item.field==='fourth_official_id')continue;
        throw createBusinessError(`同一场比赛中裁判不能重复指派：${previous.label} 与 ${item.label} 不能为同一人`, {
          code: 'REFEREE_DUPLICATE_ASSIGNMENT'
        });
      }
      seen.set(item.refereeId, item);
    }

    return patch;
  }

  isReportStarted(schedule = {}) {
    return Boolean(
      schedule.main_report_started_at ||
      schedule.supervisor_review_started_at ||
      schedule.main_report_status === 'submitted' ||
      schedule.supervisor_review_status === 'submitted'
    );
  }

  validateLockedScheduleChanges(existingSchedule = {}, payload = {}) {
    if (!this.isReportStarted(existingSchedule)) {
      return;
    }

    const coreChanged = (
      toNullableString(existingSchedule.match_type) !== toNullableString(payload.match_type) ||
      toNullableInt(existingSchedule.team_a_id) !== toNullableInt(payload.team_a_id) ||
      toNullableInt(existingSchedule.team_b_id) !== toNullableInt(payload.team_b_id) ||
      String(existingSchedule.match_date || '').slice(0, 10) !== String(payload.match_date || '').slice(0, 10) ||
      readMatchTime(existingSchedule.match_time) !== readMatchTime(payload.match_time) ||
      readMatchTime(existingSchedule.match_end_time) !== readMatchTime(payload.match_end_time) ||
      existingSchedule.venue !== payload.venue || existingSchedule.venue_detail !== payload.venue_detail ||
      toNullableString(existingSchedule.field_order) !== toNullableString(payload.field_order)
    );

    if (coreChanged) {
      throw createBusinessError('报告已开始填写，比赛类型、队伍、日期、比赛时间和场序均已锁定', {
        code: 'SCHEDULE_CORE_LOCKED'
      });
    }

    // Role requirements and source identities are checked by officials.prepare before normalization.
  }

  async assignReferees(scheduleId, data = {}, viewer) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const existingSchedule = await this.getScheduleByIdForWrite(connection, scheduleId);
      if (!existingSchedule) {
        throw createBusinessError('赛程不存在', {
          statusCode: 404,
          code: 'SCHEDULE_NOT_FOUND'
        });
      }

      if (!Object.hasOwn(data,'futsal') && !Object.hasOwn(data,'supervisor_required') && !Object.hasOwn(data,'fourth_required') && !SCHEDULE_ROLE_FIELDS.some(field => Object.hasOwn(data, field))) throw createBusinessError('至少提供一个裁判角色字段进行选派');
      checkScheduleRevision(data.schedule_revision,existingSchedule.schedule_revision);
      const prepared = await officials.prepare(connection, existingSchedule.season_id, existingSchedule, data);
      const mergedAssignment = prepared.fields;
      const nameSnapshots = prepared.snapshots;
      await officials.persist(connection, scheduleId, prepared, viewer);
      await connection.execute('UPDATE match_schedules SET supervisor_required=?,fourth_required=? WHERE id=?',[prepared.fields.supervisor_required,prepared.fields.fourth_required,scheduleId]);

      const [result] = await connection.execute(
        `UPDATE match_schedules
         SET schedule_revision = schedule_revision + 1, main_referee_id = ?,
             assistant1_id = ?,
             assistant2_id = ?,
             fourth_official_id = ?,
             supervisor_id = ?,
             main_referee_name_snapshot = ?,
             assistant1_name_snapshot = ?,
             assistant2_name_snapshot = ?,
             fourth_official_name_snapshot = ?,
             supervisor_name_snapshot = ?
         WHERE id = ?`,
        [
          mergedAssignment.main_referee_id,
          mergedAssignment.assistant1_id,
          mergedAssignment.assistant2_id,
          mergedAssignment.fourth_official_id,
          mergedAssignment.supervisor_id,
          nameSnapshots.main_referee_name_snapshot,
          nameSnapshots.assistant1_name_snapshot,
          nameSnapshots.assistant2_name_snapshot,
          nameSnapshots.fourth_official_name_snapshot,
          nameSnapshots.supervisor_name_snapshot,
          scheduleId
        ]
      );

      if (result.affectedRows === 0) {
        throw createBusinessError('赛程不存在', {
          statusCode: 404,
          code: 'SCHEDULE_NOT_FOUND'
        });
      }

      const updatedSchedule = await this.queryScheduleDetail(connection, scheduleId);
      if (updatedSchedule) updatedSchedule.assignment_warnings = await require('./assignmentWarningService').warnings(connection,updatedSchedule,Object.fromEntries(officials.ROLES.map(r=>[r.field,officials.selectionFor(updatedSchedule,r)])));
      if (!updatedSchedule) {
        throw createBusinessError('裁判选派后读取赛程详情失败，请刷新后重试', {
          statusCode: 500,
          code: 'SCHEDULE_ASSIGNMENT_DETAIL_NOT_FOUND'
        });
      }

      await connection.commit();
      return updatedSchedule;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        safeLog('裁判选派回滚失败:', rollbackError, 'error');
      }
      throw this.mapPersistenceError(error, '裁判选派失败');
    } finally {
      connection.release();
    }
  }

  mapPersistenceError(error, fallbackMessage) {
    if (isBusinessError(error)) {
      return error;
    }

    if (error && error.code === 'ER_DUP_ENTRY') {
      return createBusinessError('该比赛类型在当前赛季内场序已存在，请更换场序后重试', {
        code: 'FIELD_ORDER_CONFLICT'
      });
    }

    if (error && error.code === 'ER_NO_REFERENCED_ROW_2') {
      return createBusinessError('赛程引用的队伍或裁判不存在，请刷新后重试', {
        code: 'FOREIGN_KEY_CONFLICT'
      });
    }

    if (error && error.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
      return createBusinessError('赛程数据不满足约束，请检查主客队、场序和裁判指派是否正确', {
        code: 'SCHEDULE_CONSTRAINT_CONFLICT'
      });
    }

    return createBusinessError(fallbackMessage, {
      code: 'SCHEDULE_PERSISTENCE_FAILED'
    });
  }

  async createSchedule(data) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await this.createScheduleInTransaction(connection, data);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        safeLog('赛程创建回滚失败:', rollbackError, 'error');
      }
      throw this.mapPersistenceError(error, '赛程创建失败');
    } finally {
      connection.release();
    }
  }

  // 单场与批量导入共用全部业务校验，事务由调用方统一提交。
  async createScheduleInTransaction(connection, data) {
      const { payload, activeSeason, teamMap } = await this.validateScheduleWritePayload(connection, data);
      const teamA = teamMap.get(payload.team_a_id);
      const teamB = teamMap.get(payload.team_b_id);

      if (!teamA || !teamB) {
        throw createBusinessError('主客队必须属于当前启用赛季', {
          code: 'TEAM_NOT_IN_ACTIVE_SEASON'
        });
      }
      const prepared = await officials.prepare(connection, activeSeason.id, {}, payload, { full: true });
      Object.assign(payload, prepared.fields);
      const nameSnapshots = prepared.snapshots;

      const [result] = await connection.execute(
        `INSERT INTO match_schedules (
           season_id,
           match_type,
           team_a_id,
           team_b_id,
           team_a_name_snapshot,
           team_b_name_snapshot,
           match_date,
           match_time, match_end_time, venue, venue_detail,
           field_order,
           main_referee_id,
           assistant1_id,
           assistant2_id,
           fourth_official_id,
           supervisor_id,
           main_referee_name_snapshot,
           assistant1_name_snapshot,
           assistant2_name_snapshot,
           fourth_official_name_snapshot,
           supervisor_name_snapshot
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          activeSeason.id,
          payload.match_type,
          payload.team_a_id,
          payload.team_b_id,
          teamA.team_name,
          teamB.team_name,
          payload.match_date,
          payload.match_time, payload.match_end_time, payload.venue, payload.venue_detail,
          payload.field_order,
          payload.main_referee_id,
          payload.assistant1_id,
          payload.assistant2_id,
          payload.fourth_official_id,
          payload.supervisor_id,
          nameSnapshots.main_referee_name_snapshot,
          nameSnapshots.assistant1_name_snapshot,
          nameSnapshots.assistant2_name_snapshot,
          nameSnapshots.fourth_official_name_snapshot,
          nameSnapshots.supervisor_name_snapshot
        ]
      );

      await connection.execute('UPDATE match_schedules SET field_order_sort=?,supervisor_required=?,fourth_required=? WHERE id=?',[require('../utils/competitionRules').fieldOrderSortKey(payload.field_order),prepared.fields.supervisor_required,prepared.fields.fourth_required,result.insertId]);
      await officials.persist(connection, result.insertId, prepared);
      const createdSchedule = await this.queryScheduleDetail(connection, result.insertId);

      if (createdSchedule) {
        return createdSchedule;
      }

      return this.normalizeScheduleRecord({
        id: result.insertId,
        season_id: activeSeason.id,
        season_code: activeSeason.season_code,
        season_name: activeSeason.season_name,
        season_is_active: true,
        ...payload,
        team_a_name_snapshot: teamA.team_name,
        team_b_name_snapshot: teamB.team_name,
        ...nameSnapshots,
        report_exists: false,
        match_count: null
      });
  }

  async queryAdminSchedules(connection, options = {}) {
    const { seasonId } = options;
    if (!seasonId) return [];
    const {where:whereClause,params}=require('../utils/scheduleFilters').filters(options,seasonId);
    const {page,pageSize}=require('../utils/listQuery').pagination(options);

    const [schedules] = await connection.execute(
      `SELECT
         s.*, ${signupService.validCount} AS signup_count,
         DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d %H:%i:%s') AS delete_checked_at,
         se.season_code,
         se.season_name,
         se.is_active AS season_is_active,
         mr.id AS report_id,
         CASE WHEN mr.id IS NULL THEN 0 ELSE 1 END AS report_exists,
         mr.main_report_status AS report_main_status,
         mr.supervisor_review_status AS report_supervisor_status,
         mr.main_report_started_at,
         mr.supervisor_review_started_at,
         mr.main_report_submitted_at,
         mr.supervisor_review_submitted_at,
         COALESCE(s.main_referee_name_snapshot, main_ref.name) AS main_referee_name,
         COALESCE(s.assistant1_name_snapshot, assistant1_ref.name) AS assistant1_name,
         COALESCE(s.assistant2_name_snapshot, assistant2_ref.name) AS assistant2_name,
         COALESCE(s.fourth_official_name_snapshot, fourth_ref.name) AS fourth_official_name,
         COALESCE(s.supervisor_name_snapshot, supervisor_ref.name) AS supervisor_name,
         NULL AS match_count,
         ${require('../utils/scheduleFilters').attention} AS assignment_needs_attention
       FROM match_schedules s
       INNER JOIN seasons se ON se.id = s.season_id
       LEFT JOIN match_reports mr ON mr.schedule_id = s.id
       LEFT JOIN referee main_ref ON main_ref.id = s.main_referee_id
       LEFT JOIN referee assistant1_ref ON assistant1_ref.id = s.assistant1_id
       LEFT JOIN referee assistant2_ref ON assistant2_ref.id = s.assistant2_id
       LEFT JOIN referee fourth_ref ON fourth_ref.id = s.fourth_official_id
       LEFT JOIN referee supervisor_ref ON supervisor_ref.id = s.supervisor_id
       ${whereClause}
       ORDER BY s.match_date ASC, (s.match_time IS NULL) ASC, s.match_time ASC, s.field_order_sort ASC, s.field_order ASC, s.id ASC
       LIMIT ${options.exporting?5000:pageSize} OFFSET ${options.exporting?0:(page-1)*pageSize}`,
      params
    );

    await officials.hydrate(connection, schedules);
    return schedules.map(schedule => this.normalizeScheduleRecord(schedule));
  }

  async queryScheduleDetail(connection, scheduleId) {
    const [rows] = await connection.execute(
      `SELECT
         s.*, ${signupService.validCount} AS signup_count,
         DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d %H:%i:%s') AS delete_checked_at,
         se.season_code,
         se.season_name,
         se.is_active AS season_is_active,
         team_a.team_name AS team_a_current_name,
         team_a.league_type AS team_a_league_type,
         team_b.team_name AS team_b_current_name,
         team_b.league_type AS team_b_league_type,
         mr.id AS report_id,
         CASE WHEN mr.id IS NULL THEN 0 ELSE 1 END AS report_exists,
         mr.forfeit_side,
         mr.home_score,
         mr.away_score,
         mr.home_penalty_score,
         mr.away_penalty_score,
         mr.fourth_official_image_path,
         mr.main_report_started_at,
         mr.supervisor_review_started_at,
         mr.main_report_status AS report_main_status,
         mr.supervisor_review_status AS report_supervisor_status,
         mr.main_report_submitted_at,
         mr.supervisor_review_submitted_at,
         mr.created_at AS report_created_at,
         mr.updated_at AS report_updated_at,
         COALESCE(s.main_referee_name_snapshot, main_ref.name) AS main_referee_name,
         COALESCE(s.assistant1_name_snapshot, assistant1_ref.name) AS assistant1_name,
         COALESCE(s.assistant2_name_snapshot, assistant2_ref.name) AS assistant2_name,
         COALESCE(s.fourth_official_name_snapshot, fourth_ref.name) AS fourth_official_name,
         COALESCE(s.supervisor_name_snapshot, supervisor_ref.name) AS supervisor_name,
         NULL AS match_count
       FROM match_schedules s
       INNER JOIN seasons se ON se.id = s.season_id
       LEFT JOIN team team_a ON team_a.id = s.team_a_id AND team_a.season_id = s.season_id
       LEFT JOIN team team_b ON team_b.id = s.team_b_id AND team_b.season_id = s.season_id
       LEFT JOIN match_reports mr ON mr.schedule_id = s.id
       LEFT JOIN referee main_ref ON main_ref.id = s.main_referee_id
       LEFT JOIN referee assistant1_ref ON assistant1_ref.id = s.assistant1_id
       LEFT JOIN referee assistant2_ref ON assistant2_ref.id = s.assistant2_id
       LEFT JOIN referee fourth_ref ON fourth_ref.id = s.fourth_official_id
       LEFT JOIN referee supervisor_ref ON supervisor_ref.id = s.supervisor_id
       WHERE s.id = ?
       LIMIT 1`,
      [scheduleId]
    );

    await officials.hydrate(connection, rows);
    return rows.length > 0 ? buildScheduleDetailRecord(rows[0]) : null;
  }

  async listAdminSchedules(options = {}) {
    const q=require('../utils/listQuery');
    const {page,pageSize}=q.pagination(options);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const context = await resolveSeasonScope(connection, options.seasonId);
      const {where,params}=require('../utils/scheduleFilters').filters(options,context.selected_season?.id||0);
      const [[count]]=await connection.execute(`SELECT COUNT(*) total FROM match_schedules s LEFT JOIN match_reports mr ON mr.schedule_id=s.id ${where}`,params);
      const [[seasonCount]]=await connection.execute('SELECT COUNT(*) total FROM match_schedules WHERE season_id=?',[context.selected_season?.id||0]);
      if(options.exporting)q.guardExport(Number(count.total));
      const schedules = await this.queryAdminSchedules(connection, {
        ...options,
        seasonId: context.selected_season?.id,
      });
      await connection.commit();
      return { schedules, ...context, total: Number(count.total),season_total:Number(seasonCount.total),pagination:q.pageMeta(page,pageSize,Number(count.total)) };
    } catch(error){await connection.rollback();throw error;} finally {
      connection.release();
    }
  }

  async workbench(seasonId) {
    const c=await pool.getConnection();
    try {
      await c.beginTransaction();
      const context=await resolveSeasonScope(c,seasonId);
      const {statuses}=require('../utils/scheduleFilters');
      const expressions=Object.entries(statuses).map(([key,value])=>`COALESCE(SUM(${value}),0) AS ${key}`).join(',');
      const [[summary]]=await c.execute(`SELECT COUNT(*) total,${expressions} FROM match_schedules s LEFT JOIN match_reports mr ON mr.schedule_id=s.id WHERE s.season_id=?`,[context.selected_season?.id||0]);
      const items=await this.queryAdminSchedules(c,{seasonId:context.selected_season?.id,report_status:'attention',page_size:'10'});
      await c.commit();
      return {...context,summary,items};
    }catch(e){await c.rollback();throw e;}finally{c.release();}
  }

  async getSchedulesByType(matchType, seasonId) {
    return (await this.listAdminSchedules({ matchType, seasonId })).schedules;
  }

  async getAllSchedules(seasonId) {
    return (await this.listAdminSchedules({ seasonId })).schedules;
  }

  async listSchedulesForReferee(refereeId) {
    const normalizedRefereeId = toNullableInt(refereeId);
    if (!normalizedRefereeId || normalizedRefereeId <= 0) {
      throw createBusinessError('缺少有效裁判 ID，无法查询执法列表', {
        code: 'REFEREE_ID_REQUIRED'
      });
    }

    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        `SELECT
           s.*, ${signupService.validCount} AS signup_count,
         DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d %H:%i:%s') AS delete_checked_at,
           se.season_code,
           se.season_name,
           se.is_active AS season_is_active,
           mr.id AS report_id,
           CASE WHEN mr.id IS NULL THEN 0 ELSE 1 END AS report_exists,
           mr.home_score,
           mr.away_score,
           mr.main_report_status AS report_main_status,
           mr.supervisor_review_status AS report_supervisor_status,
           mr.main_report_started_at,
           mr.supervisor_review_started_at,
           mr.main_report_submitted_at,
           mr.supervisor_review_submitted_at,
           COALESCE(s.main_referee_name_snapshot, main_ref.name) AS main_referee_name,
           COALESCE(s.assistant1_name_snapshot, assistant1_ref.name) AS assistant1_name,
           COALESCE(s.assistant2_name_snapshot, assistant2_ref.name) AS assistant2_name,
           COALESCE(s.fourth_official_name_snapshot, fourth_ref.name) AS fourth_official_name,
           COALESCE(s.supervisor_name_snapshot, supervisor_ref.name) AS supervisor_name,
           CASE
             WHEN s.main_referee_id = ? THEN '裁判员'
             WHEN s.assistant1_id = ? THEN '第一助理裁判员'
             WHEN s.assistant2_id = ? THEN '第二助理裁判员'
             WHEN s.fourth_official_id = ? THEN '第四官员'
             WHEN s.supervisor_id = ? THEN '裁判监督'
             ELSE NULL
           END AS my_role,
           CASE
             WHEN s.main_referee_id = ? THEN 'main'
             WHEN s.assistant1_id = ? THEN 'assistant1'
             WHEN s.assistant2_id = ? THEN 'assistant2'
             WHEN s.fourth_official_id = ? THEN 'fourth'
             WHEN s.supervisor_id = ? THEN 'supervisor'
             ELSE NULL
           END AS my_role_code,
           CASE
             WHEN s.main_referee_id = ? THEN 'main_referee_id'
             WHEN s.assistant1_id = ? THEN 'assistant1_id'
             WHEN s.assistant2_id = ? THEN 'assistant2_id'
             WHEN s.fourth_official_id = ? THEN 'fourth_official_id'
             WHEN s.supervisor_id = ? THEN 'supervisor_id'
             ELSE NULL
           END AS my_role_key,
           NULL AS match_count
         FROM match_schedules s
         INNER JOIN seasons se ON se.id = s.season_id
         LEFT JOIN match_reports mr ON mr.schedule_id = s.id
         LEFT JOIN referee main_ref ON main_ref.id = s.main_referee_id
         LEFT JOIN referee assistant1_ref ON assistant1_ref.id = s.assistant1_id
         LEFT JOIN referee assistant2_ref ON assistant2_ref.id = s.assistant2_id
         LEFT JOIN referee fourth_ref ON fourth_ref.id = s.fourth_official_id
         LEFT JOIN referee supervisor_ref ON supervisor_ref.id = s.supervisor_id
         WHERE EXISTS (SELECT 1 FROM match_official_assignments mine WHERE mine.schedule_id=s.id AND mine.referee_id=? AND mine.source_type='system')
         ORDER BY se.is_active DESC, s.match_date ASC, (s.match_time IS NULL) ASC, s.match_time ASC, s.field_order_sort ASC, s.field_order ASC, s.id ASC`,
        [
          normalizedRefereeId, normalizedRefereeId, normalizedRefereeId, normalizedRefereeId, normalizedRefereeId,
          normalizedRefereeId, normalizedRefereeId, normalizedRefereeId, normalizedRefereeId, normalizedRefereeId,
          normalizedRefereeId, normalizedRefereeId, normalizedRefereeId, normalizedRefereeId, normalizedRefereeId,
          normalizedRefereeId
        ]
      );

      await officials.hydrate(connection, rows);
      return rows.map(row => {const roles=officials.ROLES.filter(role=>row.officials.some(a=>a.role===role.code&&a.source_type==='system'&&Number(a.referee_id)===normalizedRefereeId));row.my_role_codes=roles.map(r=>r.code);row.my_role_code=roles[0]?.code||null;row.my_role_key=roles[0]?.field||null;row.my_role=roles.map(r=>r.label).join('、');return this.normalizeScheduleRecord(row);});
    } finally {
      connection.release();
    }
  }

  async listStatTrendsForReferee(refereeId) {
    const normalizedRefereeId = toNullableInt(refereeId);
    if (!normalizedRefereeId || normalizedRefereeId <= 0) {
      throw createBusinessError('缺少有效裁判 ID，无法查询执法变化数据', {
        code: 'REFEREE_ID_REQUIRED'
      });
    }

    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        `SELECT
           s.id AS schedule_id,
           s.match_type,
           s.match_date,
           s.match_time, s.match_end_time,
           s.field_order,
           rs.role,
           rs.running_distance_m,
           rs.max_heart_rate,
           rs.avg_heart_rate,
           rs.sprint_count,
           rs.high_intensity_distance_m,
           rs.avg_speed_mps,
           rs.red_card_accuracy,
           rs.yellow_card_accuracy,
           rs.penalty_accuracy
         FROM match_schedules s
         INNER JOIN match_reports mr ON mr.schedule_id = s.id
         INNER JOIN match_referee_stats rs ON rs.report_id = mr.id
         INNER JOIN match_official_assignments oa ON oa.id = rs.assignment_id AND oa.referee_id = ? AND oa.source_type = 'system' AND oa.schedule_id = s.id AND oa.role = rs.role
         WHERE mr.main_report_status = 'submitted'
         ORDER BY s.match_date ASC, (s.match_time IS NULL) ASC, s.match_time ASC, s.field_order_sort ASC, s.field_order ASC, s.id ASC`,
        [normalizedRefereeId]
      );

      return rows.map(row => ({
        schedule_id: toNullableInt(row.schedule_id),
        match_type: row.match_type || null,
        match_date: row.match_date || null,
        match_time: readMatchTime(row.match_time),
        match_end_time: readMatchTime(row.match_end_time),
        field_order: toNullableString(row.field_order),
        role: row.role || null,
        running_distance_m: row.running_distance_m === null ? null : Number(row.running_distance_m),
        max_heart_rate: row.max_heart_rate === null ? null : Number(row.max_heart_rate),
        avg_heart_rate: row.avg_heart_rate === null ? null : Number(row.avg_heart_rate),
        sprint_count: row.sprint_count === null ? null : Number(row.sprint_count),
        high_intensity_distance_m: row.high_intensity_distance_m === null ? null : Number(row.high_intensity_distance_m),
        avg_speed_mps: row.avg_speed_mps === null ? null : Number(row.avg_speed_mps),
        red_card_accuracy: row.red_card_accuracy === null ? null : Number(row.red_card_accuracy),
        yellow_card_accuracy: row.yellow_card_accuracy === null ? null : Number(row.yellow_card_accuracy),
        penalty_accuracy: row.penalty_accuracy === null ? null : Number(row.penalty_accuracy)
      }));
    } finally {
      connection.release();
    }
  }

  async getScheduleById(scheduleId) {
    const connection = await pool.getConnection();
    try {
      return await this.queryScheduleDetail(connection, scheduleId);
    } finally {
      connection.release();
    }
  }

  async getScheduleDeleteState(connection, scheduleId) {
    const [[row]]=await connection.execute(`SELECT s.id,s.match_date,s.match_time, s.match_end_time,s.season_id,s.match_type,mr.id AS report_id,
      DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d %H:%i:%s') AS delete_checked_at
      FROM match_schedules s LEFT JOIN match_reports mr ON mr.schedule_id=s.id WHERE s.id=?`,[scheduleId]);
    return row||null;
  }

  buildScheduleDeleteDecision(state = {}) { return deletion.decision(state); }

  async deleteSchedule(scheduleId, expectedRevision) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const schedule=await this.getScheduleByIdForWrite(connection,scheduleId);
      if (!schedule) throw createBusinessError('赛程不存在',{statusCode:404,code:'SCHEDULE_NOT_FOUND'});
      if (expectedRevision!==undefined) checkScheduleRevision(expectedRevision,schedule.schedule_revision);
      const state=await this.getScheduleDeleteState(connection,scheduleId);
      const permission=this.buildScheduleDeleteDecision(state);
      if (!permission.can_delete) throw createBusinessError(permission.reason_message,{code:permission.reason_code,meta:permission});
      const [[competition]]=await connection.execute('SELECT id FROM season_competitions WHERE season_id=? AND league_type=? FOR UPDATE',[schedule.season_id,schedule.match_type]);
      const images=await deletion.clearReport(connection,state.report_id);
      await deletion.clearMatchSignups(connection,scheduleId);
      // Recheck the database clock at the final delete, including time spent waiting on locks.
      const [result]=await connection.execute('DELETE FROM match_schedules WHERE id=? AND TIMESTAMP(match_date,match_time)>UTC_TIMESTAMP()+INTERVAL 8 HOUR',[scheduleId]);
      if (!result.affectedRows) throw createBusinessError('已到开球时间，不能删除比赛',{code:'SCHEDULE_KICKOFF_REACHED'});
      // Future suspension projections also change when an unplayed fixture disappears.
      if (competition) await connection.execute('UPDATE season_competitions SET discipline_revision=discipline_revision+1 WHERE id=?',[competition.id]);
      await connection.commit();
      let attachmentCleanupPending=false;
      try {await deletion.clearUnreferencedImages(connection,images);} catch(error) {
        attachmentCleanupPending=true;
        safeLog('赛程已删除，报告附件清理待重试:',error,'error');
      }
      return {success:true,deleted_schedule_id:scheduleId,delete_rule:'before-kickoff-only',attachment_cleanup_pending:attachmentCleanupPending};
    } catch(error) {
      try {await connection.rollback();} catch(rollbackError) {safeLog('赛程删除回滚失败:',rollbackError,'error');}
      throw this.mapPersistenceError(error,'赛程删除失败');
    } finally {connection.release();}
  }

  async updateSchedule(scheduleId, data, viewer) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const existingSchedule = await this.getScheduleByIdForWrite(connection, scheduleId);
      if (!existingSchedule) {
        throw createBusinessError('赛程不存在', {
          statusCode: 404,
          code: 'SCHEDULE_NOT_FOUND'
        });
      }

      const { payload, activeSeason, teamMap } = await this.validateScheduleWritePayload(connection, {
        ...data,
        futsal:Object.hasOwn(data,'futsal')?data.futsal:existingSchedule.futsal,
        supervisor_required:Object.hasOwn(data,'supervisor_required')?data.supervisor_required:existingSchedule.supervisor_required,
        fourth_required:Object.hasOwn(data,'fourth_required')?data.fourth_required:existingSchedule.fourth_required,
        ...Object.fromEntries(officials.ROLES.filter(role=>!Object.hasOwn(data,role.field)).map(role=>[role.field,officials.selectionFor(existingSchedule,role)])),
        ...(!Object.hasOwn(data,'venue')?{venue:existingSchedule.venue,venue_detail:existingSchedule.venue_detail}:{}),
        match_time: Object.hasOwn(data, 'match_time') ? data.match_time : readMatchTime(existingSchedule.match_time),
        ...(!Object.hasOwn(data, 'match_time') && !Object.hasOwn(data, 'match_end_time') ? { match_end_time: readMatchTime(existingSchedule.match_end_time) } : {})
      }, {
        allowUnknownTime: existingSchedule.match_time === null,
        allowUnknownVenue: existingSchedule.venue === null,
        scheduleId,
        seasonId: existingSchedule.season_id,
        requireActiveSeason: false
      });

      const prepared = await officials.prepare(connection, existingSchedule.season_id, existingSchedule, payload, { full: true });
      Object.assign(payload, prepared.fields);
      this.validateLockedScheduleChanges(existingSchedule, payload);
      checkScheduleRevision(data.schedule_revision,existingSchedule.schedule_revision);
      const nameSnapshots = prepared.snapshots;
      await officials.persist(connection, scheduleId, prepared, viewer);
      await connection.execute('UPDATE match_schedules SET supervisor_required=?,fourth_required=? WHERE id=?',[prepared.fields.supervisor_required,prepared.fields.fourth_required,scheduleId]);

      const teamA = teamMap.get(payload.team_a_id);
      const teamB = teamMap.get(payload.team_b_id);

      if (!teamA || !teamB) {
        throw createBusinessError('主客队必须属于当前启用赛季', {
          code: 'TEAM_NOT_IN_ACTIVE_SEASON'
        });
      }

      const [result] = await connection.execute(
        `UPDATE match_schedules
         SET schedule_revision = schedule_revision + 1, match_type = ?,
             team_a_id = ?,
             team_b_id = ?,
             team_a_name_snapshot = ?,
             team_b_name_snapshot = ?,
             match_date = ?,
             match_time = ?, match_end_time = ?, venue = ?, venue_detail = ?,
             field_order = ?, field_order_sort = ?,
             main_referee_id = ?,
             assistant1_id = ?,
             assistant2_id = ?,
             fourth_official_id = ?,
             supervisor_id = ?,
             main_referee_name_snapshot = ?,
             assistant1_name_snapshot = ?,
             assistant2_name_snapshot = ?,
             fourth_official_name_snapshot = ?,
             supervisor_name_snapshot = ?
         WHERE id = ? AND season_id = ?`,
        [
          payload.match_type,
          payload.team_a_id,
          payload.team_b_id,
          teamA.team_name,
          teamB.team_name,
          payload.match_date,
          payload.match_time, payload.match_end_time, payload.venue, payload.venue_detail,
          payload.field_order, require('../utils/competitionRules').fieldOrderSortKey(payload.field_order),
          payload.main_referee_id,
          payload.assistant1_id,
          payload.assistant2_id,
          payload.fourth_official_id,
          payload.supervisor_id,
          nameSnapshots.main_referee_name_snapshot,
          nameSnapshots.assistant1_name_snapshot,
          nameSnapshots.assistant2_name_snapshot,
          nameSnapshots.fourth_official_name_snapshot,
          nameSnapshots.supervisor_name_snapshot,
          scheduleId,
          activeSeason.id
        ]
      );

      if (result.affectedRows === 0) {
        throw createBusinessError('赛程不存在', {
          statusCode: 404,
          code: 'SCHEDULE_NOT_FOUND'
        });
      }

      const updatedSchedule = await this.queryScheduleDetail(connection, scheduleId);

      if (!updatedSchedule) {
        throw createBusinessError('赛程更新后读取详情失败，请刷新后重试', {
          statusCode: 500,
          code: 'SCHEDULE_UPDATED_DETAIL_NOT_FOUND'
        });
      }

      await require('./matchRosterService').resetForScheduleChange(connection,existingSchedule,updatedSchedule);
      await connection.commit();
      return updatedSchedule;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        safeLog('赛程更新回滚失败:', rollbackError, 'error');
      }
      throw this.mapPersistenceError(error, '赛程更新失败');
    } finally {
      connection.release();
    }
  }

  async getAvailableSchedules() {
    throw createBusinessError('getAvailableSchedules 已在阶段 3-0.4 停用，请改用 /schedule 或 /schedule/type/:matchType', {
      statusCode: 410,
      code: 'SCHEDULE_AVAILABLE_DISABLED'
    });
  }
}

module.exports = new ScheduleService();
