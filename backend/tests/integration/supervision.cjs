const assert=require('node:assert/strict'),bcrypt=require('bcryptjs');
module.exports=async({t,pool,state,request,expectStatus})=>{
 if(process.env.REFWEB_INTEGRATION_TEST!=='1'||!process.env.DB_NAME.endsWith('_test'))throw Error('仅隔离测试库');
 const login=await request('/api/admin/login',{body:state.admin});expectStatus(login,200,'admin login');const admin=login.data.data.token;
 const call=async(url,body,method,expected=200,token=admin,headers)=>{const r=await request(url,{body,method,token,headers});expectStatus(r,expected,url);return r.data.data;};
 const now=new Date(Date.now()+8*3600000).toISOString().slice(0,10),refs=[],ext=[];let season,base,none,dual,external,late;
 const roles=['main','assistant1','assistant2','fourth'],fields=['main_referee_id','assistant1_id','assistant2_id','fourth_official_id'];
 const scores={reviews:roles.map(target_role=>({target_role,score:8.5,advice:'验收评分'}))};
 const assign=(m,body,expected=200)=>call(`/api/schedule/${m.id}/assign-referees`,body,'PUT',expected);
 await t.test('裁判监督需求默认保留，新增可无裁判监督；数据库禁止助理裁判员兼任其他场上岗位',async()=>{
  season=await call('/api/season',{season_code:'SUPERVISION',season_name:'裁判监督回归',start_date:now,end_date:'2099-12-31',is_active:true},'POST',201);
  const config=await call('/api/player-admin/season-settings/'+season.id,{registration_opens_at:null,registration_closes_at:null,competitions:[{league_type:'裁判监督回归赛',is_enabled:false,registration_opens_at:null,registration_closes_at:null,rules_text:'',change_windows:[],yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1}]},'PUT',200,admin,{'If-Match':'0'});
  const hash=await bcrypt.hash('Supervisor!2026',4);
  for(let i=0;i<5;i++){
   const student_id='SUPERVISION-'+i;
   await pool.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,must_change_password,is_active) VALUES (?,?,?,'一级','预备国家级','2025-01-01','足协杯',0,1)",[student_id,'裁判监督测试裁判'+i,hash]);
   const r=await call('/api/referee/login',{student_id,password:'Supervisor!2026'},'POST',200,null);refs.push(r);
   const reg=await call('/api/season-registration/current/submit',{name:'裁判监督测试裁判'+i,college:'土木工程学院',height_cm:175,weight_kg:65,grade:'一级',match_types:['足协杯']},'POST',201,r.token);
   r.registration_id=reg.id;if(i<4)await call('/api/season-registration/admin/'+reg.id+'/approve',{reason:'测试通过'},'POST');
  }
  for(let i=0;i<4;i++)ext.push(await call('/api/officials/external',{name:'裁判监督外部测试'+i},'POST',201));
  const ids=[];for(const name of ['裁判监督主队','裁判监督客队'])ids.push((await pool.execute('INSERT INTO team(season_id,team_name,league_type) VALUES (?,?,?)',[season.id,name,'裁判监督回归赛']))[0].insertId);
  base={match_type:'裁判监督回归赛',team_a_id:ids[0],team_b_id:ids[1],match_date:now,match_time:'00:00',venue:'樱花人草',...Object.fromEntries(fields.map((f,i)=>[f,refs[i].id]))};
  late=await call('/api/schedule',{...base,field_order:'SUP-LATE'},'POST');assert.equal(late.supervisor_required,true);assert.deepEqual(late.pending_assignment_roles,['裁判监督']);
  none=await call('/api/schedule',{...base,field_order:'SUP-NONE',supervisor_required:false},'POST');assert.equal(none.supervisor_required,false);assert.equal(none.is_assignment_complete,true);assert.deepEqual(none.pending_assignment_roles,[]);
  await call('/api/schedule',{...base,field_order:'SUP-BAD',supervisor_required:'false'},'POST',400);
  await call('/api/schedule',{...base,field_order:'SUP-BAD',supervisor_required:false,supervisor_id:refs[0].id},'POST',400);
  await assign(none,{assistant1_id:refs[0].id},400);
  await assert.rejects(pool.execute("UPDATE match_official_assignments SET referee_id=? WHERE schedule_id=? AND role='assistant1'",[refs[0].id,none.id]),/Duplicate entry/);
  const preserved=await call('/api/schedule/'+none.id,{...base,field_order:'SUP-NONE'},'PUT');assert.equal(preserved.supervisor_required,false);
 });
 await t.test('裁判员兼任第四官员支持系统和非系统人员，保存、岗位评分、换人与数据库约束一致',async()=>{
  for(const source of ['system','external']){
   const ids=source==='system'?refs.map(r=>r.id):ext.map(r=>'external:'+r.id);
   let m=await call('/api/schedule',{...base,field_order:'MAIN-FOURTH-'+source,main_referee_id:ids[0],assistant1_id:ids[1],assistant2_id:ids[2],fourth_official_id:ids[0],supervisor_id:refs[3].id},'POST');
   assert.equal(m.is_assignment_complete,true);
   assert.equal(m.main_referee_id_selection,m.fourth_official_id_selection);
   assert.notEqual(m.officials.find(a=>a.role==='main').id,m.officials.find(a=>a.role==='fourth').id);
   m=await assign(m,{fourth_official_id:ids[3]});m=await assign(m,{fourth_official_id:ids[0]});
   const updated=await call('/api/schedule/'+m.id,{match_type:base.match_type,team_a_id:base.team_a_id,team_b_id:base.team_b_id,match_date:base.match_date,match_time:base.match_time,venue:'铁笼',field_order:m.field_order},'PUT');
   assert.equal(updated.main_referee_id_selection,updated.fourth_official_id_selection);
   for(const field of ['assistant1_id','assistant2_id'])await assign(m,{[field]:ids[0]},400);
   await assign(m,{fourth_official_id:ids[1]},400);
   const personColumn=source==='system'?'referee_id':'external_referee_id',personId=source==='system'?refs[1].id:ext[1].id;
   await assert.rejects(pool.execute(`UPDATE match_official_assignments SET ${personColumn}=? WHERE schedule_id=? AND role='fourth'`,[personId,m.id]),/Duplicate entry/);
   if(source==='system')await assert.rejects(pool.execute('UPDATE match_schedules SET fourth_official_id=assistant1_id WHERE id=?',[m.id]),/check constraint/i);
   const reportUrl='/api/report/'+(source==='external'?'admin/':'')+'schedule/'+m.id;
   await call(reportUrl+'/main',{home_score:0,away_score:0},'POST',200,source==='external'?admin:refs[0].token);
   await call(reportUrl+'/main/submit',{},'POST',200,source==='external'?admin:refs[0].token);
   await call('/api/report/schedule/'+m.id+'/supervisor',{reviews:roles.map((target_role,i)=>({target_role,score:8+i/10}))},'POST',200,refs[3].token);
   await call('/api/report/schedule/'+m.id+'/supervisor/submit',{},'POST',200,refs[3].token);
   const report=await call('/api/report/schedule/'+m.id,undefined,'GET',200,source==='system'?refs[0].token:admin);
   if(source==='system')assert.deepEqual(report.viewer_role_codes,['main','fourth']);
   assert.equal(Number(report.reviews.find(r=>r.target_role==='main').score),8);
   assert.equal(Number(report.reviews.find(r=>r.target_role==='fourth').score),8.3);
   if(source==='system'){
    assert.equal(report.reviews.length,2);
    const history=await call('/api/report/schedule/'+m.id+'/history/supervisor',undefined,'GET',200,refs[0].token);
    const entry=await call('/api/report/schedule/'+m.id+'/history-entry/'+history.items[0].id,undefined,'GET',200,refs[0].token);
    assert.deepEqual(entry.after_snapshot.data.reviews.map(r=>r.target_role).sort(),['fourth','main']);
   }
   await assign(m,{fourth_official_id:ids[3]});
  }
  const c=await pool.getConnection();try{
   const before=(await c.query('SELECT * FROM match_official_assignments ORDER BY id'))[0];
   await require('../../../db/migrations/0029_main_fourth_dual_role').up(c);
   await require('../../../db/migrations/0029_main_fourth_dual_role').up(c);
   // 重放旧迁移后继续前向升级，恢复0033新增岗位对应的生成列定义。
   await require('../../../db/migrations/0033_futsal_officials').up(c);
   assert.deepEqual((await c.query('SELECT * FROM match_official_assignments ORDER BY id'))[0],before);
  }finally{c.release();}
 });
 await t.test('同一日期同一开球时间允许跨场选派，全部岗位及系统与非系统人员均不受时间互斥限制',async()=>{
  for(const source of ['system','external']){
   const people=source==='system'?refs:ext;
   const selections=Object.fromEntries([...fields,'supervisor_id'].map((field,i)=>[field,source+':'+people[i%4].id]));
   const a=await call('/api/schedule',{...base,...selections,field_order:'SAME-TIME-A-'+source},'POST');
   let b=await call('/api/schedule',{...base,...Object.fromEntries(fields.map(f=>[f,null])),field_order:'SAME-TIME-B-'+source},'POST');
   assert.equal(a.match_date,b.match_date);assert.equal(a.match_time,b.match_time);
   for(const [i,role]of [...roles,'supervisor'].entries()){
    const candidates=await call(`/api/officials/candidates?season_id=${season.id}&schedule_id=${b.id}&role=${role}&page_size=50&query=${encodeURIComponent(source==='system'?'SUPERVISION-':'裁判监督外部测试')}`);
    assert.ok(candidates.items.some(p=>p.source_type===source&&Number(p.referee_id||p.external_referee_id)===people[i%4].id));
   }
   b=await assign(b,selections);
   assert.equal(a.is_assignment_complete,true);assert.equal(b.is_assignment_complete,true);
   for(const field of [...fields,'supervisor_id'])assert.equal(a[field+'_selection'],b[field+'_selection']);
   const stored=await call('/api/schedule/'+b.id);assert.equal(stored.fourth_official_id_selection,a.fourth_official_id_selection);
  }
 });
 await t.test('无裁判监督报告接口全部拒绝，裁判员提交后完成且不进入裁判监督待办',async()=>{
  for(const path of ['supervisor','supervisor/submit']){await call(`/api/report/admin/schedule/${none.id}/${path}`,{},'POST',400);await call(`/api/report/schedule/${none.id}/${path}`,{},'POST',400,refs[0].token);}
  await call(`/api/report/admin/schedule/${none.id}/sections/supervisor/revise`,{reason:'不应允许',data:scores},'POST',400);
  await call(`/api/report/schedule/${none.id}/main`,{home_score:0,away_score:0},'POST',200,refs[0].token);
  await call(`/api/report/schedule/${none.id}/main/submit`,{},'POST',200,refs[0].token);
  const submitted=await call(`/api/schedule?season_id=${season.id}&report_status=submitted`);assert.ok(submitted.some(s=>s.id===none.id));
  const pending=await call(`/api/schedule?season_id=${season.id}&report_status=supervisor_pending`);assert.ok(!pending.some(s=>s.id===none.id));
  const report=await call('/api/report/schedule/'+none.id);assert.equal(report.viewer_permissions.can_edit_supervisor,false);assert.equal(report.sections.supervisor.revision,0);
 });
 await t.test('裁判监督可兼任全部四个系统场上岗位，裁判员兼裁判监督可分别填报及给本人评分',async()=>{
  for(let i=0;i<4;i++){
   const m=await call('/api/schedule',{...base,field_order:'SUP-DUAL-'+i,supervisor_id:refs[i].id},'POST');
   const r=await call('/api/report/schedule/'+m.id,undefined,'GET',200,refs[i].token);assert.equal(r.viewer_permissions.can_edit_supervisor,true);assert.equal(r.viewer_permissions.can_read_all_reviews,true);assert.deepEqual(r.viewer_role_codes,[roles[i],'supervisor']);
   if(i===0)dual=m;
  }
  await call(`/api/report/schedule/${dual.id}/main`,{home_score:0,away_score:0,stats:[{role:'main',running_distance_m:5000}]},'POST',200,refs[0].token);
  await call(`/api/report/schedule/${dual.id}/supervisor`,scores,'POST',200,refs[0].token);
  await call(`/api/report/schedule/${dual.id}/supervisor/submit`,{},'POST',200,refs[0].token);
  const r=await call('/api/report/schedule/'+dual.id,undefined,'GET',200,refs[0].token);assert.equal(r.reviews.length,4);assert.equal(Number(r.reviews.find(r=>r.target_role==='main').score),8.5);
  const onlySelf=await call('/api/report/schedule/'+dual.id,undefined,'GET',200,refs[1].token);assert.equal(onlySelf.reviews.length,1);
  await call('/api/report/schedule/'+dual.id,undefined,'GET',403,refs[4].token);
  await call(`/api/report/schedule/${dual.id}/supervisor`,scores,'POST',403,refs[1].token);
  await call(`/api/report/admin/schedule/${dual.id}/supervisor`,scores,'POST',403);
  const h=await call(`/api/report/schedule/${dual.id}/history/supervisor`,undefined,'GET',200,refs[0].token);
  const detail=await call(`/api/report/schedule/${dual.id}/history-entry/${h.items[0].id}`,undefined,'GET',200,refs[0].token);assert.equal(detail.after_snapshot.data.reviews.length,4);
 });
 await t.test('更换裁判监督保留场上岗位ID及统计，报告开始后仍可调整监督需求',async()=>{
  await call(`/api/report/schedule/${late.id}/main`,{stats:[{role:'main',running_distance_m:6200}]},'POST',200,refs[0].token);
  const before=(await pool.query('SELECT * FROM match_referee_stats WHERE report_id=?',[late.report_id]))[0];
  const original=(await pool.query('SELECT * FROM match_official_assignments WHERE schedule_id=? ORDER BY id',[late.id]))[0];
  late=await assign(late,{supervisor_id:refs[3].id});assert.equal(late.supervisor_locked,false);
  late=await assign(late,{supervisor_required:false});assert.equal(late.supervisor_required,false);assert.equal(late.supervisor_id,null);
  late=await assign(late,{supervisor_required:true,supervisor_id:refs[1].id});
  assert.deepEqual((await pool.query('SELECT * FROM match_referee_stats WHERE report_id=?',[late.report_id]))[0],before);
  assert.deepEqual((await pool.query("SELECT * FROM match_official_assignments WHERE schedule_id=? AND role<>'supervisor' ORDER BY id",[late.id]))[0],original);
  await assign(late,{main_referee_id:refs[4].id},409);
  await call('/api/schedule/'+late.id,{...base,field_order:'SUP-LATE',supervisor_id:refs[1].id,supervisor_required:false},'PUT',400);
  await call(`/api/report/schedule/${late.id}/supervisor`,scores,'POST',200,refs[1].token);
  const locked=await call('/api/schedule/'+late.id);assert.equal(locked.supervisor_locked,true);
  await assign(late,{supervisor_required:false});await assign(late,{supervisor_required:true,supervisor_id:refs[4].id},409);
 });
 await t.test('非系统裁判监督可兼任场上岗位；管理员代填、提交、修订保留操作者和评分归属',async()=>{
  external=await call('/api/schedule',{...base,field_order:'SUP-EXTERNAL',fourth_official_id:'external:'+ext[0].id,supervisor_id:'external:'+ext[0].id},'POST');
  let r=await call('/api/report/schedule/'+external.id);assert.equal(r.viewer_permissions.can_proxy_supervisor,true);assert.equal(r.viewer_permissions.can_proxy_main,false);
  await call(`/api/report/admin/schedule/${external.id}/supervisor`,scores,'POST',403,refs[0].token);
  await call(`/api/report/schedule/${external.id}/supervisor`,scores,'POST',403,refs[0].token);
  await call(`/api/report/admin/schedule/${external.id}/supervisor`,scores,'POST');
  await call(`/api/report/admin/schedule/${external.id}/supervisor/submit`,{},'POST');
  await call(`/api/report/admin/schedule/${external.id}/supervisor`,scores,'POST',400);
  await call(`/api/report/admin/schedule/${external.id}/sections/supervisor/return`,{reason:'外部无账号不能退回'},'POST',400);
  r=await call(`/api/report/admin/schedule/${external.id}/sections/supervisor/revise`,{reason:'核实评分修订',data:{reviews:[{target_role:'main',score:9}]}},'POST');assert.equal(r.report.supervisor_review_status,'submitted');assert.equal(Number(r.reviews.find(r=>r.target_role==='main').score),9);
  const [rows]=await pool.query('SELECT reviewer_referee_id,reviewer_assignment_id FROM match_referee_reviews WHERE report_id=?',[external.report_id]);assert.ok(rows.every(r=>r.reviewer_referee_id===null&&r.reviewer_assignment_id===external.officials.find(a=>a.role==='supervisor').id));
  assert.ok(r.actor_events.some(e=>e.operation==='submit_supervisor'&&e.source_type==='admin_proxy'));
  await assign(external,{supervisor_required:false});
 });
 await t.test('裁判监督代填待办、并发修改与审核意向保持一致，数据库重复迁移不改变账号及报告',async()=>{
  const m=await call('/api/schedule',{...base,field_order:'SUP-PENDING',supervisor_id:'external:'+ext[1].id},'POST');
  const list=await call(`/api/schedule?season_id=${season.id}&report_status=proxy_pending`);assert.ok(list.some(s=>s.id===m.id));assert.ok(!list.some(s=>s.id===external.id));
  const results=await Promise.all([{supervisor_required:false},{supervisor_id:refs[0].id}].map(body=>request(`/api/schedule/${m.id}/assign-referees`,{token:admin,method:'PUT',body:{...body,schedule_revision:m.schedule_revision}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  // Dedicated stale request is deterministic irrespective of which concurrent action wins.
  await assign(m,{supervisor_id:refs[1].id,schedule_revision:m.schedule_revision},409);
  const c=await pool.getConnection();try{
   const tables=['admin','referee','match_schedules','match_reports','match_official_assignments','match_referee_reviews','report_section_history'];const snapshot=async()=>{const out={};for(const table of tables)out[table]=(await c.query('SELECT * FROM '+table+' ORDER BY id'))[0];return out};
   const before=await snapshot();await require('../../../db/migrations/0022_optional_supervisors').up(c);await require('../../../db/migrations/0022_optional_supervisors').up(c);assert.deepEqual(await snapshot(),before);
  }finally{c.release()}
 });
 await t.test('账号表注册状态和导出只取当前赛季，待审核/退回/未通过可区分，无赛季不误报',async()=>{
  const accounts=()=>call('/api/admin/referee/all?query=SUPERVISION-');
  let rows=await accounts();assert.equal(rows.find(r=>r.id===refs[0].id).season_registration_status,'approved');assert.equal(rows.find(r=>r.id===refs[4].id).season_registration_status,'pending');
  await call('/api/season-registration/admin/'+refs[4].registration_id+'/approve',{reason:'审核通过'},'POST');
  await call('/api/season-registration/admin/'+refs[4].registration_id+'/return',{reason:'请补充资料'},'POST');rows=await accounts();assert.equal(rows.find(r=>r.id===refs[4].id).season_registration_label,'已退回');
  await call('/api/season-registration/current/submit',{name:'裁判监督测试裁判4',college:'土木工程学院',height_cm:175,weight_kg:65,grade:'一级',match_types:['足协杯']},'POST',201,refs[4].token);
  await call('/api/season-registration/admin/'+refs[4].registration_id+'/reject',{reason:'不符合本季条件'},'POST');rows=await accounts();assert.equal(rows.find(r=>r.id===refs[4].id).season_registration_label,'未通过');
  const csv=await request('/api/admin/referee/export?query=SUPERVISION-',{token:admin});expectStatus(csv,200,'导出');assert.match(csv.data,/当前赛季注册状态/);assert.match(csv.data,/已注册（已通过）/);
  const next=await call('/api/season',{season_code:'SUP-NEXT',season_name:'新季状态隔离',start_date:now,end_date:'2099-12-31',is_active:true},'POST',201);
  rows=await accounts();assert.ok(rows.every(r=>r.season_registration_status==='unsubmitted'));
  await pool.execute('UPDATE seasons SET is_active=0 WHERE id=?',[next.id]);rows=await accounts();assert.ok(rows.every(r=>r.season_registration_label==='未启用赛季'));
  await pool.execute('UPDATE seasons SET is_active=1 WHERE id=?',[season.id]);
 });
};
