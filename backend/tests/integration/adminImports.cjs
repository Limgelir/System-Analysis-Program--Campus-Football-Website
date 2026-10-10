const assert=require('node:assert/strict'),crypto=require('node:crypto'),XLSX=require('xlsx');
const w=require('../../utils/playerWorkflow');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=','base64');
module.exports=async({t,pool,state,request,expectStatus})=>{
  const login=await request('/api/admin/login',{body:state.admin});expectStatus(login,200,'管理员登录');const admin=login.data.data.token;
  const call=async(path,body,method,expected=200,token=admin,headers={})=>{const r=await request(path,{body,method,token,headers});expectStatus(r,expected,path);return r.data.data;};
  const now=w.chinaSql().slice(0,10),person=(suffix,name)=>({student_id:'IMPORT-'+suffix,name});
  const manager=person('MANAGER','未注册负责人'),captain=person('CAPTAIN','未注册队长'),ordinary=person('MEMBER','未注册队员');
  let season,config,comp,home,away,match,roster,captainAccount,managerAccount;
  const rows=()=>[[captain.student_id,captain.name,'7','是'],[ordinary.student_id,ordinary.name,'9','否']];
  async function preview(name,members=rows(),extra={},expected=200){
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([require('../../utils/rosterExcelParser').HEADERS,...members]),'名单');
    const body=new FormData();for(const [k,v]of Object.entries({season_id:season.id,league_type:comp.league_type,team_name:name,manager_student_id:manager.student_id,manager_name:manager.name,shirt_color:' ',shorts_color:'',socks_color:'',...extra}))body.append(k,String(v));
    body.append('roster_file',new Blob([XLSX.write(book,{type:'buffer',bookType:'xlsx'})]),'import.xlsx');
    return call('/api/team/import-preview',body,'POST',expected);
  }
  const confirm=(p,expected=200,key=crypto.randomUUID())=>call('/api/team/import-confirm',{preview:p.preview,preview_token:p.preview_token},'POST',expected,admin,{'Idempotency-Key':key});
  async function register(p){await call('/api/player/register',{...p,college:'土木工程学院',password:'Import!Test2026',gender:'male',password_confirm:'Import!Test2026'},'POST',201,null);return call('/api/player/login',{student_id:p.student_id,password:'Import!Test2026'},'POST',200,null);}
  async function submit(p){const body=new FormData();body.append('season_id',season.id);body.append('account_revision',p.revision);body.append('academic_image',new Blob([png],{type:'image/png'}),'proof.png');return call('/api/player/season-registration/submit',body,'POST',201,p.token,{'If-Match':'0','Idempotency-Key':crypto.randomUUID()});}
  const approve=(p,reg)=>call(`/api/player-admin/season-registrations/${reg.registration.id}/approve`,{account_revision:p.revision},'POST',200,admin,{'If-Match':String(reg.revision)});
  const summary=()=>call(`/api/competitions/${comp.id}/discipline`);
  await t.test('管理员窗口外导入全未注册名单，颜色可空，账号不被伪造，必填身份和队长仍校验',async()=>{
    season=await call('/api/season',{season_code:'IMPORTS',season_name:'特殊导入回归',start_date:now,end_date:'2099-12-31',is_active:true},'POST',201);
    comp={league_type:'特殊导入赛',is_enabled:false,registration_opens_at:null,registration_closes_at:null,rules_text:'',change_windows:[],yellow_threshold:1,yellow_suspension:2,red_threshold:1,red_suspension:1};
    config=await call('/api/player-admin/season-settings/'+season.id,{registration_opens_at:null,registration_closes_at:null,competitions:[comp]},'PUT',200,admin,{'If-Match':'0'});comp=config.competitions[0];
    await preview('缺负责人姓名',rows(),{manager_name:''},400);
    assert.equal((await preview('缺队员姓名',[[captain.student_id,'','7','是']])).can_confirm,false);
    assert.equal((await preview('无队长',[[captain.student_id,captain.name,'7','否']])).can_confirm,false);
    assert.equal((await preview('重复号码',[[captain.student_id,captain.name,'01','是'],[ordinary.student_id,ordinary.name,'1','否']])).can_confirm,false);
    const [[before]]=await pool.query('SELECT COUNT(*) n FROM player_accounts');
    const p=await preview('特殊导入主队');assert.equal(p.can_confirm,true);assert.equal(p.summary.unlinked,2);assert.equal(p.manager.id,null);assert.deepEqual([p.metadata.shirt_color,p.metadata.shorts_color,p.metadata.socks_color],[null,null,null]);
    const key=crypto.randomUUID();home=await confirm(p,200,key);assert.equal((await confirm(p,200,key)).team_id,home.team_id);
    away=await confirm(await preview('特殊导入客队',[[ordinary.student_id,ordinary.name,'1','是']]));
    assert.equal((await pool.query('SELECT COUNT(*) n FROM player_accounts'))[0][0].n,before.n);
    const detail=await call('/api/player-admin/team-applications/'+home.application_id);assert.equal(detail.members.length,2);assert.equal(detail.manager.name,manager.name);assert.equal(detail.members.filter(m=>m.is_captain).length,1);
    const pub=await call('/api/public/teams/'+home.team_id,undefined,'GET',200,null);assert.equal(pub.players.length,2);assert.equal(pub.team.shirt_color,null);
    assert.ok(!JSON.stringify(pub).includes(captain.student_id));
    await call('/api/team/import-confirm',{preview:p.preview,preview_token:p.preview_token},'POST',401,null,{'Idempotency-Key':crypto.randomUUID()});
  });
  await t.test('未关联人员照常进入裁判员报告、进球和停赛；重复导入同一身份延续累计',async()=>{
    const official=await call('/api/officials/external',{name:'特殊导入测试裁判员'},'POST',201);
    match=await call('/api/schedule',{team_a_id:home.team_id,team_b_id:away.team_id,match_type:comp.league_type,field_order:'I1',match_date:now,match_time:'00:00',main_referee_id:'external:'+official.id},'POST');
    roster=(await call('/api/report/schedule/'+match.id)).match_rosters.find(r=>r.team_id===home.team_id).players[0];
    await call(`/api/report/admin/schedule/${match.id}/sections/main/revise`,{reason:'未关联名单正式报告',data:{home_score:1,away_score:0,goals:[{player_team_id:home.team_id,credited_team_id:home.team_id,team_player_id:roster.id,goal_type:'normal',minute_base:5}],cards:[{team_id:home.team_id,team_player_id:roster.id,card_type:'yellow',minute_base:10}]}},'POST');
    let p=(await summary()).groups.find(g=>g.id===home.team_id).players.find(p=>p.player_name===captain.name);assert.equal(p.remaining,2);assert.match(p.key,/:i/);
    await confirm(await preview('特殊导入主队',rows(),{team_id:home.team_id}));
    const group=(await summary()).groups.find(g=>g.id===home.team_id);assert.equal(group.players.filter(p=>p.player_name===captain.name).length,1);assert.equal(group.players.find(p=>p.player_name===captain.name).remaining,2);
  });
  await t.test('注册与待审时无球队权限；学号姓名相符并通过审核后自动关联，历史报告不改写',async()=>{
    // Open personal qualification only. Team signup and roster windows stay closed.
    const time=n=>w.chinaIso(w.chinaSql(new Date(Date.now()+n)));
    const {id,rules_locked,...competition}=comp;
    config=await call('/api/player-admin/season-settings/'+season.id,{registration_opens_at:time(-3600000),registration_closes_at:time(86400000),competitions:[competition]},'PUT',200,admin,{'If-Match':String(config.revision)});
    captainAccount=await register(captain);managerAccount=await register(manager);
    await call('/api/player/teams/'+home.team_id,undefined,'GET',403,captainAccount.token);
    const registration=await submit(captainAccount);await call('/api/player/teams/'+home.team_id,undefined,'GET',403,captainAccount.token);
    const [history]=await pool.query('SELECT * FROM report_section_history WHERE report_id=(SELECT id FROM match_reports WHERE schedule_id=?) ORDER BY id',[match.id]);
    const [publications]=await pool.query('SELECT * FROM match_publications WHERE report_id=(SELECT id FROM match_reports WHERE schedule_id=?)',[match.id]);
    await approve(captainAccount,registration);
    const detail=await call('/api/player/teams/'+home.team_id,undefined,'GET',200,captainAccount.token);assert.equal(detail.can_manage,true);assert.equal(detail.players.filter(p=>p.is_captain).length,1);
    const p=(await summary()).groups.find(g=>g.id===home.team_id).players.find(p=>p.player_id===captainAccount.id);assert.equal(p.remaining,2);assert.equal(p.yellow,1);assert.match(p.key,/:p/);
    assert.equal((await call('/api/player/team-results/'+home.team_id,undefined,'GET',200,captainAccount.token)).my_goals,1);
    assert.deepEqual((await pool.query('SELECT * FROM report_section_history WHERE report_id=(SELECT id FROM match_reports WHERE schedule_id=?) ORDER BY id',[match.id]))[0],history);
    assert.deepEqual((await pool.query('SELECT * FROM match_publications WHERE report_id=(SELECT id FROM match_reports WHERE schedule_id=?)',[match.id]))[0],publications);
    await approve(managerAccount,await submit(managerAccount));assert.equal((await call('/api/player/teams/'+home.team_id,undefined,'GET',200,managerAccount.token)).can_manage,true);
    await call('/api/player/team-applications',{season_id:season.id,competition_id:comp.id,team_name:'球员不能绕过窗口'},'POST',409,captainAccount.token,{'Idempotency-Key':crypto.randomUUID()});
    await call('/api/team/import-confirm',{},'POST',403,captainAccount.token,{'Idempotency-Key':crypto.randomUUID()});
  });
  await t.test('仅同学号不同姓名不能误关联，审核后匹配身份才关联，迁移重复执行不改旧行',async()=>{
    const mismatch=await register({...ordinary,name:'不同姓名'});await approve(mismatch,await submit(mismatch));
    assert.equal((await pool.query('SELECT player_id FROM imported_player_identities WHERE season_id=? AND student_id=?',[season.id,ordinary.student_id]))[0][0].player_id,null);
    await call('/api/player/teams/'+home.team_id,undefined,'GET',403,mismatch.token);
    const tables=['admin','referee','player_accounts','team','team_player','team_applications','team_application_members','imported_player_identities'];
    const before={};for(const table of tables)before[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0];
    const connection=await pool.getConnection();try{await require('../../../db/migrations/0021_imported_player_identities').up(connection);}finally{connection.release();}
    for(const table of tables)assert.deepEqual((await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0],before[table],table);
    for(const check of require('../../scripts/audit').checks.slice(2,4)){assert.equal((await pool.query(check.sql))[0][0].issue_count,0,check.name);}
  });
  const date=offset=>new Date(Date.parse(now+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
  const rosterDetail=id=>call(`/api/report/admin/schedule/${id}/rosters`);
  const choose=(id,d,team,batch,expected=200,reason='补录历史比赛，核对原始名单后指定')=>call(`/api/report/admin/schedule/${id}/rosters`,{team_id:team,roster_batch_id:batch,reason,review_token:d.review_token},'PUT',expected);
  let backfill,startedBackfill,untouched,future,originalHomeBatch,external;
  async function createBackfill(order,day=-1){return call('/api/schedule',{team_a_id:home.team_id,team_b_id:away.team_id,match_type:comp.league_type,field_order:order,match_date:date(day),match_time:'00:00',main_referee_id:'external:'+external.id},'POST');}
  await t.test('昨天比赛可由管理员明确指定今天上传的名单；不自动改变其他历史比赛和未来比赛',async()=>{
    external=await call('/api/officials/external',{name:'补录名单测试裁判员'},'POST',201);
    backfill=await createBackfill('补录A1');untouched=await createBackfill('补录A2');future=await createBackfill('补录J1',1);
    let d=await rosterDetail(backfill.id);assert.ok(d.items.every(i=>!i.roster_batch_id&&i.can_edit));assert.ok(d.candidates.every(b=>b.effective_from===now));
    originalHomeBatch=d.candidates.find(b=>b.team_id===home.team_id).id;
    await choose(backfill.id,d,home.team_id,away.batch_id,400);
    await choose(backfill.id,d,home.team_id,originalHomeBatch,400,'');
    await call(`/api/report/admin/schedule/${backfill.id}/rosters`,undefined,'GET',403,captainAccount.token);
    await call(`/api/report/admin/schedule/${backfill.id}/rosters`,{team_id:home.team_id,roster_batch_id:originalHomeBatch,reason:'无权限',review_token:d.review_token},'PUT',403,captainAccount.token);
    const changed=await choose(backfill.id,d,home.team_id,originalHomeBatch);assert.equal(changed.items[0].roster_batch_id,originalHomeBatch);
    assert.ok(changed.events.some(e=>e.actor_admin_id&&e.reason==='补录历史比赛，核对原始名单后指定'));
    await choose(backfill.id,d,away.team_id,away.batch_id,409);
    d=await rosterDetail(backfill.id);await choose(backfill.id,d,away.team_id,away.batch_id);
    const report=await call('/api/report/schedule/'+backfill.id);assert.equal(report.match_rosters[0].players.length,2);assert.equal(report.match_rosters[1].players.length,1);
    assert.ok((await rosterDetail(untouched.id)).items.every(i=>i.roster_batch_id===null));
    const f=await rosterDetail(future.id);assert.equal(f.can_edit,false);await choose(future.id,f,home.team_id,originalHomeBatch,409);
  });
  await t.test('报告开始但原名单为空可逐队补齐；拒绝陈旧报告版本，已有名单不可换绑',async()=>{
    startedBackfill=await createBackfill('补录B1');
    await call(`/api/report/admin/schedule/${startedBackfill.id}/main`,{home_score:0,away_score:0,goals:[],cards:[]},'POST');
    let d=await rosterDetail(startedBackfill.id);assert.ok(d.items.every(i=>i.edit_mode==='fill_missing'));
    await call(`/api/report/admin/schedule/${startedBackfill.id}/main`,{home_score:0,away_score:0,goals:[],cards:[]},'POST');
    await choose(startedBackfill.id,d,home.team_id,originalHomeBatch,409);
    d=await rosterDetail(startedBackfill.id);const changed=await choose(startedBackfill.id,d,home.team_id,originalHomeBatch);
    assert.equal(changed.items[0].can_edit,false);assert.equal(changed.items[1].edit_mode,'fill_missing');
    await choose(startedBackfill.id,changed,home.team_id,originalHomeBatch,409);
    const report=await call('/api/report/schedule/'+startedBackfill.id),p=report.match_rosters[0].players[0];
    await call(`/api/report/admin/schedule/${startedBackfill.id}/main`,{home_score:1,away_score:0,goals:[{player_team_id:home.team_id,credited_team_id:home.team_id,team_player_id:p.id,goal_type:'normal',minute_base:12}],cards:[{team_id:home.team_id,team_player_id:p.id,card_type:'yellow',minute_base:20}]},'POST');
    const snapshot=async()=>{const out={};for(const table of ['match_reports','match_goals','match_cards','report_section_history','report_section_states'])out[table]=(await pool.query(`SELECT * FROM ${table} WHERE ${table==='match_reports'?'id':'report_id'}=(SELECT id FROM match_reports WHERE schedule_id=?) ORDER BY ${table==='report_section_states'?'section':'id'}`,[startedBackfill.id]))[0];return out;};
    const before=await snapshot();d=await rosterDetail(startedBackfill.id);await choose(startedBackfill.id,d,away.team_id,away.batch_id);assert.deepEqual(await snapshot(),before,'补齐客队不能改动主队进球、红黄牌、分区修订或历史');
    assert.equal((await rosterDetail(startedBackfill.id)).can_edit,false);
  });
  await t.test('裁判监督已开始且空名单仍可补齐；存在球员引用的异常空名单不能换绑',async()=>{
    const m=await createBackfill('补录C1');
    // Fixtures represent existing persisted report states; changes use the real admin API.
    await pool.execute('UPDATE match_reports SET supervisor_review_started_at=NOW() WHERE schedule_id=?',[m.id]);
    let d=await rosterDetail(m.id);assert.ok(d.items.every(i=>i.edit_mode==='fill_missing'));await choose(m.id,d,home.team_id,originalHomeBatch);
    await pool.execute('UPDATE match_roster_selections SET roster_batch_id=NULL WHERE schedule_id=? AND team_id=?',[startedBackfill.id,home.team_id]);
    try{d=await rosterDetail(startedBackfill.id);assert.equal(d.items[0].can_edit,false);assert.match(d.items[0].edit_block_reason,/进球或红黄牌/);await choose(startedBackfill.id,d,home.team_id,originalHomeBatch,409);}
    finally{await pool.execute('UPDATE match_roster_selections SET roster_batch_id=? WHERE schedule_id=? AND team_id=?',[originalHomeBatch,startedBackfill.id,home.team_id]);}
  });
  await t.test('再次导入名单不改已指定的历史版本；被冻结的缺失名单仍能补齐，选择审计连续',async()=>{
    const reimport=await confirm(await preview('特殊导入主队',rows(),{team_id:home.team_id}));
    assert.notEqual(reimport.batch_id,originalHomeBatch);assert.equal((await rosterDetail(backfill.id)).items[0].roster_batch_id,originalHomeBatch);
    const missing=await rosterDetail(untouched.id);assert.ok(missing.items[0].revision>0);assert.equal(missing.items[0].roster_batch_id,null);
    await choose(untouched.id,missing,home.team_id,reimport.batch_id);
    for(const check of require('../../scripts/audit').checks.filter(c=>/比赛名单/.test(c.name)))assert.equal((await pool.query(check.sql))[0][0].issue_count,0,check.name);
  });
  await t.test('完全新建的历史补录正式提交后计牌，重复导入延续身份，后续实际比赛执行停赛',async()=>{
    const report=await call('/api/report/schedule/'+backfill.id),p=report.match_rosters[0].players.find(p=>p.player_name===ordinary.name);
    const player=async()=> (await summary()).groups.find(g=>g.id===home.team_id).players.find(p=>p.player_name===ordinary.name);
    await call(`/api/report/admin/schedule/${backfill.id}/main`,{home_score:0,away_score:0,goals:[],cards:[{team_id:home.team_id,team_player_id:p.id,card_type:'yellow',minute_base:30}]},'POST');
    assert.equal((await player()).yellow,0,'补录草稿不计入累计');
    await call(`/api/report/admin/schedule/${backfill.id}/main/submit`,{},'POST');
    let total=await player();assert.equal(total.yellow,1);assert.equal(total.remaining,2);assert.match(total.key,/:i/);const key=total.key;
    await confirm(await preview('特殊导入主队',rows(),{team_id:home.team_id}));
    total=await player();assert.equal(total.key,key);assert.equal(total.yellow,1);assert.equal(total.remaining,2);
    assert.ok((await call(`/api/competitions/matches/${future.id}/discipline`)).suspensions.some(p=>p.key===key),'补录处罚出现在后续比赛');
    const next=await createBackfill('补录后实际比赛',0);
    await call(`/api/report/admin/schedule/${next.id}/main`,{home_score:0,away_score:0,goals:[],cards:[]},'POST');
    await call(`/api/report/admin/schedule/${next.id}/main/submit`,{},'POST');
    assert.equal((await player()).remaining,1,'后续实际完成并正式提交报告后扣一场');
    assert.equal((await player()).yellow,1,'尚未服满前保留触发累计');
    const opponent=(await summary()).groups.find(g=>g.id===away.team_id).players.find(p=>p.player_name===ordinary.name);assert.equal(opponent.yellow,0,'同一人员在另一球队分别累计');
  });
};
