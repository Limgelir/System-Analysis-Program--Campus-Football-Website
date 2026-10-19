import api from './http'
import { replacementDescription, replacementNotice } from '../utils/scheduleReplacement.js'

// 裁判 API
export const refereeAPI = {
  register(data) {
    if (data instanceof FormData) {
      return api.post('/referee/register', data, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
    }
    return api.post('/referee/register', data)
  },
  login(data) {
    return api.post('/referee/login', data)
  },
  getInfo(id) {
    return api.get(`/referee/${id}`)
  },
  getAllReferees() {
    return api.get('/referee/all')
  },
  updatePassword(id, data) {
    return api.put(`/referee/${id}/password`, data)
  },
  updateShanghaiFaRegistration(id, data) {
    return api.put(`/referee/${id}/shanghai-fa-registration`, data)
  },
  updateGrade(id, data) {
    return api.put(`/referee/${id}/grade`, data)
  },
  updateCollege(id, data) {
    return api.put(`/referee/${id}/college`, data)
  }
}

// 赛季 API（阶段 2）
export const seasonAPI = {
  getCurrentSeason() {
    return api.get('/season/current')
  },
  getAllSeasons() {
    return api.get('/season')
  },
  createSeason(data) {
    return api.post('/season', data)
  },
  activateSeason(id) {
    return api.put(`/season/${id}/activate`)
  },
  deactivateSeason(id) {
    return api.put(`/season/${id}/deactivate`)
  }
}

function postMultipart(url, data, extraHeaders = {}) {
  return api.post(url, data, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...extraHeaders
    }
  })
}

export const SCHEDULE_CONTRACT_VERSION = 'schedule-signup-v1'

export const SCHEDULE_MUTATION_FIELDS = Object.freeze([
  'match_type',
  'team_a_id',
  'team_b_id',
  'match_date',
  'match_time', 'match_end_time', 'venue', 'venue_detail', 'schedule_revision', 'supervisor_required', 'fourth_required', 'futsal', 'confirm_format_change',
  'field_order',
  'main_referee_id',
  'assistant1_id',
  'assistant2_id',
  'fourth_official_id',
  'second_referee_id', 'timekeeper_id',
  'supervisor_id'
])

export const SCHEDULE_PHASE3_SEALED = true

export const SCHEDULE_ROLE_FIELDS = Object.freeze([
  'main_referee_id',
  'assistant1_id',
  'assistant2_id',
  'fourth_official_id',
  'second_referee_id', 'timekeeper_id',
  'supervisor_id'
])

export const SCHEDULE_RESPONSE_FIELDS = Object.freeze([
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
  'second_referee_id', 'timekeeper_id',
  'supervisor_id',
  'supervisor_required',
  'supervisor_locked', 'fourth_required', 'field_locked',
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
])

function toNullableInt(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null
  }

  const normalized = String(value).trim()
  if (!/^-?\d+$/.test(normalized)) {
    return null
  }

  const parsed = Number.parseInt(normalized, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function toNullableString(value) {
  if (value === null || value === undefined) {
    return null
  }

  const normalized = String(value).trim()
  return normalized || null
}


export function buildScheduleScoreDisplay(record = {}) {
  const report = record.report || {}
  const mainReportStarted = Boolean(
    report.main_report_started_at ||
    report.main_report_submitted_at ||
    record.main_report_started_at ||
    record.main_report_submitted_at ||
    report.main_report_status === 'submitted' ||
    record.report_main_status === 'submitted'
  )

  if (!mainReportStarted) {
    return '-'
  }

  const homeScore = toNullableInt(report.home_score ?? record.home_score)
  const awayScore = toNullableInt(report.away_score ?? record.away_score)

  if (homeScore === null || awayScore === null) {
    return '-'
  }

  return `${homeScore}-${awayScore}`
}


export function buildScheduleHasReportData(record = {}) {
  const report = record.report || {}

  const startedMarkers = [
    report.main_report_started_at,
    report.supervisor_review_started_at,
    report.main_report_submitted_at,
    report.supervisor_review_submitted_at,
    record.main_report_started_at,
    record.supervisor_review_started_at,
    record.main_report_submitted_at,
    record.supervisor_review_submitted_at
  ]

  if (startedMarkers.some(Boolean)) {
    return true
  }

  const statusValues = [
    toNullableString(report.main_report_status ?? record.report_main_status),
    toNullableString(report.supervisor_review_status ?? report.supervisor_review_state ?? record.report_supervisor_status)
  ]

  if (
    statusValues.some(status => (
      status &&
      !['draft', 'pending', 'not_started', 'unstarted', 'empty'].includes(status.toLowerCase())
    ))
  ) {
    return true
  }

  const scoreFields = [
    record.home_score,
    record.away_score,
    record.home_penalty_score,
    record.away_penalty_score,
    report.home_score,
    report.away_score,
    report.home_penalty_score,
    report.away_penalty_score
  ]

  // 只有当存在分值且不全为 0，或者虽然为 0 但报告已标记开始/提交时，才视为有数据
  if (scoreFields.some(value => value !== null && value !== undefined && value !== '' && Number(value) !== 0)) {
    return true
  }

  if (toNullableString(record.fourth_official_image_path || report.fourth_official_image_path)) {
    return true
  }

  return false
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value > 0
  }
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'y'].includes(value.toLowerCase())
  }
  return false
}

