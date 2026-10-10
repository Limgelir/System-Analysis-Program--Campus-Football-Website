const pool = require('../db');
const w = require('../utils/playerWorkflow');
const rules = require('../utils/playerRules');
const r = require('../utils/teamApplicationRules');
const rosters = require('./playerRosterService');
const { businessDate } = require('../utils/competitionTime');

async function selection(c, schedule, teamId) {
  const [[saved]] = await w.sql(c, 'SELECT * FROM match_roster_selections WHERE schedule_id=? AND team_id=?', [schedule.id, teamId]);
  if (saved) return saved;
  const batch = await rosters.effectiveBatch(teamId, schedule.match_date, c);
  return { schedule_id: schedule.id, team_id: teamId, roster_batch_id: batch?.id || null, revision: 0, selection_reason: '按比赛日期读取有效名单' };
}
async function record(c, schedule, teamId, batchId, reason, user, operation, previous) {
  const [[last]]=await w.sql(c,'SELECT COALESCE(MAX(revision),0) AS revision FROM match_roster_selection_events WHERE schedule_id=? AND team_id=?',[schedule.id,teamId]);
  const revision = last.revision + 1, now = w.chinaSql();
  await c.execute(`INSERT INTO match_roster_selections
    (schedule_id,team_id,roster_batch_id,revision,selected_by_admin_id,selection_reason,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE roster_batch_id=VALUES(roster_batch_id),revision=VALUES(revision),selected_by_admin_id=VALUES(selected_by_admin_id),selection_reason=VALUES(selection_reason),updated_at=VALUES(updated_at)`,
  [schedule.id, teamId, batchId, revision, user?.id || null, reason, now, now]);
  const after = { schedule_id: schedule.id, team_id: teamId, roster_batch_id: batchId, revision, selection_reason: reason };
  await c.execute(`INSERT INTO match_roster_selection_events
    (schedule_id,team_id,revision,actor_admin_id,operation,reason,before_snapshot,after_snapshot,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [schedule.id, teamId, revision, user?.id || null, operation, reason, JSON.stringify(previous), JSON.stringify(after), now]);
  return after;
}
async function freeze(c, schedule, reason = '报告开始填写，保留本场比赛名单') {
  for (const teamId of [schedule.team_a_id, schedule.team_b_id]) {
    const current = await selection(c, schedule, teamId);
    if (!current.revision) await record(c, schedule, teamId, current.roster_batch_id, reason, null, 'preserved', current);
  }
}
async function preserveTeamMatches(c, teamId) {
  const [matches] = await w.sql(c, `SELECT s.* FROM match_schedules s WHERE (s.team_a_id=? OR s.team_b_id=?)
    AND (s.match_date<=? OR EXISTS (SELECT 1 FROM match_reports r WHERE r.schedule_id=s.id
      AND (r.main_report_started_at IS NOT NULL OR r.supervisor_review_started_at IS NOT NULL))) ORDER BY s.id FOR UPDATE`, [teamId, teamId, businessDate()]);
  for (const match of matches) await freeze(c, match, '球队名单变更前，保留已有当天及过往比赛和已开始报告的名单');
}
async function preserveRegistrationMatches(c, teamId) {
  const [matches] = await w.sql(c, 'SELECT * FROM match_schedules WHERE team_a_id=? OR team_b_id=? ORDER BY id FOR UPDATE', [teamId, teamId]);
  for (const match of matches) {
    const current = await selection(c, match, teamId);
    if (!current.revision) await record(c, match, teamId, current.roster_batch_id, '球队报名撤销通过，保留已有赛程名单', null, 'preserved', current);
  }
}
async function read(c, schedule) {
  const items = [];
  for (const teamId of [schedule.team_a_id, schedule.team_b_id]) {
    const selected = await selection(c, schedule, teamId);
    const batch = selected.roster_batch_id ? (await w.sql(c, 'SELECT id,version_no,effective_from,approved_at,source_type FROM team_roster_batches WHERE id=?', [selected.roster_batch_id]))[0][0] : null;
    items.push({ ...selected, batch, players: selected.roster_batch_id ? await rosters.roster(selected.roster_batch_id, { connection: c }) : [] });
  }
  return items;
}
const token = (schedule, items, candidates) => r.digest([schedule.id, schedule.match_date, schedule.team_a_id, schedule.team_b_id,
  schedule.main_report_started_at,schedule.supervisor_review_started_at,schedule.main_revision,schedule.supervisor_revision,
  items.map(v => [v.team_id,v.roster_batch_id,v.revision,v.edit_mode]), candidates]);
async function detailIn(c, scheduleId, user) {
  if (user.role !== 'admin') throw rules.businessError('只有管理员可以调整比赛名单', 403);
  const [[schedule]] = await w.sql(c, `SELECT s.*,r.id AS report_id,r.main_report_started_at,r.supervisor_review_started_at,
    COALESCE(m.revision,0) AS main_revision,COALESCE(v.revision,0) AS supervisor_revision FROM match_schedules s
    JOIN match_reports r ON r.schedule_id=s.id
    LEFT JOIN report_section_states m ON m.report_id=r.id AND m.section='main'
    LEFT JOIN report_section_states v ON v.report_id=r.id AND v.section='supervisor' WHERE s.id=?`, [rules.id(scheduleId)]);
  if (!schedule) throw rules.businessError('赛程不存在', 404);
  const items = await read(c, schedule);
  const [candidates] = await w.sql(c, `SELECT id,team_id,version_no,effective_from,source_type,approved_at FROM team_roster_batches
    WHERE team_id IN (?,?) AND (effective_from IS NULL OR effective_from<=?)
    AND EXISTS (SELECT 1 FROM team_player p WHERE p.roster_batch_id=team_roster_batches.id)
    ORDER BY team_id,version_no DESC`, [schedule.team_a_id, schedule.team_b_id, businessDate()]);
  const started=Boolean(schedule.main_report_started_at||schedule.supervisor_review_started_at||schedule.main_revision||schedule.supervisor_revision);
  for(const item of items){
    item.edit_mode=null;
    if(schedule.match_date>businessDate())item.edit_block_reason='未来比赛按比赛日期自动读取有效名单，比赛当天起可由管理员指定。';
    else if(!started)item.edit_mode='select';
    else if(!item.players.length){
      const [[used]]=await c.execute(`SELECT EXISTS(SELECT 1 FROM match_cards WHERE report_id=? AND team_id=?)
        OR EXISTS(SELECT 1 FROM match_goals WHERE report_id=? AND player_team_id=?) AS has_records`,[schedule.report_id,item.team_id,schedule.report_id,item.team_id]);
      if(!used.has_records)item.edit_mode='fill_missing';
      else item.edit_block_reason='已有进球或红黄牌引用该队球员，不能补换名单。';
    }else item.edit_block_reason='报告已开始，保留本队已绑定的名单。';
    item.can_edit=Boolean(item.edit_mode);
  }
  const [events] = await w.sql(c, 'SELECT team_id,revision,operation,actor_admin_id,reason,before_snapshot,after_snapshot,created_at FROM match_roster_selection_events WHERE schedule_id=? ORDER BY id DESC LIMIT 100', [schedule.id]);
  return { schedule, items, candidates, events, review_token: token(schedule, items, candidates), can_edit: items.some(item=>item.can_edit) };
}
const detail = (id, user) => w.transaction(c => detailIn(c, id, user), { readCommitted: true });
async function change(id, user, body) {
  rules.onlyKeys(body, ['team_id','roster_batch_id','reason','review_token']);
  const teamId = rules.id(body.team_id), batchId = rules.id(body.roster_batch_id), reason = r.text(body.reason, '切换比赛名单理由', 500);
  return w.transaction(async c => {
    await w.actor(c, user);
    await w.sql(c, 'SELECT id FROM match_schedules WHERE id=? FOR UPDATE', [rules.id(id)]);
    const data = await detailIn(c, id, user);
    const before = data.items.find(v => v.team_id === teamId);
    if(!before)throw rules.businessError('只能选择本场球队的名单');
    if(!before.can_edit)throw rules.businessError(before.edit_block_reason,409);
    if (body.review_token !== data.review_token) throw rules.businessError('比赛、报告或名单版本已变化，请刷新核对', 409);
    if (!before || !data.candidates.some(v => v.team_id === teamId && v.id === batchId)) throw rules.businessError('只能选择本场球队已经生效的名单');
    if (before.roster_batch_id === batchId && before.revision) throw rules.businessError('本场已经使用该名单');
    await record(c, data.schedule, teamId, batchId, reason, user, 'admin_selected', before);
    return detailIn(c, id, user);
  }, { readCommitted: true });
}
async function resetForScheduleChange(c,before,after){
  if(before.team_a_id===after.team_a_id&&before.team_b_id===after.team_b_id&&before.match_date===after.match_date)return;
  const [saved]=await w.sql(c,'SELECT * FROM match_roster_selections WHERE schedule_id=?',[after.id]);
  for(const row of saved)await record(c,after,row.team_id,row.roster_batch_id,'赛程日期或球队已修改，解除名单选择并按新赛程重新解析',null,'schedule_reset',row);
  await c.execute('DELETE FROM match_roster_selections WHERE schedule_id=?',[after.id]);
}
module.exports = { resetForScheduleChange, selection, freeze, preserveTeamMatches, preserveRegistrationMatches, read, detail, change };
