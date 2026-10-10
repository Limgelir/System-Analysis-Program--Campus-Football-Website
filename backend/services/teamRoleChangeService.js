const pool=require('../db');
const rules=require('../utils/playerRules');
const w=require('../utils/playerWorkflow');
const transaction=work=>w.transaction(work,{readCommitted:true});
const r=require('../utils/teamApplicationRules');
const teams=require('./playerTeamService');
const eligible=require('./playerRegistrationService');
const roster=require('./playerRosterService');
const query=require('../utils/listQuery');

const roleField=role=>role==='manager'?'manager_player_id':'captain_player_id';
async function team(c,id,user,{write=false,lock=false}={}){
  const [[base]]=await w.sql(c,'SELECT season_id FROM team WHERE id=?',[rules.id(id)]);if(!base)throw rules.businessError('正式球队不存在',404);
  if(lock){await w.season(c,base.season_id,{active:true});await w.actor(c,user);}
  const [[t]]=await w.sql(c,`SELECT t.*,s.is_active,s.season_name,st.ended_at FROM team t JOIN seasons s ON s.id=t.season_id LEFT JOIN player_season_settings st ON st.season_id=s.id WHERE t.id=?${lock?' FOR UPDATE':''}`,[id]);
  if(user.role!=='admin'&&![t.manager_player_id,t.captain_player_id].includes(user.id))throw rules.businessError('只有本队当前负责人或队长可以管理角色',403,'TEAM_FORBIDDEN');
  if(write&&(!t.is_active||t.ended_at))throw rules.businessError('只有当前启用且未结束的赛季可以申请角色变更',409);
  if(!t.manager_player_id||!t.captain_player_id)throw rules.businessError('这支历史球队尚未关联球员管理角色，请等待新版导入接入',409);
  return t;
}
async function account(c,id){const [[p]]=await w.sql(c,'SELECT id,student_id,name,college,is_active,revision FROM player_accounts WHERE id=? FOR SHARE',[id]);if(!p)throw rules.businessError('球员账号不存在',404);return p;}
async function candidate(c,t,id,role){const p=await account(c,id);if(!p.is_active)throw rules.businessError('新负责人或队长账号已停用',409);if(role==='captain'){await eligible.assertEligible(c,id,t.season_id);const batch=await roster.effectiveBatch(t.id,undefined,c);const [[m]]=await w.sql(c,'SELECT id FROM team_player WHERE roster_batch_id=? AND player_account_id=?',[batch?.id||0,id]);if(!m)throw rules.businessError('新队长必须是本队当前有效名单中的球员，不能借角色变更添加队员',409);}return p;}
async function lookup(id,studentId,role,user){if(!['manager','captain'].includes(role))throw rules.businessError('角色不正确');return transaction(async c=>{const t=await team(c,id,user,{write:true});if(t.registration_revoked)throw rules.businessError('报名通过已撤销，请在原报名申请中修改队长',409,'TEAM_REGISTRATION_REVOKED');const [[p]]=await w.sql(c,'SELECT id FROM player_accounts WHERE student_id=?',[rules.studentId(studentId)]);if(!p)throw rules.businessError('未找到该学号',404);return candidate(c,t,p.id,role);});}
async function row(c,id){const [[v]]=await w.sql(c,'SELECT * FROM team_role_change_requests WHERE id=?',[rules.id(id)]);if(!v)throw rules.businessError('角色变更申请不存在',404);return v;}
async function state(c,request,t){const old=await account(c,request.old_player_id),next=await account(c,request.new_player_id),batch=await roster.effectiveBatch(t.id,undefined,c);
  const [[member]]=await w.sql(c,`SELECT p.id,r.status AS qualification_status,r.revision AS qualification_revision FROM player_accounts a LEFT JOIN team_player p ON p.player_account_id=a.id AND p.roster_batch_id=? LEFT JOIN player_season_registrations r ON r.player_id=a.id AND r.season_id=? WHERE a.id=?`,[batch?.id||0,t.season_id,next.id]);
  return {old,next,is_current_member:Boolean(member?.id),qualification_status:member?.qualification_status||null,review_token:r.digest([request.id,request.revision,t.revision,t.manager_player_id,t.captain_player_id,old,next,member])};
}
function snapshot(v,t){return {id:v.id,team_id:v.team_id,role:v.role,old_player_id:v.old_player_id,new_player_id:v.new_player_id,status:v.status,revision:v.revision,reason:v.reason,profile_snapshot:v.profile_snapshot,team_revision:t.revision,manager_player_id:t.manager_player_id,captain_player_id:t.captain_player_id};}
async function event(c,v,t,operation,user,before,reason=null){await c.execute('INSERT INTO team_role_change_events (request_id,revision,operation,actor_player_id,actor_admin_id,reason,before_snapshot,after_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[v.id,v.revision,operation,user.role==='player'?user.id:null,user.role==='admin'?user.id:null,reason,before?JSON.stringify(before):null,JSON.stringify(snapshot(v,t)),w.chinaSql()]);}
async function detailIn(c,id,user){const v=await row(c,id),t=await team(c,v.team_id,user),s=await state(c,v,t);const [events]=await w.sql(c,'SELECT * FROM team_role_change_events WHERE request_id=? ORDER BY revision DESC LIMIT 100',[v.id]);return {request:{id:v.id,team_id:v.team_id,role:v.role,status:v.status,revision:v.revision,requested_by_player_id:v.requested_by_player_id,reason:v.reason,created_at:w.chinaIso(v.created_at),reviewed_at:w.chinaIso(v.reviewed_at)},team:{id:t.id,name:t.team_name,season_name:t.season_name,league_type:t.league_type,revision:t.revision,is_active:Boolean(t.is_active),ended:Boolean(t.ended_at)},old:s.old,next:s.next,is_current_member:s.is_current_member,qualification_status:s.qualification_status,review_token:user.role==='admin'?s.review_token:undefined,events:events.map(e=>({...e,created_at:w.chinaIso(e.created_at)}))};}
const detail=(id,user)=>transaction(c=>detailIn(c,id,user));
async function create(id,user,body,revision,key){rules.onlyKeys(body,['role','new_player_id','reason']);if(!['manager','captain'].includes(body.role))throw rules.businessError('角色不正确');const target=rules.id(body.new_player_id),reason=r.text(body.reason,'变更说明',500,true);key=r.requestKey(key);const hash=r.digest([id,body.role,target,reason]);
  return transaction(async c=>{const t=await team(c,id,user,{write:true,lock:true});if(t.registration_revoked)throw rules.businessError('报名通过已撤销，请在原报名申请中修改队长',409,'TEAM_REGISTRATION_REVOKED');
    const [[prior]]=await w.sql(c,'SELECT id,request_hash FROM team_role_change_requests WHERE requested_by_player_id=? AND request_key=?',[user.id,key]);if(prior){if(prior.request_hash!==hash)throw rules.businessError('提交标识已经用于其他变更',409);return detailIn(c,prior.id,user);}
    w.expectRevision(t.revision,revision);const old=t[roleField(body.role)];if(old===target)throw rules.businessError('新角色人选与当前相同');const p=await candidate(c,t,target,body.role);
    const [[pending]]=await w.sql(c,"SELECT id FROM team_role_change_requests WHERE team_id=? AND role=? AND status='pending'",[id,body.role]);if(pending)throw rules.businessError('该角色已有待审核申请，请先处理或撤回',409);
    const [result]=await c.execute('INSERT INTO team_role_change_requests (team_id,role,old_player_id,new_player_id,requested_by_player_id,revision,reason,team_revision,request_key,request_hash,profile_snapshot,created_at) VALUES (?,?,?,?,?,1,?,?,?,?,?,?)',[id,body.role,old,target,user.id,reason,t.revision,key,hash,JSON.stringify(w.accountSnapshot(p)),w.chinaSql()]);const v=await row(c,result.insertId);await event(c,v,t,'submitted',user,null,reason);
    await teams.notify(c,[t.manager_player_id,t.captain_player_id,target],`role:${v.id}:1`,'team_role_submitted',`“${t.team_name}”已申请将${body.role==='manager'?'负责人':'场上队长'}改为${p.name}，审核通过前原角色有效。`,t.season_id,t.id);return detailIn(c,v.id,user);
  });
}
async function withdraw(id,user,revision){return transaction(async c=>{const old=await row(c,id),t=await team(c,old.team_id,user,{write:true,lock:true}),[[v]]=await w.sql(c,'SELECT * FROM team_role_change_requests WHERE id=? FOR UPDATE',[id]);w.expectRevision(v.revision,revision);if(v.status!=='pending')throw rules.businessError('只有待审核角色申请可以撤回',409);const before=snapshot(v,t);await c.execute("UPDATE team_role_change_requests SET status='withdrawn',revision=revision+1 WHERE id=?",[id]);await event(c,await row(c,id),t,'withdrawn',user,before);return detailIn(c,id,user);});}
async function review(id,user,operation,body,revision){rules.onlyKeys(body,['reason','review_token']);const reason=r.text(body.reason,operation==='return'?'退回理由':'审核说明',500,operation==='approve');return transaction(async c=>{
  const initial=await row(c,id),t=await team(c,initial.team_id,user,{write:true,lock:true}),[[v]]=await w.sql(c,'SELECT * FROM team_role_change_requests WHERE id=? FOR UPDATE',[id]);w.expectRevision(v.revision,revision);if(v.status!=='pending')throw rules.businessError('角色变更申请已处理',409);
  const current=await state(c,v,t);if(current.review_token!==body.review_token)throw rules.businessError('球队角色、球员资料或资格已变化，请刷新核对',409,'TEAM_REVIEW_CHANGED');const before=snapshot(v,t);
  if(operation==='approve'){
    if(t.registration_revoked)throw rules.businessError('球队报名通过已撤销，不能通过角色变更',409,'TEAM_REGISTRATION_REVOKED');
    if(t[roleField(v.role)]!==v.old_player_id)throw rules.businessError('原角色人选已经变化，请退回重新申请',409);const p=await candidate(c,t,v.new_player_id,v.role);
    await c.execute(`UPDATE team SET ${roleField(v.role)}=?,revision=revision+1 WHERE id=?`,[p.id,t.id]);t[roleField(v.role)]=p.id;t.revision++;
    await c.execute('UPDATE team_role_change_requests SET profile_snapshot=? WHERE id=?',[JSON.stringify(w.accountSnapshot(p)),id]);
  }
  await c.execute('UPDATE team_role_change_requests SET status=?,revision=revision+1,reason=?,reviewed_by_admin_id=?,reviewed_at=? WHERE id=?',[operation==='approve'?'approved':'returned',reason,user.id,w.chinaSql(),id]);const after=await row(c,id);await event(c,after,t,operation==='approve'?'approved':'returned',user,before,reason);
  await teams.notify(c,[v.old_player_id,v.new_player_id,t.manager_player_id,t.captain_player_id],`role:${id}:${after.revision}`,operation==='approve'?'team_role_approved':'team_role_returned',`“${t.team_name}”${v.role==='manager'?'负责人':'场上队长'}变更${operation==='approve'?'已通过，角色和管理权限立即生效。':'已退回：'+reason}`,t.season_id,t.id);return detailIn(c,id,user);
});}
async function listForTeam(id,user){return transaction(async c=>{const t=await team(c,id,user);const [requests]=await w.sql(c,'SELECT r.id,r.role,r.status,r.revision,r.reason,r.created_at,p.name AS new_name FROM team_role_change_requests r JOIN player_accounts p ON p.id=r.new_player_id WHERE r.team_id=? ORDER BY r.id DESC LIMIT 100',[id]);return {team:{id:t.id,revision:t.revision,manager_player_id:t.manager_player_id,captain_player_id:t.captain_player_id,can_request:Boolean(t.is_active&&!t.ended_at&&!t.registration_revoked)},requests:requests.map(v=>({...v,created_at:w.chinaIso(v.created_at)}))};});}
async function list(q){const {page,pageSize}=query.pagination(q),status=query.choice(q.status,['pending','approved','returned','withdrawn'],'申请状态');const seasonId=q.season_id?rules.id(q.season_id):(await w.sql(pool,'SELECT id FROM seasons WHERE is_active=1 LIMIT 1'))[0][0]?.id;if(!seasonId)return {items:[],pagination:query.pageMeta(page,pageSize,0)};const args=[seasonId];const filter=status?' AND r.status=?':'';if(status)args.push(status);const from=`FROM team_role_change_requests r JOIN team t ON t.id=r.team_id JOIN player_accounts p ON p.id=r.new_player_id WHERE t.season_id=?${filter}`;const [[count]]=await w.sql(pool,`SELECT COUNT(*) AS n ${from}`,args);const [items]=await pool.query({sql:`SELECT r.id,r.role,r.status,r.revision,r.created_at,t.team_name,t.league_type,p.name AS new_name ${from} ORDER BY r.id DESC LIMIT ? OFFSET ?`,dateStrings:true},[...args,pageSize,(page-1)*pageSize]);return {items:items.map(v=>({...v,created_at:w.chinaIso(v.created_at)})),pagination:query.pageMeta(page,pageSize,Number(count.n))};}
module.exports={lookup,detail,create,withdraw,review,listForTeam,list};
