const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const w=require('../../utils/playerWorkflow');
const images=require('../../utils/playerAcademicUpload');
const service=require('../../services/playerRegistrationService');
const migration=require('../../../db/migrations/0014_player_registration_workflow');
const {runPendingMigrations}=require('../../utils/migrationRunner');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=','base64');
module.exports=async({t,pool,state,request,expectStatus})=>{
  if(process.env.REFWEB_INTEGRATION_TEST!=='1'||!process.env.DB_NAME.endsWith('_test'))throw Error('只允许隔离测试库');
  const admin=state.tokens.admin,players=[];let seasonId,config,registration;
  const expect= (r,status,label)=>{expectStatus(r,status,label);return r.data?.data;};
  const current=async(p=players[0])=>expect(await request('/api/player/season-registration/current',{token:p.token}),200,'当前资格');
  const time=delta=>w.chinaIso(w.chinaSql(new Date(Date.now()+delta)));
  const configBody=()=>({registration_opens_at:config.registration_opens_at,registration_closes_at:config.registration_closes_at,competitions:(config.competitions.length?config.competitions:['大联赛','足协杯','新生杯'].map(league_type=>({league_type,is_enabled:false,rules_text:'',registration_opens_at:null,registration_closes_at:null,change_windows:[],yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1}))).map(({id,rules_locked,...c})=>c)});
  const configure=async(body,rev=config.revision,status=200)=>{const r=await request(`/api/player-admin/season-settings/${seasonId}`,{method:'PUT',token:admin,body,headers:{'If-Match':String(rev)}});const d=expect(r,status,'保存设置');if(status===200)config=d;return d;};
  async function submit(p=players[0],rev=0,key=crypto.randomUUID(),buffer=png,status=201,extra={}){
    const form=new FormData();form.append('season_id',String(extra.seasonId||seasonId));form.append('account_revision',String(extra.accountRevision??p.revision));form.append('academic_image',new Blob([buffer],{type:'image/png'}),'academic.png');
    return expect(await request('/api/player/season-registration/submit',{token:p.token,body:form,headers:{'If-Match':String(rev),'Idempotency-Key':key}}),status,'上传');
  }
  async function review(op,reason='审核测试',rev=registration.revision,status=200){const body={reason};if(op==='approve')body.account_revision=players[0].revision;const d=expect(await request(`/api/player-admin/season-registrations/${registration.id}/${op}`,{token:admin,headers:{'If-Match':String(rev)},body}),status,op);if(status===200)registration=d.registration;return d;}
  await t.test('第二批迁移：0013 升级保留旧表及账号，重复迁移无变化',async()=>{
    const c=await pool.getConnection();try{
      await c.query('DROP TABLE competition_discipline_events');
      const before=(await c.query('SELECT * FROM player_accounts ORDER BY id'))[0];
      await require('./removeEmptyImportSchema.cjs')(c);
      for(const sql of [...migration.tables].reverse())await c.query(`DROP TABLE ${sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)[1]}`);
      await c.query('ALTER TABLE player_notifications DROP FOREIGN KEY fk_player_notification_season');
      for(const [table,col]of migration.columns)await c.query(`ALTER TABLE ${table} DROP COLUMN ${col}`);
      await c.query("DELETE FROM schema_migrations WHERE version>='0014'");
      await runPendingMigrations(c);await runPendingMigrations(c);assert.deepEqual((await c.query('SELECT * FROM player_accounts ORDER BY id'))[0],before);
    }finally{c.release();}
  });
  await t.test('未配置时不能注册；只有管理员配置赛事、规则和多轮修改窗口',async()=>{
    seasonId=expect(await request('/api/season',{token:admin,body:{season_code:'PB2',season_name:'球员学籍集成测试',start_date:'2026-01-01',end_date:'2026-12-31',is_active:true}}),201,'赛季').id;
    for(let i=0;i<3;i++){const body={student_id:`PB2-${i}`,name:`学籍测试${i}`,college:'土木工程学院',password:'Player!Test2026',gender:'male',password_confirm:'Player!Test2026'};expect(await request('/api/player/register',{body}),201,'注册');players.push(expect(await request('/api/player/login',{body:{student_id:body.student_id,password:body.password}}),200,'登录'));}
    assert.equal((await current()).can_submit,false);await submit(players[0],0,crypto.randomUUID(),png,409);
    const url=`/api/player-admin/season-settings/${seasonId}`;
    config=expect(await request(url,{token:admin}),200,'默认设置');assert.equal(config.revision,0);assert.equal(config.competitions.filter(c=>c.is_enabled).length,0);
    expect(await request(url,{token:players[0].token}),403,'球员不能设置');
    const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM player_season_settings WHERE season_id=?',[seasonId]);assert.equal(count.n,0);
    const body=configBody();body.registration_opens_at=time(-3600000);body.registration_closes_at=time(3600000);body.competitions[0].is_enabled=true;body.competitions[0].rules_text='外援与运训按标记人工审核';body.competitions[0].change_windows=[{id:null,opens_at:time(7200000),closes_at:time(10800000)},{id:null,opens_at:time(14400000),closes_at:time(18000000)}];
    await configure(body);assert.equal(config.revision,1);assert.equal(config.competitions[0].change_windows.length,2);assert.equal((await current()).can_submit,true);
    await configure(configBody(),0,409);
    const invalid=configBody();invalid.competitions[1].change_windows=[{...config.competitions[0].change_windows[0]}];await configure(invalid,1,409);
    const check=expect(await request(url,{token:admin}),200,'回滚后设置');assert.equal(check.revision,1);assert.equal(check.competitions[0].change_windows.length,2);
    const remove=configBody();remove.competitions[0].change_windows.pop();await configure(remove);
    const [[cancelled]]=await pool.query('SELECT COUNT(*) AS n FROM roster_change_windows WHERE is_cancelled=1');assert.equal(cancelled.n,1);
    const events=expect(await request(url+'/history',{token:admin}),200,'设置审计');assert.equal(events.length,2);
  });
  await t.test('材料拒绝伪装、超限、多图；并发重试仅保存一个文件及一次提交',async()=>{
    await submit(players[0],0,crypto.randomUUID(),Buffer.from('<html>fake.png</html>'),400);
    await submit(players[0],0,crypto.randomUUID(),Buffer.alloc(images.MAX_BYTES+1),400);
    const multiple=new FormData();multiple.append('season_id',String(seasonId));multiple.append('account_revision',String(players[0].revision));for(let i=0;i<2;i++)multiple.append('academic_image',new Blob([png],{type:'image/png'}),'x.png');
    expect(await request('/api/player/season-registration/submit',{token:players[0].token,body:multiple,headers:{'If-Match':'0','Idempotency-Key':crypto.randomUUID()}}),400,'只允许一张');
    const key=crypto.randomUUID(),results=await Promise.all([submit(players[0],0,key),submit(players[0],0,key)]);assert.deepEqual(results.map(v=>v.replayed).sort(),[false,true]);registration=results[0].registration;
    assert.equal(results[0].files.length,1);assert.equal(results[0].events.length,1);assert.equal(registration.status,'pending');
    await submit(players[0],0,crypto.randomUUID(),png,409);await submit(players[0],1,key,png,409);
    assert.equal((await current()).files.length,1);
  });
  await t.test('学籍截图只有本人和管理员可读，旧公开上传地址不能访问',async()=>{
    const data=await current(),fileId=data.files[0].id,url=`/api/player/season-registration/${registration.id}/files/${fileId}`;
    const self=await request(url,{token:players[0].token});expectStatus(self,200,'本人读截图');assert.equal(self.headers.get('cache-control'),'private, no-store');
    const [[ref]]=await pool.query('SELECT id,token_version FROM referee WHERE is_active=1 AND must_change_password=0 LIMIT 1');
    const refToken=require('jsonwebtoken').sign({id:ref.id,role:'referee',tokenVersion:ref.token_version},process.env.JWT_SECRET);
    expectStatus(await request(url),401,'匿名');expectStatus(await request(url,{token:players[1].token}),403,'其他球员');expectStatus(await request(url,{token:refToken}),403,'裁判');
    expectStatus(await request(`/api/player-admin/season-registrations/${registration.id}/files/${fileId}`,{token:admin}),200,'管理员');
    assert.equal(JSON.stringify(data).includes('file_path'),false);assert.equal(JSON.stringify(data).includes('password_hash'),false);
    const [[file]]=await pool.execute('SELECT file_path FROM player_registration_files WHERE id=?',[fileId]);expectStatus(await request('/uploads/'+file.file_path),404,'禁止静态访问');
  });
  await t.test('资料在待审期间变化须刷新审核；提交和通过时快照分开保留',async()=>{
    const old=players[0].revision;
    const account=expect(await request('/api/player/me',{method:'PUT',token:players[0].token,headers:{'If-Match':String(old)},body:{name:'修改后的球员'}}),200,'修改资料');
    await review('approve','',registration.revision,409);players[0].revision=account.revision;
    const d=await review('approve');assert.equal(d.registration.profile_snapshot.name,'学籍测试0');assert.equal(d.registration.review_profile_snapshot.name,'修改后的球员');
    assert.equal(await service.assertEligible(pool,players[0].id,seasonId),true);
    await submit(players[0],registration.revision,crypto.randomUUID(),png,409);
  });
  await t.test('撤销通过资格后截止外仍能补正，重新审核前不可参赛；提示只属本人',async()=>{
    // 构造升级前遗留的球队，再给测试名单关联永久身份。
    const team=await require('./legacyTeamFixture.cjs').create({team_name:'资格通知测试队',league_type:'足协杯',roster_entries:[{jersey_number:'8',player_name:'修改后的球员'}]});
    await pool.execute('UPDATE team SET manager_player_id=?,captain_player_id=? WHERE id=?',[players[1].id,players[0].id,team.id]);
    await pool.execute('UPDATE team_player SET player_account_id=? WHERE team_id=?',[players[0].id,team.id]);
    const previousGoals=(await pool.query('SELECT * FROM match_goals ORDER BY id'))[0];
    const body=configBody();body.registration_opens_at=time(-7200000);body.registration_closes_at=time(-3600000);await configure(body);
    await review('revoke','',registration.revision,400);await review('revoke','请补充最新材料');assert.equal((await current()).can_submit,true);
    await assert.rejects(service.assertEligible(pool,players[0].id,seasonId),{code:'PLAYER_NOT_ELIGIBLE'});
    const notices=expect(await request('/api/player/notifications',{token:players[0].token}),200,'站内提示');assert.ok(notices.some(n=>n.kind==='revoked'));
    const managerNotices=expect(await request('/api/player/notifications',{token:players[1].token}),200,'负责人提示');assert.equal(managerNotices[0].team_id,team.id);assert.equal(managerNotices[0].kind,'team_qualification_revoked');assert.equal(JSON.stringify(managerNotices).includes('file_path'),false);
    assert.deepEqual((await pool.query('SELECT * FROM match_goals ORDER BY id'))[0],previousGoals);
    expect(await request(`/api/player/notifications/${notices[0].id}/read`,{method:'PUT',token:players[1].token}),404,'他人不可读');expect(await request(`/api/player/notifications/${notices[0].id}/read`,{method:'PUT',token:players[0].token}),200,'标记已读');
    registration=(await submit(players[0],registration.revision)).registration;await review('return','补正截图不清晰');
    registration=(await submit(players[0],registration.revision)).registration;assert.equal((await current()).files.length,3);
    const rev=registration.revision,bodyReview={reason:'并发审核',account_revision:players[0].revision};
    const results=await Promise.all([1,2].map(()=>request(`/api/player-admin/season-registrations/${registration.id}/approve`,{token:admin,headers:{'If-Match':String(rev)},body:bodyReview})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);registration=(await current()).registration;assert.equal(registration.status,'approved');
    const detail=expect(await request(`/api/player-admin/season-registrations/${registration.id}`,{token:admin}),200,'审核历史');assert.equal(detail.events.length,registration.revision);
    await submit(players[1],0,crypto.randomUUID(),png,409);
  });
  await t.test('撤回后正常截止限制仍然有效；提交失败会回滚材料文件和申请',async()=>{
    const body=configBody();body.registration_closes_at=time(3600000);await configure(body);
    const listFiles=async()=>{try{return (await fs.readdir(images.DIRECTORY)).sort();}catch(e){if(e.code==='ENOENT')return [];throw e;}};
    const before=await listFiles();
    await pool.query("CREATE TRIGGER pb2_fail_event BEFORE INSERT ON player_registration_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected transaction failure'");
    try{await submit(players[2],0,crypto.randomUUID(),png,500);}finally{await pool.query('DROP TRIGGER pb2_fail_event');}
    assert.deepEqual(await listFiles(),before);assert.equal((await current(players[2])).registration,null);
    const d=await submit(players[1]);const closed=configBody();closed.registration_closes_at=time(-3600000);await configure(closed);
    const withdrawn=expect(await request('/api/player/season-registration/withdraw',{token:players[1].token,headers:{'If-Match':String(d.revision)},body:{season_id:seasonId}}),200,'截止后撤回');assert.equal(withdrawn.status,'withdrawn');assert.equal(withdrawn.can_submit,false);
    await submit(players[1],withdrawn.revision,crypto.randomUUID(),png,409);
  });
  await t.test('资格校验还检查账号停用和赛季结束，审核列表按赛季状态筛选',async()=>{
    const list=expect(await request(`/api/player-admin/season-registrations?season_id=${seasonId}&status=approved&q=PB2-0&page_size=1`,{token:admin}),200,'筛选');assert.equal(list.items.length,1);assert.equal(list.items[0].player_id,players[0].id);assert.equal(list.pagination.total,1);
    expectStatus(await request('/api/player-admin/season-registrations?page=0',{token:admin}),400,'非法分页');
    await pool.execute('UPDATE player_accounts SET is_active=0 WHERE id=?',[players[0].id]);
    try{await assert.rejects(service.assertEligible(pool,players[0].id,seasonId),{code:'PLAYER_NOT_ELIGIBLE'});}finally{await pool.execute('UPDATE player_accounts SET is_active=1 WHERE id=?',[players[0].id]);}
    await pool.execute('UPDATE player_season_settings SET ended_at=? WHERE season_id=?',[w.chinaSql(),seasonId]);
    try{assert.equal((await current()).window_status,'ended');assert.equal((await current()).can_submit,false);await assert.rejects(service.assertEligible(pool,players[0].id,seasonId),{code:'PLAYER_NOT_ELIGIBLE'});await review('revoke','结束后禁止审核',registration.revision,409);}
    finally{await pool.execute('UPDATE player_season_settings SET ended_at=NULL WHERE season_id=?',[seasonId]);}
  });
  await t.test('换季不继承资格、旧页不得提交或审核，历史截图仍有权限可查',async()=>{
    const id=expect(await request('/api/season',{token:admin,body:{season_code:'PB2-NEXT',season_name:'下一测试赛季',start_date:'2027-01-01',end_date:'2027-06-30',is_active:true}}),201,'新赛季').id;
    assert.equal((await current()).season.id,id);assert.equal((await current()).registration,null);
    await submit(players[2],0,crypto.randomUUID(),png,409);await review('revoke','旧赛季不能审核',registration.revision,409);
    await assert.rejects(service.assertEligible(pool,players[0].id,seasonId),{code:'PLAYER_NOT_ELIGIBLE'});
    const d=expect(await request(`/api/player/season-registration/${registration.id}`,{token:players[0].token}),200,'历史资料');assert.equal(d.files.length,3);
    expectStatus(await request(`/api/player/season-registration/${registration.id}/files/${d.files[2].id}`,{token:players[0].token}),200,'旧材料仍私有可查');
  });
};
