const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
module.exports=async({t,pool,state,request,expectStatus})=>{
  const admin=state.tokens.admin;
  const call=async(path,body,method='GET',token=admin,status=200,extra={})=>{const r=await request(path,{body,method,token,...extra});expectStatus(r,status,path);return r.data?.data;};
  const [[clock]]=await pool.query("SELECT DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d') today");
  const date=offset=>new Date(Date.parse(clock.today+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
  let season,base,match,other,legacy,refs=[];
  const signup=(ref,id,body,status=200)=>call('/api/match-signups/'+id,body,'PUT',ref.token,status);
  const detail=id=>call('/api/schedule/'+id);
  const my=async(ref,view='week')=>call('/api/match-signups?view='+view+'&page_size=100',undefined,'GET',ref.token);
  const record=async(ref,id)=>(await my(ref,'mine')).items.find(r=>r.id===id)||(await my(ref)).items.find(r=>r.id===id);
  const save=async(ref,id,intentions=['main'],status=200)=>{const row=await record(ref,id);return signup(ref,id,{action:'save',intentions,revision:row?.signup_revision||0,schedule_revision:(await detail(id)).schedule_revision},status);};
  await t.test('0019重复迁移保留既有比赛、账号、报告与历史',async()=>{
    const c=await pool.getConnection();try{
      const capture=async()=>{const out={};for(const table of ['referee','match_schedules','match_reports','report_section_history'])out[table]=(await c.query('SELECT * FROM '+table+' ORDER BY id'))[0];return out;};
      const before=await capture();await require('../../../db/migrations/0019_referee_match_signups').up(c);assert.deepEqual(await capture(),before);
    }finally{c.release();}
  });
  await t.test('场地必填和其它详情受服务端校验，旧比赛待定与新场地同步公开接口',async()=>{
    season=await call('/api/season',{season_code:'SIGNUP-'+Date.now(),season_name:'裁判报名验收',start_date:date(-20),end_date:date(300),is_active:true},'POST',admin,201);
    await pool.execute("INSERT INTO season_competitions(season_id,league_type) VALUES (?,'足协杯')",[season.id]);
    const [a]=await pool.execute("INSERT INTO team(season_id,team_name,league_type) VALUES (?,'报名主队','足协杯')",[season.id]);
    const [b]=await pool.execute("INSERT INTO team(season_id,team_name,league_type) VALUES (?,'报名客队','足协杯')",[season.id]);
    base={match_type:'足协杯',team_a_id:a.insertId,team_b_id:b.insertId,match_date:date(1),match_time:'17:35',field_order:1,venue:'樱花人草'};
    for(const data of [{venue:undefined},{venue:null},{venue:'未知'},{venue:'其它'},{venue:'其它',venue_detail:'字'.repeat(121)}])await call('/api/schedule',{...base,...data},'POST',admin,400,{autoVenue:false});
    match=await call('/api/schedule',base,'POST');other=await call('/api/schedule',{...base,field_order:2,venue:'其它',venue_detail:' 体育馆东侧 '},'POST');
    const publicData=await call('/api/public/teams/'+a.insertId,undefined,'GET',null);assert.equal(publicData.matches.find(m=>m.id===other.id).venue_detail,'体育馆东侧');
    legacy=await call('/api/schedule',{...base,field_order:3},'POST');await pool.execute('UPDATE match_schedules SET venue=NULL,match_time=NULL WHERE id=?',[legacy.id]);
    const unchanged=await call('/api/schedule/'+legacy.id,{...base,field_order:3,venue:null,match_time:null},'PUT');assert.equal(unchanged.venue,null);
    await call('/api/schedule/'+other.id,{...base,field_order:2,venue:null},'PUT',admin,400);
  });
  await t.test('准备真实注册审核状态，未来7天过滤且报名读取不泄露私有报告或人员资料',async()=>{
    const [[template]]=await pool.query('SELECT password_hash FROM referee LIMIT 1');
    for(let i=0;i<26;i++){
      const [r]=await pool.execute("INSERT INTO referee(student_id,name,grade,target_level,level_promoted_at,password_hash,is_active,must_change_password,token_version,match_types) VALUES (?,?,'一级','预备国家级','2025-01-01',?,1,0,0,'足协杯')",['SIGNUP-R-'+i,(i<2?'Z':'A')+'报名裁判'+String(i).padStart(2,'0'),template.password_hash]);
      const ref={id:r.insertId,token:jwt.sign({id:r.insertId,role:'referee',tokenVersion:0},process.env.JWT_SECRET)};refs.push(ref);
      if(i===25)continue;
      const reg=await call('/api/season-registration/current/submit',{name:(i<2?'Z':'A')+'报名裁判'+String(i).padStart(2,'0'),height_cm:175,weight_kg:65,college:'土木工程学院',grade:'一级',match_types:['足协杯']},'POST',ref.token,201);
      ref.registrationId=reg.id;if(i!==24)await call('/api/season-registration/admin/'+reg.id+'/approve',{reason:'报名验收'},'POST');
    }
    for(const [i,offset]of [0,6,7,-1].entries())await call('/api/schedule',{...base,field_order:10+i,match_date:date(offset),match_time:'00:00'},'POST');
    const data=await my(refs[0]);assert.ok(data.items.some(r=>r.match_date===date(6)));assert.ok(!data.items.some(r=>[date(7),date(-1)].includes(r.match_date)));
    assert.ok(data.items.find(r=>r.id===legacy.id).reason.includes('时间待定'));
    for(const item of data.items)for(const forbidden of ['officials','report','report_id','student_id','password_hash','referee_id','home_score'])assert.equal(Object.hasOwn(item,forbidden),false,forbidden);
    await call('/api/schedule/'+match.id,undefined,'GET',refs[0].token,403);
    await call('/api/match-signups',undefined,'GET',admin,403);
    await call('/api/match-signups/admin/'+match.id,undefined,'GET',refs[0].token,403);
    await call('/api/match-signups',undefined,'GET',null,401);
  });
  await t.test('未审核/未注册/停用、已开球与待定不能报名；意向和操作者字段严格校验',async()=>{
    for(const ref of refs.slice(24))await save(ref,match.id,['main'],400);
    await save(refs[0],legacy.id,['main'],400);
    const past=(await my(refs[0])).items.find(r=>r.match_date===date(0));await save(refs[0],past.id,['main'],400);
    for(const intentions of [[],['assistant1'],['main','main'],['invalid']])await save(refs[0],match.id,intentions,400);
    await signup(refs[0],match.id,{action:'save',intentions:['main'],revision:0,schedule_revision:match.schedule_revision,referee_id:refs[1].id},400);
    await pool.execute('UPDATE referee SET is_active=0 WHERE id=?',[refs[25].id]);await my(refs[25]).then(()=>assert.fail('停用不得访问'),e=>assert.ok(e.message.includes('401')));
    await pool.execute('UPDATE referee SET is_active=1 WHERE id=?',[refs[25].id]);
  });
  await t.test('多意向报名、重复保存、撤回重报与并发版本仅成功一次，历史连续',async()=>{
    let row=await save(refs[0],match.id,['assistant','main']);assert.deepEqual(row.intentions,['main','assistant']);assert.equal(row.signup_revision,1);
    row=await save(refs[0],match.id,['main','assistant']);assert.equal(row.signup_revision,1);
    const body={action:'save',intentions:['fourth'],revision:1,schedule_revision:row.schedule_revision};
    const results=await Promise.all([body,{...body,intentions:['supervisor']}].map(body=>request('/api/match-signups/'+match.id,{token:refs[0].token,method:'PUT',body})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    row=await record(refs[0],match.id);await signup(refs[0],match.id,{action:'withdraw',revision:row.signup_revision,schedule_revision:row.schedule_revision});
    row=await save(refs[0],match.id,['main','assistant']);assert.equal(row.signup_revision,4);
    const history=await call('/api/match-signups/admin/'+match.id+'/'+row.signup_id+'/history');assert.deepEqual(history.map(h=>h.revision),[4,3,2,1]);assert.equal(history[0].operation,'reapply');
    assert.equal((await detail(match.id)).main_referee_id,null);
  });
  await t.test('后端跨页报名优先、意向匹配优先、两个助理裁判员统一匹配；另一场无全局优先',async()=>{
    await save(refs[1],match.id,['supervisor']);
    for(const role of ['main','assistant1','assistant2']){
      const first=await call(`/api/officials/candidates?season_id=${season.id}&schedule_id=${match.id}&role=${role}&page_size=1`);assert.equal(first.items[0].referee_id,refs[0].id);assert.equal(first.items[0].signup_rank,0);
      const second=await call(`/api/officials/candidates?season_id=${season.id}&schedule_id=${match.id}&role=${role}&page_size=1&page=2`);assert.equal(second.items[0].referee_id,refs[1].id);assert.equal(second.items[0].signup_rank,1);
      const third=await call(`/api/officials/candidates?season_id=${season.id}&schedule_id=${match.id}&role=${role}&page_size=1&page=3`);assert.equal(third.items[0].signed_up,0);
    }
    const otherList=await call(`/api/officials/candidates?season_id=${season.id}&schedule_id=${other.id}&role=main&page_size=1`);assert.notEqual(otherList.items[0].referee_id,refs[0].id);
    const sup=await call(`/api/officials/candidates?season_id=${season.id}&schedule_id=${match.id}&role=supervisor`);assert.equal(sup.items[0].referee_id,refs[1].id);assert.ok(sup.items.every(r=>['system','external'].includes(r.source_type)));
    const query=await call(`/api/officials/candidates?season_id=${season.id}&schedule_id=${match.id}&role=main&query=SIGNUP-R-0`);assert.equal(query.items[0].referee_id,refs[0].id);
    await call(`/api/officials/candidates?season_id=${season.id-1}&schedule_id=${match.id}&role=main`,undefined,'GET',admin,400);
    await call(`/api/officials/candidates?season_id=${season.id+999}&schedule_id=${match.id}&role=main`,undefined,'GET',admin,404);
    assert.equal((await detail(match.id)).signup_count,2);
  });
  await t.test('报名失效实时移出优先候选，正式选派仍能选择未报名者，旧管理员页面不能覆盖新选派',async()=>{
    await call('/api/season-registration/admin/'+refs[1].registrationId+'/return',{reason:'资格核对'},'POST');
    assert.equal((await detail(match.id)).signup_count,1);
    const list=await call(`/api/officials/candidates?season_id=${season.id}&schedule_id=${match.id}&role=supervisor`);assert.ok(!list.items.some(r=>r.referee_id===refs[1].id));
    const body={main_referee_id:refs[2].id,schedule_revision:(await detail(match.id)).schedule_revision};
    const results=await Promise.all([body,{...body,main_referee_id:refs[3].id}].map(body=>request('/api/schedule/'+match.id+'/assign-referees',{token:admin,method:'PUT',body})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    let m=await detail(match.id);assert.ok([refs[2].id,refs[3].id].includes(m.main_referee_id));
    await call('/api/schedule/'+match.id+'/assign-referees',{main_referee_id:refs[0].id},'PUT');
    const row=await record(refs[0],match.id);assert.equal(row.assigned_role,'main');
    await signup(refs[0],match.id,{action:'withdraw',revision:row.signup_revision,schedule_revision:row.schedule_revision});assert.equal((await detail(match.id)).main_referee_id,refs[0].id);
    await save(refs[0],match.id,['main']);
  });
  await t.test('改期保留记录并提示，窗口外已有报名可改/撤回，旧请求被拒绝；报名历史不阻止开球前删除',async()=>{
    const old=await record(refs[0],match.id);const prior=await detail(match.id);
    await call('/api/schedule/'+match.id,{...base,main_referee_id:refs[0].id,match_date:date(10),schedule_revision:prior.schedule_revision},'PUT');
    const shifted=await record(refs[0],match.id);assert.equal(shifted.time_changed,true);assert.equal(shifted.can_change,true);assert.equal(shifted.can_apply,false);
    await signup(refs[0],match.id,{action:'save',intentions:['main'],revision:old.signup_revision,schedule_revision:old.schedule_revision},409);
    let row=await save(refs[0],match.id,['assistant']);assert.equal(row.time_changed,false);
    await signup(refs[0],match.id,{action:'withdraw',revision:row.signup_revision,schedule_revision:row.schedule_revision});
    await save(refs[0],match.id,['main'],400);
    assert.equal((await detail(match.id)).delete_state.can_delete,true);
    const adminRows=await call('/api/match-signups/admin/'+match.id);assert.equal(adminRows.items.length,2);assert.ok(adminRows.items.some(r=>!r.eligible));
  });
  await t.test('报名失败事务完整回滚，追加历史审计识别状态或意向损坏',async()=>{
    await pool.query("CREATE TRIGGER signup_test_fail BEFORE INSERT ON referee_match_signup_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated signup failure'");
    try {await save(refs[3],other.id,['main'],500);}finally{await pool.query('DROP TRIGGER signup_test_fail');}
    const [[count]]=await pool.execute('SELECT COUNT(*) n FROM referee_match_signups WHERE referee_id=? AND schedule_id=?',[refs[3].id,other.id]);assert.equal(count.n,0);
    const checks=require('../../scripts/audit').checks.filter(c=>c.name.startsWith('裁判报名'));
    for(const check of checks){const [[r]]=await pool.query(check.sql);assert.equal(r.issue_count,0,check.name);}
    const c=await pool.getConnection();try{await c.beginTransaction();await c.execute("UPDATE referee_match_signups SET intentions=JSON_ARRAY('main','main') WHERE schedule_id=? AND referee_id=?",[match.id,refs[0].id]);for(const check of checks){const [[r]]=await c.query(check.sql);assert.ok(r.issue_count>0,check.name);}}finally{await c.rollback();c.release();}
  });
  await t.test('开球前报告开始不关闭报名且仍可调整选派；结束/停用赛季和跨赛季均禁止报名',async()=>{
    await pool.execute('UPDATE match_reports SET main_report_started_at=NOW() WHERE schedule_id=?',[other.id]);
    const row=await save(refs[0],other.id,['fourth']);assert.equal(row.signup_status,'active');
    await call('/api/schedule/'+other.id+'/assign-referees',{main_referee_id:refs[0].id},'PUT',admin);
    await call('/api/schedule/'+other.id,{...base,field_order:2,venue:'铁笼'},'PUT',admin,400);
    await pool.execute('INSERT INTO player_season_settings(season_id,ended_at) VALUES (?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE ended_at=UTC_TIMESTAMP()',[season.id]);
    await save(refs[0],other.id,['main'],400);
    await pool.execute('UPDATE player_season_settings SET ended_at=NULL WHERE season_id=?',[season.id]);
    await pool.execute('UPDATE seasons SET is_active=0 WHERE id=?',[season.id]);await save(refs[0],other.id,['main'],400);
    assert.equal((await my(refs[0])).items.length,0);assert.ok((await my(refs[0],'mine')).items.length>=2);
  });
  await t.test('未开球比赛可连同报名历史删除，即使赛季已经停用',async()=>{
    await call('/api/schedule/'+match.id,undefined,'DELETE');
    const [[left]]=await pool.execute('SELECT COUNT(*) n FROM referee_match_signups WHERE schedule_id=?',[match.id]);assert.equal(left.n,0);
  });
  await require('./assignmentBoard.cjs')({t,pool,request,expectStatus,admin,season,base,refs,date});
  await require('./futsal.cjs')({t,pool,request,expectStatus,admin,season,base,refs,date});
};
