const { readMatchTime } = require('./matchTime');

// Dates and times are China-standard wall-clock values from the database.
function kickoffTime(schedule = {}) {
  const date = schedule.match_date;
  const time = readMatchTime(schedule.match_time);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return null;
  return `${date} ${time}:00`;
}

function kickoffReached(schedule, serverTime) {
  const kickoff = kickoffTime(schedule);
  if (!kickoff || typeof serverTime !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(serverTime)) return null;
  return serverTime >= kickoff;
}

async function clearMatchSignups(connection, scheduleId) {
  // The caller holds the schedule row lock shared by signup and assignment writes.
  await connection.execute(`DELETE e FROM referee_match_signup_events e
    INNER JOIN referee_match_signups s ON s.id=e.signup_id WHERE s.schedule_id=?`, [scheduleId]);
  await connection.execute('DELETE FROM referee_match_signups WHERE schedule_id=?', [scheduleId]);
}

function decision(schedule = {}, serverTime = schedule.delete_checked_at) {
  const reached = kickoffReached(schedule, serverTime);
  const kickoff = kickoffTime(schedule);
  const code = !schedule.id ? 'SCHEDULE_NOT_FOUND' : !kickoff ? 'SCHEDULE_KICKOFF_UNSET' : reached === null ? 'SCHEDULE_CLOCK_UNAVAILABLE' : reached ? 'SCHEDULE_KICKOFF_REACHED' : null;
  const messages = {SCHEDULE_NOT_FOUND:'赛程不存在',SCHEDULE_KICKOFF_UNSET:'请先补齐开球时间，再判断是否可以删除',SCHEDULE_CLOCK_UNAVAILABLE:'无法确认服务器时间，请刷新后重试',SCHEDULE_KICKOFF_REACHED:'已到开球时间，不能删除比赛'};
  return {can_delete:!code,rule:'before-kickoff-only',reason_code:code,reason_message:messages[code]||null,
    kickoff_at:kickoff?kickoff.replace(' ','T')+'+08:00':null,
    checked_at:serverTime?serverTime.replace(' ','T')+'+08:00':null};
}

async function clearReport(connection, reportId) {
  if (!reportId) return [];
  const [paths] = await connection.execute(`SELECT fourth_official_image_path AS path FROM match_reports WHERE id=?
    UNION SELECT JSON_UNQUOTE(JSON_EXTRACT(before_snapshot,'$.data.fourth_official_image_path')) FROM report_section_history WHERE report_id=?
    UNION SELECT JSON_UNQUOTE(JSON_EXTRACT(after_snapshot,'$.data.fourth_official_image_path')) FROM report_section_history WHERE report_id=?`,[reportId,reportId,reportId]);
  // Explicit ordering preserves the existing RESTRICT keys for all other workflows.
  for (const table of ['competition_discipline_events','match_publications','report_actor_events','report_section_states','report_section_history','match_referee_stats','match_referee_reviews','match_cards','match_goals']) {
    await connection.execute(`DELETE FROM ${table} WHERE report_id=?`,[reportId]);
  }
  await connection.execute('DELETE FROM match_reports WHERE id=?',[reportId]);
  return [...new Set(paths.map(row=>row.path).filter(p=>typeof p==='string'&&/^\/uploads\/reports\/[^/\\]+\.(?:png|jpe?g)$/i.test(p)))];
}

async function clearUnreferencedImages(connection, paths) {
  // Run only after commit: rollback must never remove a report's live attachments.
  for (const file of paths) {
    const [[row]]=await connection.execute(`SELECT
      (SELECT COUNT(*) FROM match_reports WHERE fourth_official_image_path=?) +
      (SELECT COUNT(*) FROM report_section_history WHERE JSON_UNQUOTE(JSON_EXTRACT(before_snapshot,'$.data.fourth_official_image_path'))=? OR JSON_UNQUOTE(JSON_EXTRACT(after_snapshot,'$.data.fourth_official_image_path'))=?) AS n`,[file,file,file]);
    if (!Number(row.n)) await require('./reportUpload').removeManagedReportUpload(file);
  }
}

module.exports = { kickoffTime, kickoffReached, decision, clearMatchSignups, clearReport, clearUnreferencedImages };