export function buildSchedulePayload(data = {}) {
  return {
    match_type: toNullableString(data.match_type),
    team_a_id: toNullableInt(data.team_a_id),
    team_b_id: toNullableInt(data.team_b_id),
    match_date: toNullableString(data.match_date),
    ...(Object.hasOwn(data, 'match_time') ? { match_time: data.match_time || null } : {}),
    ...(Object.hasOwn(data, 'match_end_time') ? { match_end_time: data.match_end_time || null } : {}),
    ...(Object.hasOwn(data,'venue')?{venue:data.venue||null,venue_detail:data.venue_detail||null}:{}),
    schedule_revision:data.schedule_revision,
    ...(Object.hasOwn(data,'futsal')?{futsal:data.futsal}:{}),
    confirm_format_change:data.confirm_format_change===true,
    field_order: toNullableString(data.field_order),
    ...Object.fromEntries(SCHEDULE_ROLE_FIELDS.filter(field=>Object.hasOwn(data,field)).map(field=>[field,toOfficialSelection(data[field])])),
    ...(Object.hasOwn(data, 'fourth_required') ? {fourth_required:data.fourth_required} : {}),
    ...(Object.hasOwn(data, 'supervisor_required') ? {supervisor_required:data.supervisor_required} : {}),
    confirm_distinct_people: data.confirm_distinct_people === true
  }
}


export function buildScheduleAssignmentPayload(data = {}) {
  return { schedule_revision:data.schedule_revision,...(Object.hasOwn(data,'futsal')?{futsal:data.futsal}:{}),confirm_format_change:data.confirm_format_change===true,...(Object.hasOwn(data,'fourth_required')?{fourth_required:data.fourth_required}:{}),...(Object.hasOwn(data,'supervisor_required')?{supervisor_required:data.supervisor_required}:{}), ...Object.fromEntries(SCHEDULE_ROLE_FIELDS.filter(field => Object.hasOwn(data,field)).map(field => [field,toOfficialSelection(data[field])])), confirm_distinct_people: data.confirm_distinct_people === true }
}

function toOfficialSelection(value) {
  if (typeof value === 'string' && /^(system|external):[1-9]\d*$/.test(value)) return value
  return toNullableInt(value)
}

async function withNameConfirmation(write, payload) {
  try { return await write(payload) } catch (error) {
    if (error?.response?.data?.code !== 'OFFICIAL_SAME_NAME_CONFIRMATION_REQUIRED' || !window.confirm(`${error.response.data.message}\n确认这些同名记录是不同的自然人吗？`)) throw error
    return write({ ...payload, confirm_distinct_people: true })
  }
}

async function createWithReplacement(data) {
  try { return await withNameConfirmation(payload => api.post('/schedule', payload), buildSchedulePayload(data)) }
  catch (error) {
    if (error.response?.data?.code !== 'SCHEDULE_REPLACEMENT_CONFIRM_REQUIRED') throw error
    const preview = error.response.data.data
    if (!window.confirm(`是否替换已有赛程？\n\n${replacementDescription(preview.rows[0])}\n\n${replacementNotice}`)) {
      throw Object.assign(new Error('已取消替换，原赛程保持不变'), { code: 'SCHEDULE_REPLACEMENT_CANCELLED' })
    }
    return api.post('/schedule/import-confirm', { preview: preview.preview, preview_token: preview.preview_token, confirm_replacements: preview.rows.map(row => row.replacement.id) })
  }
}

