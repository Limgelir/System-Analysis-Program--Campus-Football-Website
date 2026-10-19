const { createBusinessError } = require('./scheduleValidator');

function sectionPrefix(section) {
  if (!['main','supervisor'].includes(section)) throw createBusinessError('报告分区只能是裁判员区或裁判监督区');
  return section === 'main' ? 'main_report' : 'supervisor_review';
}
function requiredReason(value) {
  if (typeof value !== 'string' || !value.trim()) throw createBusinessError('请填写退回或修订原因');
  const reason = value.trim();
  if (reason.length > 500) throw createBusinessError('原因不能超过 500 字');
  return reason;
}
function checkRevision(expected, revision) {
  if (!['string','number'].includes(typeof expected) || !/^\d+$/.test(String(expected)) || !Number.isSafeInteger(Number(expected))) {
    throw createBusinessError('缺少有效的报告版本，请刷新页面后重试', {statusCode:409,code:'REPORT_REVISION_REQUIRED'});
  }
  if (Number(expected) !== Number(revision)) throw createBusinessError('该分区已被其他操作更新；请刷新并核对最新内容后重试，当前修改没有保存', {statusCode:409,code:'REPORT_REVISION_CONFLICT'});
}
function parseJson(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function filterSnapshot(snapshot, role) {
  if (!snapshot) return null;
  const result = structuredClone(parseJson(snapshot));
  const roles = Array.isArray(role) ? role : [role];
  if (result.section === 'supervisor' && !roles.some(r=>['admin','supervisor'].includes(r))) {
    result.data.reviews = (result.data.reviews || []).filter(r => roles.includes(r.target_role));
  }
  return result;
}
async function readSectionState(c, reportId, section, forWrite = false) {
  sectionPrefix(section);
  if (forWrite) await c.execute('INSERT IGNORE INTO report_section_states (report_id,section) VALUES (?,?)',[reportId,section]);
  const [[state]] = await c.execute(`SELECT * FROM report_section_states WHERE report_id=? AND section=?${forWrite?' FOR UPDATE':''}`,[reportId,section]);
  return state || {report_id:reportId,section,revision:0,version_no:0,original_submission:null,last_submission:null,return_reason:null,returned_at:null,returned_by_admin_id:null};
}
async function captureSnapshot(c, reportId, section) {
  const prefix = sectionPrefix(section);
  const [[report]] = await c.execute('SELECT * FROM match_reports WHERE id=?',[reportId]);
  const [[match]] = await c.execute("SELECT id,season_id,futsal,match_type,match_date,TIME_FORMAT(match_time,'%H:%i') AS match_time,TIME_FORMAT(match_end_time,'%H:%i') AS match_end_time,venue,venue_detail,field_order,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot FROM match_schedules WHERE id=?",[report.schedule_id]);
  const [officials] = await c.execute('SELECT id,role,source_type,referee_id,external_referee_id,name_snapshot FROM match_official_assignments WHERE schedule_id=? ORDER BY id',[report.schedule_id]);
  let data;
  if (section === 'main') {
    const [stats] = await c.execute('SELECT * FROM match_referee_stats WHERE report_id=? ORDER BY id',[reportId]);
    const [cards] = await c.execute('SELECT c.*,p.player_name,p.jersey_number AS player_jersey_number FROM match_cards c JOIN team_player p ON p.id=c.team_player_id WHERE c.report_id=? ORDER BY c.id',[reportId]);
    const [goals] = await c.execute('SELECT g.*,p.player_name,p.jersey_number AS player_jersey_number FROM match_goals g JOIN team_player p ON p.id=g.team_player_id WHERE g.report_id=? ORDER BY g.id',[reportId]);
    data = {forfeit_side:report.forfeit_side,home_score:report.home_score,away_score:report.away_score,home_penalty_score:report.home_penalty_score,away_penalty_score:report.away_penalty_score,fourth_official_image_path:report.fourth_official_image_path,stats,cards,goals};
  } else {
    const [reviews] = await c.execute('SELECT * FROM match_referee_reviews WHERE report_id=? ORDER BY id',[reportId]);
    data = {reviews};
  }
  return {section,status:report[`${prefix}_status`],started_at:report[`${prefix}_started_at`],submitted_at:report[`${prefix}_submitted_at`],owner:officials.find(a=>a.role===section)||null,match,officials,data};
}
async function appendHistory(c, {reportId,section,state,before,after,operation,sourceType,viewer,reason}) {
  const revision = Number(state.revision) + 1;
  const version = Number(state.version_no) + (operation === 'submit' || sourceType === 'admin_revision' && operation !== 'return' ? 1 : 0);
  const [[person]] = await c.execute(viewer.role === 'admin' ? 'SELECT username AS name FROM admin WHERE id=?':'SELECT name FROM referee WHERE id=?',[viewer.id]);
  const actor = {actor_admin_id:viewer.role === 'admin'?viewer.id:null,actor_referee_id:viewer.role === 'referee'?viewer.id:null,actor_name_snapshot:person.name,source_type:sourceType};
  const submission = operation === 'submit' ? JSON.stringify({owner:after.owner,submitted_at:after.submitted_at,actor,legacy_actor_unknown:false}) : null;
  await c.execute(`INSERT INTO report_section_history
    (report_id,section,revision,version_no,operation,source_type,actor_admin_id,actor_referee_id,actor_name_snapshot,reason,before_snapshot,after_snapshot)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[reportId,section,revision,version,operation,sourceType,actor.actor_admin_id,actor.actor_referee_id,actor.actor_name_snapshot,reason||null,JSON.stringify(before),JSON.stringify(after)]);
  await c.execute(`UPDATE report_section_states SET revision=?,version_no=?,
    original_submission=COALESCE(original_submission,?),last_submission=COALESCE(?,last_submission),
    return_reason=CASE WHEN ?='return' THEN ? WHEN ?='submit' THEN NULL ELSE return_reason END,
    returned_at=CASE WHEN ?='return' THEN NOW(3) WHEN ?='submit' THEN NULL ELSE returned_at END,
    returned_by_admin_id=CASE WHEN ?='return' THEN ? WHEN ?='submit' THEN NULL ELSE returned_by_admin_id END
    WHERE report_id=? AND section=?`,[revision,version,submission,submission,operation,reason||null,operation,operation,operation,operation,actor.actor_admin_id,operation,reportId,section]);
}
module.exports = {sectionPrefix,requiredReason,checkRevision,parseJson,filterSnapshot,readSectionState,captureSnapshot,appendHistory};
