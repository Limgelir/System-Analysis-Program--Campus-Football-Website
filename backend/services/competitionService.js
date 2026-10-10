const pool = require('../db');
const { LIMIT_FIELDS } = require('../utils/teamAutoReview');
const { resolveSeasonScope } = require('../utils/seasonScope');
const { competitionName, RULE_FIELDS, PRESETS } = require('../utils/competitionRules');
const { businessError } = require('../utils/playerRules');
// Before manual competition creation, settings reads saved three disabled empty
// rows. Those placeholders are not added competitions. Keep configured entries
// and anything referenced by business history, including disabled competitions.
// Alias c is fixed so every reader and write validator uses the same definition.
const ADDED_COMPETITION_SQL = `(
  c.is_enabled=1 OR c.registration_opens_at IS NOT NULL OR c.registration_closes_at IS NOT NULL
  OR NULLIF(TRIM(c.rules_text),'') IS NOT NULL
  OR ${LIMIT_FIELDS.map(k=>`c.${k} IS NOT NULL`).join(' OR ')}
  OR ${RULE_FIELDS.map(k=>`c.${k} IS NOT NULL`).join(' OR ')}
  OR EXISTS(SELECT 1 FROM team t WHERE t.season_id=c.season_id AND t.league_type=c.league_type)
  OR EXISTS(SELECT 1 FROM match_schedules m WHERE m.season_id=c.season_id AND m.match_type=c.league_type)
  OR EXISTS(SELECT 1 FROM team_applications a WHERE a.competition_id=c.id)
  OR EXISTS(SELECT 1 FROM roster_change_windows w WHERE w.competition_id=c.id)
  OR EXISTS(SELECT 1 FROM competition_discipline_events e WHERE e.competition_id=c.id)
)`;
async function list(seasonId, c = pool) {
  const scope = await resolveSeasonScope(c, seasonId);
  if (!scope.selected_season) return { ...scope, competitions: [], presets: PRESETS };
  const [competitions] = await c.execute(`SELECT c.id,c.season_id,c.league_type,c.is_enabled,c.yellow_threshold,c.yellow_suspension,c.red_threshold,c.red_suspension FROM season_competitions c WHERE c.season_id=? AND ${ADDED_COMPETITION_SQL} ORDER BY c.id`,[scope.selected_season.id]);
  return { ...scope, competitions, presets: PRESETS };
}
async function requireCompetition(c, seasonId, name) {
  const [[row]] = await c.execute(`SELECT c.* FROM season_competitions c WHERE c.season_id=? AND c.league_type=? AND ${ADDED_COMPETITION_SQL}`,[seasonId,competitionName(name)]);
  if (!row) throw businessError('请先在赛季管理中添加该赛事并设置停赛规则',400,'COMPETITION_REQUIRED');
  return row;
}
const configured = row => row && RULE_FIELDS.every(k => Number.isInteger(row[k]) && row[k] > 0);
module.exports = { list, requireCompetition, configured, ADDED_COMPETITION_SQL };
