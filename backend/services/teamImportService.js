const crypto=require('node:crypto');
const w=require('../utils/playerWorkflow');
const rules=require('../utils/playerRules');
const r=require('../utils/teamApplicationRules');
const service=require('./playerTeamService');
const changes=require('./rosterChangeService');
const rosters=require('./playerRosterService');
const identities=require('./importedIdentityService');
const transaction=work=>w.transaction(work,{readCommitted:true});
const sign=value=>crypto.createHmac('sha256',process.env.JWT_SECRET).update(JSON.stringify(value)).digest('hex');

async function inspect(c,input,user){
  const season=await w.season(c,rules.id(input.season_id),{active:true});await w.actor(c,user);
  let team=null,batch=null;
  if(input.team_id){
    [[team]]=await w.sql(c,'SELECT * FROM team WHERE id=? FOR UPDATE',[rules.id(input.team_id)]);
    if(!team||team.season_id!==season.id)throw rules.businessError('只能导入当前赛季的球队');
    if(team.registration_revoked)throw rules.businessError('球队报名通过已撤销，请先重新提交报名并通过审核',409,'TEAM_REGISTRATION_REVOKED');
    await changes.assertNoOther(c,team.id);batch=await rosters.effectiveBatch(team.id,undefined,c);
  }
  const league=team?.league_type||input.league_type;
  const tags=require('../utils/teamTags');
  const competition=await require('./competitionService').requireCompetition(c,season.id,league);
  // Administrator-confirmed imports are a separate path from player signup windows.
  const manager=await identities.inspect(c,season.id,input.manager_student_id,input.manager_name);
  if(team?.manager_player_id){
    const [[current]]=await w.sql(c,'SELECT student_id,name FROM player_accounts WHERE id=?',[team.manager_player_id]);
    if(current.student_id!==manager.student_id||current.name!==manager.name)throw rules.businessError('已有球队更换负责人请使用单独的角色变更审核');
  }
  const metadata={team_name:r.text(input.team_name,'队名',100),shirt_color:r.text(input.shirt_color,'上衣颜色',50,true),shorts_color:r.text(input.shorts_color,'裤子颜色',50,true),socks_color:r.text(input.socks_color,'袜子颜色',50,true)};
  const errors=[...(input.errors||[])],members=[];
  const counts=await service.approvedCounts(c,{season_id:season.id,league_type:league});
  for(const row of input.players){
    const p=await identities.inspect(c,season.id,row.student_id,row.player_name);
    members.push({...tags.visibleMembers(competition,[row])[0],...p,player_id:p.id,approved_team_count:counts.get(p.id)||0});
  }
  try{r.normalize({...metadata,members:members.map((m,i)=>({player_id:i+1,jersey_number:m.jersey_number,remark:m.remark,...Object.fromEntries(r.FLAGS.map(f=>[f,m[f]]))}))},{complete:true});}catch(e){if(!e.isBusinessError)throw e;errors.push({row_number:null,message:e.message});}
  const [[duplicate]]=await w.sql(c,'SELECT id FROM team WHERE season_id=? AND league_type=? AND team_name=? AND id<>?',[season.id,league,metadata.team_name,team?.id||0]);
  if(duplicate)errors.push({row_number:null,message:'本赛季该赛事已有同名正式球队'});
  return {season_id:season.id,season_name:season.season_name,team_id:team?.id||null,base_team_revision:team?.revision??null,base_roster_batch_id:batch?.id||null,competition_id:competition.id,competition_revision:competition.revision,league_type:league,rules_text:competition.rules_text,enable_sports_training:Boolean(competition.enable_sports_training),enable_football_specialty:Boolean(competition.enable_football_specialty),manager,metadata,members,errors,summary:{total:members.length,unlinked:members.filter(m=>!m.player_id).length,foreign:members.filter(m=>m.is_foreign).length,sports_training:members.filter(m=>m.is_sports_training).length,football_specialty:members.filter(m=>m.is_football_specialty).length,goalkeepers:members.filter(m=>m.is_goalkeeper).length}};
}
async function preview(body,parsed,user){
  const input={season_id:rules.id(body.season_id),team_id:body.team_id?rules.id(body.team_id):null,league_type:body.league_type||null,team_name:body.team_name,manager_student_id:body.manager_student_id,manager_name:body.manager_name,shirt_color:body.shirt_color,shorts_color:body.shorts_color,socks_color:body.socks_color,players:parsed.players,errors:parsed.errors,file_name:parsed.source_name};
  return transaction(async c=>{
    const data=await inspect(c,input,user),envelope={input,admin_id:user.id,expires_at:Date.now()+30*60*1000,state_hash:r.digest(data)};
    return {...data,can_confirm:!data.errors.length,preview:envelope,preview_token:sign(envelope)};
  });
}
async function confirm(body,user,key){
  rules.onlyKeys(body,['preview','preview_token']);key=r.requestKey(key);
  if(!body.preview||typeof body.preview_token!=='string'||!/^[a-f0-9]{64}$/.test(body.preview_token)||!crypto.timingSafeEqual(Buffer.from(sign(body.preview)),Buffer.from(body.preview_token)))throw rules.businessError('导入预览凭据无效，请重新预览',409);
  const envelope=body.preview;
  if(envelope.admin_id!==user.id)throw rules.businessError('请使用当前管理员重新预览',403);
  return transaction(async c=>{
    await w.season(c,envelope.input.season_id,{active:true});await w.actor(c,user);
    const [[prior]]=await w.sql(c,'SELECT id,request_hash,team_id FROM team_applications WHERE created_by_admin_id=? AND request_key=?',[user.id,key]);
    if(prior){if(prior.request_hash!==r.digest(envelope))throw rules.businessError('该提交标识已用于其他导入',409);return {team_id:prior.team_id,application_id:prior.id,replayed:true};}
    if(envelope.expires_at<Date.now())throw rules.businessError('预览已过期，请重新预览',409);
    const data=await inspect(c,envelope.input,user);
    if(data.errors.length||r.digest(data)!==envelope.state_hash)throw rules.businessError('球队、球员资料、资格、参队数量或窗口已变化，请重新预览',409);
    const manager=await identities.ensure(c,data.season_id,data.manager,user);
    const people=[];for(const m of data.members)people.push(await identities.ensure(c,data.season_id,{...m,id:m.player_id},user));
    const [insert]=await c.execute(`INSERT INTO team_applications
      (season_id,competition_id,team_id,manager_player_id,manager_import_person_id,kind,source_type,status,team_name,shirt_color,shorts_color,socks_color,revision,base_roster_batch_id,base_team_revision,created_by_admin_id,import_file_name,request_key,request_hash,created_at,submitted_at)
      VALUES (?,?,?,?,?,?,'admin_import','pending',?,?,?,?,1,?,?,?,?,?,?,?,?)`,
    [data.season_id,data.competition_id,data.team_id,manager.player_id,manager.id,data.team_id?'roster_change':'initial',...Object.values(data.metadata),data.base_roster_batch_id,data.base_team_revision,user.id,envelope.input.file_name,key,r.digest(envelope),w.chinaSql(),w.chinaSql()]);
    for(const [i,m]of data.members.entries())await c.execute(`INSERT INTO team_application_members (application_id,player_id,import_person_id,jersey_number,is_captain,is_goalkeeper,is_foreign,is_sports_training,is_football_specialty,remark,profile_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[insert.insertId,people[i].player_id,people[i].id,m.jersey_number,...r.FLAGS.map(f=>Number(m[f])),m.remark,JSON.stringify({id:people[i].player_id,student_id:m.student_id,name:m.name,college:m.college})]);
    const a=await service.application(c,insert.insertId),before=await service.snapshot(c,a);
    await c.execute('UPDATE team_applications SET submitted_snapshot=? WHERE id=?',[JSON.stringify(before),a.id]);
    await service.event(c,a,'submitted',user,null,'管理员导入预览确认');
    const result=await require('./teamPublicationService').publish(c,a,user),after=await service.application(c,a.id);
    await service.event(c,after,'approved',user,before,'管理员预览并确认导入，即完成审核，立即生效');
    await service.notify(c,[data.manager.id,...data.members.map(m=>m.player_id),...(result.previousPlayerIds||[])],`application:${a.id}:${after.revision}`,'team_approved',`${data.league_type}“${data.metadata.team_name}”的正式名单已由管理员导入并立即生效。`,data.season_id,result.teamId);
    return {team_id:result.teamId,application_id:a.id,batch_id:result.batchId};
  });
}
module.exports={preview,confirm};
