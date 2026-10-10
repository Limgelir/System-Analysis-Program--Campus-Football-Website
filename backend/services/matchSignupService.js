const pool = require('../db');
const {createBusinessError} = require('../utils/scheduleValidator');
const {readMatchTime} = require('../utils/matchTime');
const {parseIntentions,json,windowEnd,availability,checkScheduleRevision} = require('../utils/matchSignup');
const {pagination,pageMeta} = require('../utils/listQuery');
async function clock(c) {
  const [[r]]=await c.query("SELECT DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d %H:%i:%s') AS now");
  return r.now;
}
const select = `SELECT s.id,s.season_id,se.season_name,co.id competition_id,s.match_type,s.field_order,s.supervisor_required,s.fourth_required,s.match_date,TIME_FORMAT(s.match_time,'%H:%i') match_time,
  s.team_a_name_snapshot,s.team_b_name_snapshot,s.venue,s.venue_detail,s.schedule_revision,se.is_active,ps.ended_at,
  r.is_active referee_active,rs.status registration_status,ms.id signup_id,ms.status signup_status,ms.intentions,ms.revision signup_revision,
  ms.venue_snapshot,ms.venue_detail_snapshot,ms.match_date_snapshot,TIME_FORMAT(ms.match_time_snapshot,'%H:%i') match_time_snapshot,
  (SELECT GROUP_CONCAT(oa.role ORDER BY oa.id) FROM match_official_assignments oa WHERE oa.schedule_id=s.id AND oa.referee_id=r.id AND oa.source_type='system') assigned_role
  FROM match_schedules s JOIN seasons se ON se.id=s.season_id
  LEFT JOIN season_competitions co ON co.season_id=s.season_id AND co.league_type=s.match_type
  LEFT JOIN player_season_settings ps ON ps.season_id=se.id
  JOIN referee r ON r.id=? LEFT JOIN referee_season_registrations rs ON rs.referee_id=r.id AND rs.season_id=se.id
  LEFT JOIN referee_match_signups ms ON ms.schedule_id=s.id AND ms.referee_id=r.id`;
