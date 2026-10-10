const SCHEDULE_ROLE_FIELDS = Object.freeze([
  'main_referee_id',
  'assistant1_id',
  'assistant2_id',
  'fourth_official_id',
  'supervisor_id'
]);

const { competitionName, fieldOrder } = require('./competitionRules');

const SCHEDULE_ROLE_LABELS = Object.freeze({
  main_referee_id: '裁判员',
  assistant1_id: '第一助理裁判员',
  assistant2_id: '第二助理裁判员',
  fourth_official_id: '第四官员',
  supervisor_id: '裁判监督'
});

class ScheduleBusinessError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ScheduleBusinessError';
    this.statusCode = options.statusCode || 400;
    this.code = options.code || 'SCHEDULE_VALIDATION_FAILED';
    this.isBusinessError = true;
  }
}

function createBusinessError(message, options = {}) {
  return new ScheduleBusinessError(message, options);
}

function isBusinessError(error) {
  return Boolean(error && error.isBusinessError);
}

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

function normalizeScheduleMutationPayload(data = {}) {
  const payload = {
    match_type: toNullableString(data.match_type),
    schedule_revision: data.schedule_revision,
    ...(Object.hasOwn(data,'fourth_required')?{fourth_required:require('./officialRequirements').normalizeFourth(data.fourth_required)}:{}),
    ...(Object.hasOwn(data,'supervisor_required')?{supervisor_required:require('./supervisionRules').normalize(data.supervisor_required)}:{}),
    ...(Object.hasOwn(data,'venue')?{venue:data.venue,venue_detail:data.venue_detail}:{}),
    team_a_id: toNullableInt(data.team_a_id),
    team_b_id: toNullableInt(data.team_b_id),
    match_date: toNullableString(data.match_date),
    ...(Object.hasOwn(data, 'match_time') ? { match_time: data.match_time } : {}),
    field_order: fieldOrder(data.field_order),
    main_referee_id: toNullableInt(data.main_referee_id),
    assistant1_id: toNullableInt(data.assistant1_id),
    assistant2_id: toNullableInt(data.assistant2_id),
    fourth_official_id: toNullableInt(data.fourth_official_id),
    supervisor_id: toNullableInt(data.supervisor_id),
    legacy_team_a_name: toNullableString(data.team_a_name),
    legacy_team_b_name: toNullableString(data.team_b_name)
  };
  const { ROLES, parseSelection } = require('./officialAssignments');
  for (const role of ROLES) {
    const selected = parseSelection(data[role.field], role.code);
    payload[role.field] = selected ? (selected.source_type === 'system' ? selected.id : selected.key) : null;
  }
  payload.confirm_distinct_people = data.confirm_distinct_people === true;
  return payload;
}

function collectAssignedReferees(payload = {}) {
  return SCHEDULE_ROLE_FIELDS
    .map(field => ({ field, label: SCHEDULE_ROLE_LABELS[field], refereeId: payload[field] }))
    .filter(item => Number.isInteger(item.refereeId) && item.refereeId > 0);
}

function validateScheduleMutationPayload(data = {}, { allowUnknownTime = false, allowUnknownVenue = false } = {}) {
  const payload = normalizeScheduleMutationPayload(data);

  if (!payload.match_type) {
    throw createBusinessError('缺少必要参数：match_type', {
      code: 'MATCH_TYPE_REQUIRED'
    });
  }

  payload.match_type = competitionName(payload.match_type);

  if (!payload.team_a_id || !payload.team_b_id) {
    throw createBusinessError('缺少必要参数：team_a_id 或 team_b_id', {
      code: 'TEAM_REQUIRED'
    });
  }

  if (!payload.match_date) {
    throw createBusinessError('缺少必要参数：match_date', {
      code: 'MATCH_DATE_REQUIRED'
    });
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(payload.match_date);
  if (!dateMatch) {
    throw createBusinessError('match_date 格式必须为 YYYY-MM-DD', {
      code: 'MATCH_DATE_INVALID'
    });
  }
  const [, year, month, day] = dateMatch.map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw createBusinessError('match_date 不是有效日期', {
      code: 'MATCH_DATE_INVALID'
    });
  }

  Object.assign(payload,require('./matchVenue').validateVenue(payload,{allowUnknown:allowUnknownVenue}));
  const time = payload.match_time;
  if (time === undefined || time === null || time === '') {
    if (!allowUnknownTime) throw createBusinessError('请填写开球时间（24小时制 HH:mm）', { code: 'MATCH_TIME_REQUIRED' });
    payload.match_time = null;
  } else if (typeof time !== 'string' || time.length !== 5 || !require('./matchTime').MINUTE_TIME.test(time)) {
    throw createBusinessError('开球时间必须为24小时制 HH:mm（00:00—23:59）', { code: 'MATCH_TIME_INVALID' });
  }

  if (!payload.field_order) {
    throw createBusinessError('场序须为1—50个字符，不能只含空格或控制字符', {
      code: 'FIELD_ORDER_INVALID'
    });
  }

  if (payload.team_a_id === payload.team_b_id) {
    throw createBusinessError('主客队不能相同', {
      code: 'TEAM_DUPLICATE'
    });
  }

  const assignedReferees = collectAssignedReferees(payload);
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

  return payload;
}

module.exports = {
  SCHEDULE_ROLE_FIELDS,
  SCHEDULE_ROLE_LABELS,
  ScheduleBusinessError,
  createBusinessError,
  isBusinessError,
  toNullableInt,
  normalizeScheduleMutationPayload,
  validateScheduleMutationPayload,
  collectAssignedReferees
};
