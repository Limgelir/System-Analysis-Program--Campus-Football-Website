const assert=require('node:assert/strict'),crypto=require('node:crypto');
const w=require('../../utils/playerWorkflow');
const {LIMIT_FIELDS}=require('../../utils/teamAutoReview');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=','base64');
module.exports=async({t,pool,state,request,expectStatus})=>{
  const admin=(await request('/api/admin/login',{body:state.admin})).data.data.token,players=[];
  let season,config,app,formal;
  const call=async(path,body,token=admin,method,revision,expected=200,headers={})=>{
    const result=await request(path,{body,token,method,headers:{...headers,...(revision==null?{}:{'If-Match':String(revision)})}});
    expectStatus(result,expected,path);return result.data.data;
  };
  const iso=delta=>w.chinaIso(w.chinaSql(new Date(Date.now()+delta)));
  async function settings(limits={},open=true){
    config=await call(`/api/player-admin/season-settings/${season.id}`,{
      registration_opens_at:iso(-86400000),registration_closes_at:iso(86400000),
      competitions:['自动审核赛事','其它参队赛事'].map((league_type,i)=>({league_type,is_enabled:true,rules_text:'本地自动审核回归',yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1,
        registration_opens_at:iso(-86400000),registration_closes_at:iso(open?86400000:-1000),change_windows:[{opens_at:iso(-86400000),closes_at:iso(open?86400000:-1000)}],...(i?{}:limits)}))
    },admin,'PUT',config?.revision||0);
  }
  const fields=d=>({team_name:d.application.team_name,shirt_color:null,shorts_color:null,socks_color:null,members:d.members.map(m=>({id:m.id,player_id:m.player_id,jersey_number:m.jersey_number,remark:m.remark,...Object.fromEntries(['is_captain','is_goalkeeper','is_foreign','is_sports_training'].map(k=>[k,m[k]]))}))});
  const member=(i,extra={})=>({player_id:players[i].id,jersey_number:String(i+1),is_captain:i===1,is_goalkeeper:i===1,is_foreign:false,is_sports_training:false,...extra});
  const get=(id=app.application.id,token=players[0].token)=>call('/api/player/team-applications/'+id,undefined,token);
  const adminGet=(id=app.application.id)=>call('/api/player-admin/team-applications/'+id);
  const save=async(body=fields(app))=>app=await call('/api/player/team-applications/'+app.application.id,body,players[0].token,'PUT',app.application.revision);
  const submit=async()=>app=await call(`/api/player/team-applications/${app.application.id}/submit`,{},players[0].token,'POST',app.application.revision);
  async function create(name,competition=0,members=[member(1),member(2)]){
    app=await call('/api/player/team-applications',{season_id:season.id,competition_id:config.competitions[competition].id,team_name:name},players[0].token,'POST',null,201,{'Idempotency-Key':crypto.randomUUID()});
    await save({...fields(app),members});return app;
  }
  async function review(operation='approve',extra={}){
    const d=await adminGet();app=await call(`/api/player-admin/team-applications/${d.application.id}/${operation}`,{review_token:d.review_token,reason:'本地验收',...(operation==='return'?{replaceable_member_ids:[],member_comments:{}}:{}),...extra},admin,'POST',d.application.revision);return app;
  }
  await t.test('赛事规则默认不限，可单填上下限、填写零，非法范围与负数小数拒绝',async()=>{
    season=await call('/api/season',{season_code:'AUTO-REVIEW',season_name:'自动审核隔离测试',start_date:'2026-01-01',end_date:'2027-12-31',is_active:true},admin,'POST',null,201);
    await settings();assert.ok(LIMIT_FIELDS.every(k=>config.competitions[0][k]===null));
    const accountPassword='AutoReview!2026';
    for(let i=0;i<4;i++){
      const body={student_id:'AUTO-'+i,name:'自动审核球员'+i,college:i===2?'建筑与城市规划学院':'土木工程学院',password:accountPassword,gender:'male',password_confirm:accountPassword};
      await call('/api/player/register',body,null,'POST',null,201);
      const p=await call('/api/player/login',{student_id:body.student_id,password:accountPassword},null,'POST');players.push(p);
      if(!i)continue;
      const form=new FormData();form.append('season_id',String(season.id));form.append('account_revision',String(p.revision));form.append('academic_image',new Blob([png],{type:'image/png'}),'test.png');
      const reg=await call('/api/player/season-registration/submit',form,p.token,'POST',0,201,{'Idempotency-Key':crypto.randomUUID()});p.registration_id=reg.registration.id;
      await call(`/api/player-admin/season-registrations/${reg.registration.id}/approve`,{account_revision:p.revision},admin,'POST',reg.revision);
    }
    await settings({max_foreign_players:0,min_players:1});assert.equal(config.competitions[0].max_players,null);
    for(const bad of [{min_players:3,max_players:2},{max_colleges:-1},{max_players:1.2},{max_foreign_players:'2'}]){
      const body={registration_opens_at:null,registration_closes_at:null,competitions:config.competitions.map(({id,rules_locked,...v},i)=>({...v,...(!i?bad:{})}))};
      await call(`/api/player-admin/season-settings/${season.id}`,body,admin,'PUT',config.revision,400);
    }
  });
  await t.test('首次报名同时违反四类限制：保存自动失败及全部原因，管理员列表可见且不可直接批准',async()=>{
    await settings({min_players:3,max_colleges:1,max_foreign_players:0,max_sports_training_players:0});
    await create('自动失败主队',0,[member(1),member(2,{is_foreign:true,is_sports_training:true})]);await submit();
    assert.equal(app.application.status,'auto_failed');assert.equal(app.auto_review.failures.length,4);assert.equal(app.auto_review.counts.total,2);
    const list=await call(`/api/player-admin/team-applications?season_id=${season.id}&status=auto_failed`);
    assert.equal(list.items.length,1);assert.equal(list.items[0].auto_review.failures.length,4);
    const d=await adminGet();assert.equal(d.permissions.can_review,false);assert.equal(d.permissions.can_return,true);
    await call(`/api/player-admin/team-applications/${d.application.id}/approve`,{review_token:d.review_token},admin,'POST',d.application.revision,409);
    assert.equal((await call('/api/public/teams?season_id='+season.id,undefined,null)).length,0);
    const ordinary=await get(app.application.id,players[2].token);assert.equal(ordinary.auto_review,undefined);assert.equal(ordinary.members[0].approved_teams,undefined);
    const revisions=await Promise.all([request(`/api/player/team-applications/${app.application.id}/submit`,{body:{},token:players[0].token,headers:{'If-Match':String(app.application.revision)}}),request(`/api/player/team-applications/${app.application.id}/submit`,{body:{},token:players[0].token,headers:{'If-Match':String(app.application.revision)}})]);
    assert.deepEqual(revisions.map(v=>v.status).sort(),[200,409]);app=await get();
  });
  await t.test('学院数使用最新账号，历史审核学院和失败结果留档；重提后进入人工审核',async()=>{
    const old=app.auto_review;
    await require('./approvedCollegeChange.cjs')(request,expectStatus,players[2].token,admin,'土木工程学院');
    const latest=await adminGet();assert.deepEqual(latest.auto_review,old);
    assert.equal(latest.current_auto_review.counts.colleges,1);
    assert.equal(latest.members.find(m=>m.player_id===players[2].id).reviewed_college,'建筑与城市规划学院');
    assert.equal(latest.members.find(m=>m.player_id===players[2].id).auto_review_college,'土木工程学院');
    await submit();assert.equal(app.auto_review.counts.colleges,1);
    await settings({min_players:2,max_players:2,max_colleges:2,max_foreign_players:1,max_sports_training_players:1});
    await submit();assert.equal(app.application.status,'pending');assert.equal(app.auto_review.passed,true);
    await review();assert.equal(app.application.status,'approved');formal=app.application.team_id;
    const history=app.events.filter(e=>e.operation==='auto_failed');assert.ok(history.length>=2);
  });
  await t.test('审核详情列出跨赛事当前正式参队；排除本队、待审和退出球队，截图权限保持',async()=>{
    await create('其它赛事已通过队',1);await submit();await review();const other=app.application.team_id;
    await create('其它赛事仅待审',1);await submit();
    await create('跨赛事查询申请');const d=await adminGet();
    const rows=d.members.find(v=>v.player_id===players[1].id).approved_teams;
    assert.deepEqual(new Set(rows.map(v=>v.id)),new Set([formal,other]));assert.ok(rows.some(v=>v.league_type==='其它参队赛事'));
    const material=await call('/api/player-admin/season-registrations/'+players[1].registration_id);assert.equal(material.files[0].available,true);
    await call(`/api/player/season-registration/${players[1].registration_id}`,undefined,players[0].token,'GET',null,403);
    const target=await call('/api/player/teams/'+formal,undefined,players[0].token);
    app=await call(`/api/player/teams/${formal}/roster-changes`,{},players[0].token,'POST',target.team.revision,201,{'Idempotency-Key':crypto.randomUUID()});
    const detail=await adminGet();assert.ok(detail.members.every(m=>m.approved_teams.every(v=>v.id!==formal)));
    // Keeping only the existing captain removes the second member from this team's current roster.
    await settings({min_players:1});await save({...fields(app),members:[fields(app).members[0]]});await submit();await review();
    await create('退出后参队查询');const after=await adminGet();assert.equal(after.members.find(m=>m.player_id===players[2].id).approved_teams.some(v=>v.id===formal),false);
  });
  await t.test('名单变更自动失败仍占用唯一进行中申请，不影响正式名单，可撤回',async()=>{
    const before=await call('/api/player/teams/'+formal,undefined,players[0].token);
    await settings({min_players:2});
    app=await call(`/api/player/teams/${formal}/roster-changes`,{},players[0].token,'POST',before.team.revision,201,{'Idempotency-Key':crypto.randomUUID()});await submit();
    assert.equal(app.application.status,'auto_failed');assert.equal((await call('/api/player/teams/'+formal,undefined,players[0].token)).batch.id,before.batch.id);
    await call(`/api/player/teams/${formal}/roster-changes`,{},players[0].token,'POST',before.team.revision,409,{'Idempotency-Key':crypto.randomUUID()});
    await call(`/api/player/team-applications/${app.application.id}/withdraw`,{},players[0].token,'POST',app.application.revision);
  });
  await t.test('管理员修改规则后批准前重查，截止后普通自动失败不能自由修改',async()=>{
    await settings({min_players:2});await create('截止后的规则变化');await submit();const old=await adminGet();
    await settings({min_players:3},false);
    await call(`/api/player-admin/team-applications/${app.application.id}/approve`,{review_token:old.review_token},admin,'POST',old.application.revision,409);
    await review();assert.equal(app.application.status,'auto_failed');assert.equal(app.permissions.can_edit,false);
    await call('/api/player/team-applications/'+app.application.id,fields(app),players[0].token,'PUT',app.application.revision,409);
    const saved=(await call('/api/player/teams/'+formal,undefined,players[0].token)).players;assert.equal(saved.length,1);
  });
  await t.test('自动失败可由管理员退回指定补正；补正再次失败保留权限，不开放增删或替换其他人',async()=>{
    const replace=app.members[1].id;await review('return',{replaceable_member_ids:[replace]});app=await get();
    await submit();assert.equal(app.application.status,'auto_failed');assert.equal(app.permissions.can_edit,true);assert.equal(app.correction.restricted,true);
    const deleted=fields(app);deleted.members.pop();await call('/api/player/team-applications/'+app.application.id,deleted,players[0].token,'PUT',app.application.revision,409);
    const illegal=fields(app);illegal.members[0].player_id=players[3].id;await call('/api/player/team-applications/'+app.application.id,illegal,players[0].token,'PUT',app.application.revision,409);
    const replacement=fields(app);replacement.members[1].player_id=players[3].id;await save(replacement);await submit();assert.equal(app.application.status,'auto_failed');
    await settings({min_players:2,max_colleges:1},false);await submit();assert.equal(app.application.status,'pending');await review();assert.equal(app.application.status,'approved');
  });
  await t.test('跨赛事正式参队变化使旧人工审核页面失效',async()=>{
    await settings();await create('参队版本检查');await submit();const original=app.application.id,d=await adminGet();
    await create('新增跨赛事参队',1);await submit();await review();
    await call(`/api/player-admin/team-applications/${original}/approve`,{review_token:d.review_token},admin,'POST',d.application.revision,409);
  });
  await t.test('账号改学院使旧审核页面失效，首次报名及名单变更均重查最新学院',async()=>{
    const updateCollege=college=>require('./approvedCollegeChange.cjs')(request,expectStatus,players[2].token,admin,college);
    await settings({max_colleges:1});await create('学院变更重新检查');await submit();const old=await adminGet();
    await updateCollege('上海自主智能无人系统科学中心');
    await call(`/api/player-admin/team-applications/${app.application.id}/approve`,{review_token:old.review_token},admin,'POST',old.application.revision,409);
    await review();assert.equal(app.application.status,'auto_failed');assert.equal(app.auto_review.counts.colleges,2);
    await updateCollege('土木工程学院');await submit();await review();const id=app.application.team_id;
    const before=await call('/api/player/teams/'+id,undefined,players[0].token);
    app=await call(`/api/player/teams/${id}/roster-changes`,{},players[0].token,'POST',before.team.revision,201,{'Idempotency-Key':crypto.randomUUID()});
    await updateCollege('材料科学与工程学院');await submit();assert.equal(app.application.status,'auto_failed');
    assert.equal(app.auto_review.failures[0].rule,'max_colleges');
    assert.equal((await call('/api/player/teams/'+id,undefined,players[0].token)).batch.id,before.batch.id);
    await updateCollege('土木工程学院');await submit();await review();assert.equal(app.application.status,'approved');
  });
  await t.test('管理员特殊导入仍可窗口外导入未注册人员，配置限制不阻止导入',async()=>{
    await settings({min_players:30,max_colleges:0,max_foreign_players:0},false);
    const XLSX=require('xlsx'),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['学号','姓名','号码','场上队长','守门员','外援','运训','备注'],['AUTO-UNREGISTERED','未注册导入人员','1','是','否','是','否','']]),'名单');
    const body=new FormData();for(const[k,v]of Object.entries({season_id:season.id,league_type:'自动审核赛事',team_name:'特殊导入免检队',manager_student_id:'AUTO-IMPORT-MANAGER',manager_name:'未注册负责人'}))body.append(k,String(v));body.append('roster_file',new Blob([XLSX.write(book,{type:'buffer',bookType:'xlsx'})]),'test.xlsx');
    const preview=await call('/api/team/import-preview',body);assert.equal(preview.can_confirm,true);
    const confirmed=await call('/api/team/import-confirm',{preview:preview.preview,preview_token:preview.preview_token},admin,'POST',null,200,{'Idempotency-Key':crypto.randomUUID()});assert.ok(confirmed.team_id);
  });
  await t.test('管理员可窗口外人工通过自动失败，原因必填，失败结果与操作者保留；普通球员不可越权',async()=>{
    await settings({min_players:3});await create('人工特批自动失败队');await submit();await settings({min_players:3},false);
    const d=await adminGet();assert.equal(d.permissions.can_override,true);
    const endpoint=`/api/player-admin/team-applications/${app.application.id}/override-approve`;
    await call(endpoint,{review_token:d.review_token,reason:' '},admin,'POST',d.application.revision,400);
    await call(endpoint,{review_token:d.review_token,reason:'无权操作'},players[0].token,'POST',d.application.revision,403);
    const result=await call(endpoint,{review_token:d.review_token,reason:'赛事组委会同意本队以两人名单参加本地测试'},admin,'POST',d.application.revision);
    assert.equal(result.application.status,'approved');assert.equal(result.auto_review.passed,false);assert.equal(result.auto_review.failures[0].rule,'min_players');
    assert.ok(result.auto_review.override.admin_id);assert.ok(result.auto_review.override.approved_at);assert.match(result.auto_review.override.reason,/赛事组委会/);
    assert.deepEqual(result.auto_review.override.failed_review,d.auto_review);
    assert.equal(result.events[0].after_snapshot.auto_review.override.reason,result.auto_review.override.reason);
    await call(endpoint,{review_token:d.review_token,reason:'重复通过'},admin,'POST',d.application.revision,409);
  });
  await t.test('规则放宽后人工通过仍保留原自动失败依据，人工通过不能绕过学籍资格',async()=>{
    await settings({min_players:3});await create('放宽规则仍保留失败证据');await submit();const failure=app.auto_review;
    await settings({min_players:2});await review('override-approve',{reason:'规则已按赛事决定放宽，核验后人工通过'});
    assert.equal(app.auto_review.passed,true);assert.deepEqual(app.auto_review.override.failed_review,failure);
    await settings({min_players:3});await create('资格撤销不得人工通过');await submit();
    const registration=await call('/api/player-admin/season-registrations/'+players[2].registration_id);
    await call(`/api/player-admin/season-registrations/${players[2].registration_id}/revoke`,{reason:'隔离测试撤销资格'},admin,'POST',registration.registration.revision);
    const d=await adminGet();
    assert.equal(d.members.find(m=>m.player_id===players[2].id).reviewed_college,'建筑与城市规划学院');
    await call(`/api/player-admin/team-applications/${d.application.id}/override-approve`,{review_token:d.review_token,reason:'仍不得绕过学籍资格'},admin,'POST',d.application.revision,409);
    assert.equal((await adminGet()).application.status,'auto_failed');
  });
  await require('./playerGenderTags.cjs')({t,pool,call,players,settings,create,member,get,adminGet,save:async(body,refresh)=>{if(refresh)app=await get();return save(body)},submit,review,current:()=>app,admin,season});
  await require('./teamRegistrationRevocation.cjs')({t,pool,call,players,settings,create,member,submit,review,admin,adminGet,season});
  await require('./adminTeamManagement.cjs')({t,pool,call,players,settings,create,member,submit,review,admin,adminGet,season,request});
  await t.test('重复执行0023不改变现有记录，自动失败和审核历史审计通过',async()=>{
    const tables=['team','team_player','team_applications','team_application_events','player_accounts','match_schedules'];const before={};for(const table of tables)before[table]=(await pool.query('SELECT * FROM '+table+' ORDER BY id'))[0];
    const c=await pool.getConnection();try{await require('../../../db/migrations/0023_team_automatic_review').up(c);}finally{c.release();}
    for(const table of tables)assert.deepEqual((await pool.query('SELECT * FROM '+table+' ORDER BY id'))[0],before[table],table);
    const checks=require('../../scripts/audit').checks;for(const check of checks.filter(c=>c.name.includes('球队报名')||c.name.includes('审核通过申请'))){const [rows]=await pool.query(check.sql);assert.equal(Number(rows[0].issue_count),0,check.name);}
  });
};
