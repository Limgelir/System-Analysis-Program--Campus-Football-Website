const rules = require('../utils/playerRules');
const w = require('../utils/playerWorkflow');
const r = require('../utils/teamApplicationRules');
const service = require('./playerTeamService');

async function revoke(id, user, body, revision) {
  rules.onlyKeys(body, ['reason', 'review_token']);
  const reason = r.text(body.reason, '撤销通过原因', 500);
  return w.transaction(async c => {
    const a = await service.lock(c, id, user);
    w.expectRevision(a.revision, revision);
    if (user.role !== 'admin') throw rules.businessError('只有管理员可以撤销报名通过', 403);
    if (a.kind !== 'initial' || a.source_type !== 'online' || a.status !== 'approved' || !a.team_id || a.registration_revoked || !service.writable(a)) {
      throw rules.businessError('仅当前启用赛事中已通过的线上整队报名可以撤销，请刷新核对', 409, 'TEAM_REVOKE_STATE');
    }
    const [[team]] = await w.sql(c, 'SELECT * FROM team WHERE id=? FOR UPDATE', [a.team_id]);
    const rows = await service.members(c, a.id, true), context = await service.reviewContext(c, a, rows);
    if (body.review_token !== context.token) throw rules.businessError('球队资料、名单、角色或审核信息已变化，请刷新核对再撤销', 409, 'TEAM_REVIEW_CHANGED');
    const before = await service.snapshot(c, a);
    const batch = await require('./playerRosterService').effectiveBatch(team.id, undefined, c);
    const [current] = await w.sql(c, `SELECT p.*,a.student_id,a.name,a.college,a.gender FROM team_player p
      LEFT JOIN player_accounts a ON a.id=p.player_account_id WHERE p.roster_batch_id=? ORDER BY p.id`, [batch?.id || 0]);
    // 已通过的版本保留在批次及事件中；原申请重新以当前正式名单为起点。
    await c.execute('UPDATE team_application_members SET is_removed=1,is_captain=0 WHERE application_id=?', [a.id]);
    for (const m of current) {
      const profile = m.player_account_id ? w.accountSnapshot({ ...m, id: m.player_account_id }) : m.profile_snapshot;
      await c.execute(`INSERT INTO team_application_members
        (application_id,player_id,import_person_id,jersey_number,is_captain,is_goalkeeper,is_foreign,is_sports_training,is_football_specialty,remark,profile_snapshot)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [a.id,m.player_account_id,m.import_person_id,m.jersey_number,
        Number(m.player_account_id ? m.player_account_id === team.captain_player_id : Boolean(m.is_captain)),
        m.is_goalkeeper,m.is_foreign,m.is_sports_training,m.is_football_specialty,m.remark,JSON.stringify(profile)]);
    }
    // 包括未来赛程：撤销和重新通过都不能改写已经安排的比赛名单。
    await require('./matchRosterService').preserveRegistrationMatches(c, team.id);
    await c.execute('UPDATE team SET registration_revoked=1,revision=revision+1 WHERE id=?', [team.id]);
    await c.execute(`UPDATE team_applications SET status='revoked',revision=revision+1,revoke_reason=?,
      manager_player_id=?,manager_import_person_id=?,team_name=?,shirt_color=?,shorts_color=?,socks_color=?,
      auto_review=NULL,return_reason=NULL,return_snapshot=NULL,member_comments=NULL,effective_from=NULL,
      reviewed_by_admin_id=?,reviewed_at=? WHERE id=?`, [reason,team.manager_player_id,team.manager_import_person_id,
      team.team_name,team.shirt_color,team.shorts_color,team.socks_color,user.id,w.chinaSql(),a.id]);
    const after = await service.application(c, a.id);
    await service.event(c, after, 'revoked', user, before, reason);
    await service.notify(c, [team.manager_player_id,team.captain_player_id,...current.map(m=>m.player_account_id)],
      `application:${a.id}:${after.revision}`, 'team_revoked',
      `“${team.team_name}”${a.league_type}报名通过已撤销：${reason}。负责人或队长可在报名时间内修改原申请并重新提交。`, a.season_id, team.id);
    return service.detailIn(c, a.id, user);
  }, { readCommitted: true });
}

module.exports = { revoke };
