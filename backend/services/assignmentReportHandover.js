const history = require('../utils/reportHistory');
const { createBusinessError } = require('../utils/scheduleValidator');

// Called under the schedule/report locks, in the same transaction as the assignment.
async function begin(c, scheduleId, prepared, viewer) {
  if (!prepared.changed || !prepared.existing.id) return null;
  const [[report]] = await c.execute('SELECT * FROM match_reports WHERE schedule_id=? FOR UPDATE', [scheduleId]);
  if (!report) return null;
  if (!report.main_report_started_at && !report.supervisor_review_started_at &&
      report.main_report_status === 'draft' && report.supervisor_review_status === 'draft') {
    const [[content]] = await c.execute(`SELECT
      EXISTS(SELECT 1 FROM match_referee_stats WHERE report_id=?) OR
      EXISTS(SELECT 1 FROM match_referee_reviews WHERE report_id=?) OR
      EXISTS(SELECT 1 FROM report_section_history WHERE report_id=?) OR
      EXISTS(SELECT 1 FROM report_actor_events WHERE report_id=?) AS present`,[report.id,report.id,report.id,report.id]);
    if (!content.present) return null;
  }
  if (viewer?.role !== 'admin') throw createBusinessError('更改报告选派需要管理员身份', {statusCode:403});
  // Also cover events written by an older application during a rolling upgrade.
  await c.execute(`UPDATE report_actor_events e JOIN match_official_assignments a ON a.id=e.owner_assignment_id
    SET e.owner_assignment_snapshot=JSON_OBJECT('id',a.id,'role',a.role,'source_type',a.source_type,
    'referee_id',a.referee_id,'external_referee_id',a.external_referee_id,'name_snapshot',a.name_snapshot)
    WHERE e.report_id=? AND e.owner_assignment_snapshot IS NULL`,[report.id]);
  const sections = {};
  for (const section of ['main','supervisor']) {
    sections[section] = { state: await history.readSectionState(c,report.id,section,true),
      before: await history.captureSnapshot(c,report.id,section) };
  }
  const roles = prepared.changedRoles;
  if (prepared.formatChanged) {
    await c.execute('DELETE FROM match_referee_stats WHERE report_id=?',[report.id]);
  } else if (roles.length) {
    await c.execute(`DELETE FROM match_referee_stats WHERE report_id=? AND role IN (${roles.map(()=>'?')})`,[report.id,...roles]);
  }
  if (prepared.formatChanged || roles.includes('supervisor')) {
    await c.execute('DELETE FROM match_referee_reviews WHERE report_id=?',[report.id]);
  } else if (roles.length) {
    await c.execute(`DELETE FROM match_referee_reviews WHERE report_id=? AND target_role IN (${roles.map(()=>'?')})`,[report.id,...roles]);
  }
  const mainAffected = prepared.formatChanged || roles.some(r=>r!=='supervisor') ||
    Boolean(prepared.fields.fourth_required) !== (prepared.existing.fourth_required !== false && prepared.existing.fourth_required !== 0);
  return { report, sections, mainAffected, viewer };
}

async function finish(c, handover) {
  if (!handover) return;
  const { report, sections, mainAffected, viewer } = handover;
  for (const section of ['main','supervisor']) {
    const prefix = history.sectionPrefix(section);
    const returned = (section === 'supervisor' || mainAffected) && report[prefix+'_status'] === 'submitted';
    if (returned) await c.execute(`UPDATE match_reports SET ${prefix}_status='returned',${prefix}_started_at=COALESCE(${prefix}_started_at,NOW()) WHERE id=?`,[report.id]);
    await history.appendHistory(c,{reportId:report.id,section,...sections[section],
      after:await history.captureSnapshot(c,report.id,section),operation:returned?'return':'reassign',
      sourceType:'admin_assignment',viewer,reason:'管理员调整裁判选派；原岗位数据已保留在历史中，请核对并补填受影响内容'});
  }
}
module.exports = { begin, finish };
