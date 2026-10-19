const assert = require('node:assert/strict');
const XLSX = require('xlsx');
module.exports = async ({ t, pool, state, request, expectStatus }) => {
  const admin = state.tokens.admin;
  const call = async (url, body, method = body === undefined ? 'GET' : 'POST', status = 200, token = admin) => {
    const r = await request('/api' + url, { body, method, token }); expectStatus(r, status, url); return r.data?.data;
  };
  const [[clock]] = await pool.query("SELECT DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d') today");
  const day = offset => new Date(Date.parse(clock.today + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0,10);
  const season = await call('/season', { season_code: 'REP-'+Date.now(), season_name: '比赛时间替换验收', start_date: day(-30), end_date: day(365), is_active: true }, 'POST', 201);
  const league = '赛程替换赛';
  await pool.execute('INSERT INTO season_competitions(season_id,league_type) VALUES (?,?)',[season.id,league]);
  const teams = [];
  for(const name of ['主队','客队','第三队']) teams.push((await pool.execute('INSERT INTO team(season_id,league_type,team_name) VALUES (?,?,?)',[season.id,league,name]))[0].insertId);
  const base = {match_type:league,team_a_id:teams[0],team_b_id:teams[1],match_date:day(1),match_time:'15:00-16:00',venue:'樱花人草',field_order:'R1',futsal:false,fourth_required:true,supervisor_required:false};
  const preview = async rows => {
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([require('../../utils/scheduleImportParser').HEADERS,...rows]),'赛程');
    const form=new FormData();form.append('file',new Blob([XLSX.write(wb,{type:'buffer',bookType:'xlsx'})]),'schedule.xlsx');
    for(const [key,value] of Object.entries({season_id:season.id,match_type:league,futsal:true,supervisor_required:true}))form.append(key,String(value));
    return call('/schedule/import-preview',form);
  };
  const row = (order,time='16:00-17:00',date=day(2)) => [order,date,time,'主队','第三队','嘉定人草',''];
  const confirm = (p,status=200,ids=p.rows.filter(r=>r.replacement).map(r=>r.replacement.id)) => call('/schedule/import-confirm',{preview:p.preview,preview_token:p.preview_token,confirm_replacements:ids},'POST',status);
  const detail = id => call('/schedule/'+id);
  let match, ref, refToken;
  await t.test('比赛时间段读写、编辑移除结束时间、公开展示及0035重复迁移',async()=>{
    match=await call('/schedule',base);assert.equal(match.match_time,'15:00');assert.equal(match.match_end_time,'16:00');assert.equal(match.match.match_end_time,'16:00');assert.equal(match.template_prefill.match_end_time,'16:00');
    const publicTeam=await call('/public/teams/'+teams[0],undefined,'GET',200,null);assert.equal(publicTeam.matches.find(r=>r.id===match.id).match_end_time,'16:00');
    const omitted={...base,schedule_revision:match.schedule_revision};delete omitted.match_time;
    match=await call('/schedule/'+match.id,omitted,'PUT');assert.equal(match.match_end_time,'16:00');
    match=await call('/schedule/'+match.id,{...base,match_time:'15:00',schedule_revision:match.schedule_revision},'PUT');assert.equal(match.match_end_time,null);
    match=await call('/schedule/'+match.id,{...base,schedule_revision:match.schedule_revision},'PUT');
    const [before]=await pool.query('SELECT * FROM match_schedules ORDER BY id');
    const c=await pool.getConnection();try{await require('../../../db/migrations/0035_schedule_match_end_time').up(c);}finally{c.release();}
    assert.deepEqual((await pool.query('SELECT * FROM match_schedules ORDER BY id'))[0],before);
    for(const end of ['14:00:00','15:00:00','24:00:00','16:00:01'])await assert.rejects(pool.execute('UPDATE match_schedules SET match_end_time=? WHERE id=?',[end,match.id]));
  });
  await t.test('真实报名及选派建立后，单场替换需确认且保留全部关联记录',async()=>{
    ref=(await pool.execute("INSERT INTO referee(student_id,name,grade,target_level,level_promoted_at,password_hash,is_active,must_change_password,token_version,match_types) VALUES ('REPLACE-REF','替换裁判','一级','预备国家级','2025-01-01','unused',1,0,0,?)",[league]))[0].insertId;
    refToken=require('jsonwebtoken').sign({id:ref,role:'referee',tokenVersion:0},process.env.JWT_SECRET);
    const reg=await call('/season-registration/current/submit',{name:'替换裁判',height_cm:175,weight_kg:65,college:'土木工程学院',grade:'一级',match_types:['足协杯']},'POST',201,refToken);
    await call('/season-registration/admin/'+reg.id+'/approve',{reason:'本地替换验收'});
    await call('/match-signups/'+match.id,{action:'save',intentions:['main','fourth'],revision:0,schedule_revision:match.schedule_revision},'PUT',200,refToken);
    match=await call('/schedule/'+match.id+'/assign-referees',{main_referee_id:ref,schedule_revision:match.schedule_revision},'PUT');
    const tables=['referee_match_signups','referee_match_signup_events','match_official_assignments','match_reports'];
    const capture=async()=>Object.fromEntries(await Promise.all(tables.map(async name=>[name,(await pool.query('SELECT * FROM '+name+' ORDER BY id'))[0]])));
    const before=await capture();
    const response=await request('/api/schedule',{token:admin,body:{...base,match_time:'16:00-18:00',team_b_id:teams[2],futsal:true,supervisor_required:true}});
    expectStatus(response,409,'单场必须确认');assert.equal(response.data.code,'SCHEDULE_REPLACEMENT_CONFIRM_REQUIRED');
    assert.deepEqual(await capture(),before);assert.equal((await detail(match.id)).match_time,'15:00');
    const p=response.data.data;await confirm(p,409,[]);await confirm(p,409,[match.id+999]);
    const result=await confirm(p);assert.equal(result.replaced_count,1);assert.deepEqual(result.schedule_ids,[match.id]);
    assert.deepEqual(await capture(),before);
    match=await detail(match.id);assert.equal(match.match_time,'16:00');assert.equal(match.match_end_time,'18:00');assert.equal(match.futsal,false);assert.equal(match.fourth_required,true);assert.equal(match.supervisor_required,false);assert.equal(match.main_referee_id,ref);
    const list=await call('/match-signups?view=mine',undefined,'GET',200,refToken);const signup=list.items.find(r=>r.id===match.id);
    assert.equal(signup.signup_status,'active');assert.equal(signup.match_end_time,'18:00');assert.equal(signup.time_changed,true);
    await confirm(p,409);assert.deepEqual(await capture(),before);
  });
  await t.test('混合批量新建与替换保持ID，故障整批回滚，过期版本拒绝',async context=>{
    const p=await preview([row('R1'),row('R2')]);assert.equal(p.can_confirm,true);
    await confirm(p,409,[]);
    const before=await detail(match.id);
    const service=require('../../services/scheduleService'),original=service.createScheduleInTransaction;
    const mocked=context.mock.method(service,'createScheduleInTransaction',async function(c,data){if(data.field_order==='R2')throw new Error('注入失败');return original.call(this,c,data);});
    await confirm(p,400);mocked.mock.restore();assert.deepEqual(await detail(match.id),before);
    assert.equal((await pool.execute('SELECT id FROM match_schedules WHERE season_id=? AND field_order=?',[season.id,'R2']))[0].length,0);
    const result=await confirm(p);assert.equal(result.created_count,1);assert.equal(result.replaced_count,1);assert.equal(result.schedule_ids[0],match.id);
    const newMatch=await detail(result.schedule_ids[1]);assert.equal(newMatch.futsal,true);assert.equal(newMatch.supervisor_required,true);
    assert.equal((await detail(match.id)).futsal,false);
    const stale=await preview([row('R1')]);await pool.execute('UPDATE match_schedules SET schedule_revision=schedule_revision+1 WHERE id=?',[match.id]);await confirm(stale,409);
  });
  await t.test('原赛程/新赛程已开赛、时间待定、报告开始以及确认期间变化均禁止替换',async()=>{
    const open=await detail(match.id);
    assert.equal((await preview([row('R1','16:00',day(-1))])).can_confirm,false);
    for(const statement of ["match_date='2020-01-01'",'match_time=NULL,match_end_time=NULL']) {
      const p=await preview([row('R1')]);
      await pool.execute('UPDATE match_schedules SET '+statement+' WHERE id=?',[match.id]);
      await confirm(p,409);assert.equal((await preview([row('R1')])).can_confirm,false);
      await pool.execute('UPDATE match_schedules SET match_date=?,match_time=?,match_end_time=? WHERE id=?',[open.match_date,open.match_time,open.match_end_time,match.id]);
    }
    const p=await preview([row('R1')]);await pool.execute('UPDATE match_reports SET main_report_started_at=UTC_TIMESTAMP() WHERE schedule_id=?',[match.id]);
    await confirm(p,409);assert.equal((await preview([row('R1')])).can_confirm,false);
    await call('/schedule',{...base},'POST',400);
    await pool.execute('UPDATE match_reports SET main_report_started_at=NULL WHERE schedule_id=?',[match.id]);
    const expiring=await preview([row('R1')]);expiring.preview.expires_at=Date.now()-1;expiring.preview_token=require('node:crypto').createHmac('sha256',process.env.JWT_SECRET).update('schedule-import:'+JSON.stringify(expiring.preview)).digest('hex');await confirm(expiring,409);
  });
};
