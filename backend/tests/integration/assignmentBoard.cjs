const assert=require('node:assert/strict');
module.exports=async({t,pool,request,expectStatus,admin,season,base,refs,date})=>{
 const call=async(url,body,method='GET',token=admin,status=200)=>{const r=await request(url,{body,method,token});expectStatus(r,status,url);return r.data?.data;};
 let competition,matches=[],teams=[];
 await t.test('参队信息按裁判员和赛事隔离，允许任意多选、记忆、修改及明确未参加',async()=>{
  await pool.execute('UPDATE seasons SET is_active=1 WHERE id=?',[season.id]);
  const [[row]]=await pool.execute('SELECT id FROM season_competitions WHERE season_id=? AND league_type=?',[season.id,base.match_type]);competition=row.id;
  for(let i=0;i<4;i++)teams.push((await pool.execute('INSERT INTO team(season_id,league_type,team_name) VALUES (?,?,?)',[season.id,base.match_type,'参队验收'+i]))[0].insertId);
  const url='/api/match-signups/memberships/'+competition;
  const empty=await call(url,undefined,'GET',refs[0].token);assert.equal(empty.confirmed,false);
  const saved=await call(url,{team_ids:teams,revision:0},'PUT',refs[0].token);assert.deepEqual(saved.team_ids,teams);assert.equal(saved.confirmed,true);
  assert.deepEqual((await call(url,undefined,'GET',refs[0].token)).team_ids,teams);
  assert.equal((await call(url,undefined,'GET',refs[2].token)).confirmed,false);
  await call(url,{team_ids:[],revision:0},'PUT',refs[0].token,409);
  await call(url,{team_ids:[teams[0],teams[0]],revision:1},'PUT',refs[0].token,400);
  await call(url,{team_ids:[9999999],revision:1},'PUT',refs[0].token,400);
  await call(url,{team_ids:teams,revision:1,referee_id:refs[2].id},'PUT',refs[0].token,400);
  await call(url,undefined,'GET',admin,403);
  await call(url,{team_ids:[],revision:0},'PUT',refs[2].token);
  assert.equal((await call(url,undefined,'GET',refs[2].token)).confirmed,true);
 });
 await t.test('可选第四官员的三人组完成状态、报名与已有选派保留；第四官员变更参与并发版本',async()=>{
  for(let i=0;i<3;i++)matches.push(await call('/api/schedule',{...base,field_order:'BOARD-'+i,match_date:date(i===2?9:2),fourth_required:false,supervisor_required:false},'POST'));
  let m=await call('/api/schedule/'+matches[0].id+'/assign-referees',{main_referee_id:refs[0].id,assistant1_id:refs[2].id,assistant2_id:refs[3].id},'PUT');
  assert.equal(m.is_assignment_complete,true);assert.equal(m.fourth_required,false);assert.deepEqual(m.pending_assignment_roles,[]);
  const saved=await call('/api/schedule/'+m.id,{...base,match_date:date(2),field_order:'BOARD-0',venue:'铁笼'},'PUT');
  assert.equal(saved.main_referee_id,refs[0].id);assert.equal(saved.assistant1_id,refs[2].id);assert.equal(saved.fourth_required,false);
  await call('/api/schedule/'+m.id+'/assign-referees',{fourth_required:'false'},'PUT',admin,400);
  await call('/api/schedule/'+m.id+'/assign-referees',{fourth_official_id:refs[4].id},'PUT',admin,400);
  await call('/api/match-signups/'+m.id,{action:'save',intentions:['fourth'],revision:0,schedule_revision:saved.schedule_revision},'PUT',refs[0].token,400);
  for(const [i,match]of matches.slice(0,2).entries()){
   const detail=await call('/api/schedule/'+match.id);
   await call('/api/match-signups/'+match.id,{action:'save',intentions:i?['assistant']:['main','assistant'],revision:0,schedule_revision:detail.schedule_revision},'PUT',refs[0].token);
  }
 });
 await t.test('比赛日汇总包含全部已报名场次、职位和最新队伍，报名与选派保持独立',async()=>{
  let board=await call('/api/match-signups/assignment-board');
  const group=board.groups.find(g=>g.competition_id===competition),day=group.days.find(d=>d.match_date===date(2));
  assert.equal(day.matches.length,2);assert.equal(day.registrants.length,1);assert.equal(day.registrants[0].matches.length,2);assert.equal(day.registrants[0].teams.length,4);
  assert.ok(!board.groups.flatMap(g=>g.days).flatMap(d=>d.matches).some(m=>m.id===matches[2].id));
  await call('/api/match-signups/memberships/'+competition,{team_ids:[teams[1]],revision:1},'PUT',refs[0].token);
  board=await call('/api/match-signups/assignment-board?view=all&season_id='+season.id);
  assert.ok(board.groups.flatMap(g=>g.days).flatMap(d=>d.matches).some(m=>m.id===matches[2].id));
  const ref=board.groups.find(g=>g.competition_id===competition).days.find(d=>d.match_date===date(2)).registrants[0];assert.deepEqual(ref.teams.map(t=>t.id),[teams[1]]);
  await call('/api/match-signups/assignment-board',undefined,'GET',refs[0].token,403);
  const row=(await call('/api/match-signups?view=mine&page_size=100',undefined,'GET',refs[0].token)).items.find(r=>r.id===matches[1].id);
  await call('/api/match-signups/'+row.id,{action:'withdraw',revision:row.signup_revision,schedule_revision:row.schedule_revision},'PUT',refs[0].token);
  board=await call('/api/match-signups/assignment-board');assert.equal(board.groups.find(g=>g.competition_id===competition).days.find(d=>d.match_date===date(2)).registrants[0].matches.length,1);
 });
 await t.test('三岗位裁判监督报告可以提交，第四官员配置在报告开始后锁定，旧比赛默认保留四人需求',async()=>{
  const m=await call('/api/schedule/'+matches[0].id+'/assign-referees',{supervisor_required:true,supervisor_id:refs[0].id},'PUT');
  const reviews=['main','assistant1','assistant2'].map(target_role=>({target_role,score:8}));
  await call('/api/report/schedule/'+m.id+'/supervisor',{reviews},'POST',refs[0].token);
  await call('/api/report/schedule/'+m.id+'/supervisor/submit',{},'POST',refs[0].token);
  await call('/api/schedule/'+m.id+'/assign-referees',{fourth_required:true},'PUT',admin,400);
  const legacy=await call('/api/schedule',{...base,field_order:'BOARD-LEGACY',supervisor_required:false},'POST');assert.equal(legacy.fourth_required,true);assert.ok(legacy.pending_assignment_roles.includes('第四官员'));
  const c=await pool.getConnection();try{const before=(await c.query('SELECT * FROM match_schedules ORDER BY id'))[0];await require('../../../db/migrations/0028_referee_assignment_board').up(c);assert.deepEqual((await c.query('SELECT * FROM match_schedules ORDER BY id'))[0],before);}finally{c.release();}
 });
};
