const assert=require('node:assert/strict');
const bcrypt=require('bcryptjs');
const {PRESETS}=require('../../utils/competitionRules');
module.exports=async({t,pool,state,request,expectStatus})=>{
  const login=await request('/api/admin/login',{body:state.admin});expectStatus(login,200,'纪律测试管理员登录');const admin=login.data.data.token;
  const call=async(path,body,method,expected=200,token=admin,headers={})=>{const result=await request(path,{token,body,method,headers});expectStatus(result,expected,path);return result.data.data;};
  const day=n=>new Date(Date.now()+n*86400000+8*3600000).toISOString().slice(0,10);
  let season,config,comp,external,home,away,roster,playerId,playerToken;
  const form=()=>({registration_opens_at:null,registration_closes_at:null,competitions:config.competitions.map(({id,rules_locked,...c})=>c)});
  const rule={yellow_threshold:3,yellow_suspension:2,red_threshold:1,red_suspension:1};
  const entry=name=>({league_type:name,is_enabled:false,registration_opens_at:null,registration_closes_at:null,rules_text:'隔离测试',change_windows:[],...rule});
  const summary=()=>call(`/api/competitions/${comp.id}/discipline`);
  const playerOf=d=>d.groups.find(g=>g.id===home.id).players.find(p=>p.player_id===playerId);
  const match=(order,offset=-10,extra={})=>call('/api/schedule',{match_type:comp.league_type,team_a_id:home.id,team_b_id:away.id,match_date:day(offset),match_time:'00:00',venue:'樱花人草',field_order:order,main_referee_id:`external:${external.id}`,...extra},'POST');
  const card=type=>({team_id:home.id,team_player_id:roster.id,card_type:type,minute_base:10});
  const report=(id,cards)=>call(`/api/report/admin/schedule/${id}/sections/main/revise`,{reason:'隔离测试正式判罚',data:{home_score:0,away_score:0,goals:[],cards}},'POST');
  await t.test('旧版三个空赛事不算已添加：空设置可保存，只显示后来添加的赛事并保留历史数据',async()=>{
    const s=await call('/api/season',{season_code:'OLD-EMPTY',season_name:'旧版空赛事回归',start_date:day(-90),end_date:day(90),is_active:true},'POST',201);
    for(const name of ['大联赛','足协杯','新生杯'])await pool.execute('INSERT INTO season_competitions(season_id,league_type,revision) VALUES (?,?,5)',[s.id,name]);
    const [placeholders]=await pool.execute('SELECT * FROM season_competitions WHERE season_id=? ORDER BY id',[s.id]);
    const endpoint='/api/player-admin/season-settings/'+s.id;
    let settings=await call(endpoint);assert.deepEqual(settings.competitions,[]);
    for(const prefix of ['/api/competitions','/api/public/competitions'])assert.deepEqual((await call(prefix+'?season_id='+s.id,undefined,'GET',200,prefix.includes('/public/')?null:admin)).competitions,[]);
    await call('/api/competitions/'+placeholders[0].id+'/discipline',undefined,'GET',404);
    await assert.rejects(require('../../services/competitionService').requireCompetition(pool,s.id,'大联赛'),/先在赛季管理中添加/);
    settings=await call(endpoint,{registration_opens_at:null,registration_closes_at:null,competitions:[]},'PUT',200,admin,{'If-Match':String(settings.revision)});
    assert.deepEqual(settings.competitions,[]);
    assert.deepEqual((await pool.execute('SELECT * FROM season_competitions WHERE season_id=? ORDER BY id',[s.id]))[0],placeholders);
    const body={registration_opens_at:null,registration_closes_at:null,competitions:[{...entry('四平足协杯'),is_enabled:true}]};
    const bad=structuredClone(body);delete bad.competitions[0].yellow_threshold;
    await call(endpoint,bad,'PUT',400,admin,{'If-Match':String(settings.revision)});
    settings=await call(endpoint,body,'PUT',200,admin,{'If-Match':String(settings.revision)});
    assert.deepEqual(settings.competitions.map(c=>c.league_type),['四平足协杯']);
    assert.deepEqual((await require('../../services/playerTeamService').context()).competitions.map(c=>c.league_type),['四平足协杯']);
    for(const prefix of ['/api/competitions','/api/public/competitions'])assert.deepEqual((await call(prefix+'?season_id='+s.id,undefined,'GET',200,prefix.includes('/public/')?null:admin)).competitions.map(c=>c.league_type),['四平足协杯']);
    // Adding a former placeholder reuses its ID; disabling a configured event
    // only closes registration, so the event remains queryable as added history.
    body.competitions.push(entry('新生杯'),entry('自定义校区赛'));
    settings=await call(endpoint,body,'PUT',200,admin,{'If-Match':String(settings.revision)});
    assert.equal(settings.competitions.find(c=>c.league_type==='新生杯').id,placeholders.find(c=>c.league_type==='新生杯').id);
    assert.deepEqual(new Set(settings.competitions.map(c=>c.league_type)),new Set(['四平足协杯','新生杯','自定义校区赛']));
    // Legacy competitions with real teams must remain available even when all
    // new rule fields are null and registration was never enabled.
    await pool.execute("INSERT INTO team(season_id,team_name,league_type) VALUES (?,'历史足协球队','足协杯')",[s.id]);
    const names=(await call('/api/public/competitions?season_id='+s.id,undefined,'GET',200,null)).competitions.map(c=>c.league_type);
    assert.ok(names.includes('足协杯'));assert.ok(!names.includes('大联赛'));
    assert.equal((await require('../../services/competitionService').requireCompetition(pool,s.id,'足协杯')).league_type,'足协杯');
  });
  await t.test('新赛季无默认赛事；预设和自定义赛事显式添加，规则必填且防并发覆盖',async()=>{
    season=await call('/api/season',{season_code:'DISCIPLINE',season_name:'纪律规则验收',start_date:day(-90),end_date:day(90),is_active:true},'POST',201);
    config=await call(`/api/player-admin/season-settings/${season.id}`);assert.deepEqual(config.competitions,[]);
    assert.deepEqual((await call('/api/competitions?season_id='+season.id)).competitions,[]);
    const body={...form(),competitions:[...PRESETS,'研究生邀请赛'].map(entry)};
    const bad=structuredClone(body);delete bad.competitions[0].red_suspension;
    await call(`/api/player-admin/season-settings/${season.id}`,bad,'PUT',400,admin,{'If-Match':'0'});
    config=await call(`/api/player-admin/season-settings/${season.id}`,body,'PUT',200,admin,{'If-Match':'0'});
    await call(`/api/player-admin/season-settings/${season.id}`,body,'PUT',409,admin,{'If-Match':'0'});
    const duplicate={...form(),competitions:[...form().competitions,entry('研究生邀请赛')]};await call(`/api/player-admin/season-settings/${season.id}`,duplicate,'PUT',400,admin,{'If-Match':String(config.revision)});
    comp=config.competitions.find(c=>c.league_type==='研究生邀请赛');
    const fixture=require('./legacyTeamFixture.cjs');home=await fixture.create({team_name:'纪律主队',league_type:comp.league_type,roster_entries:[{jersey_number:'7',player_name:'纪律球员'}]});away=await fixture.create({team_name:'纪律客队',league_type:comp.league_type,roster_entries:[{jersey_number:'8',player_name:'对手球员'}]});
    const password='Discipline!2026';const [p]=await pool.execute('INSERT INTO player_accounts(student_id,name,college,password_hash) VALUES (?,?,?,?)',['DISCIPLINE-PLAYER','纪律球员','土木工程学院',await bcrypt.hash(password,4)]);playerId=p.insertId;
    await pool.execute('UPDATE team_player SET player_account_id=? WHERE team_id=?',[playerId,home.id]);[[roster]]=await pool.execute('SELECT * FROM team_player WHERE team_id=?',[home.id]);
    playerToken=(await call('/api/player/login',{student_id:'DISCIPLINE-PLAYER',password},'POST')).token;
    external=await call('/api/officials/external',{name:'纪律验收外部裁判员',note:'测试'},'POST',201);
  });
  await t.test('任意赛事支持字符串场序、精确唯一、自然排序及并发防重',async()=>{
    for(const value of ['A1','a1','01','1','A10','A2','决赛'])assert.equal((await match(value,20)).field_order,value);
    const result=await request('/api/schedule',{token:admin,body:{match_type:comp.league_type,team_a_id:home.id,team_b_id:away.id,match_date:day(20),match_time:'00:00',field_order:' A1 '}});expectStatus(result,400,'去空白后重复场序');assert.equal(result.data.code,'FIELD_ORDER_CONFLICT');
    const body={match_type:comp.league_type,team_a_id:home.id,team_b_id:away.id,match_date:day(20),match_time:'00:00',field_order:'并发1'};
    const requests=await Promise.all([request('/api/schedule',{token:admin,body}),request('/api/schedule',{token:admin,body})]);assert.deepEqual(requests.map(r=>r.status).sort(),[200,400]);
    const list=await call('/api/schedule?season_id='+season.id);const names=list.map(m=>m.field_order);assert.ok(names.indexOf('A2')<names.indexOf('A10'));
    const pub=await call(`/api/public/teams?season_id=${season.id}&league_type=${encodeURIComponent(comp.league_type)}`,undefined,'GET',200,null);assert.equal(pub.length,2);
    await call(`/api/competitions/${comp.id}/discipline`,undefined,'GET',403,playerToken);
  });
  let first,second,third,serve1,serve2;
  await t.test('只有正式报告计牌；重复修订不重复加牌；达到黄牌阈值后两端显示预计停赛',async()=>{
    first=await match('Y1',-20);second=await match('Y2',-19);third=await match('Y3',-18);
    await call(`/api/report/admin/schedule/${first.id}/main`,{home_score:0,away_score:0,cards:[card('yellow')]},'POST');assert.equal(playerOf(await summary()).yellow,0);
    await Promise.all([report(first.id,[card('yellow')]),report(second.id,[card('yellow')])]);await report(first.id,[card('yellow')]);assert.equal(playerOf(await summary()).yellow,2);
    await report(third.id,[card('yellow')]);let p=playerOf(await summary());assert.equal(p.yellow,3);assert.equal(p.remaining,2);
    const upcoming=await call(`/api/player/team-results/${home.id}`,undefined,'GET',200,playerToken);assert.equal(upcoming.matches.filter(m=>m.discipline.suspensions.some(p=>p.player_name==='纪律球员')).length,2);
    const future=upcoming.matches.find(m=>m.discipline.suspensions.length);const preview=await call(`/api/competitions/matches/${future.id}/discipline`);assert.equal(preview.suspensions[0].player_name,'纪律球员');
    const locked=await request('/api/schedule/'+third.id,{token:admin,method:'PUT',body:{match_type:comp.league_type,team_a_id:home.id,team_b_id:away.id,match_date:day(-18),match_time:'00:00',venue:'樱花人草',field_order:'Z9'}});expectStatus(locked,400,'开始报告后文本场序锁定');
    config=await call(`/api/player-admin/season-settings/${season.id}`);const changed=form();changed.competitions.find(c=>c.league_type===comp.league_type).yellow_threshold=4;await call(`/api/player-admin/season-settings/${season.id}`,changed,'PUT',409,admin,{'If-Match':String(config.revision)});
  });
  await t.test('正式完成下一场后扣一次，重提不重复扣；服满只清触发牌种',async()=>{
    serve1=await match('S1',-17);serve2=await match('S2',-16);
    await report(serve1.id,[]);await report(serve1.id,[]);assert.equal(playerOf(await summary()).remaining,1);
    await report(serve2.id,[]);const p=playerOf(await summary());assert.equal(p.remaining,0);assert.equal(p.yellow,0);assert.equal(p.total_yellow,3);
    const r1=await match('R1',-15);await report(r1.id,[card('yellow')]);const r2=await match('R2',-14);await report(r2.id,[card('yellow'),card('second_yellow_red')]);
    assert.equal(playerOf(await summary()).yellow,1);assert.equal(playerOf(await summary()).red,1);const r3=await match('R3',-13);await report(r3.id,[]);const after=playerOf(await summary());assert.equal(after.yellow,1);assert.equal(after.red,0);assert.equal(after.remaining,0);
  });
  await t.test('同场黄红同时触发取较长场数；管理员纠正有版本校验和历史',async()=>{
    const y=await match('M1',-12);await report(y.id,[card('yellow')]);const both=await match('M2',-11);await report(both.id,[card('yellow'),card('red')]);
    let data=await summary();const p=playerOf(data);assert.equal(p.remaining,2);assert.equal(p.trigger_yellow,true);assert.equal(p.trigger_red,true);
    await call(`/api/competitions/${comp.id}/discipline/adjust`,{key:p.key,remaining:0,reason:'核对已经执行'},'POST',200,admin,{'If-Match':String(data.revision)});
    await call(`/api/competitions/${comp.id}/discipline/adjust`,{key:p.key,remaining:1,reason:'过期操作'},'POST',409,admin,{'If-Match':String(data.revision)});
    data=await summary();assert.equal(playerOf(data).yellow,0);assert.equal(playerOf(data).red,0);assert.equal(data.operations.at(-1).operation,'adjust');
  });
  await t.test('赛事清零解除全部停赛、保留历史；旧比赛修订和补报不复活处罚',async()=>{
    const r=await match('CLEAR',-10);await report(r.id,[card('red')]);const delayed=await match('LATE',-9);let data=await summary();assert.equal(playerOf(data).remaining,1);
    await call(`/api/competitions/${comp.id}/discipline/reset`,{reason:'小组赛结束',confirm_name:'错误赛事'},'POST',400,admin,{'If-Match':String(data.revision)});
    await call(`/api/competitions/${comp.id}/discipline/reset`,{reason:'小组赛结束',confirm_name:comp.league_type},'POST',200,admin,{'If-Match':String(data.revision)});
    await report(r.id,[card('yellow'),card('red')]);await report(delayed.id,[card('red')]);data=await summary();assert.equal(playerOf(data).remaining,0);assert.equal(playerOf(data).yellow,0);assert.equal(playerOf(data).red,0);assert.ok(playerOf(data).total_red>=3);assert.equal(data.operations.at(-1).operation,'reset');
  });
};