function present(row,now) {
  const {referee_active,is_active,ended_at,...safe}=row;
  return {...safe,intentions:json(row.intentions)||[],signup_revision:Number(row.signup_revision||0),
    time_changed:Boolean(row.signup_id && (row.match_date!==row.match_date_snapshot || row.match_time!==row.match_time_snapshot)),
    venue_changed:Boolean(row.signup_id && (row.venue!==row.venue_snapshot || row.venue_detail!==row.venue_detail_snapshot)),
    ...availability(row,now)};
}
async function list(refereeId,options={}) {
  if(options.view!==undefined&&!['week','mine'].includes(options.view))throw createBusinessError('报名列表类型无效');
  const {page,pageSize}=pagination(options), mine=options.view==='mine';
  const c=await pool.getConnection();
  try {
    await c.beginTransaction();
    const now=await clock(c),today=now.slice(0,10),last=windowEnd(today);
    const [[season]]=await c.execute(`SELECT se.id,se.season_name,ps.ended_at,rs.status registration_status
      FROM seasons se LEFT JOIN player_season_settings ps ON ps.season_id=se.id
      LEFT JOIN referee_season_registrations rs ON rs.season_id=se.id AND rs.referee_id=? WHERE se.is_active=1 LIMIT 1`,[refereeId]);
    const clause=mine?'ms.id IS NOT NULL':'se.is_active=1 AND ps.ended_at IS NULL AND s.match_date BETWEEN ? AND ?';
    const params=mine?[refereeId]:[refereeId,today,last];
    const [[count]]=await c.query(`SELECT COUNT(*) total FROM (${select} WHERE ${clause}) matches`,params);
    const [rows]=await c.query(`${select} WHERE ${clause} ORDER BY s.match_date ${mine?'DESC':'ASC'},(s.match_time IS NULL),s.match_time,s.field_order_sort,s.field_order,s.id LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]);
    await c.commit();
    return {items:rows.map(r=>present(r,now)),pagination:pageMeta(page,pageSize,Number(count.total)),current_season:season||null,server_time:now,window:{from:today,to:last}};
  } catch(e) {await c.rollback();throw e;} finally {c.release();}
}
async function mutate(refereeId,scheduleId,data) {
  if (!data || Array.isArray(data) || Object.keys(data).some(k=>!['action','intentions','revision','schedule_revision'].includes(k))) throw createBusinessError('报名请求包含无效字段');
  if (!['save','withdraw'].includes(data.action)) throw createBusinessError('报名操作无效');
  if (!Number.isSafeInteger(data.revision) || data.revision<0) throw createBusinessError('请刷新报名状态后重试',{statusCode:409,code:'SIGNUP_REVISION_CONFLICT'});
  const intentions=data.action==='save'?parseIntentions(data.intentions):null;
  const c=await pool.getConnection();
  try {
    await c.beginTransaction();
    // 与赛程改期、正式选派、删除共用同一行锁，锁后再读取业务时钟与资格。
    const [[schedule]]=await c.execute('SELECT * FROM match_schedules WHERE id=? FOR UPDATE',[scheduleId]);
    if (!schedule) throw createBusinessError('比赛不存在',{statusCode:404});
    if (intentions?.includes('fourth') && !schedule.fourth_required) throw createBusinessError('本场无需第四官员，请选择其他岗位意向');
    if (intentions?.includes('supervisor') && !schedule.supervisor_required) throw createBusinessError('本场无需裁判监督，请选择场上岗位意向');
    await c.execute('SELECT id FROM seasons WHERE id=? FOR SHARE',[schedule.season_id]);
    await c.execute('SELECT season_id FROM player_season_settings WHERE season_id=? FOR SHARE',[schedule.season_id]);
    await c.execute('SELECT id FROM referee WHERE id=? FOR SHARE',[refereeId]);
    await c.execute('SELECT id FROM referee_season_registrations WHERE referee_id=? AND season_id=? FOR SHARE',[refereeId,schedule.season_id]);
    const [[row]]=await c.execute(select+' WHERE s.id=?',[refereeId,scheduleId]);
    const now=await clock(c),permission=availability(row,now);
    if (!(data.action==='withdraw'?permission.can_change:permission.can_change||permission.can_apply)) throw createBusinessError(permission.reason||'当前没有可撤回的报名',{code:'SIGNUP_UNAVAILABLE'});
    checkScheduleRevision(data.schedule_revision,schedule.schedule_revision);
    const [[existing]]=await c.execute('SELECT * FROM referee_match_signups WHERE schedule_id=? AND referee_id=? FOR UPDATE',[scheduleId,refereeId]);
    if(data.revision!==Number(existing?.revision||0)) throw createBusinessError('报名状态已更新，请刷新后核对；未提交的意向会保留',{statusCode:409,code:'SIGNUP_REVISION_CONFLICT'});
    const status=data.action==='withdraw'?'withdrawn':'active', choices=intentions||json(existing.intentions);
    const snapshot={status,intentions:choices,venue_snapshot:schedule.venue,venue_detail_snapshot:schedule.venue_detail,match_date_snapshot:schedule.match_date,match_time_snapshot:readMatchTime(schedule.match_time)};
    // 相同版本的重复保存是无变化操作，不增加历史。
    if(existing && existing.venue_snapshot===schedule.venue && existing.venue_detail_snapshot===schedule.venue_detail && existing.status===status && JSON.stringify(json(existing.intentions))===JSON.stringify(choices) && existing.match_date_snapshot===schedule.match_date && readMatchTime(existing.match_time_snapshot)===snapshot.match_time_snapshot) {await c.commit();return present(row,now);}
    const revision=Number(existing?.revision||0)+1;
    let id=existing?.id;
    if(existing) await c.execute('UPDATE referee_match_signups SET status=?,intentions=?,revision=?,match_date_snapshot=?,match_time_snapshot=?,venue_snapshot=?,venue_detail_snapshot=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[status,JSON.stringify(choices),revision,snapshot.match_date_snapshot,snapshot.match_time_snapshot,schedule.venue,schedule.venue_detail,id]);
    else {const [insert]=await c.execute(`INSERT INTO referee_match_signups (schedule_id,referee_id,status,intentions,revision,match_date_snapshot,match_time_snapshot,venue_snapshot,venue_detail_snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,[scheduleId,refereeId,status,JSON.stringify(choices),revision,snapshot.match_date_snapshot,snapshot.match_time_snapshot,schedule.venue,schedule.venue_detail]);id=insert.insertId;}
    const before=existing?{venue_snapshot:existing.venue_snapshot,venue_detail_snapshot:existing.venue_detail_snapshot,status:existing.status,intentions:json(existing.intentions),revision:existing.revision,match_date_snapshot:existing.match_date_snapshot,match_time_snapshot:readMatchTime(existing.match_time_snapshot)}:null;
    await c.execute(`INSERT INTO referee_match_signup_events (signup_id,revision,operation,before_snapshot,after_snapshot,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))`,[id,revision,data.action==='withdraw'?'withdraw':!existing?'signup':existing.status==='withdrawn'?'reapply':'update',before?JSON.stringify(before):null,JSON.stringify({...snapshot,revision})]);
    const [[saved]]=await c.execute(select+' WHERE s.id=?',[refereeId,scheduleId]);
    await c.commit();return present(saved,now);
  } catch(e) {await c.rollback();throw e;} finally {c.release();}
}
const validCount = `(SELECT COUNT(*) FROM referee_match_signups ms JOIN referee r ON r.id=ms.referee_id JOIN referee_season_registrations rs ON rs.referee_id=r.id AND rs.season_id=s.season_id WHERE ms.schedule_id=s.id AND ms.status='active' AND r.is_active=1 AND rs.status='approved')`;
async function adminList(scheduleId,options={}) {
  const {page,pageSize}=pagination(options);
  const [[s]]=await pool.execute('SELECT id,match_date,match_time,venue,venue_detail FROM match_schedules WHERE id=?',[scheduleId]);
  if(!s) throw createBusinessError('比赛不存在',{statusCode:404});
  const [[count]]=await pool.execute('SELECT COUNT(*) total FROM referee_match_signups WHERE schedule_id=?',[scheduleId]);
  const [rows]=await pool.query(`SELECT ms.*,r.student_id,COALESCE(rs.name_snapshot,r.name) name,r.is_active referee_active,rs.status registration_status,
    (SELECT GROUP_CONCAT(oa.role ORDER BY oa.id) FROM match_official_assignments oa WHERE oa.schedule_id=s.id AND oa.source_type='system' AND oa.referee_id=r.id) assigned_role FROM referee_match_signups ms JOIN match_schedules s ON s.id=ms.schedule_id JOIN referee r ON r.id=ms.referee_id
    LEFT JOIN referee_season_registrations rs ON rs.referee_id=r.id AND rs.season_id=s.season_id
    WHERE s.id=? ORDER BY (ms.status='active' AND r.is_active=1 AND rs.status='approved') DESC,ms.id LIMIT ? OFFSET ?`,[scheduleId,pageSize,(page-1)*pageSize]);
  return {items:rows.map(r=>({...r,intentions:json(r.intentions),venue_changed:r.venue_snapshot!==s.venue||r.venue_detail_snapshot!==s.venue_detail,eligible:Boolean(r.referee_active&&r.registration_status==='approved'),time_changed:r.match_date_snapshot!==s.match_date||readMatchTime(r.match_time_snapshot)!==readMatchTime(s.match_time),match_time_snapshot:readMatchTime(r.match_time_snapshot)})),pagination:pageMeta(page,pageSize,Number(count.total))};
}
async function history(scheduleId,signupId) {
  const [items]=await pool.execute(`SELECT e.id,e.revision,e.operation,e.before_snapshot,e.after_snapshot,CONCAT(DATE_FORMAT(e.created_at,'%Y-%m-%dT%H:%i:%s.%f'),'Z') created_at FROM referee_match_signup_events e JOIN referee_match_signups ms ON ms.id=e.signup_id WHERE ms.schedule_id=? AND ms.id=? ORDER BY e.revision DESC`,[scheduleId,signupId]);
  return items.map(r=>({...r,before_snapshot:json(r.before_snapshot),after_snapshot:json(r.after_snapshot)}));
}
module.exports={list,mutate,adminList,history,validCount};