export const officialAPI = {
  candidates(params) { return api.get('/officials/candidates', {params}) },
  list(params) { return api.get('/officials/external', {params}) },
  create(data) { return api.post('/officials/external',data) },
  update(id,data) { return api.put(`/officials/external/${id}`,data) }
}

export function normalizeScheduleRecord(record = {}) {
  const matchCount = record.match_count === null || record.match_count === undefined
    ? null
    : Number.parseInt(record.match_count, 10)

  const pendingAssignmentRoles = Array.isArray(record.pending_assignment_roles)
    ? record.pending_assignment_roles
    : Array.isArray(record.assignment?.pending_roles)
      ? record.assignment.pending_roles
      : []

  const assignmentStatus = record.assignment?.status || record.assignment_status || (pendingAssignmentRoles.length === 0 ? 'assigned' : 'pending')
  const isAssignmentComplete = typeof record.is_assignment_complete === 'boolean'
    ? record.is_assignment_complete
    : typeof record.assignment?.is_complete === 'boolean'
      ? record.assignment.is_complete
      : pendingAssignmentRoles.length === 0

  const teamANameSnapshot = toNullableString(record.team_a_name_snapshot) || toNullableString(record.team_a_name)
  const teamBNameSnapshot = toNullableString(record.team_b_name_snapshot) || toNullableString(record.team_b_name)
  const reportId = toNullableInt(record.report_id)
  const reportExists = Boolean(reportId || record.report_exists)

  const myRole = toNullableString(record.my_role) || toNullableString(record.my_assignment?.role)
  const myRoleCode = toNullableString(record.my_role_code) || toNullableString(record.my_assignment?.role_code)
  const myRoleKey = toNullableString(record.my_role_key) || toNullableString(record.my_assignment?.role_key)

  const normalized = {
    ...record,
    id: toNullableInt(record.id),
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
    match_time: record.match_time == null ? null : String(record.match_time).slice(0, 5),
    match_end_time: record.match_end_time == null ? null : String(record.match_end_time).slice(0, 5),
    field_order: toNullableString(record.field_order),
    main_referee_id: toNullableInt(record.main_referee_id),
    main_referee_name_snapshot: toNullableString(record.main_referee_name_snapshot),
    main_referee_name: toNullableString(record.main_referee_name),
    assistant1_id: toNullableInt(record.assistant1_id),
    assistant1_name_snapshot: toNullableString(record.assistant1_name_snapshot),
    assistant1_name: toNullableString(record.assistant1_name),
    assistant2_id: toNullableInt(record.assistant2_id),
    assistant2_name_snapshot: toNullableString(record.assistant2_name_snapshot),
    assistant2_name: toNullableString(record.assistant2_name),
    fourth_official_id: toNullableInt(record.fourth_official_id),
    fourth_official_name_snapshot: toNullableString(record.fourth_official_name_snapshot),
    fourth_official_name: toNullableString(record.fourth_official_name),
    supervisor_id: toNullableInt(record.supervisor_id),
    fourth_required: record.fourth_required !== false && record.fourth_required !== 0,
    field_locked: Boolean(record.field_locked),
    supervisor_required: record.supervisor_required !== false && record.supervisor_required !== 0,
    supervisor_locked: Boolean(record.supervisor_locked),
    my_role_codes: record.my_role_codes || [],
    supervisor_name_snapshot: toNullableString(record.supervisor_name_snapshot),
    supervisor_name: toNullableString(record.supervisor_name),
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    report_id: reportId,
    report_exists: reportExists,
    has_report_data: buildScheduleHasReportData(record),
    report_main_status: toNullableString(record.report_main_status),
    report_supervisor_status: toNullableString(record.report_supervisor_status),
    home_score: toNullableInt(record.home_score ?? record.report?.home_score),
    away_score: toNullableInt(record.away_score ?? record.report?.away_score),
    main_report_started_at: record.main_report_started_at || record.report?.main_report_started_at || null,
    supervisor_review_started_at: record.supervisor_review_started_at || record.report?.supervisor_review_started_at || null,
    main_report_submitted_at: record.main_report_submitted_at || record.report?.main_report_submitted_at || null,
    supervisor_review_submitted_at: record.supervisor_review_submitted_at || record.report?.supervisor_review_submitted_at || null,
    assignment_status: assignmentStatus,
    is_assignment_complete: isAssignmentComplete,
    pending_assignment_roles: pendingAssignmentRoles,
    assignment: {
      status: assignmentStatus,
      is_complete: isAssignmentComplete,
      pending_roles: pendingAssignmentRoles
    },
    my_role: myRole,
    my_role_code: myRoleCode,
    my_role_key: myRoleKey,
    my_assignment: myRole ? {
      role: myRole,
      role_code: myRoleCode,
      role_key: myRoleKey,
      referee_id: myRoleKey ? toNullableInt(record[myRoleKey]) : null
    } : null,
    display_teams: record.display_teams || (teamANameSnapshot && teamBNameSnapshot ? `${teamANameSnapshot} vs ${teamBNameSnapshot}` : null),
    match_count: Number.isNaN(matchCount) ? null : matchCount
  }

  const referees = record.referees || {
    main_referee: {
      id: normalized.main_referee_id,
      name: normalized.main_referee_name,
      role_key: 'main_referee_id',
      role_code: 'main',
      label: '裁判员'
    },
    assistant1: {
      id: normalized.assistant1_id,
      name: normalized.assistant1_name,
      role_key: 'assistant1_id',
      role_code: 'assistant1',
      label: '助理裁判员 1'
    },
    assistant2: {
      id: normalized.assistant2_id,
      name: normalized.assistant2_name,
      role_key: 'assistant2_id',
      role_code: 'assistant2',
      label: '助理裁判员 2'
    },
    fourth_official: {
      id: normalized.fourth_official_id,
      name: normalized.fourth_official_name,
      role_key: 'fourth_official_id',
      role_code: 'fourth',
      label: '第四官员'
    },
    supervisor: {
      id: normalized.supervisor_id,
      name: normalized.supervisor_name,
      role_key: 'supervisor_id',
      role_code: 'supervisor',
      label: '裁判监督'
    }
  }

  const teams = record.teams || {
    home: {
      id: normalized.team_a_id,
      name_snapshot: normalized.team_a_name_snapshot,
      current_name: toNullableString(record.team_a_current_name) || normalized.team_a_name_snapshot,
      league_type: toNullableString(record.team_a_league_type),
      display_name: normalized.team_a_name_snapshot
    },
    away: {
      id: normalized.team_b_id,
      name_snapshot: normalized.team_b_name_snapshot,
      current_name: toNullableString(record.team_b_current_name) || normalized.team_b_name_snapshot,
      league_type: toNullableString(record.team_b_league_type),
      display_name: normalized.team_b_name_snapshot
    }
  }

  const report = record.report || {
    id: normalized.report_id,
    exists: normalized.report_exists,
    main_report_status: normalized.report_main_status,
    supervisor_review_status: normalized.report_supervisor_status,
    main_report_started_at: record.main_report_started_at || null,
    supervisor_review_started_at: record.supervisor_review_started_at || null,
    main_report_submitted_at: record.main_report_submitted_at || null,
    supervisor_review_submitted_at: record.supervisor_review_submitted_at || null,
    home_score: toNullableInt(record.home_score) || 0,
    away_score: toNullableInt(record.away_score) || 0,
    home_penalty_score: toNullableInt(record.home_penalty_score) || 0,
    away_penalty_score: toNullableInt(record.away_penalty_score) || 0,
    fourth_official_image_path: toNullableString(record.fourth_official_image_path),
    created_at: record.report_created_at || null,
    updated_at: record.report_updated_at || null
  }

  const reportEntry = record.report_entry || {
    schedule_id: normalized.id,
    report_id: normalized.report_id,
    report_exists: normalized.report_exists,
    source: 'schedule-driven'
  }

  return {
    ...normalized,
    season: record.season || {
      id: normalized.season_id,
      season_code: normalized.season_code,
      season_name: normalized.season_name,
      is_active: normalized.season_is_active
    },
    match: record.match || {
      id: normalized.id,
      match_type: normalized.match_type,
      match_date: normalized.match_date,
      match_time: normalized.match_time,
      match_end_time: normalized.match_end_time,
      field_order: normalized.field_order,
      display_teams: normalized.display_teams,
      created_at: normalized.created_at,
      updated_at: normalized.updated_at
    },
    teams,
    referees,
    report,
    report_entry: {
      schedule_id: toNullableInt(reportEntry.schedule_id) || normalized.id,
      report_id: toNullableInt(reportEntry.report_id) || normalized.report_id,
      report_exists: typeof reportEntry.report_exists === 'boolean' ? reportEntry.report_exists : normalized.report_exists,
      source: toNullableString(reportEntry.source) || 'schedule-driven'
    },
    template_prefill: record.template_prefill || {
      field_order: normalized.field_order,
      match_type: normalized.match_type,
      match_date: normalized.match_date,
      match_time: normalized.match_time,
      match_end_time: normalized.match_end_time,
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
        supervisor_name: normalized.supervisor_name
      }
    }
  }
}


