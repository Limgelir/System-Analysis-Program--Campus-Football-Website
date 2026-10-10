// 第1批的数据读取基础。后续正式报名/导入才创建带身份及生效日的名单。
const pool = require('../db');
const { businessDate } = require('../utils/competitionTime');
const rules = require('../utils/playerRules');

async function effectiveBatch(teamId, date = businessDate(), c = pool) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T00:00:00Z`).getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date) throw rules.businessError('比赛日期不正确');
  const [[batch]] = await c.execute(`SELECT id,team_id,season_id,version_no,effective_from,source_type,uploaded_at,approved_at,metadata_snapshot FROM team_roster_batches
    WHERE team_id=? AND (effective_from<=? OR effective_from IS NULL)
    ORDER BY effective_from DESC,version_no DESC,id DESC LIMIT 1`, [teamId,date]);
  return batch || null;
}
async function roster(batchId, { currentProfile = false, rawTags = false, connection = pool } = {}) {
  const [rows] = await connection.execute(`SELECT p.id,p.roster_batch_id,p.team_id,p.player_account_id,p.import_person_id,p.jersey_number,
    ${currentProfile ? 'COALESCE(a.name,p.player_name)' : 'p.player_name'} AS player_name,
    ${currentProfile ? 'a.college' : "JSON_UNQUOTE(JSON_EXTRACT(p.profile_snapshot,'$.college'))"} AS college,
    p.is_captain,p.is_goalkeeper,p.is_foreign,
    ${rawTags ? 'p.is_sports_training' : 'IF(COALESCE(c.enable_sports_training,1),p.is_sports_training,0)'} AS is_sports_training,
    ${rawTags ? 'p.is_football_specialty' : 'IF(COALESCE(c.enable_football_specialty,0),p.is_football_specialty,0)'} AS is_football_specialty,p.remark,p.created_at
    FROM team_player p LEFT JOIN player_accounts a ON a.id=p.player_account_id JOIN team t ON t.id=p.team_id LEFT JOIN season_competitions c ON c.season_id=t.season_id AND c.league_type=t.league_type WHERE p.roster_batch_id=? ORDER BY p.id`,[batchId]);
  return rows;
}
module.exports={effectiveBatch,roster};
