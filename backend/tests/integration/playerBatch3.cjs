const assert=require('node:assert/strict'),crypto=require('node:crypto');
const w=require('../../utils/playerWorkflow');
const {nextEffectiveDate}=require('../../utils/competitionTime');
const {runPendingMigrations}=require('../../utils/migrationRunner');
const migration=require('../../../db/migrations/0015_team_application_workflow');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=','base64');
module.exports=async({t,pool,state,request,expectStatus})=>{
  if(process.env.REFWEB_INTEGRATION_TEST!=='1'||!process.env.DB_NAME.endsWith('_test'))throw Error('只能连接隔离库');
  const admin=state.tokens.admin,players=[];let seasonId,config,app,formal,other,reviewDetail;
  const result=(r,status,label)=>{expectStatus(r,status,label);return r.data?.data;};
  const call=async(path,body,token=admin,method,revision,status=200,headers={})=>result(await request(path,{body,token,method,headers:{...headers,...(revision===undefined?{}:{'If-Match':String(revision)})}}),status,path);
  const get=async(id=app.application.id,token=players[0].token)=>call(`/api/player/team-applications/${id}`,undefined,token);
  const reviewGet=async(id=app.application.id)=>call(`/api/player-admin/team-applications/${id}`);
  const fields=d=>({team_name:d.application.team_name,shirt_color:d.application.shirt_color,shorts_color:d.application.shorts_color,socks_color:d.application.socks_color,members:d.members.map(m=>({id:m.id,player_id:m.player_id,jersey_number:m.jersey_number,is_captain:m.is_captain,is_goalkeeper:m.is_goalkeeper,is_foreign:m.is_foreign,is_sports_training:m.is_sports_training}))});
  const member=(p,number,cap=false)=>({id:null,player_id:p.id,jersey_number:number,is_captain:cap,is_goalkeeper:cap,is_foreign:false,is_sports_training:false});
  const create=(name,competition=0,key=crypto.randomUUID(),status=201)=>call('/api/player/team-applications',{season_id:seasonId,competition_id:config.competitions[competition].id,team_name:name},players[0].token,'POST',undefined,status,{'Idempotency-Key':key});
  async function save(body,token=players[0].token,status=200,revision=app.application.revision){const d=await call(`/api/player/team-applications/${app.application.id}`,body,token,'PUT',revision,status);if(status===200)app=d;return d;}
  async function submit(status=200){const d=await call(`/api/player/team-applications/${app.application.id}/submit`,{},players[0].token,'POST',app.application.revision,status);if(status===200)app=d;return d;}
  async function review(operation,extra={},status=200){const d=await reviewGet();const body={reason:'整队审核测试',review_token:d.review_token,...(operation==='return'?{replaceable_member_ids:[],member_comments:{}}:{}),...extra};const out=await call(`/api/player-admin/team-applications/${app.application.id}/${operation}`,body,admin,'POST',d.application.revision,status);if(status===200)app=await get();return out;}
  async function window(open=true){const time=delta=>w.chinaIso(w.chinaSql(new Date(Date.now()+delta)));const body={registration_opens_at:time(-7200000),registration_closes_at:time(86400000),competitions:(config.competitions.length?config.competitions:['大联赛','足协杯','新生杯'].map(league_type=>({league_type}))).map(c=>({yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1,league_type:c.league_type,is_enabled:c.league_type!=='新生杯',rules_text:'人数和标记人工审核',registration_opens_at:time(-7200000),registration_closes_at:time(open?86400000:-3600000),change_windows:[]}))};config=await call(`/api/player-admin/season-settings/${seasonId}`,body,admin,'PUT',config.revision);}
  async function account(index,qualified=true){const body={student_id:`PB3-${index}`,name:`组队球员${index}`,college:'土木工程学院',password:'Player!Test2026',gender:'male',password_confirm:'Player!Test2026'};await call('/api/player/register',body,null,'POST',undefined,201);const p=await call('/api/player/login',{student_id:body.student_id,password:body.password},null,'POST');players[index]=p;
    if(qualified){const form=new FormData();form.append('season_id',String(seasonId));form.append('account_revision',String(p.revision));form.append('academic_image',new Blob([png],{type:'image/png'}),'test.png');const reg=await call('/api/player/season-registration/submit',form,p.token,'POST',0,201,{'Idempotency-Key':crypto.randomUUID()});p.registration_id=reg.registration.id;await call(`/api/player-admin/season-registrations/${p.registration_id}/approve`,{account_revision:p.revision},admin,'POST',reg.revision);}
    return p;
  }
  await t.test('第三批从0014无损升级，空号码、历史行与新增审计结构可重复迁移',async()=>{
    const c=await pool.getConnection();try{const before=(await c.query('SELECT id,student_id,password_hash,name,college FROM player_accounts ORDER BY id'))[0];
      const newer=require('../../../db/migrations/0016_roster_changes_and_imports');
      for(const sql of [...newer.tables].reverse())await c.query('DROP TABLE '+sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)[1]);
      for(const [table,name]of [...newer.indexes].reverse())await c.query('ALTER TABLE '+table+' DROP INDEX '+name);
      for(const [table,column]of [...newer.columns].reverse())await c.query('ALTER TABLE '+table+' DROP COLUMN '+column);
      await c.query('DROP TABLE team_role_change_events');await c.query('ALTER TABLE team_application_members ADD UNIQUE INDEX uq_application_player (application_id,player_id), ADD UNIQUE INDEX uq_application_number (application_id,jersey_number)');
      // MySQL may replace implicit FK indexes with the new composite unique indexes.
      // Restore supporting indexes before simulating the prior schema.
      await c.query('ALTER TABLE team_role_change_requests ADD INDEX pb3_old_requester (requested_by_player_id)');
      await c.query('ALTER TABLE team_applications ADD INDEX pb3_old_manager (manager_player_id)');
      for(const [table,name]of [...migration.indexes].reverse())await c.query(`ALTER TABLE ${table} DROP INDEX ${name}`);
      for(const [table,column]of [...migration.columns].reverse())await c.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      await c.query('ALTER TABLE team_application_members MODIFY jersey_number VARCHAR(20) NOT NULL');await c.query("DELETE FROM schema_migrations WHERE version>='0015'");await runPendingMigrations(c);await runPendingMigrations(c);assert.deepEqual((await c.query('SELECT id,student_id,password_hash,name,college FROM player_accounts ORDER BY id'))[0],before);
    }finally{c.release();}
  });
  await t.test('未参赛负责人可建队，创建受赛事和窗口控制，同一创建重试只生成一个草稿',async()=>{
    const season=await call('/api/season',{season_code:'PB3',season_name:'第三批组队测试',start_date:'2026-01-01',end_date:'2026-12-31',is_active:true},admin,'POST',undefined,201);seasonId=season.id;config=await call(`/api/player-admin/season-settings/${seasonId}`);await window();
    await account(0,false);for(let i=1;i<=4;i++)await account(i);await account(5,false);await account(6,false);
    await window(false);await create('关闭时不建队',0,crypto.randomUUID(),409);await window();await create('未启用新生杯',2,crypto.randomUUID(),409);
    const key=crypto.randomUUID(),both=await Promise.all([create('第三批主队',0,key),create('第三批主队',0,key)]);assert.equal(both[0].application.id,both[1].application.id);app=both[0];assert.equal(app.events.length,1);assert.equal(app.permissions.can_edit,true);
    const formalTeams=await call(`/api/team/season/${seasonId}`);assert.equal(formalTeams.teams.length,0);
    await call(`/api/player/team-applications/${app.application.id}`,undefined,players[6].token,'GET',undefined,403);
    const list=await call('/api/player/team-applications',undefined,players[6].token);assert.equal(list.items.length,0);
  });
  await t.test('按当前完整学号添加，草稿暂缺号码；普通队员无编辑权或队友学号材料访问权',async()=>{
    await call(`/api/player/team-applications/${app.application.id}/players?student_id=PB3-5`,undefined,players[0].token,'GET',undefined,409);
    const found=await call(`/api/player/team-applications/${app.application.id}/players?student_id=PB3-1`,undefined,players[0].token);assert.equal(found.id,players[1].id);
    const body=fields(app);body.members=[member(players[1],null,true),member(players[2],null)];await save(body);assert.equal(app.members[0].jersey_number,null);
    const captain=await get(undefined,players[1].token);assert.equal(captain.permissions.can_edit,true);
    const ordinary=await get(undefined,players[2].token);assert.equal(ordinary.permissions.can_edit,false);assert.equal(ordinary.members.find(m=>m.player_id===players[1].id).student_id,undefined);assert.equal(ordinary.events,undefined);assert.equal(JSON.stringify(ordinary).includes('profile_snapshot'),false);
    await save(fields(app),players[2].token,403);
    const academic=await call(`/api/player-admin/season-registrations/${players[1].registration_id}`);await call(`/api/player/season-registration/${players[1].registration_id}/files/${academic.files[0].id}`,undefined,players[0].token,'GET',undefined,403);
    await submit(400);const duplicate=fields(app);duplicate.members[0].jersey_number='01';duplicate.members[1].jersey_number='1';await save(duplicate,players[0].token,400);duplicate.members[1].jersey_number='-1';await save(duplicate,players[0].token,400);
  });
  await t.test('双角色协作防旧版本覆盖，队长调整立即改协作权限，外援和运训可同时计入',async()=>{
    const body=fields(app);body.shirt_color=body.shorts_color=body.socks_color='红';body.members[0].jersey_number='0';body.members[1].jersey_number='10';body.members[1].is_foreign=body.members[1].is_sports_training=true;await save(body);
    const rev=app.application.revision,payload=fields(app),url=`/api/player/team-applications/${app.application.id}`;
    const responses=await Promise.all([players[0],players[1]].map(p=>request(url,{method:'PUT',token:p.token,body:payload,headers:{'If-Match':String(rev)}})));assert.deepEqual(responses.map(v=>v.status).sort(),[200,409]);app=await get();assert.equal(app.summary.foreign,1);assert.equal(app.summary.sports_training,1);
    const swap=fields(app);swap.members[0].is_captain=false;swap.members[1].is_captain=true;await save(swap);assert.equal((await get(undefined,players[1].token)).permissions.can_manage,false);assert.equal((await get(undefined,players[2].token)).permissions.can_manage,true);
    swap.members[0].is_captain=true;swap.members[1].is_captain=false;await save(swap);
    await submit();await save(fields(app),players[0].token,409);await submit(409);
    app=await call(`/api/player/team-applications/${app.application.id}/withdraw`,{},players[1].token,'POST',app.application.revision);await submit();
  });
  await t.test('退回须写理由；截止后只能替换指定行，第二次退回不继承旧替换权限',async()=>{
    await window(false);await review('return',{reason:''},400);await call(`/api/player/team-applications/${app.application.id}/withdraw`,{},players[0].token,'POST',app.application.revision,409);
    const target=app.members[1].id;await review('return',{reason:'该球员不符合本赛事规则\n请替换指定人员',replaceable_member_ids:[target],member_comments:{[target]:'只可替换这一行'}});
    const remove=fields(app);remove.members.pop();await save(remove,players[0].token,409);
    const bad=fields(app);bad.members[0].player_id=players[4].id;await save(bad,players[0].token,409);
    const allowed=fields(app);allowed.members[1].player_id=players[3].id;await save(allowed);assert.equal(app.members[1].id,target);await submit();
    await review('return',{reason:'只改号码，不再允许换人'});const blocked=fields(app);blocked.members[1].player_id=players[4].id;await save(blocked,players[0].token,409);await submit();
  });
  await t.test('审核时资料及资格必须最新；停用或撤销不能通过；重审保留提交快照',async()=>{
    reviewDetail=await reviewGet();const p=players[1];const changed=await call('/api/player/me',{name:'组队新姓名'},p.token,'PUT',p.revision);p.revision=changed.revision;
    await call(`/api/player-admin/team-applications/${app.application.id}/approve`,{reason:'旧页面',review_token:reviewDetail.review_token},admin,'POST',reviewDetail.application.revision,409);
    await call(`/api/player-admin/season-registrations/${p.registration_id}/revoke`,{reason:'核验资格'},admin,'POST',2);await review('approve',{},409);
    const f=new FormData();f.append('season_id',String(seasonId));f.append('account_revision',String(p.revision));f.append('academic_image',new Blob([png],{type:'image/png'}),'test.png');const reg=await call('/api/player/season-registration/submit',f,p.token,'POST',3,201,{'Idempotency-Key':crypto.randomUUID()});await call(`/api/player-admin/season-registrations/${p.registration_id}/approve`,{account_revision:p.revision},admin,'POST',reg.revision);
    const detail=await reviewGet();assert.equal(detail.members[0].name,'组队新姓名');assert.equal(detail.members[0].profile_snapshot.name,'组队球员1');
  });
  await t.test('正式发布事务失败整体回滚，并发通过只建一队一批，旧导入不能覆盖线上队',async()=>{
    const [[before]]=await pool.execute('SELECT COUNT(*) AS n FROM team WHERE season_id=?',[seasonId]);await pool.query("CREATE TRIGGER pb3_fail_roster BEFORE INSERT ON team_player FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test publication rollback'");try{await review('approve',{},500);}finally{await pool.query('DROP TRIGGER pb3_fail_roster');}const [[after]]=await pool.execute('SELECT COUNT(*) AS n FROM team WHERE season_id=?',[seasonId]);assert.equal(after.n,before.n);assert.equal((await get()).application.status,'pending');
    const d=await reviewGet();const responses=await Promise.all([1,2].map(()=>request(`/api/player-admin/team-applications/${d.application.id}/approve`,{token:admin,body:{review_token:d.review_token},headers:{'If-Match':String(d.application.revision)}})));assert.deepEqual(responses.map(v=>v.status).sort(),[200,409]);app=await get();formal=app.application.team_id;assert.ok(formal);
    const [[batch]]=await pool.execute('SELECT COUNT(*) AS n FROM team_roster_batches WHERE application_id=?',[app.application.id]);assert.equal(batch.n,1);
    const teams=await call(`/api/team/season/${seasonId}`);assert.ok(teams.teams.some(t=>t.id===formal));await call(`/api/team/${formal}/roster`,{roster_entries:[{jersey_number:'1',player_name:'绕过审核'}]},admin,'POST',undefined,400);
    const historical=(await pool.execute('SELECT player_name FROM team_player WHERE team_id=? AND player_account_id=?',[formal,players[1].id]))[0][0];assert.equal(historical.player_name,'组队新姓名');
  });
  await t.test('同类赛事正式队数去重、不同赛事同名独立，普通关闭窗口不可自由编辑',async()=>{
    const main=app;await window();app=await create('第三批主队');let body=fields(app);body.shirt_color=body.shorts_color=body.socks_color='白';body.members=[member(players[1],'1',true)];await save(body);await submit(409);
    body.team_name='第三批第二队';await save(body);await submit();const detail=await reviewGet();assert.equal(detail.members[0].approved_team_count,1);other=app;
    // 名单按中国业务日期生效，不能使用 CI 数据库的 UTC 当天来推算明天。
    const [[oldBatch]]=await pool.execute('SELECT * FROM team_roster_batches WHERE team_id=?',[formal]);
    const futureDate=nextEffectiveDate();
    const [future]=await pool.execute('INSERT INTO team_roster_batches (team_id,season_id,version_no,effective_from) VALUES (?,?,2,?)',[formal,seasonId,futureDate]);
    try{
      await pool.execute('INSERT INTO team_player (roster_batch_id,team_id,player_account_id,jersey_number,player_name) VALUES (?,?,?,?,?)',[future.insertId,formal,players[1].id,'99','未来名单']);
      const beforeDate=new Date(Date.parse(futureDate+'T00:00:00Z')-86400000).toISOString().slice(0,10);
      const rosters=require('../../services/playerRosterService');
      assert.equal((await rosters.effectiveBatch(formal,beforeDate)).id,oldBatch.id,'生效日前保留原名单');
      assert.equal((await rosters.effectiveBatch(formal,futureDate)).id,future.insertId,'跨过中国日期边界后新名单生效');
    }finally{
      // This intentionally incomplete future roster belongs only to this test.
      // Leaving it behind changed later audit results when CI crossed midnight.
      await pool.execute('DELETE FROM team_player WHERE roster_batch_id=?',[future.insertId]);
      await pool.execute('DELETE FROM team_roster_batches WHERE id=?',[future.insertId]);
    }
    assert.equal((await reviewGet()).members[0].approved_team_count,1);
    app=await create('第三批主队',1);body=fields(app);body.shirt_color=body.shorts_color=body.socks_color='蓝';body.members=[member(players[1],'0',true)];await save(body);await submit();assert.equal((await reviewGet()).members[0].approved_team_count,0);await review('approve');assert.notEqual(app.application.team_id,formal);
    await window(false);const draft=await create('不在窗口',0,crypto.randomUUID(),409);app=main;
  });
  await t.test('窗口外角色变更经审核立即生效，非参赛负责人可接任，队长仅有效名单内选择',async()=>{
    const rows=(await pool.execute('SELECT * FROM team_player WHERE team_id=? ORDER BY id',[formal]))[0];let list=await call(`/api/player/teams/${formal}/role-changes`,undefined,players[0].token);
    await call(`/api/player/teams/${formal}/role-candidates?role=captain&student_id=PB3-2`,undefined,players[0].token,'GET',undefined,409);
    const body={role:'manager',new_player_id:players[5].id,reason:'非参赛负责人接任'},key=crypto.randomUUID();const requestData=await call(`/api/player/teams/${formal}/role-changes`,body,players[0].token,'POST',list.team.revision,201,{'Idempotency-Key':key});const same=await call(`/api/player/teams/${formal}/role-changes`,body,players[0].token,'POST',list.team.revision,201,{'Idempotency-Key':key});assert.equal(same.request.id,requestData.request.id);
    await call(`/api/player/teams/${formal}/role-changes`,undefined,players[5].token,'GET',undefined,403);
    let d=await call(`/api/player-admin/role-changes/${requestData.request.id}`);await call(`/api/player-admin/role-changes/${d.request.id}/approve`,{review_token:d.review_token},admin,'POST',d.request.revision);
    await call(`/api/player/team-applications/${app.application.id}`,undefined,players[0].token,'GET',undefined,403);assert.equal((await get(app.application.id,players[5].token)).permissions.can_manage,true);
    list=await call(`/api/player/teams/${formal}/role-changes`,undefined,players[5].token);const cap=await call(`/api/player/teams/${formal}/role-changes`,{role:'captain',new_player_id:players[3].id},players[5].token,'POST',list.team.revision,201,{'Idempotency-Key':crypto.randomUUID()});d=await call(`/api/player-admin/role-changes/${cap.request.id}`);await call(`/api/player-admin/role-changes/${cap.request.id}/return`,{reason:'',review_token:d.review_token},admin,'POST',d.request.revision,400);await call(`/api/player-admin/role-changes/${cap.request.id}/approve`,{review_token:d.review_token},admin,'POST',d.request.revision);
    assert.equal((await get(app.application.id,players[1].token)).permissions.can_manage,false);const newCaptain=await get(app.application.id,players[3].token);assert.equal(newCaptain.permissions.can_manage,true);assert.equal(newCaptain.members.find(m=>m.player_id===players[3].id).is_captain,true);
    assert.deepEqual((await pool.execute('SELECT * FROM team_player WHERE team_id=? ORDER BY id',[formal]))[0],rows);
  });
  await t.test('超过31人的线上球队可正常审核，人数和外援运训只显示不自动限额',async()=>{
    await window();for(let i=7;i<=35;i++)await account(i);
    app=await create('超过31人测试队');const body=fields(app);body.shirt_color=body.shorts_color=body.socks_color='红';body.members=[...players.slice(1,5),...players.slice(7,36)].map((p,i)=>({...member(p,String(i),i===0),is_foreign:true,is_sports_training:true}));assert.equal(body.members.length,33);await save(body);await submit();const d=await reviewGet();assert.equal(d.summary.total,33);assert.equal(d.summary.foreign,33);assert.equal(d.summary.sports_training,33);await review('approve');const current=await call(`/api/team/${app.application.team_id}/current-roster`);assert.equal(current.players.length,33);
  });
  await t.test('同名待审队伍在审批时再次检查；关闭窗口后未提交草稿不可保存或提交',async()=>{
    async function ready(){app=await create('审批同名保护');const body=fields(app);body.shirt_color=body.shorts_color=body.socks_color='红';body.members=[member(players[1],'1',true)];await save(body);await submit();return app;}
    const first=await ready(),second=await ready();app=first;await review('approve');app=second;await review('approve',{},409);
    app=await create('截止前保留的草稿');const body=fields(app);body.shirt_color=body.shorts_color=body.socks_color='白';body.members=[member(players[1],'1',true)];await save(body);await window(false);
    await save(fields(app),players[0].token,409);await submit(409);assert.equal((await get()).permissions.can_edit,false);
  });
  await t.test('线上报名、指定补正和角色变更审计通过，损坏状态可以被检出',async()=>{
    const {checks}=require('../../scripts/audit');
    const workflowChecks=checks.filter(v=>v.name.startsWith('球队')||v.name.startsWith('审核通过申请'));assert.equal(workflowChecks.length,5);
    for(const check of workflowChecks){const [[row]]=await pool.query(check.sql);assert.equal(Number(row.issue_count),0,check.name);}
    const c=await pool.getConnection();try{await c.beginTransaction();await c.execute("UPDATE team_applications SET status='returned' WHERE id=?",[app.application.id]);const [[row]]=await c.query(workflowChecks[0].sql);assert.ok(Number(row.issue_count)>0);}finally{await c.rollback();c.release();}
  });
};
