const { ROLES, parseSelection } = require('../utils/officialAssignments');
const { readMatchTime, displayMatchTime } = require('../utils/matchTime');

function overlaps(a, b) {
  const startA = readMatchTime(a.match_time), startB = readMatchTime(b.match_time);
  if (!startA || !startB) return false;
  const endA = readMatchTime(a.match_end_time), endB = readMatchTime(b.match_end_time);
  return endA && endB ? startA < endB && startB < endA : startA === startB;
}
async function warnings(c, schedule, selections) {
  if (!readMatchTime(schedule.match_time)) return [];
  const keys = [...new Set(ROLES.map(r=>parseSelection(selections[r.field],r.code)?.key).filter(Boolean))];
  if (!keys.length) return [];
  const [rows] = await c.execute(`SELECT a.source_type,a.referee_id,a.external_referee_id,a.name_snapshot,a.role,
    s.id schedule_id,s.match_type,s.field_order,s.team_a_name_snapshot,s.team_b_name_snapshot,
    s.match_time,s.match_end_time FROM match_official_assignments a JOIN match_schedules s ON s.id=a.schedule_id
    WHERE s.match_date=? AND s.id<>? AND CONCAT(a.source_type,':',COALESCE(a.referee_id,a.external_referee_id)) IN (${keys.map(()=>'?')})
    ORDER BY s.match_time,s.id,a.id`,[schedule.match_date,schedule.id,...keys]);
  return rows.filter(row=>overlaps(schedule,row)).map(row=>{
    const role = ROLES.find(r=>r.code===row.role)?.label || row.role;
    const match = `${row.match_type} · 场序 ${row.field_order} · ${row.team_a_name_snapshot} VS ${row.team_b_name_snapshot}`;
    return {schedule_id:row.schedule_id,source_type:row.source_type,referee_id:row.referee_id,
      external_referee_id:row.external_referee_id,role:row.role,
      message:`${row.name_snapshot}裁判员同时已经在${match}比赛中担任${role}（${displayMatchTime(row.match_time,row.match_end_time)}）`};
  });
}
module.exports = { overlaps, warnings };
