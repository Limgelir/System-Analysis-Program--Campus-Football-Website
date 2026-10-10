// undefined means follow the active season; an explicit invalid ID must never
// silently fall back to the active season or an unfiltered query.
async function resolveSeasonScope(connection, seasonId) {
  let id;
  if (seasonId !== undefined) {
    if (!['string', 'number'].includes(typeof seasonId) ||
        !/^[1-9]\d*$/.test(String(seasonId)) || !Number.isSafeInteger(Number(seasonId))) {
      const error = new Error('赛季 ID 必须是正整数');
      error.statusCode = 400;
      throw error;
    }
    id = Number(seasonId);
  }

  const [seasons] = await connection.execute(
    'SELECT id, season_code, season_name, is_active FROM seasons ORDER BY start_date DESC, id DESC'
  );
  const currentSeason = seasons.find(season => Number(season.is_active) === 1) || null;
  const selectedSeason = id === undefined
    ? currentSeason
    : seasons.find(season => Number(season.id) === id);
  if (id !== undefined && !selectedSeason) {
    const error = new Error('赛季不存在');
    error.statusCode = 404;
    throw error;
  }
  return { seasons, current_season: currentSeason, selected_season: selectedSeason };
}

module.exports = { resolveSeasonScope };
