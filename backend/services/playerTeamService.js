const pool=require('../db');
const rules=require('../utils/playerRules');
const w=require('../utils/playerWorkflow');
const transaction=work=>w.transaction(work,{readCommitted:true});
const r=require('../utils/teamApplicationRules');
const query=require('../utils/listQuery');
const eligibility=require('./playerRegistrationService');
const roster=require('./playerRosterService');
const settings=require('./playerSeasonSettingsService');
const automatic=require('../utils/teamAutoReview');
const tags=require('../utils/teamTags');
const {COLLEGE_RULE_VERSION,resolveCollege}=require('../utils/collegeIdentity');
const {businessDate}=require('../utils/competitionTime');

async function otherTeams(c,a){
  const [rows]=await w.sql(c,`SELECT DISTINCT p.player_account_id,t.id,t.team_name,t.league_type
    FROM team t JOIN team_player p ON p.team_id=t.id
    WHERE t.registration_revoked=0 AND t.season_id=? AND t.id<>? AND p.player_account_id IS NOT NULL
    AND p.roster_batch_id=(SELECT b.id FROM team_roster_batches b WHERE b.team_id=t.id
      AND (b.effective_from IS NULL OR b.effective_from<=?) ORDER BY b.effective_from DESC,b.version_no DESC,b.id DESC LIMIT 1)
    ORDER BY t.league_type,t.team_name,t.id`,[a.season_id,a.team_id||0,businessDate()]);
  const result=new Map();
  for(const {player_account_id,...team} of rows){if(!result.has(player_account_id))result.set(player_account_id,[]);result.get(player_account_id).push(team);}
  return result;
}
async function automaticReview(c,a,rows){
  let correction_allowed=correctionAllowed(a)||a.status==='pending'&&a.auto_review?.correction_allowed===true;
  if(a.status==='pending'&&!a.auto_review&&a.return_snapshot){
    const [[last]]=await w.sql(c,"SELECT e.operation FROM team_application_events e WHERE e.application_id=? AND e.operation IN ('returned','withdrawn') AND NOT EXISTS (SELECT 1 FROM team_application_events u WHERE u.application_id=e.application_id AND u.operation='return_undone' AND JSON_EXTRACT(u.before_snapshot,'$.revision')=e.revision) ORDER BY e.revision DESC LIMIT 1",[a.id]);
    correction_allowed=last?.operation==='returned';
  }
  const result=a.source_type==='admin_import'?{passed:true,exempt:true,checks:[],failures:[]}:automatic.fromMembers(a,rows);
  return {...result,checked_at:w.chinaIso(w.chinaSql()),competition_revision:a.competition_revision,application_revision:a.revision+1,correction_allowed};
}
async function recordAutoFailure(c,a,user,result){
  const before=await snapshot(c,a);
  await c.execute("UPDATE team_applications SET status='auto_failed',revision=revision+1,submitted_at=?,auto_review=? WHERE id=?",[w.chinaSql(),JSON.stringify(result),a.id]);
  const after=await application(c,a.id),reason=result.failures.map(v=>v.message).join('；').slice(0,500);
  await event(c,after,'auto_failed',user,before,reason);
  const access=await rights(c,after,await members(c,a.id),user);
  await notify(c,[access.manager,access.captain],`application:${a.id}:${after.revision}`,'team_auto_failed',`“${a.team_name}”自动审核失败：${reason}`,a.season_id,a.team_id);
  return detailIn(c,a.id,user);
}

async function application(c,id,lock=false){const [[a]]=await w.sql(c,`SELECT a.*,COALESCE(t.registration_revoked,0) AS registration_revoked,s.is_active,s.season_name,c.league_type,c.is_enabled,c.registration_opens_at,c.registration_closes_at,c.rules_text,${[...automatic.LIMIT_FIELDS,...tags.CONFIG_FIELDS].map(k=>'c.'+k).join(',')},c.revision AS competition_revision,st.ended_at FROM team_applications a LEFT JOIN team t ON t.id=a.team_id JOIN seasons s ON s.id=a.season_id JOIN season_competitions c ON c.id=a.competition_id LEFT JOIN player_season_settings st ON st.season_id=a.season_id WHERE a.id=?${lock?' FOR UPDATE':''}`,[rules.id(id)]);if(!a)throw rules.businessError('球队申请不存在',404);
  if(a.kind==='roster_change'){
    const [windows]=await w.sql(c,'SELECT opens_at,closes_at FROM roster_change_windows WHERE competition_id=? AND is_cancelled=0 ORDER BY opens_at',[a.competition_id]);
    const current=windows.find(v=>w.windowStatus(v.opens_at,v.closes_at)==='open')||windows.find(v=>w.windowStatus(v.opens_at,v.closes_at)==='upcoming')||windows.at(-1);
    a.registration_opens_at=current?.opens_at||null;a.registration_closes_at=current?.closes_at||null;
  }return a;}
