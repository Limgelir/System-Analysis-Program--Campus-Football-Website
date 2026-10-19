const rules = require('../utils/playerRules');
const w = require('../utils/playerWorkflow');
const r = require('../utils/teamApplicationRules');
const service = require('./playerTeamService');

const FIELDS = ['status','manager_player_id','manager_import_person_id','team_name','shirt_color','shorts_color','socks_color',
  'auto_review','return_reason','return_snapshot','member_comments','revoke_reason','effective_from','reviewed_by_admin_id','reviewed_at','submitted_at','submitted_snapshot'];
const JSON_FIELDS = new Set(['auto_review','return_snapshot','member_comments','submitted_snapshot']);
async function capture(c, a, operation) {
  const [[team]] = a.team_id ? await w.sql(c,'SELECT revision FROM team WHERE id=? FOR UPDATE',[a.team_id]) : [[]];
  const [selections] = operation === 'revoked' ? await w.sql(c,'SELECT schedule_id,revision,roster_batch_id FROM match_roster_selections WHERE team_id=?',[a.team_id]) : [[]];
  const [drafts] = operation === 'revoked' ? await w.sql(c,"SELECT id,revision FROM team_applications WHERE team_id=? AND kind='roster_change' AND base_team_revision=? AND status IN ('draft','pending','returned','auto_failed')",[a.team_id,team.revision]) : [[]];
  return { operation, revision:a.revision+1, before:Object.fromEntries(FIELDS.map(k=>[k,a[k]??null])),
    members:(await service.snapshot(c,a)).members, team_revision:team?.revision??null, selections, drafts };
}
async function store(c, id, snapshot) {
  if (snapshot.operation === 'revoked') {
    const [rows] = await w.sql(c,`SELECT s.schedule_id,s.revision,s.roster_batch_id FROM match_roster_selections s
      JOIN team_applications a ON a.team_id=s.team_id WHERE a.id=?`,[id]);
    snapshot.created_selections = rows.filter(row=>!snapshot.selections.some(old=>old.schedule_id===row.schedule_id));
  }
  await c.execute('UPDATE team_applications SET admin_undo=? WHERE id=?',[JSON.stringify(snapshot),id]);
}
async function available(c, a) {
  const saved = a.admin_undo;
  if (!saved || a.revision !== saved.revision || a.status !== (saved.operation === 'returned' ? 'returned' : 'revoked') || !service.writable(a)) return false;
  if (a.team_id) {
    const [[team]] = await w.sql(c,'SELECT revision FROM team WHERE id=?',[a.team_id]);
    if (team?.revision !== saved.team_revision + Number(saved.operation === 'revoked')) return false;
  }
  return true;
}
async function undo(id, user, operation, body, revision) {
  if (user.role !== 'admin') throw rules.businessError('只有管理员可以撤销球队操作',403);
  rules.onlyKeys(body,['reason','review_token']);
  const reason = r.text(body.reason,'撤销误操作说明',500,true);
  return w.transaction(async c=>{
    const a = await service.lock(c,id,user);
    w.expectRevision(a.revision,revision);
    if (a.team_id) await w.sql(c,'SELECT id FROM team WHERE id=? FOR UPDATE',[a.team_id]);
    if (a.admin_undo?.operation !== operation || !await available(c,a)) throw rules.businessError('该操作无法撤销：申请或球队已有后续变化，或没有完整恢复记录，请刷新核对',409,'TEAM_UNDO_STATE');
    const rows = await service.members(c,a.id,true), context = await service.reviewContext(c,a,rows);
    if (body.review_token !== context.token) throw rules.businessError('球队审核资料已变化，请刷新核对',409,'TEAM_REVIEW_CHANGED');
    const before = await service.snapshot(c,a), saved = a.admin_undo;
    if (operation === 'revoked') {
      // 按赛程顺序加锁，与名单发布保持相同顺序；报告已开始时不可解除冻结。
      for (const selected of saved.created_selections || []) await w.sql(c,'SELECT id FROM match_schedules WHERE id=? FOR UPDATE',[selected.schedule_id]);
      if (!await available(c,a)) throw rules.businessError('比赛名单已变化，不能撤销本次操作',409,'TEAM_UNDO_STATE');
      await c.execute('UPDATE team_application_members SET is_removed=1,is_captain=0 WHERE application_id=?',[a.id]);
      for (const m of saved.members) await c.execute(`UPDATE team_application_members SET
        player_id=?,import_person_id=?,jersey_number=?,is_captain=?,is_goalkeeper=?,is_foreign=?,is_sports_training=?,is_football_specialty=?,remark=?,profile_snapshot=?,is_removed=0 WHERE application_id=? AND id=?`,
      [m.player_id,m.import_person_id,m.jersey_number,...r.FLAGS.map(f=>Number(m[f])),m.remark,JSON.stringify(m.profile_snapshot),a.id,m.id]);
      await c.execute('UPDATE team SET registration_revoked=0,revision=revision+1 WHERE id=?',[a.team_id]);
      for (const draft of saved.drafts || []) await c.execute('UPDATE team_applications SET base_team_revision=? WHERE id=? AND revision=? AND base_team_revision=?',
        [saved.team_revision+2,draft.id,draft.revision,saved.team_revision]);
      for (const selected of saved.created_selections || []) {
        const [[current]] = await w.sql(c,`SELECT s.revision,s.roster_batch_id,r.main_report_started_at,r.supervisor_review_started_at
          FROM match_roster_selections s LEFT JOIN match_reports r ON r.schedule_id=s.schedule_id WHERE s.schedule_id=? AND s.team_id=?`,[selected.schedule_id,a.team_id]);
        // 后续已填写报告或人工选择名单的比赛保留，不覆盖独立发生的比赛操作。
        if (!current || current.revision!==selected.revision || current.roster_batch_id!==selected.roster_batch_id || current.main_report_started_at || current.supervisor_review_started_at) continue;
        const [[last]] = await w.sql(c,'SELECT MAX(revision) AS revision FROM match_roster_selection_events WHERE schedule_id=? AND team_id=?',[selected.schedule_id,a.team_id]);
        await c.execute(`INSERT INTO match_roster_selection_events
          (schedule_id,team_id,revision,actor_admin_id,operation,reason,before_snapshot,after_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        [selected.schedule_id,a.team_id,last.revision+1,user.id,'revoke_undone','撤销误操作，恢复按比赛日期读取名单',JSON.stringify(selected),JSON.stringify({team_id:a.team_id,automatic:true}),w.chinaSql()]);
        await c.execute('DELETE FROM match_roster_selections WHERE schedule_id=? AND team_id=?',[selected.schedule_id,a.team_id]);
      }
    }
    await c.execute(`UPDATE team_applications SET ${FIELDS.map(k=>k+'=?').join(',')},revision=revision+1,admin_undo=NULL WHERE id=?`,
      [...FIELDS.map(k=>JSON_FIELDS.has(k)&&saved.before[k]!=null?JSON.stringify(saved.before[k]):saved.before[k]),a.id]);
    const after = await service.application(c,a.id);
    await service.event(c,after,operation==='returned'?'return_undone':'revoke_undone',user,before,reason);
    const access = await service.rights(c,after,await service.members(c,a.id),user);
    await service.notify(c,[access.manager,access.captain,...rows.map(m=>m.player_id),...saved.members.map(m=>m.player_id)],
      `application:${a.id}:${after.revision}`,'team_operation_undone',`管理员已撤销对“${a.team_name}”的${operation==='returned'?'退回操作，申请恢复原审核状态':'撤销报名通过操作，球队恢复通过状态'}。`,a.season_id,a.team_id);
    return service.detailIn(c,a.id,user);
  },{readCommitted:true});
}
module.exports = { capture, store, available, undo };
