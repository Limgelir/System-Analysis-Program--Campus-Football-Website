const assert = require('node:assert/strict');
module.exports = async ({t,pool,state,request,expectStatus})=>{
  const login=await request('/api/admin/login',{body:state.admin});expectStatus(login,200,'登录');
  const admin=login.data.data.token;
  const call=async(path,body,method,token=admin,status=200,headers)=>{
    const r=await request('/api'+path,{body,method,token,headers});expectStatus(r,status,path);return r.data.data;
  };
  const fixture=await require('../../scripts/seedAssignmentExport')(pool,{active:true});
  const {matches,refs}=fixture, id=matches.A01;
  const url='/report/schedule/'+id;
  const detail=()=>call(url);
  const assign=(body,status=200,token=admin)=>call('/schedule/'+id+'/assign-referees',body,'PUT',token,status);
  for(const ref of refs)ref.token=(await call('/referee/login',{student_id:ref.student_id,password:fixture.password},'POST',null)).token;
  const parse=value=>typeof value==='string'?JSON.parse(value):value;
  let original;
  await t.test('草稿与已提交报告均可换人，原数据进入历史，新旧人员权限随选派改变',async()=>{
    await call(url+'/main',{home_score:0,away_score:0,stats:[{role:'main',running_distance_m:5000},{role:'assistant1',running_distance_m:4000}]},'POST',refs[0].token);
    await call(url+'/main/submit',{},'POST',refs[0].token);
    await call(url+'/supervisor',{reviews:['main','assistant1','assistant2','fourth'].map(target_role=>({target_role,score:8}))},'POST',refs[4].token);
    await call(url+'/supervisor/submit',{},'POST',refs[4].token);
    original=await detail();
    // Simulate an old application writing an event after the schema migration.
    await pool.execute('UPDATE report_actor_events SET owner_assignment_snapshot=NULL WHERE report_id=?',[original.report.id]);
    const updated=await assign({assistant1_id:'external:'+fixture.externalId});
    assert.equal(updated.assistant1_id_selection,'external:'+fixture.externalId);
    const after=await detail();
    assert.equal(after.report.main_report_status,'returned');assert.equal(after.report.supervisor_review_status,'returned');
    assert.equal(after.report.home_score,original.report.home_score);
    assert.deepEqual(after.sections.main.original_submission,original.sections.main.original_submission);
    assert.deepEqual(after.stats.map(s=>s.role),['main']);
    assert.deepEqual(after.reviews.map(r=>r.target_role).sort(),['assistant2','fourth','main']);
    const [[row]]=await pool.execute("SELECT before_snapshot FROM report_section_history WHERE report_id=? AND section='main' ORDER BY id DESC LIMIT 1",[after.report.id]);
    assert.equal(parse(row.before_snapshot).data.stats.find(s=>s.role==='assistant1').running_distance_m,4000);
    await call(url,undefined,'GET',refs[1].token,403);
    await call(url+'/main',{home_score:0},'POST',refs[0].token,409,{'If-Match':String(original.sections.main.revision)});
    await assign({main_referee_id:refs[1].id});
    await call(url+'/main',{home_score:0},'POST',refs[0].token,403);
    await call(url+'/main',{stats:[{role:'main',running_distance_m:2000}]},'POST',refs[1].token);
    const next=await detail();assert.equal(next.stats.find(s=>s.role==='main').referee_id,refs[1].id);
    assert.ok(next.actor_events.some(e=>e.owner_assignment_id===null&&parse(e.owner_assignment_snapshot).referee_id===refs[0].id));
  });
  await t.test('只更换裁判监督时裁判员提交状态和数据不变，监督评分留历史后重填',async()=>{
    await call(url+'/main/submit',{},'POST',refs[1].token);
    await call(url+'/supervisor',{reviews:['main','assistant1','assistant2','fourth'].map(target_role=>({target_role,score:9}))},'POST',refs[4].token);
    await call(url+'/supervisor/submit',{},'POST',refs[4].token);
    const before=await detail();
    await assign({supervisor_id:'external:'+fixture.externalId});
    const after=await detail();assert.equal(after.report.main_report_status,'submitted');assert.equal(after.report.supervisor_review_status,'returned');
    assert.deepEqual(after.stats,before.stats);assert.deepEqual(after.reviews,[]);
    await call(url+'/supervisor',{reviews:[]},'POST',refs[4].token,403);
    await call('/report/admin/schedule/'+id+'/supervisor',{reviews:[{target_role:'main',score:7}]},'POST');
    const proxy=await detail();assert.equal(proxy.reviews[0].reviewer_referee_id,null);
    assert.equal(parse(proxy.actor_events[0].owner_assignment_snapshot).external_referee_id,fixture.externalId);
  });
  await t.test('报告已开始也能取消岗位、切换五人制再切回，并可清空和补选',async()=>{
    await assign({fourth_required:false,fourth_official_id:null,supervisor_required:false,supervisor_id:null});
    let m=await assign({futsal:true,confirm_format_change:true,second_referee_id:refs[2].id,timekeeper_id:refs[3].id});
    assert.equal(m.futsal,true);assert.deepEqual(m.officials.map(a=>a.role).sort(),['main','second','timekeeper']);
    let report=await detail();assert.deepEqual(report.stats,[]);assert.deepEqual(report.reviews,[]);assert.equal(report.report.home_score,0);
    await call(url+'/main',{stats:[{role:'second',running_distance_m:3000}]},'POST',refs[1].token);
    m=await assign({futsal:false,confirm_format_change:true,fourth_required:true,supervisor_required:true});
    assert.equal(m.futsal,false);assert.ok(m.pending_assignment_roles.includes('第四官员'));
    await assign({main_referee_id:null});await assign({main_referee_id:refs[0].id});
    report=await detail();assert.deepEqual(report.stats,[]);
    await assign({main_referee_id:refs[0].id},403,refs[0].token);
  });
  await t.test('选派版本冲突仍保护最新结果；相同选派保存不新增交接历史',async()=>{
    const before=await call('/schedule/'+id),report=await detail();
    await assign({main_referee_id:refs[0].id,schedule_revision:before.schedule_revision});
    assert.equal((await detail()).sections.main.revision,report.sections.main.revision);
    await assign({main_referee_id:null,schedule_revision:before.schedule_revision},409);
    assert.equal((await call('/schedule/'+id)).main_referee_id,refs[0].id);
  });
  await t.test('完整时段、同开球时刻、跨赛事、外部裁判、多场多岗位均仅提示且保存成功',async()=>{
    await pool.execute("UPDATE match_schedules SET match_time='15:00',match_end_time='17:00' WHERE id=?",[id]);
    await pool.execute("UPDATE match_schedules SET match_time='16:00',match_end_time='18:00' WHERE id=?",[matches.A02]);
    await pool.execute("UPDATE match_schedules SET match_time='15:00',match_end_time=NULL WHERE id=?",[matches.B01]);
    const other=(await call('/schedule/'+matches.A02+'/assign-referees',{supervisor_id:refs[0].id},'PUT'));
    assert.equal(other.supervisor_id,refs[0].id);
    await call('/schedule/'+matches.B01+'/assign-referees',{main_referee_id:refs[0].id},'PUT');
    const warnings=await call('/schedule/'+id+'/assignment-warnings',{main_referee_id:refs[0].id,assistant1_id:'external:'+fixture.externalId},'POST');
    assert.equal(warnings.length,3);assert.ok(warnings.some(w=>w.message.includes('担任裁判监督')));assert.ok(warnings.some(w=>w.message.includes('足协杯')));
    const saved=await assign({assistant1_id:'external:'+fixture.externalId});assert.equal(saved.assignment_warnings.length,3);
    await pool.execute("UPDATE match_schedules SET match_time='17:00',match_end_time='18:00' WHERE id=?",[matches.A02]);
    assert.equal((await call('/schedule/'+id+'/assignment-warnings',{main_referee_id:refs[0].id},'POST')).length,1);
    await call('/schedule/'+id+'/assignment-warnings',{main_referee_id:'external:0'},'POST',admin,400);
    await call('/schedule/'+id+'/assignment-warnings',{main_referee_id:refs[0].id},'POST',refs[0].token,403);
  });
  await t.test('迁移可重复执行，历史操作人的原岗位姓名不会随换人改写',async()=>{
    const before=(await detail()).actor_events;
    await require('../../../db/migrations/0036_assignment_report_handover').up(pool);
    assert.deepEqual((await detail()).actor_events,before);
  });
  await t.test('换人不改比分、进球、红黄牌及图片；保存中途失败完整回滚',async()=>{
    const before=await detail(), teamId=before.schedule.team_a_id, reportId=before.report.id;
    const [batch]=await pool.execute('INSERT INTO team_roster_batches(team_id,season_id,version_no) VALUES (?,?,1)',[teamId,fixture.seasonId]);
    const [player]=await pool.execute("INSERT INTO team_player(roster_batch_id,team_id,jersey_number,player_name) VALUES (?,?,'9','验收球员')",[batch.insertId,teamId]);
    await pool.execute("INSERT INTO match_goals(report_id,player_team_id,credited_team_id,team_player_id,minute_base,minute_label) VALUES (?,?,?,?,12,'12')",[reportId,teamId,teamId,player.insertId]);
    await pool.execute("INSERT INTO match_cards(report_id,team_id,team_player_id,card_type,minute_base,minute_label) VALUES (?,?,?,'yellow',20,'20')",[reportId,teamId,player.insertId]);
    await pool.execute("UPDATE match_reports SET home_score=1,fourth_official_image_path='reports/acceptance-history.png' WHERE id=?",[reportId]);
    const content=await detail();
    await assign({assistant2_id:refs[2].id});
    const after=await detail();assert.equal(after.report.home_score,1);
    assert.equal(after.report.fourth_official_image_path,content.report.fourth_official_image_path);
    assert.deepEqual(after.cards,content.cards);assert.deepEqual(after.goals,content.goals);
    const service=require('../../services/assignmentWarningService'),originalWarnings=service.warnings;
    service.warnings=async()=>{throw Error('测试保存后读取失败')};
    try { await assign({main_referee_id:refs[4].id},400); } finally { service.warnings=originalWarnings; }
    const rolledBack=await detail();
    assert.deepEqual(rolledBack.schedule.officials,after.schedule.officials);
    assert.deepEqual(rolledBack.sections,after.sections);assert.deepEqual(rolledBack.actor_events,after.actor_events);
    assert.deepEqual(rolledBack.stats,after.stats);assert.deepEqual(rolledBack.reviews,after.reviews);
  });
};
