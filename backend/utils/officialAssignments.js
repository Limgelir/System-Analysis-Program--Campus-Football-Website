const { createBusinessError } = require('./scheduleValidator');
const ROLES = Object.freeze([
  { code: 'main', field: 'main_referee_id', name: 'main_referee_name', label: '裁判员' },
  { code: 'assistant1', field: 'assistant1_id', name: 'assistant1_name', label: '第一助理裁判员' },
  { code: 'assistant2', field: 'assistant2_id', name: 'assistant2_name', label: '第二助理裁判员' },
  { code: 'fourth', field: 'fourth_official_id', name: 'fourth_official_name', label: '第四官员' },
  { code: 'second', field: 'second_referee_id', name: 'second_referee_name', label: '第二裁判员' },
  { code: 'timekeeper', field: 'timekeeper_id', name: 'timekeeper_name', label: '计时员' },
  { code: 'supervisor', field: 'supervisor_id', name: 'supervisor_name', label: '裁判监督' }
]);
// 显式 source:id 与旧正整数 ID 均支持，外部 ID 不可能被解析成登录账号 ID。
function parseSelection(value, role) {
  if (value === null || value === undefined || value === '') return null;
  if (!['number', 'string'].includes(typeof value)) throw createBusinessError('选派必须是裁判编号', { code: 'OFFICIAL_INVALID' });
  const match = /^(?:(system|external):)?([1-9]\d*)$/.exec(String(value));
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw createBusinessError('裁判编号必须是正整数或 source:id', { code: 'OFFICIAL_INVALID' });
  const source = match[1] || 'system';
  return { source_type: source, id: Number(match[2]), key: `${source}:${Number(match[2])}` };
}
function selectionFor(schedule, role) {
  const a = schedule?.officials?.find(item => item.role === role.code);
  return a ? `${a.source_type}:${a.referee_id || a.external_referee_id}` : (schedule?.[role.field] ? `system:${schedule[role.field]}` : null);
}
async function hydrate(c, schedules) {
  if (!schedules.length) return schedules;
  const [rows] = await c.query(`SELECT * FROM match_official_assignments WHERE schedule_id IN (${schedules.map(() => '?').join(',')}) ORDER BY id`, schedules.map(s => s.id));
  for (const s of schedules) {
    s.officials = rows.filter(row => Number(row.schedule_id) === Number(s.id));
    for (const role of ROLES) {
      const a = s.officials.find(row => row.role === role.code);
      s[`${role.field}_selection`] = a ? `${a.source_type}:${a.referee_id || a.external_referee_id}` : null;
      s[`${role.code}_source_type`] = a?.source_type || null;
      if (a) {
        s[role.field] = a.referee_id;
        s[role.name] = a.name_snapshot;
        s[`${role.name}_snapshot`] = a.name_snapshot;
      }
    }
  }
  return schedules;
}
async function prepare(c, seasonId, existing, data, { full = false } = {}) {
  const supervision=require('./supervisionRules');
  const supervisorRequired=supervision.normalize(data.supervisor_required,existing.supervisor_required);
  const requirements=require('./officialRequirements');
  const futsal=requirements.normalizeFutsal(data.futsal,existing.futsal);
  const formatChanged=Boolean(existing.id)&&futsal!==requirements.isFutsal(existing);
  if(formatChanged&&data.confirm_format_change!==true)throw createBusinessError('切换安排类型将清空不适用的选派和报名意向，意向全部失效者自动撤回，请确认后保存',{statusCode:409,code:'FORMAT_CHANGE_CONFIRMATION_REQUIRED'});
  const requestedFourth=requirements.normalizeFourth(data.fourth_required,existing.fourth_required);
  const fourthRequired=futsal?false:requestedFourth;
  const next = [], previous = existing.officials || [];
  const fields = {futsal:futsal?1:0,supervisor_required:supervisorRequired?1:0,fourth_required:fourthRequired?1:0}, snapshots = {}, changedRoles=[];
  let changed = formatChanged || supervisorRequired!==supervision.required(existing.supervisor_required)||fourthRequired!==requirements.required(existing.fourth_required);
  for (const role of ROLES) {
    const provided = Object.hasOwn(data, role.field);
    if(role.code==='supervisor'&&!supervisorRequired&&provided&&data[role.field])throw createBusinessError('不需要裁判监督的比赛不能同时选派裁判监督');
    if(!formatChanged&&!requirements.roleRequired(fields,role.code)&&provided&&data[role.field]&&role.code!=='supervisor')throw createBusinessError('本场不需要'+role.label+'，不能选派该岗位');
    if(!formatChanged&&role.code==='fourth'&&!fourthRequired&&provided&&data[role.field])throw createBusinessError('不需要第四官员的比赛不能同时选派第四官员');
    const selected = !requirements.roleRequired(fields,role.code)?null:parseSelection(provided ? data[role.field] : (full ? null : selectionFor(existing, role)), role.code);
    const prior = previous.find(item => item.role === role.code);
    const same = (selected?.key || null) === selectionFor(existing, role);
    if (!same) {
      changed = true;
      changedRoles.push(role.code);
    }
    let person = null;
    if (selected && same && prior) person = { ...prior };
    else if (selected?.source_type === 'system') {
      const [[row]] = await c.execute(`SELECT r.id, rsr.name_snapshot FROM referee r
        JOIN referee_season_registrations rsr ON rsr.referee_id = r.id
        WHERE r.id = ? AND r.is_active = 1 AND rsr.season_id = ? AND rsr.status = 'approved' FOR SHARE`, [selected.id, seasonId]);
      if (!row) throw createBusinessError(`${role.label}未通过该赛季审核、已停用或不存在`, { statusCode: 409, code: 'REFEREE_NOT_ELIGIBLE_FOR_SEASON' });
      person = { role: role.code, source_type: 'system', referee_id: row.id, external_referee_id: null, name_snapshot: row.name_snapshot };
    } else if (selected) {
      const [[row]] = await c.execute('SELECT id, name FROM external_referees WHERE id = ? AND is_active = 1 FOR SHARE', [selected.id]);
      if (!row) throw createBusinessError(`${role.label}的非系统裁判不存在或已停用`, { statusCode: 409, code: 'EXTERNAL_REFEREE_UNAVAILABLE' });
      person = { role: role.code, source_type: 'external', referee_id: null, external_referee_id: row.id, name_snapshot: row.name };
    }
    fields[role.field] = person?.referee_id || null;
    snapshots[`${role.name}_snapshot`] = person?.name_snapshot || null;
    if (person) next.push(person);
  }
  const identities = new Map(), names = new Set();
  let duplicateName = false;
  for (const a of next) {
    const key = `${a.source_type}:${a.referee_id || a.external_referee_id}`;
    if (identities.has(key)) {
      if(a.role==='supervisor'||(a.role==='fourth'&&identities.get(key)==='main'))continue;
      throw createBusinessError('除裁判员兼任第四官员外，场上裁判岗位不能重复指派同一人', { code: 'REFEREE_DUPLICATE_ASSIGNMENT' });
    }
    identities.set(key,a.role);
    const name = a.name_snapshot.normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase();
    if (names.has(name)) duplicateName = true;
    names.add(name);
  }
  if (changed && duplicateName && data.confirm_distinct_people !== true) {
    throw createBusinessError('选派中存在同名记录，请核对来源及编号，确认是不同人后再保存', { statusCode: 409, code: 'OFFICIAL_SAME_NAME_CONFIRMATION_REQUIRED' });
  }
  return { next, fields, snapshots, changed, changedRoles, formatChanged, existing };
}
async function persist(c, scheduleId, prepared, viewer) {
  const handover = await require('../services/assignmentReportHandover').begin(c,scheduleId,prepared,viewer);
  const values={...prepared.fields,...prepared.snapshots};
  await c.execute('UPDATE match_schedules SET '+Object.keys(values).map(k=>k+'=?').join(',')+' WHERE id=?',[...Object.values(values),scheduleId]);
  if(prepared.formatChanged)await require('../services/matchSignupService').reconcileFormat(c,scheduleId,prepared.existing,prepared.fields);
  if (!prepared.changed) return;
  // 只替换变化的岗位；原个人数据和操作人身份已保存到历史快照。
  for(const role of prepared.changedRoles)await c.execute('DELETE FROM match_official_assignments WHERE schedule_id=? AND role=?',[scheduleId,role]);
  for (const a of prepared.next.filter(a=>prepared.changedRoles.includes(a.role))) {
    await c.execute(`INSERT INTO match_official_assignments (schedule_id,role,source_type,referee_id,external_referee_id,name_snapshot)
      VALUES (?,?,?,?,?,?)`, [scheduleId,a.role,a.source_type,a.referee_id,a.external_referee_id,a.name_snapshot]);
  }
  await require('../services/assignmentReportHandover').finish(c,handover);
}
module.exports = { ROLES, parseSelection, selectionFor, hydrate, prepare, persist };
