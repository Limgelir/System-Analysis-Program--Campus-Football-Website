// 独立追加、整批事务、私有凭据；只操作本次新建赛季和新账号。
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),bcrypt=require('bcryptjs');
const pool=require('../db'),w=require('../utils/playerWorkflow'),academic=require('../utils/playerAcademicUpload');
const {BACKEND_ROOT,UPLOAD_ROOT}=require('../utils/uploadPaths');
const {assertMigrationsCurrent}=require('../utils/migrationRunner');
const {recordSecurityEvent}=require('../utils/securityEvents');
const {businessDate}=require('../utils/competitionTime');
const {parseArguments,definitions,image}=require('./playerDemoData');
const teams=require('../services/playerTeamService');
const fixtureReason='[虚构测试数据生成器] 合成审批和比赛记录，不代表真实学籍或人工审核。';
function assertAuthorized(env,database){
  if(env.PLAYER_DEMO_CONFIRM!==`APPEND_${database}`)throw Error('请设置 PLAYER_DEMO_CONFIRM=APPEND_数据库名；只追加虚构数据');
  if(env.NODE_ENV==='production'&&env.PLAYER_DEMO_ALLOW_PRODUCTION!=='true')throw Error('服务器生成测试数据还需 PLAYER_DEMO_ALLOW_PRODUCTION=true');
}
function validateOutput(file){
  const inside=(root)=>{const relative=path.relative(root,file);return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
  if(path.extname(file)!=='.seed'||[UPLOAD_ROOT,path.resolve(BACKEND_ROOT,'../frontend'),path.resolve(BACKEND_ROOT,'../player-frontend'),path.resolve('/var/www')].some(inside))throw Error('凭据必须为私有目录中的 .seed 文件，不能放入网页或上传目录');
  return file;
}
function outputPath(env,batch){const value=env.PLAYER_DEMO_OUTPUT||path.join(BACKEND_ROOT,`player-demo-${batch}.seed`);if(env.NODE_ENV==='production'&&!path.isAbsolute(value))throw Error('生产凭据位置必须是绝对路径');return validateOutput(path.resolve(BACKEND_ROOT,value));}
async function registration(c,p,seasonId,adminId,files){
  if(p.status==='unsubmitted')return;
  const now=w.chinaSql(),profile=w.accountSnapshot(p);
  const [r]=await c.execute("INSERT INTO player_season_registrations (player_id,season_id,status,revision,profile_snapshot,submitted_at) VALUES (?,?,'pending',1,?,?)",[p.id,seasonId,JSON.stringify(profile),now]);p.registration_id=r.insertId;
  const buffer=image(),meta=academic.validate({buffer,size:buffer.length,mimetype:'image/png'}),stored=await academic.save({buffer},meta);files.push(stored);
  await c.execute('INSERT INTO player_registration_files (registration_id,revision,file_path,mime_type,sha256,created_at) VALUES (?,1,?,?,?,?)',[r.insertId,stored,meta.mime,meta.sha256,now]);
  let before=null;
  const states=p.status==='revoked'?['pending','approved','revoked']:p.status==='pending'?['pending']:['pending',p.status];
  for(let i=0;i<states.length;i++){
    const status=states[i],revision=i+1,reviewed=['approved','returned','revoked'].includes(status);
    const after={id:r.insertId,player_id:p.id,season_id:seasonId,status,revision,profile_snapshot:profile,review_profile_snapshot:reviewed?profile:null,return_reason:reviewed?fixtureReason:null};
    await c.execute('UPDATE player_season_registrations SET status=?,revision=?,review_profile_snapshot=?,reviewed_at=?,reviewed_by_admin_id=?,return_reason=? WHERE id=?',[status,revision,reviewed?JSON.stringify(profile):null,reviewed?now:null,reviewed?adminId:null,reviewed?fixtureReason:null,r.insertId]);
    await c.execute('INSERT INTO player_registration_events (registration_id,revision,operation,actor_player_id,actor_admin_id,reason,before_snapshot,after_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[r.insertId,revision,status==='pending'?'submitted':status,reviewed?null:p.id,reviewed?adminId:null,fixtureReason,before?JSON.stringify(before):null,JSON.stringify(after),now]);before=after;
  }
}
async function application(c,{seasonId,competition,manager,players,name,status,adminId}){
  const [r]=await c.execute("INSERT INTO team_applications (season_id,competition_id,manager_player_id,kind,team_name,shirt_color,shorts_color,socks_color,status,revision,request_key,request_hash) VALUES (?,?,?,'initial',?,'蓝','白','蓝','draft',1,?,?)",[seasonId,competition.id,manager.id,name,crypto.randomUUID(),crypto.createHash('sha256').update(name+competition.id).digest('hex')]);
  for(const [i,p]of players.entries())await c.execute('INSERT INTO team_application_members (application_id,player_id,jersey_number,is_captain,is_goalkeeper,is_foreign,is_sports_training,profile_snapshot) VALUES (?,?,?,?,?,?,?,?)',[r.insertId,p.id,String(i===0?7:i===1?10:i+10),Number(i===0),Number(i===0),Number(i===1),Number(i===1),JSON.stringify(w.accountSnapshot(p))]);
  const admin={id:adminId,role:'admin'},actor={id:manager.id,role:'player'};
  let a=await teams.application(c,r.insertId);await teams.event(c,a,'created',actor,null,fixtureReason);
  if(status==='draft')return {id:a.id,status,name};
  let before=await teams.snapshot(c,a);
  await c.execute("UPDATE team_applications SET status='pending',revision=2,submitted_at=? WHERE id=?",[w.chinaSql(),a.id]);a=await teams.application(c,a.id);
  await c.execute('UPDATE team_applications SET submitted_snapshot=? WHERE id=?',[JSON.stringify(await teams.snapshot(c,a)),a.id]);await teams.event(c,a,'submitted',actor,before,fixtureReason);
  if(status==='pending')return {id:a.id,status,name};
  before=await teams.snapshot(c,a);
  if(status==='returned'){
    await c.execute("UPDATE team_applications SET status='returned',revision=3,return_reason=?,return_snapshot=?,reviewed_at=?,reviewed_by_admin_id=? WHERE id=?",[fixtureReason+' 请核对号码和球衣颜色。',JSON.stringify(before),w.chinaSql(),adminId,a.id]);
    await teams.event(c,await teams.application(c,a.id),'returned',admin,before,fixtureReason);return {id:a.id,status,name};
  }
  // 仅为这个未启用的虚构赛季预置正式名单；不暂时切换当前赛季，也不放宽在线审核服务。
  const metadata={team_name:name,manager_player_id:manager.id,captain_player_id:players[0].id,shirt_color:'蓝',shorts_color:'白',socks_color:'蓝'};
  const [team]=await c.execute('INSERT INTO team (season_id,team_name,league_type,manager_player_id,captain_player_id,shirt_color,shorts_color,socks_color,revision,description) VALUES (?,?,?,?,?,?,?,?,1,?)',[seasonId,name,competition.league_type,manager.id,players[0].id,'蓝','白','蓝',fixtureReason]);
  const [batch]=await c.execute("INSERT INTO team_roster_batches (team_id,season_id,version_no,source_type,application_id,application_revision,effective_from,approved_at,metadata_snapshot) VALUES (?,?,1,'online',?,3,?,?,?)",[team.insertId,seasonId,a.id,businessDate(),w.chinaSql(),JSON.stringify(metadata)]);
  const [members]=await c.execute('SELECT * FROM team_application_members WHERE application_id=?',[a.id]);
  for(const m of members){const p=players.find(p=>p.id===m.player_id);await c.execute('INSERT INTO team_player (team_id,roster_batch_id,player_account_id,jersey_number,player_name,is_captain,is_goalkeeper,is_foreign,is_sports_training,profile_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?)',[team.insertId,batch.insertId,p.id,m.jersey_number,p.name,m.is_captain,m.is_goalkeeper,m.is_foreign,m.is_sports_training,JSON.stringify(w.accountSnapshot(p))]);}
  await c.execute("UPDATE team_applications SET team_id=?,status='approved',revision=3,effective_from=?,reviewed_at=?,reviewed_by_admin_id=? WHERE id=?",[team.insertId,businessDate(),w.chinaSql(),adminId,a.id]);
  await teams.event(c,await teams.application(c,a.id),'approved',admin,before,fixtureReason);
  await teams.notify(c,[manager.id,...players.map(p=>p.id)],`player-demo:${a.id}`,'team_approved',name+' 的虚构测试名单已准备。',seasonId,team.insertId);
  return {id:a.id,status,name,team_id:team.insertId,batch_id:batch.insertId,league_type:competition.league_type};
}
async function refereeAccounts(c,seasonId,adminId,batch){
  const {buildDemoDefinitions,buildRegistrationEvents}=require('./demoSeed');
  const refs=buildDemoDefinitions('small',new Date(),'all-approved').referees.slice(0,5);
  for(const [i,r]of refs.entries()){
    r.student_id=`PD-${batch}-R${i+1}`;r.name=`测试${batch}裁判${i+1}`;r.password=`Demo!9${crypto.randomBytes(12).toString('base64url')}`;
    const [insert]=await c.execute("INSERT INTO referee (student_id,name,grade,target_level,level_promoted_at,match_types,password_hash,must_change_password,is_active,password_changed_at) VALUES (?,?,'三级','二级',?,'大联赛,足协杯,新生杯',?,0,1,NOW())",[r.student_id,r.name,businessDate(),await bcrypt.hash(r.password,10)]);r.id=insert.insertId;
    await c.execute("INSERT INTO referee_profile (referee_id,gender,college,height_cm,weight_kg) VALUES (?,'男','虚构测试学院',175,65)",[r.id]);
    r.registration_status='approved';r.match_types=['大联赛','足协杯','新生杯'];r.college='虚构测试学院';
    const events=buildRegistrationEvents(r,seasonId,adminId),last=events.at(-1).after_snapshot;
    const [reg]=await c.execute('INSERT INTO referee_season_registrations (season_id,referee_id,name_snapshot,height_cm_snapshot,weight_kg_snapshot,college_snapshot,grade_snapshot,match_types_snapshot,status,submitted_at,reviewed_at,reviewed_by_admin_id,review_reason,application_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)',[seasonId,r.id,last.name_snapshot,last.height_cm_snapshot,last.weight_kg_snapshot,last.college_snapshot,last.grade_snapshot,JSON.stringify(last.match_types_snapshot),last.status,last.submitted_at,last.reviewed_at,adminId,fixtureReason]);
    let before=null;for(const event of events){const after={id:reg.insertId,...event.after_snapshot,review_reason:event.after_snapshot.status==='approved'?fixtureReason:null};await c.execute('INSERT INTO referee_season_registration_events (registration_id,season_id,referee_id,event_type,from_status,to_status,application_version,actor_type,actor_referee_id,actor_admin_id,reason,before_snapshot,after_snapshot,created_at) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?)',[reg.insertId,seasonId,r.id,event.event_type,before?.status||null,after.status,event.actor_type,event.actor_referee_id,event.actor_admin_id,fixtureReason,before?JSON.stringify(before):null,JSON.stringify(after),event.created_at]);before=after;}
  }
  return refs.map(r=>({id:r.id,student_id:r.student_id,name:r.name,password:r.password}));
}
async function schedules(c,seasonId,formal,adminId,batch,refs){
  const [ref]=await c.execute('INSERT INTO external_referees (name,note,created_by_admin_id) VALUES (?,?,?)',[`测试${batch}非系统裁判员`,fixtureReason,adminId]);
  const home=formal[0],away=formal[1],result=[];
  const [roster]=await c.execute('SELECT id FROM team_player WHERE roster_batch_id=? ORDER BY id',[home.batch_id]);
  const history=require('../utils/reportHistory'),service=require('../services/reportService');
  for(let i=0;i<3;i++){
    const [m]=await c.execute('INSERT INTO match_schedules (season_id,match_type,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot,match_date,match_time,venue,field_order,main_referee_name_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[seasonId,home.league_type,home.team_id,away.team_id,home.name,away.name,businessDate(),'17:35','樱花人草',i+1,`测试${batch}非系统裁判员`]);
    const roles=require('../utils/officialAssignments').ROLES.filter(r=>require('../utils/officialRequirements').roleRequired({},r.code));
    for(const [n,role]of roles.entries()){
      const external=i!==1&&n===0,person=refs[n],name=external?`测试${batch}非系统裁判员`:person.name;
      await c.execute(`UPDATE match_schedules SET ${role.field}=?,${role.name}_snapshot=? WHERE id=?`,[external?null:person.id,name,m.insertId]);
      await c.execute('INSERT INTO match_official_assignments (schedule_id,role,source_type,referee_id,external_referee_id,name_snapshot) VALUES (?,?,?,?,?,?)',[m.insertId,role.code,external?'external':'system',external?null:person.id,external?ref.insertId:null,name]);
    }
    const schedule=await require('../services/scheduleService').queryScheduleDetail(c,m.insertId),reportId=schedule.report.id;
    async function transition(operation,work){const state=await history.readSectionState(c,reportId,'main',true),before=await history.captureSnapshot(c,reportId,'main');await require('../services/matchRosterService').freeze(c,schedule);await work();const after=await history.captureSnapshot(c,reportId,'main'),system=['save','submit'].includes(operation);await history.appendHistory(c,{reportId,section:'main',state,before,after,operation,sourceType:system?'referee':'admin_revision',viewer:system?{id:refs[0].id,role:'referee'}:{id:adminId,role:'admin'},reason:fixtureReason});if(['revise','submit'].includes(operation))await require('../services/matchPublicationService').afterWrite(c,reportId,system?'submit_main':'revise',system?null:'revise');}
    if(i<2){
      const goal=(index,type,minute)=>({player_team_id:home.team_id,credited_team_id:type==='own_goal'?away.team_id:home.team_id,team_player_id:roster[index].id,goal_type:type,minute_base:minute});
      await transition(i===1?'save':'revise',()=>service.writeMainContent(c,schedule,reportId,{home_score:i===0?2:1,away_score:i===0?1:0,home_penalty_score:i===0?4:null,away_penalty_score:i===0?3:null,goals:i===0?[goal(0,'normal',12),goal(0,'penalty',35),goal(1,'own_goal',60)]:[goal(0,'normal',25)],cards:[{team_id:home.team_id,team_player_id:roster[1].id,card_type:'yellow',minute_base:40}]}));
      if(i===1){
        await transition('submit',()=>c.execute("UPDATE match_reports SET main_report_status='submitted',main_report_submitted_at=NOW() WHERE id=?",[reportId]));
        await transition('return',()=>c.execute("UPDATE match_reports SET main_report_status='returned' WHERE id=?",[reportId]));
        await transition('save',()=>service.writeMainContent(c,schedule,reportId,{home_score:0,away_score:0,goals:[],cards:[]}));
      }
    }
    result.push({id:m.insertId,scenario:['正式2:1，点球大战4:3，队长计2球','退回修订中，公开保留1:0，队长计1球','待发布'][i]});
  }return result;
}
async function run(options,env=process.env){
  const c=await pool.getConnection(),files=[];let locked=false,transaction=false,handle,createdFile=false,commitAttempted=false,file;
  try{
    const [[db]]=await c.query('SELECT DATABASE() AS name');if(options.command==='append')assertAuthorized(env,db.name);await assertMigrationsCurrent(c);
    const [[lock]]=await c.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':demo_seed'), 120) AS acquired");if(Number(lock.acquired)!==1)throw Error('另一生成任务正在执行');locked=true;
    const [[existing]]=await c.execute("SELECT season_id,JSON_UNQUOTE(JSON_EXTRACT(after_snapshot,'$.fixture_size')) AS size FROM player_season_setting_events WHERE JSON_UNQUOTE(JSON_EXTRACT(after_snapshot,'$.fixture_batch'))=? LIMIT 1",[options.batch]);
    if(existing){if(existing.size!==options.size)throw Error('同一批次不能更改规模，请使用新批次号');return {status:'skipped',season_id:existing.season_id,message:'批次已存在，不重复追加、不重置密码、不恢复人工修改。'};}
    const [[admin]]=await c.execute('SELECT id FROM admin WHERE id=?',[options.adminId]);if(!admin)throw Error('指定管理员不存在');
    const players=definitions(options.batch,options.size),seasonName=`球员测试-${options.batch}`,seasonCode=`pd-${options.batch}`;
    const [[collision]]=await c.query('SELECT (SELECT COUNT(*) FROM seasons WHERE season_code=? OR season_name=?)+(SELECT COUNT(*) FROM player_accounts WHERE student_id IN (?)) AS n',[seasonCode,seasonName,players.map(p=>p.student_id)]);if(Number(collision.n))throw Error('批次存在冲突数据，拒绝补写或覆盖，请使用全新批次号');
    file=outputPath(env,options.batch);try{await fs.lstat(file);throw Error('凭据文件已存在，拒绝覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}
    const summary={players:players.length,referees:5,teams:options.size==='large'?48:6,applications:3,matches:3,inactive_seasons:1};
    if(options.command==='plan')return {status:'plan',database:db.name,batch:options.batch,...summary,credential_file:file,message:'只读预览；创建独立未启用赛季，原赛季与账号不变。'};
    await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});validateOutput(path.join(await fs.realpath(path.dirname(file)),path.basename(file)));handle=await fs.open(file,'wx',0o600);createdFile=true;
    // 唯一随机密码分别哈希；不为500人复用一份密码哈希。
    for(let start=0;start<players.length;start+=4)await Promise.all(players.slice(start,start+4).map(async p=>{p.hash=await bcrypt.hash(p.password,10);}));
    await c.beginTransaction();transaction=true;
    const today=businessDate(),now=w.chinaSql(),closes=w.chinaSql(new Date(Date.now()+30*86400000));
    const [s]=await c.execute('INSERT INTO seasons (season_code,season_name,start_date,end_date,is_active) VALUES (?,?,?,?,0)',[seasonCode,seasonName,today,closes.slice(0,10)]);const seasonId=s.insertId;
    await c.execute('INSERT INTO player_season_settings (season_id,registration_opens_at,registration_closes_at,revision) VALUES (?,?,?,1)',[seasonId,now,closes]);
    const competitions=[];
    for(const type of ['大联赛','足协杯','新生杯']){const [r]=await c.execute('INSERT INTO season_competitions (season_id,league_type,is_enabled,registration_opens_at,registration_closes_at,rules_text) VALUES (?,?,1,?,?,?)',[seasonId,type,now,closes,fixtureReason+' 人数、外援、运训由管理员手动审核。']);competitions.push({id:r.insertId,league_type:type});await c.execute('INSERT INTO roster_change_windows (competition_id,opens_at,closes_at,created_by_admin_id) VALUES (?,?,?,?)',[r.insertId,now,closes,options.adminId]);}
    const setting=await require('../services/playerSeasonSettingsService').read(seasonId,c);
    await c.execute('INSERT INTO player_season_setting_events (season_id,revision,actor_admin_id,before_snapshot,after_snapshot,created_at) VALUES (?,1,?,?,?,?)',[seasonId,options.adminId,JSON.stringify({revision:0,fixture_new_season:true}),JSON.stringify({...setting,fixture_batch:options.batch,fixture_size:options.size}),now]);
    for(const p of players){const [r]=await c.execute('INSERT INTO player_accounts (student_id,name,college,password_hash) VALUES (?,?,?,?)',[p.student_id,p.name,p.college,p.hash]);p.id=r.insertId;delete p.hash;await c.execute("INSERT INTO player_account_events (player_id,operation,revision,actor_player_id,after_snapshot) VALUES (?,'register',0,?,?)",[p.id,p.id,JSON.stringify(w.accountSnapshot(p))]);await recordSecurityEvent(c,'account_created','player',p.id,{role:'system'});await registration(c,p,seasonId,options.adminId,files);}
    const formal=[],applications=[],perType=summary.teams/3,perTeam=options.size==='large'?10:3;
    for(const [typeIndex,competition]of competitions.entries())for(let i=0;i<perType;i++){
      const offset=(typeIndex*perType+i)*perTeam,eligible=players.filter(p=>p.status==='approved');
      const selected=Array.from({length:perTeam},(_,n)=>eligible[(offset+n)%eligible.length]);
      formal.push(await application(c,{seasonId,competition,manager:players[0],players:selected,name:`测试${options.batch}-${i+1}队`,status:'approved',adminId:options.adminId}));
    }
    for(const status of ['draft','pending','returned'])applications.push(await application(c,{seasonId,competition:competitions[0],manager:players[0],players:players.slice(1,4),name:`测试${options.batch}-${status}`,status,adminId:options.adminId}));
    const referees=await refereeAccounts(c,seasonId,options.adminId,options.batch),matches=await schedules(c,seasonId,formal,options.adminId,options.batch,referees);
    const payload={warning:fixtureReason+' 密码为生成时初始值；人工修改后本文件不会同步。',database:db.name,batch:options.batch,size:options.size,created_at:new Date().toISOString(),summary,season:{id:seasonId,name:seasonName,is_active:false},admin_id:options.adminId,players,referees,teams:formal,applications,matches};
    await handle.writeFile(JSON.stringify(payload,null,2)+'\n');await handle.sync();await handle.close();handle=null;commitAttempted=true;await c.commit();transaction=false;
    return {status:'appended',...summary,season:payload.season,credential_file:file,message:'已追加虚构数据。当前启用赛季不变；需要操作报名时由管理员启用本测试赛季。'};
  }catch(e){if(handle)await handle.close().catch(()=>{});let rolledBack=!transaction;if(transaction)try{await c.rollback();rolledBack=true;}catch{}if(rolledBack&&!commitAttempted){for(const stored of files)await academic.remove(stored);if(createdFile)await fs.unlink(file);}if(commitAttempted)throw Error('提交结果需要核对；保留本批私有凭据和材料，不要覆盖重试。');throw e;}
  finally{if(locked)await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':demo_seed'))").catch(()=>{});c.release();}
}
if(require.main===module)Promise.resolve().then(()=>run(parseArguments(process.argv.slice(2)))).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.code?`测试数据生成失败：${e.code}`:e.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports={run,assertAuthorized,outputPath};
