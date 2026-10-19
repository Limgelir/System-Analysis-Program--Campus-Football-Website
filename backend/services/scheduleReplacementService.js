const { createBusinessError: invalid } = require('../utils/scheduleValidator');
const { readMatchTime } = require('../utils/matchTime');
const { kickoffReached } = require('../utils/scheduleDeletion');

async function serverTime(c) {
  const [[row]] = await c.query("SELECT DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d %H:%i:%s') now");
  return row.now;
}
function assertReplaceable(existing, incoming, now) {
  if (kickoffReached(existing, now) !== false) throw invalid('原赛程已开赛或开始时间待定，不能替换', { code: 'SCHEDULE_REPLACEMENT_CLOSED' });
  if (kickoffReached(incoming, now) !== false) throw invalid('替换后的赛程必须尚未开赛', { code: 'SCHEDULE_REPLACEMENT_CLOSED' });
  if (require('./scheduleService').isReportStarted(existing)) throw invalid('报告已开始填写，不能替换赛程', { code: 'SCHEDULE_CORE_LOCKED' });
}
async function inspect(c, seasonId, matchType, payload, lock = false) {
  const [[existing]] = await c.execute(`SELECT s.id,s.schedule_revision,s.match_date,s.match_time,s.match_end_time,s.field_order,
    s.team_a_id,s.team_b_id,s.team_a_name_snapshot,s.team_b_name_snapshot,s.venue,s.venue_detail,s.futsal,s.fourth_required,s.supervisor_required,
    mr.main_report_started_at,mr.supervisor_review_started_at,mr.main_report_status,mr.supervisor_review_status
    FROM match_schedules s LEFT JOIN match_reports mr ON mr.schedule_id=s.id
    WHERE s.season_id=? AND s.match_type=? AND s.field_order=? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
  [seasonId, matchType, payload.field_order]);
  if (!existing) return null;
  assertReplaceable(existing, payload, await serverTime(c));
  return { ...existing, match_time: readMatchTime(existing.match_time), match_end_time: readMatchTime(existing.match_end_time) };
}
async function replace(c, seasonId, matchType, row) {
  const schedules = require('./scheduleService');
  const before = row.replacement;
  const existing = await inspect(c, seasonId, matchType, row, true);
  if (!existing || existing.id !== before.id || existing.schedule_revision !== before.schedule_revision) throw invalid('原赛程已变化，请重新预览', { statusCode: 409 });
  const { payload, teamMap } = await schedules.validateScheduleWritePayload(c, {
    ...row, match_type: matchType, futsal: Boolean(existing.futsal), fourth_required: Boolean(existing.fourth_required), supervisor_required: Boolean(existing.supervisor_required)
  }, { scheduleId: existing.id, seasonId });
  // Only schedule details change. Assignment and signup rows (including histories) are never rewritten.
  const [result] = await c.execute(`UPDATE match_schedules SET match_date=?,match_time=?,match_end_time=?,
    team_a_id=?,team_b_id=?,team_a_name_snapshot=?,team_b_name_snapshot=?,venue=?,venue_detail=?,schedule_revision=schedule_revision+1
    WHERE id=? AND schedule_revision=? AND TIMESTAMP(match_date,match_time)>UTC_TIMESTAMP()+INTERVAL 8 HOUR
    AND TIMESTAMP(?,?)>UTC_TIMESTAMP()+INTERVAL 8 HOUR`,
  [payload.match_date,payload.match_time,payload.match_end_time,payload.team_a_id,payload.team_b_id,
    teamMap.get(payload.team_a_id).team_name,teamMap.get(payload.team_b_id).team_name,payload.venue,payload.venue_detail,
    existing.id,existing.schedule_revision,payload.match_date,payload.match_time]);
  if (!result.affectedRows) throw invalid('赛程已变化或已到开赛时间，请重新预览', { statusCode: 409 });
  const updated = await schedules.queryScheduleDetail(c, existing.id);
  await require('./matchRosterService').resetForScheduleChange(c, existing, updated);
  return updated;
}
module.exports = { inspect, replace, assertReplaceable };