export function normalizeScheduleListResponse(payload = {}) {
  let rawList = []

  if (Array.isArray(payload)) {
    rawList = payload
  } else if (payload && Array.isArray(payload.schedules)) {
    rawList = payload.schedules
  } else if (payload && Array.isArray(payload.data)) {
    rawList = payload.data
  }

  return rawList.map(item => normalizeScheduleRecord(item))
}

function getScheduleListEndpoint(matchType) {
  const normalized = toNullableString(matchType)
  return normalized ? `/schedule/type/${normalized}` : '/schedule'
}

// 队伍 API，支持当前名单与历史名单批次
export const teamAPI = {
  exportCurrentRoster(id) { return api.get(`/team/${id}/current-roster/export`, { responseType: 'blob' }) },
  getTeamsByLeague(leagueType) {
    return api.get('/team/list', { params: { league_type: leagueType } })
  },
  getAllTeams() {
    return api.get('/team/all')
  },
  getSeasonTeams(seasonId) {
    return api.get(`/team/season/${seasonId}`)
  },
  getTeamDetail(id) {
    return api.get(`/team/${id}`)
  },
  createTeam(data) {
    if (data instanceof FormData) {
      return postMultipart('/team', data)
    }
    return api.post('/team', data)
  },
  createTeamWithRoster(data) {
    return this.createTeam(data)
  },
  updateTeam(id, data) {
    return api.put(`/team/${id}`, data)
  },
  deleteTeam(id) {
    return api.delete(`/team/${id}`)
  },
  uploadRoster(teamId, data) {
    if (data instanceof FormData) {
      return postMultipart(`/team/${teamId}/roster`, data)
    }
    return api.post(`/team/${teamId}/roster`, data)
  },
  getCurrentRoster(teamId) {
    return api.get(`/team/${teamId}/current-roster`)
  },
  getRosterBatches(teamId) {
    return api.get(`/team/${teamId}/roster-batches`)
  },
  getRosterBatchPlayers(teamId, batchId) {
    return api.get(`/team/${teamId}/roster-batches/${batchId}`)
  }
}


