const assert=require('node:assert/strict'),bcrypt=require('bcryptjs'),fs=require('node:fs/promises'),path=require('node:path');
module.exports=async({t,pool,state,request,expectStatus})=>{
 if(process.env.REFWEB_INTEGRATION_TEST!=='1'||!process.env.DB_NAME.endsWith('_test'))throw Error('仅隔离测试库');
 const auditChecks=require('../../scripts/audit').checks;
 const auditCounts=async()=>{const result=[];for(const check of auditChecks){const [rows]=await pool.query(check.sql);result.push({name:check.name,count:check.countRows?rows.length:Number(rows[0]?.issue_count||0)});}return result;};
 // Earlier API fixtures deliberately exercise malformed legacy records. This feature must add no issues.
 const auditBefore=await auditCounts();
 const login=await request('/api/admin/login',{body:state.admin});expectStatus(login,200,'管理员登录');const admin=login.data.data.token;
 const call=async(url,body,method,expected=200,token=admin)=>{const r=await request(url,{body,method,token});expectStatus(r,expected,url);return r.data.data;};
 const [[clock]]=await pool.query("SELECT DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d') today");
 const day=n=>new Date(Date.parse(clock.today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const season=await call('/api/season',{season_code:'DELETE-RULE',season_name:'开球前删除验收',start_date:day(-30),end_date:day(365),is_active:true},'POST',201);
 const [comp]=await pool.execute("INSERT INTO season_competitions(season_id,league_type,is_enabled,yellow_threshold,yellow_suspension,red_threshold,red_suspension) VALUES (?,'删除验收赛',1,3,1,1,1)",[season.id]);
 const refs=[],teams=[],players=[],external=[];
 for(let i=0;i<2;i++){
  const password='DeleteRule!2026',student_id='DELETE-REF-'+i,name='删除验收裁判'+i;
  await pool.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,must_change_password,is_active) VALUES (?,?,?,'一级','一级','2025-01-01','足协杯',0,1)",[student_id,name,await bcrypt.hash(password,4)]);
  const ref=await call('/api/referee/login',{student_id,password},'POST');refs.push(ref);
  await pool.execute('INSERT INTO referee_profile(referee_id) VALUES (?)',[ref.id]);
  const reg=await call('/api/season-registration/current/submit',{name,college:'土木工程学院',height_cm:175,weight_kg:65,grade:'一级',match_types:['足协杯']},'POST',201,ref.token);
  await call('/api/season-registration/admin/'+reg.id+'/approve',{reason:'删除回归'},'POST');
  external.push(await call('/api/officials/external',{name:'删除验收外部裁判'+i},'POST',201));
  const [team]=await pool.execute("INSERT INTO team(season_id,team_name,league_type) VALUES (?,?,'删除验收赛')",[season.id,'删除验收球队'+i]);teams.push(team.insertId);
  const [batch]=await pool.execute('INSERT INTO team_roster_batches(team_id,season_id,version_no,effective_from) VALUES (?,?,1,?)',[team.insertId,season.id,day(-30)]);
  const [player]=await pool.execute("INSERT INTO team_player(roster_batch_id,team_id,jersey_number,player_name) VALUES (?,?,?,?)",[batch.insertId,team.insertId,String(i+7),'删除验收球员'+i]);players.push(player.insertId);
 }
 const base={match_type:'删除验收赛',team_a_id:teams[0],team_b_id:teams[1],match_date:day(1),match_time:'17:35',venue:'樱花人草',main_referee_id:refs[0].id,assistant1_id:'external:'+external[0].id,assistant2_id:'external:'+external[1].id,fourth_official_id:refs[1].id,supervisor_id:refs[0].id};
 const create=(field_order,extra={})=>call('/api/schedule',{...base,field_order,...extra},'POST');
 const detail=id=>call('/api/schedule/'+id);
 const signup=async(id,ref=refs[0],action='save')=>{
  const rows=await call('/api/match-signups?view=mine&page_size=100',undefined,'GET',200,ref.token);
  const row=rows.items.find(r=>r.id===id);
  return call('/api/match-signups/'+id,{action,intentions:['main'],revision:row?.signup_revision||0,schedule_revision:(await detail(id)).schedule_revision},'PUT',200,ref.token);
 };
 const rowCount=async(table,where,params)=>(await pool.execute(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`,params))[0][0].n;
 const snapshots=async()=>{const out={};for(const table of ['referee','referee_profile','team','team_player','team_roster_batches'])out[table]=(await pool.query('SELECT * FROM '+table+' ORDER BY '+(table==='referee_profile'?'referee_id':'id')))[0];return out;};
 const audit=async()=>{
  assert.deepEqual(await auditCounts(),auditBefore,'删除后不新增数据审计问题');
  let result;try{result=await require('node:util').promisify(require('node:child_process').execFile)(process.execPath,[path.resolve(__dirname,'../../scripts/audit.js')],{cwd:path.resolve(__dirname,'../..'),env:process.env,timeout:15000});}catch(error){assert.ok(auditBefore.some(row=>row.count>0),'独立删除验收审计必须全通过');assert.equal(error.code,1);assert.equal(error.stderr,'');result=error;}
  assert.match(result.stdout,/"missing_upload_count":0/);assert.match(result.stdout,/"orphan_upload_count":0/);
 };
 let keep=await create('DEL-KEEP');
 await t.test('删除仅限管理员，时间待定、恰好开球及过去比赛均禁止，旧选派版本拒绝',async()=>{
  const future=await create('DEL-AUTH');assert.equal(future.delete_state.can_delete,true);
  await call('/api/schedule/'+future.id,undefined,'DELETE',401,null);
  await call('/api/schedule/'+future.id,undefined,'DELETE',403,refs[0].token);
  await call('/api/schedule/'+future.id,{schedule_revision:999},'DELETE',409);
  const unknown=await create('DEL-UNSET');await pool.execute('UPDATE match_schedules SET match_time=NULL WHERE id=?',[unknown.id]);
  assert.equal((await detail(unknown.id)).delete_state.reason_code,'SCHEDULE_KICKOFF_UNSET');
  const rejected=await request('/api/schedule/'+unknown.id,{token:admin,method:'DELETE'});expectStatus(rejected,400,'待定禁止');assert.equal(rejected.data.code,'SCHEDULE_KICKOFF_UNSET');
  await pool.execute('UPDATE match_schedules SET match_time=? WHERE id=?',['17:35',unknown.id]);await call('/api/schedule/'+unknown.id,undefined,'DELETE');
  for(const [order,date] of [['DEL-PAST',day(-1)],['DEL-TODAY',day(0)]]){
   const m=await create(order,{match_date:date,match_time:'00:00'});assert.equal(m.delete_state.can_delete,false);
   await call('/api/schedule/'+m.id,undefined,'DELETE',400);
  }
  const listed=await call('/api/schedule?season_id='+season.id);assert.equal(listed.find(m=>m.id===future.id).delete_state.can_delete,true);
  await call('/api/schedule/'+future.id,{schedule_revision:future.schedule_revision},'DELETE');
 });
 await t.test('已报名、已撤回及已完整选派的未来比赛能删除，其他账号球队比赛完全保留',async()=>{
  const m=await create('DEL-SIGNUPS');await signup(m.id);await signup(m.id,refs[1]);await signup(m.id,refs[1],'withdraw');
  const before=await snapshots(),other=await detail(keep.id);
  const signupIds=(await pool.execute('SELECT id FROM referee_match_signups WHERE schedule_id=?',[m.id]))[0].map(r=>r.id);
  await call('/api/schedule/'+m.id,{schedule_revision:m.schedule_revision},'DELETE');
  for(const table of ['match_schedules','match_reports','match_official_assignments','referee_match_signups','match_roster_selections','match_roster_selection_events'])assert.equal(await rowCount(table,table==='match_schedules'?'id=?':'schedule_id=?',[m.id]),0,table);
  for(const id of signupIds)assert.equal(await rowCount('referee_match_signup_events','signup_id=?',[id]),0);
  assert.deepEqual(await snapshots(),before);
  const current=await detail(keep.id);delete current.delete_state;delete other.delete_state;assert.deepEqual(current,other);
  const mine=await call('/api/schedule/my-assignments',undefined,'GET',200,refs[0].token);assert.ok(!mine.some(r=>r.id===m.id));
  const signups=await call('/api/match-signups?view=mine',undefined,'GET',200,refs[0].token);assert.ok(!signups.items.some(r=>r.id===m.id));
  const pub=await call('/api/public/teams/'+teams[0],undefined,'GET',200,null);assert.ok(!pub.matches.some(r=>r.id===m.id));
  await call('/api/schedule/'+m.id,undefined,'DELETE',404);
 });
 await t.test('未来比赛的裁判员草稿、已提交裁判监督报告和所有版本/附件一起清理，失败时完整回滚',async()=>{
  const m=await create('DEL-REPORT'),normal='/api/report/schedule/'+m.id;await signup(m.id);
  await call(normal+'/main',{home_score:0,away_score:0,stats:[{role:'main',running_distance_m:4500}],cards:[{team_id:teams[0],team_player_id:players[0],card_type:'yellow',minute_base:10}]},'POST',200,refs[0].token);
  await call(normal+'/supervisor',{reviews:['main','assistant1','assistant2','fourth'].map(target_role=>({target_role,score:8,advice:'删除测试'}))},'POST',200,refs[0].token);
  await call(normal+'/supervisor/submit',{},'POST',200,refs[0].token);
  const imagePaths=[];for(let i=0;i<2;i++){
   const body=new FormData();body.append('fourth_official_image',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'fixture.png');
   const saved=await call(normal+'/fourth-official-image',body,'POST',200,refs[0].token);imagePaths.push(saved.report.fourth_official_image_path);
  }
  const before=await call(normal),revision=(await detail(m.id)).schedule_revision;
  await pool.query("CREATE TRIGGER deletion_rollback_test BEFORE DELETE ON match_schedules FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated delete rollback'");
  try{const failure=await request('/api/schedule/'+m.id,{token:admin,body:{schedule_revision:revision},method:'DELETE'});expectStatus(failure,400,'删除失败');assert.equal(failure.data.code,'SCHEDULE_PERSISTENCE_FAILED');}finally{await pool.query('DROP TRIGGER deletion_rollback_test');}
  const after=await call(normal);assert.deepEqual(after.report,before.report);assert.deepEqual(after.sections,before.sections);assert.equal(await rowCount('referee_match_signups','schedule_id=?',[m.id]),1);
  for(const file of imagePaths)assert.ok((await fs.stat(path.join(process.env.UPLOAD_DIR,'reports',path.basename(file)))).size>0);
  // Simulate a historical shared attachment: only the unreferenced old file may be removed.
  await pool.execute('UPDATE match_reports SET fourth_official_image_path=? WHERE schedule_id=?',[imagePaths[1],keep.id]);
  await call('/api/schedule/'+m.id,{schedule_revision:revision},'DELETE');
  for(const table of ['match_referee_stats','match_referee_reviews','match_cards','match_goals','report_actor_events','report_section_states','report_section_history','match_publications','competition_discipline_events'])assert.equal(await rowCount(table,'report_id=?',[before.report.id]),0,table);
  await assert.rejects(fs.stat(path.join(process.env.UPLOAD_DIR,'reports',path.basename(imagePaths[0]))),{code:'ENOENT'});
  assert.ok((await fs.stat(path.join(process.env.UPLOAD_DIR,'reports',path.basename(imagePaths[1])))).size>0);
  await call('/api/schedule/'+keep.id,undefined,'DELETE');
  await assert.rejects(fs.stat(path.join(process.env.UPLOAD_DIR,'reports',path.basename(imagePaths[1]))),{code:'ENOENT'});
 });
 await t.test('删除遗留提前发布的比赛会撤销公开比分、执裁统计和红黄牌累计',async()=>{
  const m=await create('DEL-PUBLISHED',{match_date:day(-1),match_time:'00:00'}),url='/api/report/schedule/'+m.id;
  await call(url+'/main',{home_score:1,away_score:0,goals:[{player_team_id:teams[0],credited_team_id:teams[0],team_player_id:players[0],goal_type:'normal',minute_base:20}],cards:[{team_id:teams[0],team_player_id:players[0],card_type:'red',minute_base:30}],stats:[{role:'main',running_distance_m:6000}]},'POST',200,refs[0].token);
  await call(url+'/main/submit',{},'POST',200,refs[0].token);
  const discipline=require('../../services/disciplineService');const before=await discipline.summary(comp.insertId);assert.equal(before.groups[0].players[0].total_red,1);
  // Only the isolated fixture bypasses edit locks to represent an old prematurely submitted future match.
  await pool.execute('UPDATE match_schedules SET match_date=? WHERE id=?',[day(1),m.id]);
  await call('/api/schedule/'+m.id,undefined,'DELETE');
  const after=await discipline.summary(comp.insertId);assert.equal(after.groups[0].players[0].total_red,0);assert.equal(after.groups[0].players[0].remaining,0);assert.ok(after.revision>before.revision);
  assert.equal(await rowCount('match_publications','report_id=?',[m.report_id]),0);
  const trends=await call('/api/schedule/my-stat-trends',undefined,'GET',200,refs[0].token);assert.ok(!trends.some(r=>r.schedule_id===m.id));
 });
 await t.test('并发报名与删除串行化，双重删除只成功一次；等待锁后按新时间重新判断',async()=>{
  const m=await create('DEL-RACE');
  const results=await Promise.all([request('/api/match-signups/'+m.id,{method:'PUT',token:refs[0].token,body:{action:'save',intentions:['main'],revision:0,schedule_revision:m.schedule_revision}}),request('/api/schedule/'+m.id,{method:'DELETE',token:admin})]);
  assert.equal(results[1].status,200);assert.ok([200,404].includes(results[0].status));assert.equal(await rowCount('referee_match_signups','schedule_id=?',[m.id]),0);
  const twice=await create('DEL-TWICE');const deleted=await Promise.all([1,2].map(()=>request('/api/schedule/'+twice.id,{method:'DELETE',token:admin})));assert.deepEqual(deleted.map(r=>r.status).sort(),[200,404]);
  const waiting=await create('DEL-LOCK'),c=await pool.getConnection();let pending;
  try{await c.beginTransaction();await c.execute('UPDATE match_schedules SET match_date=?,match_time=? WHERE id=?',[day(-1),'00:00',waiting.id]);pending=request('/api/schedule/'+waiting.id,{method:'DELETE',token:admin});await new Promise(resolve=>setTimeout(resolve,50));await c.commit();expectStatus(await pending,400,'锁后重新判断');}finally{await c.rollback();c.release();}
  assert.equal(await rowCount('match_schedules','id=?',[waiting.id]),1);assert.equal(await rowCount('match_official_assignments','schedule_id=?',[waiting.id]),5);
  await audit();
 });
};
