const q = require('./listQuery');
const { ROLES } = require('./officialAssignments');
const { isFutsal, required, roleRequired } = require('./officialRequirements');
const { displayMatchTime } = require('./matchTime');
const { displayVenue } = require('./matchVenue');

function dayFilters(options = {}) {
  const seasonId = q.integer(options.season_id, undefined, Number.MAX_SAFE_INTEGER, '赛季');
  const matchType = q.text(options.match_type, '比赛类型', 50);
  const date = q.date(options.match_date, '比赛日');
  if (!seasonId || !matchType || !date) throw q.invalid('请选择赛季、比赛类型和比赛日');
  // Only this exact day/type/season is exported. Board visibility, pagination,
  // report status and whether a position has been filled must not hide matches.
  return { seasonId, matchType, date_from: date, date_to: date, exporting: true };
}

function assignmentDayTable(schedules) {
  const normal = schedules.some(s => !isFutsal(s));
  const futsal = schedules.some(isFutsal);
  const roles = ROLES.filter(r => ['main', 'supervisor'].includes(r.code)
    || (['second', 'timekeeper'].includes(r.code) ? futsal : normal));
  const headers = ['赛季', '比赛类型', '日期', '比赛时间', '场序', '场地', '主队', '客队', ...roles.map(r => r.label)];
  const rows = schedules.map(s => [s.season_name || s.season_code, s.match_type, s.match_date,
    displayMatchTime(s.match_time, s.match_end_time) || '时间待定', s.field_order, displayVenue(s),
    s.team_a_name_snapshot, s.team_b_name_snapshot, ...roles.map(r => {
      if (r.code === 'supervisor' && !required(s.supervisor_required)) return '无需监督';
      if (r.code === 'fourth' && !isFutsal(s) && !required(s.fourth_required)) return '无需第四官员';
      if (!roleRequired(s, r.code)) return '不适用';
      return s.officials?.find(a => a.role === r.code)?.name_snapshot || '未选派';
    })]);
  return { headers, rows };
}
module.exports = { dayFilters, assignmentDayTable };