export const reportAPI = {
  saveProxyMainReport(scheduleId,data,revision) { return api.post(`/report/admin/schedule/${scheduleId}/main`,data,reportRevisionHeaders(revision)) },
  submitProxyMainReport(scheduleId,revision) { return api.post(`/report/admin/schedule/${scheduleId}/main/submit`,{},reportRevisionHeaders(revision)) },
  uploadProxyImage(scheduleId,data,revision) { return postMultipart(`/report/admin/schedule/${scheduleId}/fourth-official-image`,data,reportRevisionHeaders(revision).headers) },
  deleteProxyImage(scheduleId,revision) { return api.delete(`/report/admin/schedule/${scheduleId}/fourth-official-image`,reportRevisionHeaders(revision)) },
  getScheduleReport(scheduleId) {
    return api.get(`/report/schedule/${scheduleId}`)
  },
  saveMainReport(scheduleId, data, revision) {
    return api.post(`/report/schedule/${scheduleId}/main`, data,reportRevisionHeaders(revision))
  },
  submitMainReport(scheduleId,revision) {
    return api.post(`/report/schedule/${scheduleId}/main/submit`,{},reportRevisionHeaders(revision))
  },
  uploadFourthOfficialImage(scheduleId, data,revision) {
    return postMultipart(`/report/schedule/${scheduleId}/fourth-official-image`, data,reportRevisionHeaders(revision).headers)
  },
  deleteFourthOfficialImage(scheduleId,revision) {
    return api.delete(`/report/schedule/${scheduleId}/fourth-official-image`,reportRevisionHeaders(revision))
  },
  saveProxySupervisorReport(scheduleId,data,revision) { return api.post(`/report/admin/schedule/${scheduleId}/supervisor`,data,reportRevisionHeaders(revision)) },
  submitProxySupervisorReport(scheduleId,revision) { return api.post(`/report/admin/schedule/${scheduleId}/supervisor/submit`,{},reportRevisionHeaders(revision)) },
  saveSupervisorReport(scheduleId, data,revision) {
    return api.post(`/report/schedule/${scheduleId}/supervisor`, data,reportRevisionHeaders(revision))
  },
  submitSupervisorReport(scheduleId,revision) {
    return api.post(`/report/schedule/${scheduleId}/supervisor/submit`,{},reportRevisionHeaders(revision))
  },
  returnSection(id,section,reason,revision) { return api.post(`/report/admin/schedule/${id}/sections/${section}/return`,{reason},reportRevisionHeaders(revision)) },
  reviseSection(id,section,data,reason,revision) { return api.post(`/report/admin/schedule/${id}/sections/${section}/revise`,{data,reason},reportRevisionHeaders(revision)) },
  reviseImage(id,data,revision) { return postMultipart(`/report/admin/schedule/${id}/revision-image`,data,reportRevisionHeaders(revision).headers) },
  removeRevisionImage(id,reason,revision) { return api.delete(`/report/admin/schedule/${id}/revision-image`,{...reportRevisionHeaders(revision),data:{reason}}) },
  getHistory(id,section,page=1) { return api.get(`/report/schedule/${id}/history/${section}`,{params:{page}}) },
  getHistoryDetail(id,entryId) { return api.get(`/report/schedule/${id}/history-entry/${entryId}`) }
}

