const assert=require('node:assert/strict'),crypto=require('node:crypto'),XLSX=require('xlsx');
const w=require('../../utils/playerWorkflow'),rules=require('../../utils/teamApplicationRules');
const {businessDate}=require('../../utils/competitionTime');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=','base64');
module.exports=async({t,pool,state,request,expectStatus})=>{
  const admin=state.tokens.admin,players=[];let season,config,home,away,app,oldBatch,newBatch,todayMatch,futureMatch,pastMatch,selection;
  const call=async(path,body,token=admin,method,revision,status=200,headers={})=>{const r=await request(path,{body,token,method,headers:{...headers,...(revision==null?{}:{'If-Match':String(revision)})}});expectStatus(r,status,path);return r.data?.data;};
  const get=()=>call(`/api/player/team-applications/${app.application.id}`,undefined,players[0].token);
  const fields=d=>({...Object.fromEntries(['team_name','shirt_color','shorts_color','socks_color'].map(k=>[k,d.application[k]])),members:d.members.map(m=>({id:m.id,player_id:m.player_id,jersey_number:m.jersey_number,remark:m.remark,...Object.fromEntries(rules.FLAGS.map(f=>[f,m[f]]))}))});
  async function settings(open){const time=d=>w.chinaIso(w.chinaSql(new Date(Date.now()+d)));config=await call(`/api/player-admin/season-settings/${season.id}`,{registration_opens_at:time(-7200000),registration_closes_at:time(86400000),competitions:['大联赛','足协杯','新生杯'].map(league_type=>({yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1,league_type,is_enabled:true,rules_text:'本测试人数不限，外援与运训人工判断',registration_opens_at:time(-7200000),registration_closes_at:time(86400000),change_windows:[{opens_at:time(-7200000),closes_at:time(open?86400000:-3600000)}]}))},admin,'PUT',config.revision);}
  function file(rows){const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([require('../../utils/rosterExcelParser').HEADERS,...rows]),'名单');return XLSX.write(b,{type:'buffer',bookType:'xlsx'});}
  const row=(p,n,cap=false)=>[p.student_id,p.name,String(n),cap?'是':'否','是','是','是','测试备注'];
  async function preview(name,rows,teamId=null,status=200){const b=new FormData();for(const [k,v]of Object.entries({season_id:season.id,team_name:name,league_type:'足协杯',manager_student_id:players[0].student_id,manager_name:players[0].name,shirt_color:'红',shorts_color:'红',socks_color:'红',...(teamId?{team_id:teamId}:{})}))b.append(k,String(v));b.append('roster_file',new Blob([file(rows)]),'测试名单.xlsx');return call('/api/team/import-preview',b,admin,'POST',null,status);}
  const confirm=(p,status=200,key=crypto.randomUUID())=>call('/api/team/import-confirm',{preview:p.preview,preview_token:p.preview_token},admin,'POST',null,status,{'Idempotency-Key':key});
  async function changeCreate(status=201,token=players[0].token){const d=await call(`/api/player/teams/${home.team_id}`,undefined,token);const a=await call(`/api/player/teams/${home.team_id}/roster-changes`,{},token,'POST',d.team.revision,status,{'Idempotency-Key':crypto.randomUUID()});if(status===201)app=a;return a;}
  async function save(body,status=200,token=players[0].token){const d=await call(`/api/player/team-applications/${app.application.id}`,body,token,'PUT',app.application.revision,status);if(status===200)app=d;return d;}
  async function submit(status=200){const d=await call(`/api/player/team-applications/${app.application.id}/submit`,{},players[0].token,'POST',app.application.revision,status);if(status===200)app=d;}
  async function review(operation='approve',extra={},status=200){const d=await call(`/api/player-admin/team-applications/${app.application.id}`);const result=await call(`/api/player-admin/team-applications/${app.application.id}/${operation}`,{review_token:d.review_token,reason:'第四批审核测试',...(operation==='return'?{replaceable_member_ids:[],member_comments:{}}:{}),...extra},admin,'POST',d.application.revision,status);if(status===200)app=await get();return result;}
  const current=()=>call(`/api/team/${home.team_id}/current-roster`);
  const matchDetail=id=>call(`/api/report/admin/schedule/${id}/rosters`);
  const date=d=>new Date(Date.parse(businessDate()+'T00:00:00Z')+d*86400000).toISOString().slice(0,10);

  await t.test('第四批0016迁移无损、可重复运行，原表原字段及比赛历史保留',async()=>{
    const m=require('../../../db/migrations/0016_roster_changes_and_imports'),{runPendingMigrations}=require('../../utils/migrationRunner'),c=await pool.getConnection();
    try{const snapshot=async()=>{const out={};for(const name of ['team','team_player','team_roster_batches','team_applications','match_goals','match_schedules'])out[name]=(await c.query('SELECT * FROM '+name+' ORDER BY id'))[0].map(v=>{for(const [table,column]of m.columns)if(table===name)delete v[column];return v;});return out;};const before=await snapshot();for(const sql of [...m.tables].reverse())await c.query('DROP TABLE '+sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1]);for(const [table,index]of [...m.indexes].reverse())await c.query(`ALTER TABLE ${table} DROP INDEX ${index}`);for(const [table,column]of [...m.columns].reverse())await c.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);await c.query("DELETE FROM schema_migrations WHERE version>='0016'");await runPendingMigrations(c);await runPendingMigrations(c);assert.deepEqual(await snapshot(),before);}finally{c.release();}
  });
  await t.test('新版导入保留待关联身份，完整名单错误仍不能确认',async()=>{
    season=await call('/api/season',{season_code:'PB4',season_name:'第四批名单变更测试',start_date:date(-180),end_date:date(180),is_active:true},admin,'POST',null,201);config=await call(`/api/player-admin/season-settings/${season.id}`);await settings(true);
    for(let i=0;i<5;i++){const p=await call('/api/player/login',{student_id:'PB3-'+i,password:'Player!Test2026'},null,'POST');players.push(p);{const form=new FormData();form.append('season_id',String(season.id));form.append('account_revision',String(p.revision));form.append('academic_image',new Blob([png],{type:'image/png'}),'test.png');const reg=await call('/api/player/season-registration/submit',form,p.token,'POST',0,201,{'Idempotency-Key':crypto.randomUUID()});await call(`/api/player-admin/season-registrations/${reg.registration.id}/approve`,{account_revision:p.revision},admin,'POST',reg.revision);}}
    const bad=await preview('错误导入',[row(players[0],0,true),['不存在','无账号','1'],[players[1].student_id,'错误姓名','2']]);assert.equal(bad.can_confirm,true);assert.equal(bad.members[1].link_status,'unregistered');assert.equal(bad.members[2].link_status,'identity_mismatch');const invalid=await preview('无队长',[row(players[1],1,false)]);assert.equal(invalid.can_confirm,false);await confirm(invalid,409);
    await call('/api/team',{team_name:'旁路',league_type:'足协杯',roster_entries:[{jersey_number:'1',player_name:'未关联'}]},admin,'POST',null,400);
  });
  await t.test('管理员确认即发布，签名防篡改、重复确认幂等、重名及过期预览被拦截',async()=>{
    const p=await preview('第四批主队',[row(players[1],1,true),row(players[2],2)]);assert.equal(p.can_confirm,true);assert.equal(p.summary.foreign,2);assert.equal(p.summary.sports_training,2);
    const tampered=structuredClone(p);tampered.preview.input.team_name='篡改';await confirm(tampered,409);
    const key=crypto.randomUUID();home=await confirm(p,200,key);assert.equal((await confirm(p,200,key)).team_id,home.team_id);assert.equal((await current()).roster_batch.version_no,1);oldBatch=(await current()).roster_batch.id;
    assert.equal((await preview('第四批主队',[row(players[1],1,true)])).can_confirm,false);
    away=await confirm(await preview('第四批客队',[row(players[3],3,true)]));
    const exp=await preview('过期队',[row(players[3],3,true)]);exp.preview.expires_at=Date.now()-1000;exp.preview_token=crypto.createHmac('sha256',process.env.JWT_SECRET).update(JSON.stringify(exp.preview)).digest('hex');await confirm(exp,409);
  });
  await t.test('预览后资料变化必须重新预览；并发确认只生成一个正式批次，故障完整回滚',async()=>{
    const stale=await preview('资料变化队',[row(players[1],1,true)]);await pool.execute('UPDATE player_accounts SET revision=revision+1 WHERE id=?',[players[1].id]);await confirm(stale,409);
    const p=await preview('并发导入队',[row(players[1],1,true)]),key=crypto.randomUUID();const results=await Promise.all([confirm(p,200,key),confirm(p,200,key)]);assert.equal(results[0].team_id,results[1].team_id);
    const fail=await preview('回滚导入队',[row(players[1],1,true)]);await pool.query("CREATE TRIGGER pb4_fail BEFORE INSERT ON team_player FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='batch4 rollback'");try{await confirm(fail,500);}finally{await pool.query('DROP TRIGGER pb4_fail');}assert.equal((await pool.execute("SELECT id FROM team WHERE team_name='回滚导入队'"))[0].length,0);
  });
  await t.test('负责人及队长可建变更稿，队员不能；进行中申请阻止重复草稿及Excel导入',async()=>{
    await changeCreate(403,players[2].token);await changeCreate(201,players[1].token);assert.equal(app.application.kind,'roster_change');assert.equal(app.members.length,2);await changeCreate(409);await preview('第四批主队',[row(players[1],1,true)],home.team_id,409);
    let body=fields(app);body.members[1].jersey_number='12';await save(body,200,players[1].token);assert.equal((await current()).players[1].jersey_number,'2');
    const createMatch=async day=>call('/api/schedule',{team_a_id:home.team_id,team_b_id:away.team_id,match_type:'足协杯',match_time: '00:00', match_date: date(day),field_order:day+20},admin,'POST');
    todayMatch=await createMatch(0);futureMatch=await createMatch(1);pastMatch=await createMatch(-1);
  });
  await t.test('名单待审保留旧版，通过即更新人员号码角色及球队资料；今日和过往赛程保留原版',async()=>{
    const body=fields(app);body.team_name='第四批主队更名';body.shirt_color='蓝';body.members[1]={...body.members[1],player_id:players[4].id,jersey_number:'44',is_captain:true};body.members[0].is_captain=false;await save(body);await submit();assert.equal((await current()).roster_batch.id,oldBatch);
    selection=await matchDetail(todayMatch.id);await review();const now=await current();newBatch=now.roster_batch.id;assert.notEqual(newBatch,oldBatch);assert.equal(now.team.team_name,'第四批主队更名');assert.equal(now.players[1].player_account_id,players[4].id);assert.equal(now.players[1].is_captain,1);
    assert.equal((await matchDetail(todayMatch.id)).items[0].roster_batch_id,oldBatch);assert.equal((await matchDetail(pastMatch.id)).items[0].roster_batch_id,null);assert.equal((await matchDetail(futureMatch.id)).items[0].roster_batch_id,newBatch);
    assert.equal((await call('/api/player/teams',undefined,players[2].token)).some(t=>t.id===home.team_id),false);assert.ok((await call('/api/player/teams',undefined,players[4].token)).some(t=>t.id===home.team_id));assert.equal((await call(`/api/player/teams/${home.team_id}`,undefined,players[1].token)).can_manage,false);
    assert.ok((await call('/api/player/notifications',undefined,players[2].token)).some(n=>n.message.includes('立即生效')));
  });
  await t.test('管理员可在开始报告前切换今日名单；过期选择凭据、其他队名单和非管理员被拒绝',async()=>{
    await call(`/api/report/admin/schedule/${todayMatch.id}/rosters`,{team_id:home.team_id,roster_batch_id:newBatch,reason:'未开赛使用新版',review_token:selection.review_token},admin,'PUT',null,409);
    const d=await matchDetail(todayMatch.id);await call(`/api/report/admin/schedule/${todayMatch.id}/rosters`,{team_id:home.team_id,roster_batch_id:away.batch_id,reason:'错误球队',review_token:d.review_token},admin,'PUT',null,400);
    await call(`/api/report/admin/schedule/${todayMatch.id}/rosters`,undefined,players[0].token,'GET',null,403);
    await call(`/api/report/admin/schedule/${todayMatch.id}/rosters`,{team_id:home.team_id,roster_batch_id:newBatch,reason:'尚未开赛，采用新名单',review_token:d.review_token},admin,'PUT');assert.equal((await matchDetail(todayMatch.id)).items[0].roster_batch_id,newBatch);
  });
  await t.test('截止后退回仅指定球员可替换，其他人及行数锁定；补正重审立即发布',async()=>{
    await changeCreate();await submit();await settings(false);const id=app.members[0].id;await review('return',{replaceable_member_ids:[id],member_comments:{[id]:'替换此人'}});const body=fields(app);body.members[1].player_id=players[2].id;await save(body,409);const added=fields(app);added.members.push({...added.members[0],id:null,player_id:players[3].id,jersey_number:'33'});await save(added,409);
    const correct=fields(app);correct.members[0].player_id=players[2].id;correct.members[0].jersey_number='22';await save(correct);await submit();await review();assert.equal((await current()).players[0].player_account_id,players[2].id);await changeCreate(409);
  });
  await t.test('撤回变更释放导入入口，旧草稿不能覆盖新版本；旧未关联球队可用新版导入保留历史',async()=>{
    await settings(true);await changeCreate();const staleId=app.application.id;app=await call(`/api/player/team-applications/${staleId}/withdraw`,{},players[0].token,'POST',app.application.revision);const stale=fields(app);
    await confirm(await preview('第四批导入修订',[row(players[4],4,true)],home.team_id));await save(stale,409);
    const legacy=await require('./legacyTeamFixture.cjs').create({team_name:'第四批遗留球队',league_type:'足协杯',roster_entries:[{jersey_number:'9',player_name:'同名旧球员'}]});const before=(await pool.execute('SELECT * FROM team_player WHERE team_id=?',[legacy.id]))[0];await confirm(await preview('第四批遗留球队',[row(players[3],3,true)],legacy.id));assert.deepEqual((await pool.execute('SELECT * FROM team_player WHERE id=?',[before[0].id]))[0],before);assert.equal((await call(`/api/team/${legacy.id}/current-roster`)).players[0].player_account_id,players[3].id);
  });
  await t.test('本场报告按选择名单读取，开始后选择锁定，名单审核不改已填写比赛的球员ID',async()=>{
    const ext=await call('/api/officials/external',{name:'第四批非系统裁判员',note:'名单回归测试'},admin,'POST',null,201);
    const match=await call('/api/schedule',{team_a_id:home.team_id,team_b_id:away.team_id,match_type:'足协杯',match_time: '00:00', match_date: date(0),field_order:99,main_referee_id:`external:${ext.id}`},admin,'POST');
    const report=await call(`/api/report/schedule/${match.id}`),p=report.match_rosters[0].players[0];
    await call(`/api/report/admin/schedule/${match.id}/main`,{home_score:1,away_score:0,goals:[{player_team_id:home.team_id,credited_team_id:home.team_id,team_player_id:p.id,goal_type:'normal',minute_base:12}],cards:[]},admin,'POST',report.sections.main.revision);
    const locked=await matchDetail(match.id);assert.equal(locked.can_edit,false);await call(`/api/report/admin/schedule/${match.id}/rosters`,{team_id:home.team_id,roster_batch_id:oldBatch,reason:'开始后不可切换',review_token:locked.review_token},admin,'PUT',null,409);
    const goals=(await pool.execute('SELECT * FROM match_goals WHERE report_id=(SELECT id FROM match_reports WHERE schedule_id=?)',[match.id]))[0];await confirm(await preview('第四批最终名单',[row(players[2],2,true)],home.team_id));assert.deepEqual((await pool.execute('SELECT * FROM match_goals WHERE report_id=(SELECT id FROM match_reports WHERE schedule_id=?)',[match.id]))[0],goals);assert.equal((await call(`/api/report/schedule/${match.id}`)).match_rosters[0].players[0].id,p.id);
  });
  await t.test('修改赛程日期会解除先前名单选择，重选审计修订号连续；过往比赛可在报告前指定名单',async()=>{
    const before=await call(`/api/schedule/${todayMatch.id}`);
    await call(`/api/schedule/${todayMatch.id}`,{match_type:'足协杯',team_a_id:home.team_id,team_b_id:away.team_id,match_time: '00:00', match_date: date(1),field_order:20},admin,'PUT');
    assert.equal((await matchDetail(todayMatch.id)).items[0].revision,0);
    await call(`/api/schedule/${todayMatch.id}`,{match_type:'足协杯',team_a_id:home.team_id,team_b_id:away.team_id,match_time: '00:00', match_date: date(0),field_order:20},admin,'PUT');
    const d=await matchDetail(todayMatch.id);await call(`/api/report/admin/schedule/${todayMatch.id}/rosters`,{team_id:home.team_id,roster_batch_id:oldBatch,reason:'改期后核对，保留旧名单',review_token:d.review_token},admin,'PUT');assert.ok((await matchDetail(todayMatch.id)).items[0].revision>2);assert.equal((await matchDetail(pastMatch.id)).can_edit,true);
  });
  await t.test('超过31人的Excel逐一关联并发布全部33人，外援运训分别计数且不自动设限',async()=>{
    const many=[...players.slice(1)];
    for(let i=7;i<=35;i++){const p=await call('/api/player/login',{student_id:'PB3-'+i,password:'Player!Test2026'},null,'POST');many.push(p);const form=new FormData();form.append('season_id',String(season.id));form.append('account_revision',String(p.revision));form.append('academic_image',new Blob([png],{type:'image/png'}),'test.png');const reg=await call('/api/player/season-registration/submit',form,p.token,'POST',0,201,{'Idempotency-Key':crypto.randomUUID()});await call(`/api/player-admin/season-registrations/${reg.registration.id}/approve`,{account_revision:p.revision},admin,'POST',reg.revision);}
    const p=await preview('完整33人导入队',many.map((p,i)=>row(p,i,i===0)));assert.equal(p.summary.total,33);assert.equal(p.summary.foreign,33);assert.equal(p.summary.sports_training,33);const team=await confirm(p);assert.equal((await call(`/api/team/${team.team_id}/current-roster`)).players.length,33);
  });
  await t.test('第四批正式发布和名单选择审计一致',async()=>{for(const check of require('../../scripts/audit').checks.filter(c=>/球队|审核通过申请|比赛名单/.test(c.name))){const [[row]]=await pool.query(check.sql);assert.equal(Number(row.issue_count),0,check.name);}});
};
