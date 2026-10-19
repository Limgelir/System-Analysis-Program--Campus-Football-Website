const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {businessDate} = require('../../utils/competitionTime');
module.exports = async ({t,pool,call,players,settings,create,member,submit,review,admin,adminGet,season,request}) => {
  let teamId, appId, opponent, d, match, oldBatch;
  const get = () => call(`/api/player-admin/teams/${teamId}/manage`);
  const fields = v => ({team_name:v.team.team_name,manager_player_id:v.manager.id,shirt_color:v.team.shirt_color,shorts_color:v.team.shorts_color,socks_color:v.team.socks_color,
    members:v.members.map(m=>({id:m.id,player_id:m.player_id,jersey_number:m.jersey_number,remark:m.remark,...Object.fromEntries(['is_captain','is_goalkeeper','is_foreign','is_sports_training','is_football_specialty'].map(f=>[f,Boolean(m[f])]))}))});
  const update = (body,expected=200,version=d.team.revision,token=admin) => call(`/api/player-admin/teams/${teamId}/manage`,body,token,'PUT',version,expected);
  const action = async (id, op, extra={},expected=200) => {const a=await adminGet(id);return call(`/api/player-admin/team-applications/${id}/${op}`,{review_token:a.review_token,reason:'管理员编辑及恢复验收',...(op==='return'?{replaceable_member_ids:[],member_comments:{}}:{}),...extra},admin,'POST',a.application.revision,expected)};
  const appFields = a => ({team_name:a.application.team_name,shirt_color:a.application.shirt_color,shorts_color:a.application.shorts_color,socks_color:a.application.socks_color,members:a.members.map(({id,player_id,jersey_number,remark,...m})=>({id,player_id,jersey_number,remark,...Object.fromEntries(['is_captain','is_goalkeeper','is_foreign','is_sports_training','is_football_specialty'].map(f=>[f,Boolean(m[f])]))}))});
  await t.test('管理员编辑：关闭窗口仍可改名、换负责人、改号码和删队员，赛程同步且旧名单保留',async()=>{
    await settings({});await create('管理员修改验收队',0,[member(1),member(3)]);await submit();const a=await review();teamId=a.application.team_id;appId=a.application.id;
    await create('管理员修改对手',0,[member(1),member(3)]);await submit();opponent=(await review()).application.team_id;
    const tomorrow=new Date(Date.parse(businessDate()+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    match=await call('/api/schedule',{team_a_id:teamId,team_b_id:opponent,match_type:'自动审核赛事',match_date:tomorrow,match_time:'12:00',field_order:'ADMIN-EDIT',supervisor_required:false},admin,'POST');
    await settings({},false);d=await get();assert.equal(d.can_edit,true);oldBatch=d.batch.id;
    const body=fields(d);body.team_name='管理员改名已生效';body.manager_player_id=players[3].id;body.members=body.members.filter(m=>m.player_id===players[3].id);body.members[0].is_captain=true;body.members[0].jersey_number='008';
    d=await update(body);assert.equal(d.team.team_name,body.team_name);assert.equal(d.manager.id,players[3].id);assert.equal(d.members.length,1);assert.equal(d.members[0].jersey_number,'8');assert.notEqual(d.batch.id,oldBatch);
    const [[schedule]]=await pool.execute('SELECT * FROM match_schedules WHERE id=?',[match.id]);assert.equal(schedule.team_a_name_snapshot,body.team_name);
    const scheduleDetail=await call(`/api/schedule/${match.id}`);assert.equal(scheduleDetail.team_a_name_snapshot,body.team_name);
    const publicTeam=await call(`/api/public/teams/${teamId}`,undefined,null);assert.equal(publicTeam.matches[0].home_name,body.team_name);
    const [[old]]=await pool.execute('SELECT COUNT(*) n FROM team_player WHERE roster_batch_id=?',[oldBatch]);assert.equal(old.n,2);
    const playerTeam=await call(`/api/player/teams/${teamId}`,undefined,players[3].token);assert.equal(playerTeam.can_manage,true);assert.equal(playerTeam.players[0].jersey_number,'8');
    await call(`/api/player/teams/${teamId}`,undefined,players[0].token,'GET',null,403);
    await update(fields(d),403,d.team.revision,players[3].token);
  });
  await t.test('管理员编辑：按学号加人、换号；重复号码、空队长、重名及旧版本仍被拒绝',async()=>{
    const candidate=await call(`/api/player-admin/teams/${teamId}/manage/players?role=member&student_id=AUTO-1`);assert.equal(candidate.id,players[1].id);
    const body=fields(d);body.members.push(member(1,{is_captain:false,jersey_number:'9'}));d=await update(body);
    const original=fields(d);
    for(const bad of [v=>v.members.forEach(m=>m.jersey_number='08'),v=>v.members.forEach(m=>m.is_captain=false),v=>v.team_name='管理员修改对手']){
      const v=structuredClone(original);bad(v);await update(v,v.team_name==='管理员修改对手'?409:400);
    }
    await update({...original,adminDirectEdit:true},400);
    await update({...original,manager_player_id:2147483647},404);
    const stale=d.team.revision;d=await update({...fields(d),shirt_color:'红'});await update(fields(d),409,stale);
    const [events]=await pool.execute("SELECT actor_admin_id,after_snapshot FROM team_application_events WHERE operation='admin_updated' AND JSON_EXTRACT(after_snapshot,'$.team_id')=?",[teamId]);assert.ok(events.length>=3);assert.ok(events.every(e=>e.actor_admin_id));
  });
  await t.test('管理员编辑：超人数、学院、外援及合并标签限制可保存，失败依据和管理员豁免留档',async()=>{
    const [[profile]]=await pool.execute('SELECT college FROM player_accounts WHERE id=?',[players[1].id]);
    await pool.execute("UPDATE player_accounts SET college='交通学院' WHERE id=?",[players[1].id]);
    const limits={max_players:1,max_colleges:1,max_foreign_players:0,enable_sports_training:true,enable_football_specialty:true,max_sports_training_players:0,max_football_specialty_players:0,combined_player_limits:[{tags:['sports_training','football_specialty'],max:0}]};
    await settings(limits,false);
    const body=fields(d);body.members.forEach(m=>{m.is_foreign=true;m.is_sports_training=true;m.is_football_specialty=true});
    const previousBatch=d.batch.id;d=await update(body);assert.notEqual(d.batch.id,previousBatch);
    const [[saved]]=await pool.execute('SELECT a.id,a.auto_review FROM team_applications a JOIN team_roster_batches b ON b.application_id=a.id WHERE b.id=?',[d.batch.id]);
    assert.equal(saved.auto_review.passed,false);assert.equal(saved.auto_review.exemption,'admin_direct_edit');assert.equal(saved.auto_review.eligibility_exempt,true);assert.ok(saved.auto_review.override.admin_id);
    for(const rule of ['max_players','max_colleges','max_foreign_players','max_sports_training_players','max_football_specialty_players','combined:sports_training+football_specialty'])assert.ok(saved.auto_review.failures.some(f=>f.rule===rule),rule);
    const history=await adminGet(saved.id);assert.equal(history.application.status,'approved');assert.equal(history.events[0].operation,'admin_updated');assert.equal(history.auto_review.exemption,'admin_direct_edit');
    await settings({min_players:3},false);d=await update({...fields(d),shirt_color:'最低人数豁免'});
    const [[minimum]]=await pool.execute('SELECT a.auto_review FROM team_applications a JOIN team_roster_batches b ON b.application_id=a.id WHERE b.id=?',[d.batch.id]);assert.ok(minimum.auto_review.failures.some(f=>f.rule==='min_players'));
    // 同一赛事下普通球员提交仍进入自动失败，不能用请求参数获得管理员豁免。
    await settings(limits);await create('球员自动审核仍生效',0,[member(1),member(3)]);const a=await submit();assert.equal(a.application.status,'auto_failed');assert.equal(a.auto_review.exemption,undefined);
    await call(`/api/player/team-applications/${a.application.id}`,{...appFields(a),skipPlayerEligibility:true},players[0].token,'PUT',a.application.revision,400);
    await pool.execute('UPDATE player_accounts SET college=? WHERE id=?',[profile.college,players[1].id]);await settings({});
  });
  await t.test('管理员编辑：未通过学籍、已撤销资格、停用账号及未填性别可编辑，球员端仍受资格校验',async()=>{
    const a=await create('球员资格校验仍生效',0,[member(1),member(3)]);
    const submitPlayer=(expected)=>call(`/api/player/team-applications/${a.application.id}/submit`,{},players[0].token,'POST',a.application.revision,expected);
    await call(`/api/player/team-applications/${a.application.id}/players?student_id=AUTO-0`,undefined,players[0].token,'GET',null,409);
    const candidate=await call(`/api/player-admin/teams/${teamId}/manage/players?role=member&student_id=AUTO-0`);assert.equal(candidate.qualification_status,null);
    // 前序回归已撤销 AUTO-2 的当季学籍资格。
    const revoked=await call(`/api/player-admin/teams/${teamId}/manage/players?role=member&student_id=AUTO-2`);assert.equal(revoked.qualification_status,'revoked');
    await pool.execute('UPDATE player_accounts SET gender=NULL WHERE id=?',[players[1].id]);await submitPlayer(400);
    await pool.execute("UPDATE player_accounts SET gender='male',is_active=0 WHERE id=?",[players[1].id]);await submitPlayer(409);
    await pool.execute('UPDATE player_accounts SET gender=NULL WHERE id=?',[players[1].id]);
    await pool.execute('UPDATE player_accounts SET is_active=0 WHERE id=?',[players[3].id]);
    const inactive=await call(`/api/player-admin/teams/${teamId}/manage/players?role=member&student_id=AUTO-1`);assert.equal(inactive.is_active,0);assert.equal(inactive.gender,null);
    const manager=await call(`/api/player-admin/teams/${teamId}/manage/players?role=manager&student_id=AUTO-3`);assert.equal(manager.is_active,0);
    const body=fields(d);body.members.push(member(0,{is_captain:false,jersey_number:'77'}),member(2,{is_captain:false,jersey_number:'78'}));d=await update(body);
    assert.equal(d.members.length,4);assert.equal(d.members.find(m=>m.player_id===players[1].id).gender,null);assert.equal(d.manager.id,players[3].id);
    const [[account]]=await pool.execute('SELECT is_active,gender FROM player_accounts WHERE id=?',[players[1].id]);assert.equal(account.is_active,0);assert.equal(account.gender,null);
    const [[registration]]=await pool.execute('SELECT status FROM player_season_registrations WHERE player_id=? AND season_id=?',[players[2].id,season.id]);assert.equal(registration.status,'revoked');
    await pool.execute("UPDATE player_accounts SET gender='male',is_active=1 WHERE id=?",[players[1].id]);await pool.execute('UPDATE player_accounts SET is_active=1 WHERE id=?',[players[3].id]);
    d=await update({...fields(d),members:fields(d).members.filter(m=>![players[0].id,players[2].id].includes(m.player_id))});
  });
  await t.test('管理员编辑：现有名单及角色申请阻止直接修改，撤回后可继续',async()=>{
    await settings({});d=await get();let a=await call(`/api/player/teams/${teamId}/roster-changes`,{},players[3].token,'POST',d.team.revision,201,{'Idempotency-Key':crypto.randomUUID()});
    assert.equal((await get()).can_edit,false);await update(fields(d),409);await call(`/api/player/team-applications/${a.application.id}/withdraw`,{},players[3].token,'POST',a.application.revision);
    const role=await call(`/api/player/teams/${teamId}/role-changes`,{role:'manager',new_player_id:players[0].id,reason:'测试待审'},players[3].token,'POST',d.team.revision,201,{'Idempotency-Key':crypto.randomUUID()});
    assert.equal((await get()).can_edit,false);await update(fields(d),409);await call(`/api/player/role-changes/${role.request.id}/withdraw`,{},players[3].token,'POST',role.request.revision);
    d=await get();assert.equal(d.can_edit,true);
  });
  await t.test('撤销退回：恢复待审核及上次补正范围，重复撤销与球员越权被拒绝',async()=>{
    await create('撤销退回验收',0,[member(1),member(3)]);await submit();let a=await review('return',{replaceable_member_ids:[]});const id=a.application.id;
    assert.equal(a.permissions.can_undo_return,true);a=await action(id,'undo-return');assert.equal(a.application.status,'pending');assert.equal(a.application.return_reason,null);assert.deepEqual(a.correction.replaceable_member_ids,[]);
    await action(id,'undo-return',{},409);
    a=await action(id,'return',{replaceable_member_ids:[a.members[0].id]});const replacement=a.members[0].id;
    await call(`/api/player/team-applications/${id}/submit`,{},players[0].token,'POST',a.application.revision);
    a=await action(id,'return',{replaceable_member_ids:[a.members[1].id]});a=await action(id,'undo-return');assert.equal(a.application.status,'pending');assert.deepEqual(a.correction.replaceable_member_ids,[replacement]);
    await call(`/api/player-admin/team-applications/${id}/undo-return`,{review_token:a.review_token},players[0].token,'POST',a.application.revision,403);
  });
  await t.test('旧操作补齐：备份恢复快照与新快照一致，首次退回可按确认规则恢复',async()=>{
    const w=require('../../utils/playerWorkflow'),legacy=require('../../utils/legacyTeamUndoSnapshot');
    for(const operation of ['returned','revoked']){
      await settings({});await create('旧记录恢复'+operation,0,[member(1),member(3)]);await submit();
      if(operation==='revoked')await review();
      const [latest]=await pool.query('SELECT id FROM team_applications ORDER BY id DESC LIMIT 1');const id=latest[0].id;
      const [[original]]=await w.sql(pool,'SELECT * FROM team_applications WHERE id=?',[id]);
      await action(id,operation==='returned'?'return':'revoke');
      const [[a]]=await w.sql(pool,'SELECT * FROM team_applications WHERE id=?',[id]);const oracle=a.admin_undo;
      await pool.execute('UPDATE team_applications SET admin_undo=NULL WHERE id=?',[id]);a.admin_undo=null;
      assert.equal((await adminGet(id)).permissions[operation==='returned'?'can_undo_return':'can_undo_revoke'],false);
      const [[event]]=await w.sql(pool,'SELECT * FROM team_application_events WHERE application_id=? AND revision=?',[id,a.revision]);
      const snapshot=legacy.build({current:a,event,original:operation==='revoked'?original:null,teamRevision:oracle.team_revision,firstReturnConfirmed:operation==='returned'});
      assert.deepEqual(snapshot.before,oracle.before);assert.deepEqual(snapshot.members,oracle.members);
      assert.throws(()=>legacy.build({current:{...a,revision:a.revision+1},event,original}));
      await pool.execute('UPDATE team_applications SET admin_undo=? WHERE id=?',[JSON.stringify(snapshot),id]);
      const restored=await action(id,operation==='returned'?'undo-return':'undo-revoke');assert.equal(restored.application.status,original.status);
      assert.deepEqual((await w.sql(pool,'SELECT reviewed_at,submitted_at FROM team_applications WHERE id=?',[id]))[0][0],{reviewed_at:original.reviewed_at,submitted_at:original.submitted_at});
    }
  });
  await t.test('撤销退回：自动失败恢复原失败依据，球队保存或重提后不允许恢复',async()=>{
    await settings({min_players:3});await create('恢复自动失败验收',0,[member(1),member(3)]);let a=await submit();const original=a.auto_review;a=await review('return');a=await action(a.application.id,'undo-return');assert.equal(a.application.status,'auto_failed');assert.deepEqual(a.auto_review,original);
    a=await action(a.application.id,'return');a=await call(`/api/player/team-applications/${a.application.id}`,appFields(a),players[0].token,'PUT',a.application.revision);
    assert.equal((await adminGet(a.application.id)).permissions.can_undo_return,false);await action(a.application.id,'undo-return',{},409);
    await settings({});
  });
  await t.test('撤销撤销通过：恢复原申请与当前正式名单，恢复未来比赛自动取名单，操作历史保留',async()=>{
    const original=await adminGet(appId),before=await get();let a=await action(appId,'revoke');assert.equal(a.permissions.can_undo_revoke,true);assert.equal(a.application.registration_revoked,true);
    const [[frozen]]=await pool.execute('SELECT COUNT(*) n FROM match_roster_selections WHERE schedule_id=? AND team_id=?',[match.id,teamId]);assert.equal(frozen.n,1);
    await settings({},false);a=await action(appId,'undo-revoke');assert.equal(a.application.status,'approved');assert.equal(a.application.registration_revoked,false);assert.deepEqual(a.members,original.members);assert.equal(a.application.reviewed_at,original.application.reviewed_at);
    const after=await get();assert.equal(after.batch.id,before.batch.id);assert.equal(after.manager.id,before.manager.id);assert.deepEqual(after.members,before.members);
    const [[automatic]]=await pool.execute('SELECT COUNT(*) n FROM match_roster_selections WHERE schedule_id=? AND team_id=?',[match.id,teamId]);assert.equal(automatic.n,0);
    assert.equal(a.events[0].operation,'revoke_undone');await action(appId,'undo-revoke',{},409);
  });
  await t.test('撤销撤销通过：球队已修改时禁止恢复；重复迁移保留业务记录',async()=>{
    await settings({});let a=await action(appId,'revoke');a=await call(`/api/player/team-applications/${appId}`,{...appFields(a),shirt_color:'蓝'},players[3].token,'PUT',a.application.revision);
    assert.equal((await adminGet(appId)).permissions.can_undo_revoke,false);await action(appId,'undo-revoke',{},409);
    await call(`/api/player/team-applications/${appId}/submit`,{},players[3].token,'POST',a.application.revision);await action(appId,'approve');
    const c=await pool.getConnection();try{const [before]=await c.query('SELECT * FROM team_applications');await require('../../../db/migrations/0034_admin_team_management').up(c);assert.deepEqual((await c.query('SELECT * FROM team_applications'))[0],before);}finally{c.release()}
  });
  await t.test('并发保存只发布一版；撤销退回与球队保存并发时只允许一个成功',async()=>{
    d=await get();const body=fields(d),before=d.batch.version_no;
    const updates=await Promise.all([1,2].map(i=>request(`/api/player-admin/teams/${teamId}/manage`,{method:'PUT',token:admin,body:{...body,shirt_color:'并发'+i},headers:{'If-Match':String(d.team.revision)}})));
    assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);d=await get();assert.equal(d.batch.version_no,before+1);
    await create('并发恢复验收',0,[member(1),member(3)]);await submit();const a=await review('return');
    const replies=await Promise.all([
      request(`/api/player-admin/team-applications/${a.application.id}/undo-return`,{token:admin,body:{review_token:a.review_token},headers:{'If-Match':String(a.application.revision)}}),
      request(`/api/player/team-applications/${a.application.id}`,{token:players[0].token,method:'PUT',body:{...appFields(a),shirt_color:'并发修改'},headers:{'If-Match':String(a.application.revision)}})
    ]);assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  });
  await t.test('撤销误撤销保留后来开始的报告名单，恢复原先有效的名单变更草稿',async()=>{
    d=await get();const draft=await call(`/api/player/teams/${teamId}/roster-changes`,{},players[3].token,'POST',d.team.revision,201,{'Idempotency-Key':crypto.randomUUID()});
    const reportMatch=await call('/api/schedule',{team_a_id:teamId,team_b_id:opponent,match_type:'自动审核赛事',match_date:new Date(Date.parse(businessDate()+'T00:00:00Z')+86400000).toISOString().slice(0,10),match_time:'13:00',field_order:'ADMIN-UNDO-REPORT',supervisor_required:false},admin,'POST');
    const a=await action(appId,'revoke');
    await pool.execute('UPDATE match_reports SET main_report_started_at=NOW() WHERE schedule_id=?',[reportMatch.id]);
    await action(appId,'undo-revoke');
    const [[frozen]]=await pool.execute('SELECT roster_batch_id FROM match_roster_selections WHERE schedule_id=? AND team_id=?',[reportMatch.id,teamId]);assert.equal(frozen.roster_batch_id,d.batch.id);
    const updated=await call(`/api/player/team-applications/${draft.application.id}`,appFields(draft),players[3].token,'PUT',draft.application.revision);assert.equal(updated.application.status,'draft');
    await call(`/api/player/team-applications/${draft.application.id}/withdraw`,{},players[3].token,'POST',updated.application.revision);
  });
};