function reportRevisionHeaders(revision) {
  return {headers:{'If-Match':String(revision)}}
}

// 赛季注册 API：账号资料与每赛季审核快照严格分离。
export const seasonRegistrationAPI = {
  exportApproved(params={}) { return api.get('/season-registration/admin/export',{params,responseType:'blob'}) },
  getCurrent() {
    return api.get('/season-registration/current')
  },
  submitCurrent(data) {
    return api.post('/season-registration/current/submit', data)
  },
  getAdminList(params = {}) {
    return api.get('/season-registration/admin', { params })
  },
  getAdminDetail(id) {
    return api.get(`/season-registration/admin/${id}`)
  },
  approve(id, reason = '') {
    return api.post(`/season-registration/admin/${id}/approve`, { reason })
  },
  reject(id, reason) {
    return api.post(`/season-registration/admin/${id}/reject`, { reason })
  },
  returnForRevision(id, reason) {
    return api.post(`/season-registration/admin/${id}/return`, { reason })
  },
  getEligible(params = {}) {
    return api.get('/season-registration/admin/eligible', { params })
  }
}

export const fileAPI = {
  getHistoryImage(id,entryId,side) { return api.get(`/files/report/${id}/history/${entryId}/${side}/image`,{responseType:'blob'}) },
  getRefereePhoto(refereeId) {
    return api.get(`/files/referee-photo/${refereeId}`, { responseType: 'blob' })
  },
  getFourthOfficialImage(scheduleId) {
    return api.get(`/files/report/${scheduleId}/fourth-official-image`, { responseType: 'blob' })
  }
}

