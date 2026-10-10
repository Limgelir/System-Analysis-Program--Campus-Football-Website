const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const images=require('../../utils/playerAcademicUpload');
const {businessDate}=require('../../utils/competitionTime');
module.exports=async({t,pool,state,request,expectStatus})=>{
  if(process.env.REFWEB_INTEGRATION_TEST!=='1'||!process.env.DB_NAME.endsWith('_test'))throw Error('仅隔离测试库');
  const admin=state.tokens.admin;
  const call=async(url,body,token=admin,method,revision,status=200)=>{const r=await request(url,{body,token,method,headers:revision==null?{}:{'If-Match':String(revision)}});expectStatus(r,status,url);return r.data?.data;};
  let team,away,season,match,p,player,manager,goalData,cleanup,mainToken,mainId;
  const result=async()=> (await call(`/api/player/team-results/${team.id}`,undefined,player.token)).matches.find(m=>m.id===match.id);
  await t.test('第五批公开名单、历史赛季和扩展契约不泄露学号或内部报告',async()=>{
    [[season]]=await pool.query("SELECT * FROM seasons WHERE season_code='PB4'");[[team]]=await pool.query("SELECT * FROM team WHERE season_id=? AND team_name='第四批最终名单'",[season.id]);[[away]]=await pool.query('SELECT * FROM team WHERE season_id=? AND id<>? ORDER BY id LIMIT 1',[season.id,team.id]);
    player=await call('/api/player/login',{student_id:'PB3-2',password:'Player!Test2026'},null,'POST');manager=await call('/api/player/login',{student_id:'PB3-0',password:'Player!Test2026'},null,'POST');
    const publicTeam=await call('/api/public/teams/'+team.id,undefined,null);assert.equal(publicTeam.players.length,1);assert.ok(publicTeam.players[0].is_foreign);assert.ok(publicTeam.players[0].is_sports_training);
    const forbidden=/student_id|profile_snapshot|password|file_path|actor_|referee|player_account_id|remark/;assert.doesNotMatch(JSON.stringify(publicTeam),forbidden);
    const all=await call(`/api/public/teams?season_id=${season.id}&league_type=足协杯`,undefined,null);assert.ok(all.every(v=>v.season_id===season.id&&v.league_type==='足协杯'));
    const mine=await call('/api/player/my-teams',undefined,player.token);assert.ok(mine.some(v=>v.id===team.id&&v.is_member&&v.can_manage));
    const managed=await call('/api/player/my-teams',undefined,manager.token);assert.ok(managed.some(v=>v.id===team.id&&v.can_manage&&!v.is_member));
    for(const name of ['scorers','standings'])assert.equal((await call('/api/public/'+name,undefined,null)).enabled,false);
    await call('/api/player-admin/competition-format',undefined,player.token,undefined,null,403);assert.equal((await call('/api/player-admin/competition-format')).status,'not_implemented');
    await call('/api/public/teams?season_id=bad',undefined,null,undefined,null,400);
  });
  await t.test('未提交0比0为待发布，管理员首次修订立即公开，随后代填草稿不泄露',async()=>{
    const external=await call('/api/officials/external',{name:'第五批外部裁判员',note:'隔离测试'},admin,'POST',null,201);
    match=await call('/api/schedule',{team_a_id:team.id,team_b_id:away.id,match_type:'足协杯',match_time: '00:00', match_date: businessDate(),field_order:150,main_referee_id:`external:${external.id}`},admin,'POST');
    assert.equal((await result()).status,'unpublished');assert.equal((await result()).result,null);
    const d=await call(`/api/report/schedule/${match.id}`);p=d.match_rosters.find(v=>v.team_id===team.id).players[0];
    const goal=(type,minute)=>({player_team_id:team.id,credited_team_id:type==='own_goal'?away.id:team.id,team_player_id:p.id,goal_type:type,minute_base:minute});
    goalData={home_score:2,away_score:1,home_penalty_score:5,away_penalty_score:4,goals:[goal('normal',10),goal('penalty',20),goal('own_goal',30)],cards:[]};
    await call(`/api/report/admin/schedule/${match.id}/sections/main/revise`,{reason:'首次核实正式比分',data:goalData},admin,'POST');
    const published=await result();assert.equal(published.my_goals,2);assert.equal(published.result.home_penalty_score,5);assert.equal(published.result.goals.length,3);
    await call(`/api/report/admin/schedule/${match.id}/main`,{...goalData,home_score:1,away_score:0,goals:goalData.goals.slice(0,1)},admin,'POST');assert.deepEqual((await result()).result,published.result);
    await call(`/api/report/admin/schedule/${match.id}/main/submit`,{},admin,'POST');assert.equal((await result()).my_goals,1);
    await call(`/api/report/admin/schedule/${match.id}/main/submit`,{},admin,'POST',null,400);assert.equal((await result()).my_goals,1);
  });
  await t.test('改名、换学号和旧学号复用不转移进球；比赛和审核快照保留原名',async()=>{
    const oldName=p.player_name;
    await call('/api/player/me',{name:'第五批最新姓名'},player.token,'PUT',player.revision);player=await call('/api/player/me',undefined,player.token).then(d=>({...d,token:player.token}));
    await call('/api/player/me/student-id',{student_id:'PB5-NEW-ID',current_password:'Player!Test2026'},player.token,'PUT',player.revision);player=await call('/api/player/login',{student_id:'PB5-NEW-ID',password:'Player!Test2026'},null,'POST');
    await call('/api/player/register',{student_id:'PB3-2',name:oldName,college:'法学院',password:'Player!Test2026',gender:'male',password_confirm:'Player!Test2026'},null,'POST',null,201);
    const other=await call('/api/player/login',{student_id:'PB3-2',password:'Player!Test2026'},null,'POST');
    assert.equal((await result()).my_goals,1);assert.equal((await call('/api/player/team-results/'+team.id,undefined,other.token)).my_goals,0);
    assert.equal((await call('/api/public/teams/'+team.id,undefined,null)).players[0].player_name,'第五批最新姓名');
    assert.equal((await call('/api/public/matches/'+match.id,undefined,null)).rosters.find(v=>v.team_id===team.id).players[0].player_name,oldName);
    assert.equal((await result()).result.goals[0].player_name,oldName);
  });
  await t.test('系统裁判员退回保留正式结果，重提替换且不累计；并发修订只接受一个版本',async()=>{
    // 前面的演示 CLI 用例重建了隔离裁判账号；为本场取现存账号生成测试会话。
    const [[ref]]=await pool.query('SELECT id,token_version FROM referee WHERE is_active=1 AND must_change_password=0 ORDER BY id LIMIT 1');mainId=ref.id;mainToken=require('jsonwebtoken').sign({id:ref.id,role:'referee',tokenVersion:ref.token_version},process.env.JWT_SECRET);
    const reg=await call('/api/season-registration/current/submit',{name:'第五批系统裁判员',height_cm:175,weight_kg:65,college:'土木工程学院',grade:'二级',match_types:['足协杯']},mainToken,'POST',null,201);
    await call(`/api/season-registration/admin/${reg.id}/approve`,{reason:'测试资格'},admin,'POST');
    match=await call('/api/schedule',{team_a_id:team.id,team_b_id:away.id,match_type:'足协杯',match_time: '00:00', match_date: businessDate(),field_order:151,main_referee_id:mainId},admin,'POST');
    await call(`/api/report/schedule/${match.id}/main`,goalData,mainToken,'POST');await call(`/api/report/schedule/${match.id}/main/submit`,{},mainToken,'POST');
    assert.equal((await result()).my_goals,2);
    await call(`/api/report/admin/schedule/${match.id}/sections/main/return`,{reason:'核对普通进球'},admin,'POST');
    await call(`/api/report/schedule/${match.id}/main`,{home_score:0,away_score:0,goals:[],home_penalty_score:null,away_penalty_score:null},mainToken,'POST');
    assert.equal((await result()).status,'revising');assert.equal((await result()).my_goals,2);
    await call(`/api/report/schedule/${match.id}/main/submit`,{},mainToken,'POST');assert.equal((await result()).my_goals,0);
    const report=await call(`/api/report/schedule/${match.id}`),url=`/api/report/admin/schedule/${match.id}/sections/main/revise`;
    const responses=await Promise.all([1,2].map(()=>request(url,{token:admin,body:{reason:'同时修订',data:goalData},headers:{'If-Match':String(report.sections.main.revision)}})));
    assert.deepEqual(responses.map(v=>v.status).sort(),[200,409]);assert.equal((await result()).my_goals,2);
    const pub=await call('/api/public/teams/'+team.id,undefined,null);assert.deepEqual(pub.matches.find(v=>v.id===match.id).result,(await result()).result);
  });
  await t.test('0017回填最后正式快照，不采用退回草稿，重复迁移稳定',async()=>{
    await call(`/api/report/admin/schedule/${match.id}/sections/main/return`,{reason:'回填验证'},admin,'POST');
    await call(`/api/report/schedule/${match.id}/main`,{home_score:0,away_score:0,goals:[]},mainToken,'POST');
    const before=(await result()).result,c=await pool.getConnection();
    try{await c.execute('DELETE FROM match_publications WHERE report_id=(SELECT id FROM match_reports WHERE schedule_id=?)',[match.id]);await c.query("DELETE FROM schema_migrations WHERE version>='0017'");await require('../../utils/migrationRunner').runPendingMigrations(c);await require('../../utils/migrationRunner').runPendingMigrations(c);}finally{c.release();}
    assert.deepEqual((await result()).result,before);assert.equal((await result()).status,'revising');
  });
  await t.test('截图清理预览只允许管理员，必须明确确认和使用最新版本',async()=>{
    const url=`/api/player-admin/season-settings/${season.id}/cleanup`;cleanup=await call(url);
    assert.ok(cleanup.remaining>0);await call(url,undefined,player.token,undefined,null,403);await call(url,{confirm_season_name:'错误'},admin,'POST',cleanup.revision,400);await call(url,{confirm_season_name:season.season_name},admin,'POST',cleanup.revision+100,409);
    assert.equal((await call(url)).ended_at,null);
  });
  await t.test('结束仅清理指定赛季的在线历史图片，备份/其他图片保留，失败可安全重试',async()=>{
    const url=`/api/player-admin/season-settings/${season.id}/cleanup`;
    const [targets]=await pool.execute('SELECT f.* FROM player_registration_files f JOIN player_season_registrations r ON r.id=f.registration_id WHERE r.season_id=?',[season.id]);
    const [[foreign]]=await pool.execute('SELECT f.* FROM player_registration_files f JOIN player_season_registrations r ON r.id=f.registration_id WHERE r.season_id<>? AND f.file_path IS NOT NULL LIMIT 1',[season.id]);
    const backup=path.join(require('../../utils/uploadPaths').UPLOAD_ROOT,'backups-test');await fs.mkdir(backup);const copy=path.join(backup,'academic.png');await fs.copyFile(images.resolve(targets[0].file_path),copy);
    const original=targets[0].file_path;await pool.execute('UPDATE player_registration_files SET file_path=? WHERE id=?',['../backups-test/academic.png',targets[0].id]);
    cleanup=await call(url,{confirm_season_name:season.season_name},admin,'POST',cleanup.revision);assert.equal(cleanup.cleanup_status,'failed');assert.equal(cleanup.remaining,1);assert.ok(cleanup.events.some(e=>e.operation==='failed'));
    await fs.access(copy);await fs.access(images.resolve(foreign.file_path));await fs.access(images.resolve(original));
    for(const f of targets.slice(1))await assert.rejects(fs.access(images.resolve(f.file_path)),{code:'ENOENT'});
    await pool.execute('UPDATE player_registration_files SET file_path=? WHERE id=?',[original,targets[0].id]);
    cleanup=await call(url,{confirm_season_name:season.season_name},admin,'POST',cleanup.revision);assert.equal(cleanup.remaining,0);assert.equal(cleanup.cleanup_status,'complete');
    cleanup=await call(url,{confirm_season_name:season.season_name},admin,'POST',cleanup.revision);assert.equal(cleanup.remaining,0);await fs.access(copy);
    const d=await call(`/api/player-admin/season-registrations/${targets[0].registration_id}`);assert.ok(d.events.length);assert.ok(d.files.every(f=>!f.available&&f.cleaned_at));await call(`/api/player-admin/season-registrations/${targets[0].registration_id}/files/${targets[0].id}`,undefined,admin,undefined,null,410);
    assert.equal((await call('/api/player/season-registration/current',undefined,player.token)).can_submit,false);
    assert.equal((await call('/api/player/teams/'+team.id,undefined,player.token)).can_create,false);
    // 赛季结束后正式结果修订仍有效。
    await call(`/api/report/admin/schedule/${match.id}/sections/main/revise`,{reason:'赛季结束后核实结果',data:goalData},admin,'POST');assert.equal((await result()).my_goals,2);
    await fs.unlink(copy);await fs.rmdir(backup);
  });
  await t.test('公开发布和已清理材料审计一致，学籍历史查询只返回本人记录',async()=>{
    for(const check of require('../../scripts/audit').checks.filter(c=>/公开结果|已清理学籍|清理完成赛季/.test(c.name))){const [[row]]=await pool.query(check.sql);assert.equal(Number(row.issue_count),0,check.name);}
    const own=await call('/api/player/season-registration/history',undefined,player.token);assert.ok(own.length>=2);
    const [[other]]=await pool.query('SELECT id FROM player_season_registrations WHERE player_id<>? LIMIT 1',[player.id]);assert.ok(!own.some(r=>r.id===other.id));
    await call(`/api/player/season-registration/${other.id}`,undefined,player.token,undefined,null,403);
    assert.deepEqual((await call('/api/player/teams/'+team.id,undefined,player.token)).players.map(p=>p.player_name),(await call('/api/public/teams/'+team.id,undefined,null)).players.map(p=>p.player_name));
  });
};
