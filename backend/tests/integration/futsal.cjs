const assert=require('node:assert/strict');
module.exports=async({t,pool,request,expectStatus,admin,season,base,refs,date})=>{
 const call=async(url,body,method='GET',token=admin,status=200)=>{const r=await request(url,{body,method,token});expectStatus(r,status,url);return r.data?.data;};
 const create=(extra={})=>call('/api/schedule',{...base,match_date:date(2),field_order:'FUT-'+(++sequence),supervisor_required:false,...extra},'POST');
 const assign=(id,data,status=200)=>call(`/api/schedule/${id}/assign-referees`,data,'PUT',admin,status);
 const signup=async(ref,match,intentions,revision=0,status=200)=>call('/api/match-signups/'+match.id,{action:'save',intentions,revision,schedule_revision:match.schedule_revision},'PUT',ref.token,status);
 let sequence=0,futsal,ordinary,external;
 await t.test('五人制新建与旧比赛兼容，新增岗位独立存储，迁移重复执行保留数据',async()=>{
  ordinary=await create();assert.equal(ordinary.futsal,false);assert.equal(ordinary.fourth_required,true);
  futsal=await create({futsal:true});assert.equal(futsal.futsal,true);assert.equal(futsal.fourth_required,false);
  assert.deepEqual(futsal.pending_assignment_roles,['裁判员','第二裁判员','计时员']);
  await call('/api/schedule',{...base,futsal:'true',field_order:'FUT-INVALID'},'POST',admin,400);
  await call('/api/schedule',{...base,futsal:true,field_order:'FUT-WRONG',assistant1_id:refs[2].id},'POST',admin,400);
  await assign(ordinary.id,{second_referee_id:refs[2].id},400);
  const c=await pool.getConnection();try{
   const tables=['referee','match_schedules','match_official_assignments','match_reports','report_section_history','referee_match_signups'];
   const capture=async()=>{const result={};for(const table of tables)result[table]=(await c.query('SELECT * FROM '+table+' ORDER BY id'))[0];return result;};
   const before=await capture();await require('../../../db/migrations/0033_futsal_officials').up(c);assert.deepEqual(await capture(),before);
  }finally{c.release();}
 });
 await t.test('五人制三岗禁止兼任，监督可兼任；报名新岗位与候选匹配',async()=>{
  await signup(refs[2],futsal,['second','timekeeper']);
  await signup(refs[3],futsal,['assistant'],0,400);
  await signup(refs[3],futsal,['fourth'],0,400);
  await signup(refs[3],ordinary,['second'],0,400);
  const candidates=await call(`/api/officials/candidates?season_id=${season.id}&schedule_id=${futsal.id}&role=second`);
  assert.equal(candidates.items[0].referee_id,refs[2].id);assert.equal(candidates.items[0].signup_rank,0);
  for(const pair of [['main_referee_id','second_referee_id'],['main_referee_id','timekeeper_id'],['second_referee_id','timekeeper_id']])await assign(futsal.id,Object.fromEntries(pair.map(f=>[f,refs[2].id])),400);
  futsal=await assign(futsal.id,{main_referee_id:refs[0].id,second_referee_id:refs[2].id,timekeeper_id:refs[3].id,supervisor_required:true,supervisor_id:refs[2].id});
  assert.equal(futsal.is_assignment_complete,true);assert.equal(futsal.second_referee_id,refs[2].id);assert.equal(futsal.referees.second.label,'第二裁判员');
  const report=await call('/api/report/schedule/'+futsal.id,undefined,'GET',refs[2].token);
  assert.deepEqual(report.viewer_role_codes,['second','supervisor']);assert.equal(report.viewer_permissions.can_edit_main,false);
  await assert.rejects(pool.execute('UPDATE match_schedules SET timekeeper_id=second_referee_id WHERE id=?',[futsal.id]),/check constraint/i);
 });
 await t.test('切换须确认，保留兼容岗位及意向、自动撤回全部失效报名并追加历史，旧版本拒绝',async()=>{
  ordinary=await assign(ordinary.id,{main_referee_id:refs[0].id,assistant1_id:refs[2].id,assistant2_id:refs[3].id,fourth_official_id:refs[0].id});
  await signup(refs[2],ordinary,['assistant']);await signup(refs[3],ordinary,['main','assistant','fourth']);
  const before=ordinary;
  await assign(ordinary.id,{futsal:true},409);
  assert.deepEqual((await call('/api/schedule/'+ordinary.id)).officials,before.officials);
  ordinary=await call('/api/schedule/'+ordinary.id,{...base,match_date:date(2),field_order:ordinary.field_order,futsal:true,confirm_format_change:true},'PUT');
  assert.equal(ordinary.main_referee_id,refs[0].id);assert.equal(ordinary.assistant1_id,null);assert.equal(ordinary.fourth_official_id,null);
  const rows=(await call('/api/match-signups/admin/'+ordinary.id)).items;
  const withdrawn=rows.find(r=>r.referee_id===refs[2].id),kept=rows.find(r=>r.referee_id===refs[3].id);
  assert.equal(withdrawn.status,'withdrawn');assert.deepEqual(withdrawn.intentions,[]);assert.deepEqual(kept.intentions,['main']);assert.equal(kept.status,'active');
  const [events]=await pool.execute("SELECT * FROM referee_match_signup_events WHERE signup_id=? AND operation='format_change'",[withdrawn.id]);
  assert.equal(events.length,1);const json=v=>typeof v==='string'?JSON.parse(v):v;
  assert.deepEqual(json(events[0].before_snapshot).intentions,['assistant']);assert.deepEqual(json(events[0].after_snapshot).intentions,[]);
  await assign(ordinary.id,{futsal:false,confirm_format_change:true,schedule_revision:before.schedule_revision},409);
  await signup(refs[2],ordinary,['second'],withdrawn.revision);
  ordinary=await assign(ordinary.id,{second_referee_id:refs[2].id,timekeeper_id:refs[3].id});
  ordinary=await assign(ordinary.id,{futsal:false,confirm_format_change:true});
  assert.equal(ordinary.second_referee_id,null);assert.equal(ordinary.timekeeper_id,null);assert.equal(ordinary.main_referee_id,refs[0].id);
  const [[reapply]]=await pool.execute('SELECT status,intentions,revision FROM referee_match_signups WHERE id=?',[withdrawn.id]);assert.equal(reapply.status,'withdrawn');assert.equal(reapply.revision,4);
 });
 await t.test('五人制报告保存第二裁判员完整数据，拒绝助理数据和越位协助，类型切换需确认且评分仅三岗',async()=>{
  const url='/api/report/schedule/'+futsal.id;
  await call(url+'/main',{home_score:0,away_score:0,stats:[{role:'second',running_distance_m:2400}]},'POST',refs[2].token,403);
  await call(url+'/main',{home_score:0,away_score:0,stats:[{role:'assistant1',offside_flag_count:3}]},'POST',refs[0].token,400);
  await call(url+'/main',{home_score:0,away_score:0,stats:[{role:'second',assist_count:0}]},'POST',refs[0].token,400);
  await call(url+'/main',{home_score:0,away_score:0,stats:[{role:'main',running_distance_m:2300},{role:'second',running_distance_m:2400,max_heart_rate:180,penalty_count:1,penalty_accuracy:100}]},'POST',refs[0].token);
  const report=await call(url);assert.equal(report.stats.find(s=>s.role==='second').running_distance_m,2400);assert.equal(report.stats.find(s=>s.role==='second').offside_flag_count,null);
  await assign(futsal.id,{futsal:false},409);
  await assign(futsal.id,{timekeeper_id:refs[4].id});await assign(futsal.id,{timekeeper_id:refs[3].id});
  await call(url+'/supervisor',{reviews:[{target_role:'assistant1',score:8}]},'POST',refs[2].token,400);
  await call(url+'/supervisor',{reviews:['main','second','timekeeper'].map(target_role=>({target_role,score:8.5,advice:'五人制岗位验收'}))},'POST',refs[2].token);
  await call(url+'/supervisor/submit',{},'POST',refs[2].token);
  await call(url+'/main/submit',{},'POST',refs[0].token);
  const mine=await call('/api/schedule/my-assignments',undefined,'GET',refs[2].token);
  const assigned=mine.find(m=>m.id===futsal.id);assert.equal(assigned.my_role,'第二裁判员、裁判监督');assert.equal(assigned.my_assignment.referee_id,refs[2].id);
  const timing=await call('/api/schedule/my-assignments',undefined,'GET',refs[3].token);assert.equal(timing.find(m=>m.id===futsal.id).my_role_code,'timekeeper');
  const info=await call('/api/referee/'+refs[3].id,undefined,'GET',refs[3].token);assert.ok(info.matches.some(m=>m.id===futsal.id&&m.my_role_codes.includes('timekeeper')));
  const trends=await call('/api/schedule/my-stat-trends',undefined,'GET',refs[2].token);assert.equal(trends.find(m=>m.schedule_id===futsal.id).running_distance_m,2400);
  const own=await call(url,undefined,'GET',refs[3].token);assert.equal(own.viewer_role,'计时员');assert.deepEqual(own.reviews.map(r=>r.target_role),['timekeeper']);
  const [[snapshot]]=await pool.execute("SELECT after_snapshot FROM report_section_history WHERE report_id=? AND section='main' ORDER BY id DESC LIMIT 1",[report.report.id]);
  const data=typeof snapshot.after_snapshot==='string'?JSON.parse(snapshot.after_snapshot):snapshot.after_snapshot;assert.equal(data.match.futsal,1);assert.ok(data.data.stats.some(s=>s.role==='second'));
 });
 await t.test('非系统五人制岗位、监督兼任、管理员代填及导出保持职责准确',async()=>{
  const ex=[];for(let i=0;i<3;i++)ex.push(await call('/api/officials/external',{name:'五人制外部'+i},'POST',admin,201));
  external=await create({futsal:true,main_referee_id:'external:'+ex[0].id,second_referee_id:'external:'+ex[1].id,timekeeper_id:'external:'+ex[2].id,supervisor_required:true,supervisor_id:'external:'+ex[2].id});
  await assign(external.id,{second_referee_id:'external:'+ex[0].id},400);
  await call('/api/report/admin/schedule/'+external.id+'/main',{home_score:0,away_score:0,stats:[{role:'second',running_distance_m:2000}]},'POST');
  await call('/api/report/admin/schedule/'+external.id+'/supervisor',{reviews:['main','second','timekeeper'].map(target_role=>({target_role,score:8}))},'POST');
  const out=await request('/api/schedule/export?season_id='+season.id,{token:admin});expectStatus(out,200,'导出五人制');
  assert.match(out.data,/第二裁判员/);assert.match(out.data,/计时员/);assert.match(out.data,/五人制外部1/);
  const {checks}=require('../../scripts/audit');for(const check of checks.filter(c=>/裁判报名|岗位镜像|岗位配置/.test(c.name))){const [[r]]=await pool.query(check.sql);assert.equal(Number(r.issue_count),0,check.name);}
 });
};
