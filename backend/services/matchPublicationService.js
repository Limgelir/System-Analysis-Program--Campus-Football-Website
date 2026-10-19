const { parseJson } = require('../utils/reportHistory');
const w = require('../utils/playerWorkflow');

// 只保存公开比赛字段。永久身份由历史名单行取得，绝不按学号或姓名重新匹配。
async function publish(c, reportId, historyRow) {
  const snapshot = parseJson(historyRow.after_snapshot), data = snapshot.data;
  const goals = [];
  for (const g of data.goals || []) {
    const [[p]] = await c.execute('SELECT player_account_id,import_person_id FROM team_player WHERE id=?', [g.team_player_id]);
    goals.push({ player_id: p?.player_account_id || null, import_person_id:p?.import_person_id||null, team_id: g.player_team_id, credited_team_id: g.credited_team_id,
      player_name: g.player_name, jersey_number: g.player_jersey_number, goal_type: g.goal_type, minute_label: g.minute_label });
  }
  const result = { home_score: data.home_score, away_score: data.away_score,
    home_penalty_score: data.home_penalty_score, away_penalty_score: data.away_penalty_score, goals };
  // 旧普通比赛的公开快照结构保持兼容。
  if (data.forfeit_side && data.forfeit_side !== 'none') result.forfeit_side = data.forfeit_side;
  await c.execute(`INSERT INTO match_publications (report_id,source_history_id,version_no,result_snapshot,published_at)
    VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE source_history_id=VALUES(source_history_id),version_no=VALUES(version_no),result_snapshot=VALUES(result_snapshot),published_at=VALUES(published_at)`,
  [reportId,historyRow.id,historyRow.version_no,JSON.stringify(result),w.chinaSql()]);
}
async function afterWrite(c, reportId, operation, adminAction) {
  if (operation !== 'submit_main' && !(operation === 'revise' && adminAction === 'revise')) return;
  const [[row]] = await c.execute("SELECT * FROM report_section_history WHERE report_id=? AND section='main' ORDER BY revision DESC LIMIT 1",[reportId]);
  await publish(c,reportId,row);
  await require('./disciplineService').afterReport(c,reportId);
}
module.exports={publish,afterWrite};
