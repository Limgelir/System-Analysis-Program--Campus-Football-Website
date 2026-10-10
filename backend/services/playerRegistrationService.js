const crypto=require('node:crypto');
const pool=require('../db');
const rules=require('../utils/playerRules');
const query=require('../utils/listQuery');
const w=require('../utils/playerWorkflow');
const images=require('../utils/playerAcademicUpload');
const settings=require('./playerSeasonSettingsService');
const {businessDate}=require('../utils/competitionTime');
const STATUSES=['pending','withdrawn','returned','approved','revoked'];

function registration(row){
  if(!row)return null;
  return {id:row.id,player_id:row.player_id,season_id:row.season_id,status:row.status,revision:row.revision,
    profile_snapshot:row.profile_snapshot,review_profile_snapshot:row.review_profile_snapshot,
    submitted_at:w.chinaIso(row.submitted_at),reviewed_at:w.chinaIso(row.reviewed_at),
    reviewed_by_admin_id:row.reviewed_by_admin_id,return_reason:row.return_reason};
}
function fileMeta(row){return {id:row.id,revision:row.revision,mime_type:row.mime_type,sha256:row.sha256,created_at:w.chinaIso(row.created_at),cleaned_at:w.chinaIso(row.cleaned_at),available:Boolean(row.file_path)&&!row.cleaned_at};}
async function readRow(c,id){const [[row]]=await w.sql(c,'SELECT * FROM player_season_registrations WHERE id=?',[id]);if(!row)throw rules.businessError('赛季注册申请不存在',404,'PLAYER_REGISTRATION_NOT_FOUND');return row;}
async function detailIn(c,id){
  const row=await readRow(c,id);
  const [[account]]=await w.sql(c,'SELECT id,student_id,name,college,revision,is_active FROM player_accounts WHERE id=?',[row.player_id]);
  const [[season]]=await w.sql(c,'SELECT id,season_name,season_code,is_active FROM seasons WHERE id=?',[row.season_id]);
  const [files]=await w.sql(c,'SELECT * FROM player_registration_files WHERE registration_id=? ORDER BY revision DESC',[id]);
  const [events]=await w.sql(c,'SELECT id,revision,operation,actor_player_id,actor_admin_id,reason,before_snapshot,after_snapshot,created_at FROM player_registration_events WHERE registration_id=? ORDER BY revision DESC LIMIT 100',[id]);
  return {registration:registration(row),account:{...account,is_active:Boolean(account.is_active)},season,files:files.map(fileMeta),events:events.map(e=>({...e,created_at:w.chinaIso(e.created_at)}))};
}
async function detail(id,user){return w.transaction(async c=>{const data=await detailIn(c,rules.id(id));if(user.role!=='admin'&&(user.role!=='player'||data.registration.player_id!==user.id))throw rules.businessError('无权查看该学籍申请',403,'PLAYER_REGISTRATION_FORBIDDEN');return data;});}
async function currentIn(c,playerId){
  const [[account]]=await w.sql(c,'SELECT id,student_id,name,college,revision FROM player_accounts WHERE id=?',[playerId]);
  const [[season]]=await w.sql(c,'SELECT id,season_name,season_code,start_date,end_date,is_active FROM seasons WHERE is_active=1 LIMIT 1');
  if(!season)return {season:null,account,registration:null,revision:0,window_status:'no_season',can_submit:false,can_withdraw:false,files:[],events:[],competitions:[],message:'暂无启用赛季，账号可以正常使用。'};
  const config=await settings.read(season.id,c);
  const [[row]]=await w.sql(c,'SELECT id,status FROM player_season_registrations WHERE player_id=? AND season_id=?',[playerId,season.id]);
  const data=row?await detailIn(c,row.id):{registration:null,files:[],events:[]};
  const status=row?.status||'unsubmitted',correction=['returned','revoked'].includes(status);
  const canSubmit=!config.ended_at&&['unsubmitted','withdrawn','returned','revoked'].includes(status)&&(config.window_status==='open'||correction);
  const messages={unsubmitted:'参加本赛季比赛前，请提交1系统学籍信息截图。',pending:'材料已提交，等待管理员审核。',approved:'本赛季学籍基础资格已通过，各赛事参赛规则在球队报名时另行审核。',returned:'申请已退回，请根据管理员说明补正截图后重新提交。',withdrawn:'申请已撤回，可在个人注册窗口内重新提交。',revoked:'当季资格已撤销，后续参赛暂停；请补正截图并重新接受审核。'};
  return {...data,season,account,revision:data.registration?.revision||0,status,window_status:config.ended_at?'ended':config.window_status,
    registration_opens_at:config.registration_opens_at,registration_closes_at:config.registration_closes_at,server_time:config.server_time,
    can_submit:canSubmit,can_withdraw:!config.ended_at&&status==='pending',is_correction:correction,
    competitions:config.competitions.filter(v=>v.is_enabled),message:config.ended_at?'该赛季已经结束。':messages[status]};
}
const current=playerId=>w.transaction(c=>currentIn(c,playerId));
async function snapshot(c,row){
  const [[file]]=await w.sql(c,'SELECT id,revision,mime_type,sha256 FROM player_registration_files WHERE registration_id=? ORDER BY revision DESC LIMIT 1',[row.id]);
  return {...registration(row),file:file||null};
}
async function event(c,row,operation,user,before,reason){
  await c.execute('INSERT INTO player_registration_events (registration_id,revision,operation,actor_player_id,actor_admin_id,reason,before_snapshot,after_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [row.id,row.revision,operation,user.role==='player'?user.id:null,user.role==='admin'?user.id:null,reason||null,before?JSON.stringify(before):null,JSON.stringify(await snapshot(c,row)),w.chinaSql()]);
}
async function notification(c,playerId,eventKey,kind,message,seasonId,teamId=null){
  await c.execute('INSERT INTO player_notifications (player_id,event_key,kind,message,season_id,related_team_id,created_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',[playerId,eventKey,kind,Array.from(message).slice(0,500).join(''),seasonId,teamId,w.chinaSql()]);
}
async function submit(user,body,expectedRevision,key,file,meta){
  rules.onlyKeys(body,['season_id','account_revision']);
  const seasonId=rules.id(body.season_id),accountRevision=rules.revision(body.account_revision);
  if(typeof key!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key))throw rules.businessError('提交标识缺失，请刷新页面后重试',400,'PLAYER_REQUEST_KEY_REQUIRED');
  const hash=crypto.createHash('sha256').update(JSON.stringify([seasonId,accountRevision,expectedRevision,meta.sha256])).digest('hex');
  const c=await pool.getConnection();let saved=null,commitAttempted=false;
  try{
    await c.beginTransaction();await w.season(c,seasonId,{active:true});const account=await w.actor(c,user);
    const [[prior]]=await w.sql(c,'SELECT * FROM player_registration_requests WHERE player_id=? AND request_key=?',[user.id,key]);
    if(prior){if(prior.request_hash!==hash)throw rules.businessError('同一提交标识不能用于不同材料',409,'PLAYER_REQUEST_KEY_CONFLICT');const data=await currentIn(c,user.id);await c.commit();return {...data,replayed:true};}
    if(account.revision!==accountRevision)throw rules.businessError('账号资料已变化，请刷新并核对姓名、学号和学院后重提',409,'PLAYER_PROFILE_CHANGED');
    const [[previous]]=await w.sql(c,'SELECT * FROM player_season_registrations WHERE player_id=? AND season_id=? FOR UPDATE',[user.id,seasonId]);
    w.expectRevision(previous?.revision||0,expectedRevision);
    if(previous&&!['withdrawn','returned','revoked'].includes(previous.status))throw rules.businessError('申请已经提交或审核通过，请刷新状态',409,'PLAYER_REGISTRATION_STATE');
    const config=await settings.read(seasonId,c);
    if(!['returned','revoked'].includes(previous?.status)&&config.window_status!=='open')throw rules.businessError('当前不在个人注册开放时间内',409,'PLAYER_REGISTRATION_WINDOW_CLOSED');
    const before=previous?await snapshot(c,previous):null,revision=(previous?.revision||0)+1,now=w.chinaSql();
    let id=previous?.id;
    if(previous)await c.execute("UPDATE player_season_registrations SET status='pending',revision=?,profile_snapshot=?,review_profile_snapshot=NULL,submitted_at=?,reviewed_at=NULL,reviewed_by_admin_id=NULL,return_reason=NULL WHERE id=?",[revision,JSON.stringify(w.accountSnapshot(account)),now,id]);
    else{const [insert]=await c.execute("INSERT INTO player_season_registrations (player_id,season_id,status,revision,profile_snapshot,submitted_at) VALUES (?,?,'pending',?,?,?)",[user.id,seasonId,revision,JSON.stringify(w.accountSnapshot(account)),now]);id=insert.insertId;}
    saved=await images.save(file,meta);
    await c.execute('INSERT INTO player_registration_files (registration_id,revision,file_path,mime_type,sha256,created_at) VALUES (?,?,?,?,?,?)',[id,revision,saved,meta.mime,meta.sha256,now]);
    const row=await readRow(c,id);await event(c,row,'submitted',user,before,null);
    await c.execute('INSERT INTO player_registration_requests (player_id,request_key,season_id,request_hash,registration_id,submission_revision,created_at) VALUES (?,?,?,?,?,?,?)',[user.id,key,seasonId,hash,id,revision,now]);
    const data=await currentIn(c,user.id);commitAttempted=true;await c.commit();return {...data,replayed:false};
  }catch(e){await c.rollback();if(saved&&!commitAttempted)await images.remove(saved);throw e;}finally{c.release();}
}
async function withdraw(user,body,expectedRevision){
  rules.onlyKeys(body,['season_id']);const seasonId=rules.id(body.season_id);
  return w.transaction(async c=>{
    await w.season(c,seasonId,{active:true});await w.actor(c,user);
    const [[row]]=await w.sql(c,'SELECT * FROM player_season_registrations WHERE player_id=? AND season_id=? FOR UPDATE',[user.id,seasonId]);
    if(!row)throw rules.businessError('没有可撤回的申请',409,'PLAYER_REGISTRATION_STATE');w.expectRevision(row.revision,expectedRevision);
    if(row.status!=='pending')throw rules.businessError('只有待审核申请可以撤回',409,'PLAYER_REGISTRATION_STATE');
    const before=await snapshot(c,row);await c.execute("UPDATE player_season_registrations SET status='withdrawn',revision=revision+1 WHERE id=?",[row.id]);
    await event(c,await readRow(c,row.id),'withdrawn',user,before,null);return currentIn(c,user.id);
  });
}
async function review(id,operation,body,expectedRevision,user){
  if(!['approve','return','revoke'].includes(operation))throw rules.businessError('审核操作不正确');
  rules.onlyKeys(body,operation==='approve'?['reason','account_revision']:['reason']);
  const reason=operation==='approve'?(body.reason==null||body.reason===''?null:rules.requiredText(body.reason,'审核说明',500)):rules.requiredText(body.reason,operation==='return'?'退回理由':'撤销原因',500);
  return w.transaction(async c=>{
    const existing=await readRow(c,rules.id(id));await w.season(c,existing.season_id,{active:true});await w.actor(c,user);
    const [[row]]=await w.sql(c,'SELECT * FROM player_season_registrations WHERE id=? FOR UPDATE',[id]);w.expectRevision(row.revision,expectedRevision);
    if(row.status!==(operation==='revoke'?'approved':'pending'))throw rules.businessError('申请状态已变化，不能重复处理',409,'PLAYER_REGISTRATION_STATE');
    const [[account]]=await w.sql(c,'SELECT id,student_id,name,college,revision,is_active FROM player_accounts WHERE id=? FOR UPDATE',[row.player_id]);
    if(operation==='approve'){
      if(!account.is_active)throw rules.businessError('球员账号已停用，不能通过审核',409,'PLAYER_ACCOUNT_DISABLED');
      if(account.revision!==rules.revision(String(body.account_revision)))throw rules.businessError('球员账号资料已变化，请刷新后核对再审核',409,'PLAYER_PROFILE_CHANGED');
      const [[file]]=await w.sql(c,'SELECT * FROM player_registration_files WHERE registration_id=? ORDER BY revision DESC LIMIT 1',[id]);
      if(!file?.file_path||file.cleaned_at)throw rules.businessError('材料已经清理，不能通过审核',409,'PLAYER_MATERIAL_UNAVAILABLE');
      try{await require('node:fs/promises').access(images.resolve(file.file_path));}catch{throw rules.businessError('材料文件缺失，请退回球员重新上传',409,'PLAYER_MATERIAL_UNAVAILABLE');}
    }
    const before=await snapshot(c,row),status={approve:'approved',return:'returned',revoke:'revoked'}[operation];
    await c.execute('UPDATE player_season_registrations SET status=?,revision=revision+1,review_profile_snapshot=?,reviewed_at=?,reviewed_by_admin_id=?,return_reason=? WHERE id=?',[status,JSON.stringify(w.accountSnapshot(account)),w.chinaSql(),user.id,reason,id]);
    const after=await readRow(c,id);await event(c,after,status,user,before,reason);
    if(operation==='approve')await require('./importedIdentityService').link(c,row.player_id,row.season_id,row.id,user);
    const descriptions={approved:'你的当季学籍审核已通过。',returned:`你的当季申请已退回：${reason}`,revoked:`你的当季资格已撤销，后续参赛暂停：${reason}`};
    await notification(c,row.player_id,`registration:${id}:${after.revision}`,status,descriptions[status],row.season_id);
    if(operation==='revoke'){
      const today=businessDate();
      const [teams]=await w.sql(c,`SELECT DISTINCT t.id,t.team_name,t.manager_player_id,t.captain_player_id FROM team t JOIN team_player p ON p.team_id=t.id WHERE t.season_id=? AND p.player_account_id=? AND
        (p.roster_batch_id=(SELECT b.id FROM team_roster_batches b WHERE b.team_id=t.id AND (b.effective_from IS NULL OR b.effective_from<=?) ORDER BY b.effective_from DESC,b.version_no DESC LIMIT 1)
         OR p.roster_batch_id=(SELECT b.id FROM team_roster_batches b WHERE b.team_id=t.id ORDER BY b.effective_from DESC,b.version_no DESC LIMIT 1))`,[row.season_id,row.player_id,today]);
      for(const team of teams)for(const recipient of new Set([team.manager_player_id,team.captain_player_id].filter(Boolean)))await notification(c,recipient,`qualification:${id}:${after.revision}:${team.id}:${recipient}`,'team_qualification_revoked',`${team.team_name}的球员${account.name}当季资格已撤销，请调整后续参赛安排。`,row.season_id,team.id);
    }
    return detailIn(c,id);
  });
}
async function list(q){
  const {page,pageSize}=query.pagination(q),status=query.choice(q.status,STATUSES,'申请状态'),search=query.text(q.q,'搜索内容');
  let seasonId=q.season_id?rules.id(q.season_id):null;
  if(!seasonId){const [[s]]=await w.sql(pool,'SELECT id FROM seasons WHERE is_active=1 LIMIT 1');seasonId=s?.id;}
  if(!seasonId)return {season:null,items:[],summary:{},pagination:query.pageMeta(page,pageSize,0)};
  const [[season]]=await w.sql(pool,'SELECT id,season_name,season_code,is_active FROM seasons WHERE id=?',[seasonId]);if(!season)throw rules.businessError('赛季不存在',404);
  const where=['r.season_id=?'],args=[seasonId];if(status){where.push('r.status=?');args.push(status);}
  if(search){where.push("(a.name LIKE ? ESCAPE '!' OR a.student_id LIKE ? ESCAPE '!' OR a.college LIKE ? ESCAPE '!')");args.push(...Array(3).fill(query.like(search)));}
  const from=`FROM player_season_registrations r JOIN player_accounts a ON a.id=r.player_id WHERE ${where.join(' AND ')}`;
  const [[count]]=await w.sql(pool,`SELECT COUNT(*) AS n ${from}`,args);
  const [rows]=await pool.query({sql:`SELECT r.*,a.name,a.student_id,a.college,a.is_active ${from} ORDER BY r.submitted_at DESC,r.id DESC LIMIT ? OFFSET ?`,dateStrings:true},[...args,pageSize,(page-1)*pageSize]);
  const [counts]=await w.sql(pool,'SELECT status,COUNT(*) AS n FROM player_season_registrations WHERE season_id=? GROUP BY status',[seasonId]);
  return {season,items:rows.map(r=>({...registration(r),account:{name:r.name,student_id:r.student_id,college:r.college,is_active:Boolean(r.is_active)}})),summary:Object.fromEntries(STATUSES.map(s=>[s,Number(counts.find(r=>r.status===s)?.n||0)])),pagination:query.pageMeta(page,pageSize,Number(count.n))};
}
async function file(id,fileId,user){
  const row=await readRow(pool,rules.id(id));
  if(user.role!=='admin'&&(user.role!=='player'||row.player_id!==user.id))throw rules.businessError('无权查看该学籍截图',403,'PLAYER_MATERIAL_FORBIDDEN');
  const [[item]]=await w.sql(pool,'SELECT * FROM player_registration_files WHERE id=? AND registration_id=?',[rules.id(fileId),row.id]);
  if(!item)throw rules.businessError('材料文件不存在',404);
  if(item.cleaned_at||!item.file_path)throw rules.businessError('该赛季材料已清理',410,'PLAYER_MATERIAL_CLEANED');
  return {path:images.resolve(item.file_path),mime:item.mime_type};
}
async function assertEligible(c,playerId,seasonId){
  const [[row]]=await w.sql(c,`SELECT a.id FROM player_accounts a JOIN player_season_registrations r ON r.player_id=a.id JOIN seasons s ON s.id=r.season_id LEFT JOIN player_season_settings st ON st.season_id=s.id
    WHERE a.id=? AND r.season_id=? AND a.is_active=1 AND r.status='approved' AND s.is_active=1 AND st.ended_at IS NULL FOR SHARE`,[playerId,seasonId]);
  if(!row)throw rules.businessError('球员尚未通过当季学籍审核、资格已撤销或账号已停用',409,'PLAYER_NOT_ELIGIBLE');
  return true;
}
async function notices(user){const [rows]=await w.sql(pool,'SELECT id,kind,message,season_id,related_team_id AS team_id,read_at,created_at FROM player_notifications WHERE player_id=? ORDER BY id DESC LIMIT 30',[user.id]);return rows.map(r=>({...r,message:r.kind==='team_auto_failed'?r.message.split('”自动审核失败')[0]+'”自动审核失败，请到球队报名查看详情；可修改后重提或申请人工审核。':r.message,read_at:w.chinaIso(r.read_at),created_at:w.chinaIso(r.created_at)}));}
async function readNotice(id,user){const [result]=await pool.execute('UPDATE player_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND player_id=?',[w.chinaSql(),rules.id(id),user.id]);if(!result.affectedRows)throw rules.businessError('提示不存在',404);return {read:true};}
module.exports={current,detail,submit,withdraw,review,list,file,assertEligible,notices,readNotice};
