// Keep the explicitly viewed season across list -> detail -> report -> list.
// Direct historical detail links fall back to the match's own season.
export function scheduleReturnQuery(query = {}, seasonId) {
  const result = {}
  for (const key of ['season_id', 'match_type', 'date_from', 'date_to', 'source_type', 'report_status', 'page', 'page_size']) {
    const value = query[key]
    if (typeof value === 'string' && value) result[key] = value
  }
  if (query.season_id === undefined && seasonId) result.season_id = String(seasonId)
  return result
}