// 管理员 API
export const adminAPI = {
  exportReferees(params={}) { return api.get('/admin/referee/export',{params,responseType:'blob'}) },
  getWorkbench(params={}) { return api.get('/schedule/workbench',{params}) },
  login(data) {
    return api.post('/admin/login', data)
  },
  updatePassword(data) {
    return api.put('/admin/password', data)
  },
  getAllReferees(params={}) {
    return api.get('/admin/referee/all',{params})
  },
  getRefereeDetail(id) {
    return api.get(`/admin/referee/${id}`)
  },
  createReferee(data) {
    if (data instanceof FormData) {
      return api.post('/admin/referee', data, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
    }
    return api.post('/admin/referee', data)
  },
  updateReferee(id, data) {
    if (data instanceof FormData) {
      return api.put(`/admin/referee/${id}`, data, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
    }
    return api.put(`/admin/referee/${id}`, data)
  },
  setRefereeActive(id, isActive) {
    return api.patch(`/admin/referee/${id}/status`, { is_active: isActive })
  },
  resetRefereePassword(id) {
    return api.post(`/admin/referee/${id}/reset-password`)
  },
  deleteReferee(id) {
    return api.delete(`/admin/referee/${id}`)
  },
  // 赛程管理：GET /schedule 返回管理员可见的全部赛程
  getScheduleContract() {
    return api.get('/schedule/contract')
  },
  createSchedule(data) {
    return createWithReplacement(data)
  },
  getSchedules() {
    return api.get('/schedule')
  },
  getSchedulesByType(matchType) {
    return api.get(`/schedule/type/${matchType}`)
  },
  getScheduleDetail(id) {
    return api.get(`/schedule/${id}`)
  },
  assignScheduleReferees(id, data) {
    return withNameConfirmation(payload => api.put(`/schedule/${id}/assign-referees`, payload), buildScheduleAssignmentPayload(data))
  },
  updateSchedule(id, data) {
    return withNameConfirmation(payload => api.put(`/schedule/${id}`, payload), buildSchedulePayload(data))
  },
  deleteSchedule(id, scheduleRevision) {
    return api.delete(`/schedule/${id}`, { data: { schedule_revision: scheduleRevision } })
  },
  // 阶段 3 兼容接口；新增页面应优先使用 getSchedules / getSchedulesByType
  getAvailableSchedules(matchType) {
    return api.get(getScheduleListEndpoint(matchType))
  }
}

// 赛程 API
export const scheduleAPI = {
  generateFourthOfficialSheet(id, template) { return api.get(`/schedule/${id}/fourth-official-sheet`, { params: { template }, responseType: 'blob' }) },
  importTemplate() { return api.get('/schedule/import-template', { responseType: 'blob' }) },
  previewImport(data) { return postMultipart('/schedule/import-preview', data) },
  confirmImport(data) { return api.post('/schedule/import-confirm', data) },
  exportFiltered(params={}) { return api.get('/schedule/export',{params,responseType:'blob'}) },
  contractVersion: SCHEDULE_CONTRACT_VERSION,
  phase3Sealed: SCHEDULE_PHASE3_SEALED,
  mutationFields: SCHEDULE_MUTATION_FIELDS,
  responseFields: SCHEDULE_RESPONSE_FIELDS,
  roleFields: SCHEDULE_ROLE_FIELDS,
  getContract() {
    return api.get('/schedule/contract')
  },
  buildPayload(data) {
    return buildSchedulePayload(data)
  },
  buildScoreDisplay(record) {
    return buildScheduleScoreDisplay(record)
  },
  buildHasReportData(record) {
    return buildScheduleHasReportData(record)
  },
  normalizeRecord(record) {
    return normalizeScheduleRecord(record)
  },
  normalizeListResponse(payload) {
    return normalizeScheduleListResponse(payload)
  },
  create(data) {
    return createWithReplacement(data)
  },
  getAll(params = {}) {
    return api.get('/schedule', { params })
  },
  getByType(matchType, params = {}) {
    return api.get(`/schedule/type/${matchType}`, { params })
  },
  getMyAssignments() {
    return api.get('/schedule/my-assignments')
  },
  getMyStatTrends() {
    return api.get('/schedule/my-stat-trends')
  },
  getDetail(id) {
    return api.get(`/schedule/${id}`)
  },
  buildAssignmentPayload(data) {
    return buildScheduleAssignmentPayload(data)
  },
  assignmentWarnings(id, data) {
    return api.post(`/schedule/${id}/assignment-warnings`, data)
  },
  assignReferees(id, data) {
    return withNameConfirmation(payload => api.put(`/schedule/${id}/assign-referees`, payload), buildScheduleAssignmentPayload(data))
  },
  update(id, data) {
    return withNameConfirmation(payload => api.put(`/schedule/${id}`, payload), buildSchedulePayload(data))
  },
  delete(id, scheduleRevision) {
    return api.delete(`/schedule/${id}`, { data: { schedule_revision: scheduleRevision } })
  },
  // 阶段 3 验收封边后仅保留兼容别名；新增页面请统一使用 getAll / getByType
}

export const matchSignupAPI = {
  board(params){return api.get('/match-signups/assignment-board',{params})},
  exportDay(params){return api.get('/match-signups/assignment-board/export',{params,responseType:'blob'})},
  membership(id){return api.get('/match-signups/memberships/'+id)},
  saveMembership(id,data){return api.put('/match-signups/memberships/'+id,data)},
  list(params){return api.get('/match-signups',{params})},
  save(id,data){return api.put('/match-signups/'+id,data)},
  adminList(id,params){return api.get('/match-signups/admin/'+id,{params})},
  history(id,signupId){return api.get('/match-signups/admin/'+id+'/'+signupId+'/history')}
}