async function members(c,id,locked=false){
  const [rows]=await w.sql(c,`SELECT m.*,
    COALESCE(p.student_id,JSON_UNQUOTE(JSON_EXTRACT(m.profile_snapshot,'$.student_id'))) AS student_id,
    COALESCE(p.name,JSON_UNQUOTE(JSON_EXTRACT(m.profile_snapshot,'$.name'))) AS name,
    p.college,p.gender,p.revision AS account_revision,p.is_active AS account_active,
    g.id AS registration_id,g.status AS qualification_status,g.revision AS qualification_revision,
    JSON_EXTRACT(CASE WHEN g.status='approved' THEN g.review_profile_snapshot ELSE
      (SELECT JSON_EXTRACT(e.after_snapshot,'$.review_profile_snapshot') FROM player_registration_events e
       WHERE e.registration_id=g.id AND e.operation='approved' ORDER BY e.revision DESC LIMIT 1)
    END,'$') AS review_profile_snapshot
    FROM team_application_members m LEFT JOIN player_accounts p ON p.id=m.player_id
    LEFT JOIN player_season_registrations g ON g.player_id=p.id AND g.season_id=(SELECT season_id FROM team_applications WHERE id=?)
    WHERE m.application_id=? AND m.is_removed=0 ORDER BY m.id${locked?' FOR SHARE':''}`,[id,id]);
  return rows;
}
function memberSnapshot(m){return {id:m.id,player_id:m.player_id,import_person_id:m.import_person_id||null,jersey_number:m.jersey_number,remark:m.remark||null,...Object.fromEntries(r.FLAGS.map(f=>[f,Boolean(m[f])])),profile_snapshot:m.profile_snapshot};}
async function snapshot(c,a){return {id:a.id,kind:a.kind,source_type:a.source_type,season_id:a.season_id,competition_id:a.competition_id,team_id:a.team_id,manager_player_id:a.manager_player_id,manager_import_person_id:a.manager_import_person_id||null,team_name:a.team_name,shirt_color:a.shirt_color,shorts_color:a.shorts_color,socks_color:a.socks_color,status:a.status,revision:a.revision,auto_review:a.auto_review,revoke_reason:a.revoke_reason,registration_revoked:Boolean(a.registration_revoked),members:(await members(c,a.id)).map(memberSnapshot)};}
async function rights(c,a,rows,user){
  let manager=a.manager_player_id,captain=rows.find(m=>m.is_captain)?.player_id||null;
  if(a.team_id&&!(a.kind==='initial'&&a.registration_revoked)){const [[team]]=await w.sql(c,'SELECT manager_player_id,captain_player_id FROM team WHERE id=?',[a.team_id]);manager=team.manager_player_id;captain=team.captain_player_id;}
  const manages=user.role==='player'&&[manager,captain].includes(user.id),isMember=user.role==='player'&&rows.some(m=>m.player_id===user.id);
  return {manager,captain,manages,isMember,canRead:user.role==='admin'||manages||isMember};
}
function window(a){return w.windowStatus(a.registration_opens_at,a.registration_closes_at);}
function writable(a){return Boolean(a.is_active&&a.is_enabled&&!a.ended_at&&!(a.kind==='roster_change'&&a.registration_revoked));}
function correctionAllowed(a){return !a.registration_revoked&&(a.status==='returned'||a.status==='auto_failed'&&a.auto_review?.correction_allowed===true);}
function editable(a){return writable(a)&&['draft','withdrawn','returned','auto_failed','revoked'].includes(a.status)&&(window(a)==='open'||correctionAllowed(a));}
async function authorized(c,id,user,{edit=false}={}){const a=await application(c,id),rows=await members(c,a.id),access=await rights(c,a,rows,user);if(!access.canRead||edit&&!access.manages)throw rules.businessError('只有本队负责人或场上队长可以操作',403,'TEAM_FORBIDDEN');return {a,rows,access};}
async function lock(c,id,user){const [[base]]=await w.sql(c,'SELECT season_id FROM team_applications WHERE id=?',[rules.id(id)]);if(!base)throw rules.businessError('球队申请不存在',404);await w.season(c,base.season_id,{active:true});await w.actor(c,user);return application(c,id,true);}
async function notify(c,ids,key,kind,message,seasonId,teamId=null){for(const playerId of new Set(ids.filter(Boolean)))await c.execute('INSERT INTO player_notifications (player_id,event_key,kind,message,season_id,related_team_id,created_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',[playerId,key,kind,Array.from(message).slice(0,500).join(''),seasonId,teamId,w.chinaSql()]);}
async function event(c,a,operation,user,before,reason=null){await c.execute('INSERT INTO team_application_events (application_id,revision,operation,actor_player_id,actor_admin_id,reason,before_snapshot,after_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[a.id,a.revision,operation,user.role==='player'?user.id:null,user.role==='admin'?user.id:null,reason,before?JSON.stringify(before):null,JSON.stringify(await snapshot(c,a)),w.chinaSql()]);}
async function approvedCounts(c,a){const [rows]=await w.sql(c,`SELECT p.player_account_id,COUNT(DISTINCT t.id) AS n FROM team t JOIN team_player p ON p.team_id=t.id WHERE t.registration_revoked=0 AND t.season_id=? AND t.league_type=? AND p.player_account_id IS NOT NULL AND p.roster_batch_id=(SELECT b.id FROM team_roster_batches b WHERE b.team_id=t.id AND (b.effective_from IS NULL OR b.effective_from<=?) ORDER BY b.effective_from DESC,b.version_no DESC,b.id DESC LIMIT 1) GROUP BY p.player_account_id`,[a.season_id,a.league_type,businessDate()]);return new Map(rows.map(v=>[v.player_account_id,Number(v.n)]));}
async function reviewContext(c,a,rows){const counts=await approvedCounts(c,a),participations=await otherTeams(c,a);const [[manager]]=a.manager_player_id?await w.sql(c,'SELECT id,student_id,name,college,gender,is_active,revision FROM player_accounts WHERE id=? FOR SHARE',[a.manager_player_id]):await w.sql(c,'SELECT NULL AS id,student_id,name,NULL AS college,0 AS is_active FROM imported_player_identities WHERE id=?',[a.manager_import_person_id]);const inputs=rows.map(m=>({id:m.id,player_id:m.player_id,name:m.name,student_id:m.student_id,college:m.college,gender:m.gender,account_revision:m.account_revision,account_active:m.account_active,qualification_status:m.qualification_status,qualification_revision:m.qualification_revision,review_profile_snapshot:m.review_profile_snapshot,approved_teams:participations.get(m.player_id)||[],approved_team_count:counts.get(m.player_id)||0}));const [[team]]=a.team_id?await w.sql(c,'SELECT revision FROM team WHERE id=?',[a.team_id]):[[]];return {counts,manager,participations,token:r.digest([COLLEGE_RULE_VERSION,a.id,a.revision,a.competition_revision,team?.revision,manager,inputs])};}
async function detailIn(c,id,user){
  const {a,rows,access}=await authorized(c,id,user);const manages=access.manages||user.role==='admin';const review=await reviewContext(c,a,rows);
  const current=await snapshot(c,a);const [replacements]=await w.sql(c,'SELECT member_id FROM team_return_replacements WHERE application_id=? AND return_revision=COALESCE((SELECT JSON_EXTRACT(return_snapshot,\'$.revision\')+1 FROM team_applications WHERE id=?),0)',[id,id]);
  // 权限按当前角色计算；普通队员不读取他人的学号、审核快照及内部操作记录。
  const outputMembers=rows.map(m=>({...memberSnapshot(m),gender:m.gender||null,is_captain:a.team_id&&a.status==='approved'?m.player_id?m.player_id===access.captain:Boolean(m.is_captain):Boolean(m.is_captain),profile_snapshot:manages?m.profile_snapshot:undefined,name:a.is_active?m.name:m.profile_snapshot.name,college:a.is_active?m.college:m.profile_snapshot.college,student_id:manages||m.player_id===user.id?m.student_id:undefined,qualification_status:manages?m.qualification_status:undefined,account_active:manages?Boolean(m.account_active):undefined,approved_team_count:user.role==='admin'?review.counts.get(m.player_id)||0:undefined,approved_teams:user.role==='admin'?review.participations.get(m.player_id)||[]:undefined,account_college:manages?m.college||null:undefined,auto_review_college:manages&&a.source_type!=='admin_import'?resolveCollege(m.college)||null:undefined,reviewed_college:manages?m.review_profile_snapshot?.college||null:undefined,registration_id:user.role==='admin'?m.registration_id:undefined}));
  const manager=access.manager===review.manager?.id?review.manager:access.manager?(await w.sql(c,'SELECT id,student_id,name,college,gender,revision,is_active FROM player_accounts WHERE id=?',[access.manager]))[0][0]:(await w.sql(c,'SELECT NULL AS id,i.student_id,i.name FROM team t JOIN imported_player_identities i ON i.id=t.manager_import_person_id WHERE t.id=?',[a.team_id]))[0][0];
  const data={application:{id:a.id,kind:a.kind,source_type:a.source_type,base_roster_batch_id:a.base_roster_batch_id,season_id:a.season_id,competition_id:a.competition_id,team_id:a.team_id,season_name:a.season_name,league_type:a.league_type,team_name:a.team_name,status:a.status,revision:a.revision,shirt_color:a.shirt_color,shorts_color:a.shorts_color,socks_color:a.socks_color,submitted_at:w.chinaIso(a.submitted_at),reviewed_at:w.chinaIso(a.reviewed_at),return_reason:manages?a.return_reason:null,revoke_reason:a.revoke_reason,registration_revoked:Boolean(a.registration_revoked)},manager:{id:manager?.id||null,name:manager?.name||'待关联负责人',student_id:manages?manager?.student_id:undefined},captain_player_id:access.captain,members:outputMembers,
    summary:{total:rows.length,foreign:rows.filter(m=>m.is_foreign).length,sports_training:rows.filter(m=>m.is_sports_training).length,football_specialty:rows.filter(m=>m.is_football_specialty).length,goalkeepers:rows.filter(m=>m.is_goalkeeper).length},
    auto_review:manages?a.auto_review||null:undefined,current_auto_review:manages&&a.source_type!=='admin_import'?automatic.fromMembers(a,rows):null,
    window:{limits:Object.fromEntries([...automatic.LIMIT_FIELDS,...tags.CONFIG_FIELDS].map(k=>[k,a[k]??null])),status:window(a),opens_at:w.chinaIso(a.registration_opens_at),closes_at:w.chinaIso(a.registration_closes_at),rules_text:a.rules_text||'',enabled:Boolean(a.is_enabled),active:Boolean(a.is_active),ended:Boolean(a.ended_at)},
    permissions:{can_revoke:user.role==='admin'&&writable(a)&&a.kind==='initial'&&a.source_type==='online'&&a.status==='approved'&&Boolean(a.team_id)&&!a.registration_revoked,can_manage:access.manages,can_edit:access.manages&&editable(a),can_submit:access.manages&&editable(a),can_withdraw:access.manages&&Boolean(a.is_active&&a.is_enabled&&!a.ended_at)&&(a.kind==='roster_change'?['draft','pending','returned','auto_failed'].includes(a.status):a.status==='pending'&&window(a)==='open'),can_submit_manual:access.manages&&editable(a)&&a.status==='auto_failed',can_override:user.role==='admin'&&writable(a)&&(a.status==='auto_failed'||a.status==='pending'&&a.auto_review?.manual_requested===true&&!a.auto_review?.passed),can_review:user.role==='admin'&&writable(a)&&a.status==='pending'&&!(a.auto_review?.manual_requested&&!a.auto_review?.passed),can_return:user.role==='admin'&&writable(a)&&['pending','auto_failed'].includes(a.status)},
    correction:manages?{restricted:correctionAllowed(a)&&window(a)!=='open',replaceable_member_ids:replacements.map(v=>v.member_id),member_comments:a.member_comments||{},differences:r.differences(a.return_snapshot||a.base_snapshot,current)}:null};
  if(manages){const [events]=await w.sql(c,'SELECT id,revision,operation,actor_player_id,actor_admin_id,reason,before_snapshot,after_snapshot,created_at FROM team_application_events WHERE application_id=? ORDER BY revision DESC LIMIT 100',[id]);data.events=events.map(e=>({...e,created_at:w.chinaIso(e.created_at),changes:r.differences(e.before_snapshot,e.after_snapshot)}));}
  if(user.role==='admin')data.review_token=review.token;
  if(user.role==='admin'){
    const canUndo=await require('./teamOperationUndoService').available(c,a);
    data.permissions.can_undo_return=canUndo&&a.admin_undo.operation==='returned';
    data.permissions.can_undo_revoke=canUndo&&a.admin_undo.operation==='revoked';
  }
  return tags.present(a,data);
}
const detail=(id,user)=>transaction(c=>detailIn(c,rules.id(id),user));
async function response(c,a,user){const rows=await members(c,a.id),access=await rights(c,a,rows,user);return access.canRead?detailIn(c,a.id,user):{access_changed:true,id:a.id,message:'已保存，你已不再担任此队的管理角色。'};}
async function create(user,body,key){
  rules.onlyKeys(body,['season_id','competition_id','team_name','shirt_color','shorts_color','socks_color']);key=r.requestKey(key);
  const seasonId=rules.id(body.season_id),competitionId=rules.id(body.competition_id),data=r.normalize({team_name:body.team_name,shirt_color:body.shirt_color,shorts_color:body.shorts_color,socks_color:body.socks_color,members:[]}),hash=r.digest([seasonId,competitionId,data]);
  return transaction(async c=>{
    await w.season(c,seasonId,{active:true});await w.actor(c,user);
    const [[prior]]=await w.sql(c,'SELECT id,request_hash FROM team_applications WHERE manager_player_id=? AND request_key=?',[user.id,key]);if(prior){if(prior.request_hash!==hash)throw rules.businessError('提交标识不能用于另一份球队草稿',409);return detailIn(c,prior.id,user);}
    const [[competition]]=await w.sql(c,'SELECT * FROM season_competitions WHERE id=? AND season_id=?',[competitionId,seasonId]);if(!competition?.is_enabled||w.windowStatus(competition.registration_opens_at,competition.registration_closes_at)!=='open')throw rules.businessError('当前赛事未启用或不在球队报名时间内',409,'TEAM_WINDOW_CLOSED');
    const [result]=await c.execute("INSERT INTO team_applications (season_id,competition_id,manager_player_id,kind,team_name,shirt_color,shorts_color,socks_color,revision,request_key,request_hash,created_at) VALUES (?,?,?,'initial',?,?,?,?,1,?,?,?)",[seasonId,competitionId,user.id,data.team_name,data.shirt_color,data.shorts_color,data.socks_color,key,hash,w.chinaSql()]);
    const a=await application(c,result.insertId);await event(c,a,'created',user,null);return detailIn(c,a.id,user);
  });
}
async function lookup(id,studentId,user){return transaction(async c=>{const {a}=await authorized(c,rules.id(id),user,{edit:true});if(!editable(a))throw rules.businessError('当前不能编辑该报名名单',409);const [[p]]=await w.sql(c,'SELECT id,student_id,name,college,gender,revision FROM player_accounts WHERE student_id=?',[rules.studentId(studentId)]);if(!p)throw rules.businessError('未找到该学号，请先注册球员账号',404);await eligibility.assertEligible(c,p.id,a.season_id);return p;});}
async function save(id,user,body,revision){const data=r.normalize(body);return transaction(async c=>{
  const a=await lock(c,id,user),{rows}=await authorized(c,a.id,user,{edit:true});w.expectRevision(a.revision,revision);if(!editable(a))throw rules.businessError('当前不能编辑该申请；待审名单已冻结，普通编辑须在报名窗口内',409,'TEAM_WINDOW_CLOSED');
  await require('./rosterChangeService').assertBase(c,a);
  for(const m of data.members)for(const tag of tags.TAGS)if(!tags.enabled(a,tag.key))m[tag.flag]=Boolean(rows.find(old=>old.id===m.id&&old.player_id===m.player_id)?.[tag.flag]);
  for(const m of data.members)if(m.id&&!rows.some(old=>old.id===m.id))throw rules.businessError('名单行已失效或不属于本申请',409);
  if(window(a)!=='open'){const [allowed]=await w.sql(c,'SELECT member_id FROM team_return_replacements WHERE application_id=? AND return_revision=COALESCE((SELECT JSON_EXTRACT(return_snapshot,\'$.revision\')+1 FROM team_applications WHERE id=?),0)',[a.id,a.id]);r.correction(a.return_snapshot,data,allowed.map(v=>v.member_id));}
  const before=await snapshot(c,a),profiles=new Map();
  for(const m of [...data.members].sort((a,b)=>a.player_id-b.player_id)){const old=rows.find(v=>v.id===m.id);if(!old||old.player_id!==m.player_id)await eligibility.assertEligible(c,m.player_id,a.season_id);const [[p]]=await w.sql(c,'SELECT id,student_id,name,college,gender FROM player_accounts WHERE id=? FOR SHARE',[m.player_id]);if(!p)throw rules.businessError('球员账号不存在');profiles.set(m.player_id,w.accountSnapshot(p));}
  // 保留稳定名单行及退回权限引用；先释放当前唯一键，支持交换号码和队长。
  await c.execute('UPDATE team_application_members SET is_removed=1,is_captain=0 WHERE application_id=?',[a.id]);
  for(const m of data.members){const values=[m.player_id,m.jersey_number,...r.FLAGS.map(f=>Number(m[f])),m.remark,JSON.stringify(profiles.get(m.player_id))];if(m.id)await c.execute('UPDATE team_application_members SET player_id=?,jersey_number=?,is_captain=?,is_goalkeeper=?,is_foreign=?,is_sports_training=?,is_football_specialty=?,remark=?,profile_snapshot=?,is_removed=0 WHERE id=? AND application_id=?',[...values,m.id,a.id]);else{const [result]=await c.execute('INSERT INTO team_application_members (application_id,player_id,jersey_number,is_captain,is_goalkeeper,is_foreign,is_sports_training,is_football_specialty,remark,profile_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?)',[a.id,...values]);m.id=result.insertId;}}
  await c.execute("UPDATE team_applications SET team_name=?,shirt_color=?,shorts_color=?,socks_color=?,status=IF(kind='roster_change' AND status='withdrawn','draft',status),revision=revision+1 WHERE id=?",[data.team_name,data.shirt_color,data.shorts_color,data.socks_color,a.id]);
  const after=await application(c,a.id);await event(c,after,'saved',user,before);
  for(const m of data.members)if(!rows.some(old=>old.player_id===m.player_id))await notify(c,[m.player_id],`application:${a.id}:${after.revision}:added`,'team_added',`你已被加入${a.season_name}·${a.league_type}“${data.team_name}”的报名草稿，尚待整队审核。`,a.season_id);
  const captain=data.members.find(m=>m.is_captain)?.player_id;if((!a.team_id||a.kind==='initial'&&a.registration_revoked)&&captain&&!rows.some(m=>m.is_captain&&m.player_id===captain))await notify(c,[captain],`application:${a.id}:${after.revision}:captain`,'team_captain_assigned',`你已被指定为“${data.team_name}”报名草稿的场上队长，可与负责人协作。`,a.season_id);
  return response(c,after,user);
});}

async function checkSubmission(c,a,{skipPlayerEligibility=false}={}){
  await require('./rosterChangeService').assertBase(c,a);
  const rows=await members(c,a.id,true);if(a.source_type!=='admin_import'&&rows.some(m=>!m.player_id))throw rules.businessError('当前名单存在未关联账号的球员，请先完成注册关联，或移除后按学号重新添加');const data=r.normalize({team_name:a.team_name,shirt_color:a.shirt_color,shorts_color:a.shorts_color,socks_color:a.socks_color,members:rows.map(m=>({...memberSnapshot(m),player_id:a.source_type==='admin_import'?m.id:m.player_id})).map(({profile_snapshot,import_person_id,...m})=>m)},{complete:true});
  if(!skipPlayerEligibility&&a.source_type!=='admin_import'&&rows.some(m=>!m.gender))throw rules.businessError('队伍中有人未选择性别，无法提交队伍创建申请：'+rows.filter(m=>!m.gender).map(m=>m.name).join('、'),400,'TEAM_GENDER_REQUIRED');
  if(!skipPlayerEligibility&&a.source_type!=='admin_import')for(const m of [...rows].sort((a,b)=>a.player_id-b.player_id))await eligibility.assertEligible(c,m.player_id,a.season_id);
  const [[manager]]=await w.sql(c,'SELECT is_active FROM player_accounts WHERE id=? FOR SHARE',[a.manager_player_id]);if(!skipPlayerEligibility&&a.source_type!=='admin_import'&&!manager?.is_active)throw rules.businessError('球队负责人账号已停用，请先处理负责人账号',409);
  const [[existing]]=await w.sql(c,'SELECT id FROM team WHERE season_id=? AND league_type=? AND team_name=? AND id<>?',[a.season_id,a.league_type,a.team_name,a.team_id||0]);if(existing)throw rules.businessError('本赛季该赛事已有同名正式球队，请修改队名',409,'TEAM_NAME_TAKEN');return {data,rows,autoReview:await automaticReview(c,a,rows)};
}
async function submit(id,user,revision,{manual=false}={}){return transaction(async c=>{const a=await lock(c,id,user);await authorized(c,id,user,{edit:true});w.expectRevision(a.revision,revision);if(!editable(a))throw rules.businessError('当前不在球队报名开放时间，或申请已经提交',409,'TEAM_WINDOW_CLOSED');if(manual&&a.status!=='auto_failed')throw rules.businessError('请先完成自动审核，再申请人工审核',409);const {data,autoReview}=await checkSubmission(c,a);
  if(window(a)!=='open'){const [allowed]=await w.sql(c,'SELECT member_id FROM team_return_replacements WHERE application_id=? AND return_revision=COALESCE((SELECT JSON_EXTRACT(return_snapshot,\'$.revision\')+1 FROM team_applications WHERE id=?),0)',[a.id,a.id]);r.correction(a.return_snapshot,data,allowed.map(v=>v.member_id));}
  if(!autoReview.passed&&!manual)return recordAutoFailure(c,a,user,autoReview);
   if(manual)autoReview.manual_requested=true;
   const before=await snapshot(c,a);await c.execute('UPDATE team_application_members m JOIN player_accounts p ON p.id=m.player_id SET m.profile_snapshot=JSON_OBJECT(\'id\',p.id,\'student_id\',p.student_id,\'name\',p.name,\'college\',p.college,\'gender\',p.gender) WHERE m.application_id=? AND m.is_removed=0',[a.id]);
  await c.execute("UPDATE team_applications SET status='pending',revision=revision+1,submitted_at=?,auto_review=? WHERE id=?",[w.chinaSql(),JSON.stringify(autoReview),a.id]);const after=await application(c,a.id);await c.execute('UPDATE team_applications SET submitted_snapshot=? WHERE id=?',[JSON.stringify(await snapshot(c,after)),a.id]);await event(c,after,'submitted',user,before,manual?'自动审核后仍然提交，申请人工审核':null);
  await notify(c,[a.manager_player_id,data.members.find(m=>m.is_captain).player_id],`application:${id}:${after.revision}`,'team_submitted',`“${a.team_name}”已提交${a.league_type}整队审核。`,a.season_id);return detailIn(c,id,user);
});}
async function withdraw(id,user,revision){return transaction(async c=>{const a=await lock(c,id,user);await authorized(c,id,user,{edit:true});w.expectRevision(a.revision,revision);if(!(a.is_active&&a.is_enabled&&!a.ended_at)||(a.kind==='roster_change'?!['draft','pending','returned','auto_failed'].includes(a.status):a.status!=='pending'||window(a)!=='open'))throw rules.businessError('仅报名窗口内的待审申请可以撤回',409,'TEAM_WINDOW_CLOSED');const before=await snapshot(c,a);await c.execute("UPDATE team_applications SET status='withdrawn',auto_review=NULL,revision=revision+1 WHERE id=?",[id]);const after=await application(c,id);await event(c,after,'withdrawn',user,before);return detailIn(c,id,user);});}

async function context(){const [seasons]=await w.sql(pool,'SELECT id,season_name,is_active FROM seasons ORDER BY start_date DESC,id DESC');const active=seasons.find(s=>s.is_active);const config=active?await settings.read(active.id):null;return {seasons,current_season_id:active?.id||null,competitions:config?.competitions.filter(c=>c.is_enabled)||[],ended:Boolean(config?.ended_at)};}
module.exports={automaticReview,recordAutoFailure,application,members,snapshot,rights,window,writable,editable,authorized,lock,notify,event,approvedCounts,reviewContext,detailIn,detail,create,lookup,save,checkSubmission,submit,withdraw,context};
