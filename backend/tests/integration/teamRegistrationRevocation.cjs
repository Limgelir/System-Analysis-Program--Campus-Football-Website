const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { businessDate } = require('../../utils/competitionTime');

module.exports = async ({ t, pool, call, players, settings, create, member, submit, review, admin, adminGet, season }) => {
  let id, teamId, stale, latest, revoked, match, scheduleBody, oldBatch, oldPlayers, oldSchedule, change;
  const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });
  const get = token => call(`/api/player/team-applications/${id}`, undefined, token || players[3].token);
  const fields = d => ({ team_name:d.application.team_name,shirt_color:d.application.shirt_color,shorts_color:d.application.shorts_color,socks_color:d.application.socks_color,
    members:d.members.map(({id,player_id,jersey_number,remark,is_captain,is_goalkeeper,is_foreign,is_sports_training,is_football_specialty})=>({id,player_id,jersey_number,remark,is_captain,is_goalkeeper,is_foreign,is_sports_training:Boolean(is_sports_training),is_football_specialty:Boolean(is_football_specialty)})) });
  const reviewApp = async (appId, operation='approve', extra={}) => {
    const d = await adminGet(appId);
    return call(`/api/player-admin/team-applications/${appId}/${operation}`, { review_token:d.review_token,reason:'撤销功能验收',...extra }, admin, 'POST', d.application.revision);
  };
  await t.test('0030已有正式名单升级到0031：回填通过版本，保留账号、申请、球队及名单', async () => {
    assert.equal(process.env.REFWEB_INTEGRATION_TEST,'1');assert.ok(process.env.DB_NAME.endsWith('_test'));
    const tables=['player_accounts','team','team_roster_batches','team_player','team_applications','team_application_events'];
    const before={};for(const table of tables)before[table]=(await pool.query('SELECT * FROM '+table+' ORDER BY id'))[0];
    const c=await pool.getConnection();
    try {
      await c.query('ALTER TABLE team_roster_batches ADD UNIQUE INDEX uq_batch_application (application_id)');
      await c.query('ALTER TABLE team_roster_batches DROP INDEX uq_batch_application_revision, DROP COLUMN application_revision');
      await c.query('ALTER TABLE team DROP COLUMN registration_revoked');
      await c.query('ALTER TABLE team_applications DROP COLUMN revoke_reason');
      await c.query("ALTER TABLE team_applications MODIFY status ENUM('draft','pending','returned','withdrawn','approved','auto_failed') NOT NULL DEFAULT 'draft'");
      await c.query("DELETE FROM schema_migrations WHERE version>='0031'");
      await require('../../utils/migrationRunner').runPendingMigrations(c);
      for(const table of tables)assert.deepEqual((await c.query('SELECT * FROM '+table+' ORDER BY id'))[0],before[table],table);
    } finally { c.release(); }
  });
  await t.test('撤销准备：保留最新正式名单和当前角色；队长、守门员、运训可同时标记', async () => {
    await settings({ enable_sports_training:true });
    const a = await create('撤销后重新报名队',0,[member(1,{is_sports_training:true}),member(3)]);
    id=a.application.id;await submit();await review();
    stale=await adminGet(id);teamId=stale.application.team_id;
    assert.equal(stale.permissions.can_revoke,true);
    const captain=stale.members.find(m=>m.is_captain);
    assert.equal(captain.is_goalkeeper,true);assert.equal(captain.is_sports_training,true);
    const roles=await call(`/api/player/teams/${teamId}/role-changes`,undefined,players[0].token);
    const role=await call(`/api/player/teams/${teamId}/role-changes`,{role:'manager',new_player_id:players[3].id},players[0].token,'POST',roles.team.revision,201,key());
    const check=await call(`/api/player-admin/role-changes/${role.request.id}`);
    await call(`/api/player-admin/role-changes/${role.request.id}/approve`,{review_token:check.review_token},admin,'POST',check.request.revision);
    let formal=await call(`/api/player/teams/${teamId}`,undefined,players[3].token);
    let draft=await call(`/api/player/teams/${teamId}/roster-changes`,{},players[3].token,'POST',formal.team.revision,201,key());
    const body=fields(draft);body.shirt_color='蓝';body.members[0].jersey_number='99';body.members.forEach(m=>m.is_captain=m.player_id===players[3].id);
    draft=await call(`/api/player/team-applications/${draft.application.id}`,body,players[3].token,'PUT',draft.application.revision);
    await call(`/api/player/team-applications/${draft.application.id}/submit`,{},players[3].token,'POST',draft.application.revision);
    await reviewApp(draft.application.id);
    formal=await call(`/api/player/teams/${teamId}`,undefined,players[3].token);oldBatch=formal.batch.id;
    oldPlayers=(await pool.query('SELECT * FROM team_player WHERE team_id=? ORDER BY id',[teamId]))[0];
    await call(`/api/player-admin/team-applications/${id}/revoke`,{reason:'旧页面不能撤销',review_token:stale.review_token},admin,'POST',stale.application.revision,409);
    latest=await adminGet(id);
    await call(`/api/player-admin/team-applications/${id}/revoke`,{reason:'  ',review_token:latest.review_token},admin,'POST',latest.application.revision,400);
    await call(`/api/player-admin/team-applications/${id}/revoke`,{reason:'球员无权',review_token:latest.review_token},players[3].token,'POST',latest.application.revision,403);
    // 进行中的名单变更在撤销后不得覆盖重新报名。
    change=await call(`/api/player/teams/${teamId}/roster-changes`,{},players[3].token,'POST',formal.team.revision,201,key());
    await create('撤销验收对手',0,[member(1),member(3)]);await submit();const other=await review();
    const tomorrow=new Date(Date.parse(businessDate()+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    scheduleBody={team_a_id:teamId,team_b_id:other.application.team_id,match_type:'自动审核赛事',match_date:tomorrow,match_time:'12:00',field_order:'REVOKE-1',supervisor_required:false};
    match=await call('/api/schedule',scheduleBody,admin,'POST');
    oldSchedule=(await pool.query('SELECT * FROM match_schedules WHERE id=?',[match.id]))[0][0];
    latest=await adminGet(id);
  });
  await t.test('有赛程也可撤销：原申请、历史名单、赛程保留，正式列表及参队统计移除', async () => {
    revoked=await call(`/api/player-admin/team-applications/${id}/revoke`,{reason:'请重新核对本队报名资料',review_token:latest.review_token},admin,'POST',latest.application.revision);
    assert.equal(revoked.application.status,'revoked');assert.equal(revoked.application.team_id,teamId);
    assert.equal(revoked.application.shirt_color,'蓝');assert.equal(revoked.manager.id,players[3].id);
    assert.equal(revoked.members.find(m=>m.is_captain).player_id,players[3].id);
    assert.equal(revoked.members.find(m=>m.player_id===players[1].id).jersey_number,'99');
    assert.equal(revoked.events[0].operation,'revoked');assert.equal(revoked.events[0].before_snapshot.status,'approved');
    assert.equal((await get(players[1].token)).application.revoke_reason,'请重新核对本队报名资料');
    assert.equal((await get(players[1].token)).permissions.can_manage,false);
    assert.equal((await get()).permissions.can_edit,true);
    await call(`/api/player/team-applications/${id}`,undefined,players[0].token,'GET',null,403);
    const list=await call('/api/player/team-applications?status=revoked',undefined,players[3].token);
    assert.equal(list.items.find(a=>a.id===id).can_manage,true);
    for(const endpoint of ['/api/public/teams','/api/player/teams']) {
      const rows=await call(endpoint,undefined,endpoint.includes('/public/')?null:players[3].token);
      assert.ok(!rows.some(t=>t.id===teamId));
    }
    const history=await call('/api/player/my-teams',undefined,players[3].token);assert.equal(history.find(t=>t.id===teamId).is_member,false);assert.equal(history.find(t=>t.id===teamId).was_member,true);
    const adminTeams=await call(`/api/team/season/${season.id}`);assert.ok(!adminTeams.teams.some(t=>t.id===teamId));
    const other=await adminGet();assert.ok(other.members.every(m=>!m.approved_teams.some(t=>t.id===teamId)));
    assert.deepEqual((await pool.query('SELECT * FROM team_player WHERE team_id=? ORDER BY id',[teamId]))[0],oldPlayers);
    assert.deepEqual((await pool.query('SELECT * FROM match_schedules WHERE id=?',[match.id]))[0][0],oldSchedule);
    const [[selection]]=await pool.execute('SELECT roster_batch_id FROM match_roster_selections WHERE schedule_id=? AND team_id=?',[match.id,teamId]);
    assert.equal(selection.roster_batch_id,oldBatch);
    const [[opponent]]=await pool.execute('SELECT COUNT(*) n FROM match_roster_selections WHERE schedule_id=? AND team_id<>?',[match.id,teamId]);assert.equal(opponent.n,0);
    const [[notification]]=await pool.execute("SELECT message FROM player_notifications WHERE player_id=? AND kind='team_revoked' AND related_team_id=?",[players[3].id,teamId]);assert.match(notification.message,/请重新核对/);
    await call(`/api/player-admin/team-applications/${id}/revoke`,{reason:'重复撤销',review_token:revoked.review_token},admin,'POST',revoked.application.revision,409);
    await call(`/api/player/team-applications/${change.application.id}/submit`,{},players[3].token,'POST',change.application.revision,409);
    await call(`/api/player/team-applications/${change.application.id}/withdraw`,{},players[3].token,'POST',change.application.revision);
    await call('/api/schedule',{...scheduleBody,field_order:'REVOKE-FORBIDDEN'},admin,'POST',null,400);
    await call(`/api/schedule/${match.id}`,{...scheduleBody,match_time:'13:00'},admin,'PUT');
  });
  await t.test('窗口内重新提交仍需审核，沿用球队编号并追加正式版本，已有比赛继续使用原名单', async () => {
    let a=await get();const body=fields(a);body.members[0].jersey_number='88';body.members.forEach(m=>m.is_captain=m.player_id===players[1].id);
    a=await call(`/api/player/team-applications/${id}`,body,players[3].token,'PUT',a.application.revision);
    assert.equal((await get(players[1].token)).permissions.can_manage,true,'草稿新队长可协作');
    const list=await call('/api/player/team-applications?status=revoked',undefined,players[1].token);assert.equal(list.items.find(v=>v.id===id).can_manage,true);
    a=await call(`/api/player/team-applications/${id}/submit`,{},players[1].token,'POST',a.application.revision);
    assert.equal(a.application.status,'pending');assert.equal(a.application.registration_revoked,true);
    a=await reviewApp(id);assert.equal(a.application.status,'approved');assert.equal(a.application.team_id,teamId);assert.equal(a.application.registration_revoked,false);
    const formal=await call(`/api/player/teams/${teamId}`,undefined,players[3].token);assert.notEqual(formal.batch.id,oldBatch);assert.equal(formal.players[0].jersey_number,'88');
    const [[selection]]=await pool.execute('SELECT roster_batch_id FROM match_roster_selections WHERE schedule_id=? AND team_id=?',[match.id,teamId]);assert.equal(selection.roster_batch_id,oldBatch);
    const [batches]=await pool.execute('SELECT application_revision FROM team_roster_batches WHERE application_id=? ORDER BY id',[id]);assert.equal(batches.length,2);assert.equal(batches[1].application_revision,a.application.revision);
    await call('/api/schedule',{...scheduleBody,field_order:'REVOKE-NEW'},admin,'POST');
  });
  await t.test('撤销后截止外禁止保存、提交和人工申请，退回也不延长报名期限；再次开放可重提', async () => {
    await settings({},false);let a=await reviewApp(id,'revoke');assert.equal(a.application.status,'revoked');
    a=await get();assert.equal(a.permissions.can_edit,false);assert.equal(a.permissions.can_submit,false);
    await call(`/api/player/team-applications/${id}`,fields(a),players[3].token,'PUT',a.application.revision,409);
    for(const op of ['submit','submit-manual'])await call(`/api/player/team-applications/${id}/${op}`,{},players[3].token,'POST',a.application.revision,409);
    await settings({});a=await get();a=await call(`/api/player/team-applications/${id}/submit`,{},players[3].token,'POST',a.application.revision);
    await reviewApp(id,'return',{replaceable_member_ids:[],member_comments:{}});await settings({},false);
    a=await get();assert.equal(a.permissions.can_edit,false);assert.equal(a.correction.restricted,false);
    await call(`/api/player/team-applications/${id}/submit`,{},players[3].token,'POST',a.application.revision,409);
    await settings({});a=await get();await call(`/api/player/team-applications/${id}/submit`,{},players[3].token,'POST',a.application.revision);await reviewApp(id);
  });
  await t.test('导入球队不能撤销；0031重复执行保留全部记录', async () => {
    const [[imported]]=await pool.execute("SELECT id FROM team_applications WHERE source_type='admin_import' AND kind='initial' LIMIT 1");
    const d=await adminGet(imported.id);assert.equal(d.permissions.can_revoke,false);
    await call(`/api/player-admin/team-applications/${d.application.id}/revoke`,{reason:'导入不在范围内',review_token:d.review_token},admin,'POST',d.application.revision,409);
    const tables=['team','team_roster_batches','team_player','team_applications','team_application_members','team_application_events','match_schedules','match_roster_selections','match_roster_selection_events'];
    const before={};for(const table of tables)before[table]=(await pool.query('SELECT * FROM '+table))[0];
    const c=await pool.getConnection();try{await require('../../../db/migrations/0031_team_registration_revocation').up(c);}finally{c.release();}
    for(const table of tables)assert.deepEqual((await pool.query('SELECT * FROM '+table))[0],before[table],table);
  });
};
