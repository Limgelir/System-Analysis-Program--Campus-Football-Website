const workflow = require('../utils/playerWorkflow');
const { businessError, id } = require('../utils/playerRules');
const { parseJson } = require('../utils/reportHistory');
const officials = require('../utils/officialAssignments');
const matchRosters = require('./matchRosterService');
const discipline = require('./disciplineService');
const document = require('../utils/fourthOfficialDocument');

async function loadData(c, scheduleId) {
  const [[schedule]] = await workflow.sql(c, `SELECT s.*,
    COALESCE(s.team_a_name_snapshot,a.team_name) AS team_a_name,
    COALESCE(s.team_b_name_snapshot,b.team_name) AS team_b_name,
    COALESCE(s.main_referee_name_snapshot,m.name) AS main_referee_name,
    COALESCE(s.assistant1_name_snapshot,r1.name) AS assistant1_name,
    COALESCE(s.assistant2_name_snapshot,r2.name) AS assistant2_name,
    COALESCE(s.fourth_official_name_snapshot,f.name) AS fourth_official_name,
    COALESCE(s.supervisor_name_snapshot,v.name) AS supervisor_name
    FROM match_schedules s JOIN team a ON a.id=s.team_a_id JOIN team b ON b.id=s.team_b_id
    LEFT JOIN referee m ON m.id=s.main_referee_id LEFT JOIN referee r1 ON r1.id=s.assistant1_id
    LEFT JOIN referee r2 ON r2.id=s.assistant2_id LEFT JOIN referee f ON f.id=s.fourth_official_id
    LEFT JOIN referee v ON v.id=s.supervisor_id WHERE s.id=?`, [id(scheduleId)]);
  if (!schedule) throw businessError('赛程不存在', 404);
  await officials.hydrate(c, [schedule]);
  const rosters = await matchRosters.read(c, schedule);
  const teams = [];
  for (const [i, selected] of rosters.entries()) {
    const [[team]] = await c.execute('SELECT shirt_color,shorts_color,socks_color FROM team WHERE id=?', [selected.team_id]);
    const [[batch]] = selected.roster_batch_id ? await c.execute('SELECT metadata_snapshot FROM team_roster_batches WHERE id=?', [selected.roster_batch_id]) : [[]];
    const snapshot = parseJson(batch?.metadata_snapshot) || {};
    teams.push({ name: schedule[i ? 'team_b_name' : 'team_a_name'], players: selected.players,
      ...Object.fromEntries(['shirt_color', 'shorts_color', 'socks_color'].map(field => [field, Object.hasOwn(snapshot, field) ? snapshot[field] : team[field]])) });
  }
  const suspensionInfo = await discipline.forSheet(schedule.id, c);
  if (suspensionInfo.needs_review) throw businessError('本场停赛记录存在待核对项，请先在赛事停赛管理中核对后再生成四官单', 409);
  return { schedule, teams, suspensions: suspensionInfo.suspensions };
}

async function generate(scheduleId, template) {
  document.templateOptions(template);
  // One consistent read, with no roster freeze, report creation, or discipline write.
  const data = await workflow.transaction(c => loadData(c, scheduleId));
  return document.generateDocument(data, template);
}
module.exports = { generate, loadData };
