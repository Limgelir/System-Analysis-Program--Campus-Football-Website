export function teamGroups(teams) {
  return [
    { title: '我的队伍', include: t => t.is_member },
    { title: '我管理的队伍', include: t => t.can_manage },
    { title: '曾参加的队伍', include: t => t.was_member && !t.is_member }
  ].map(section => ({ title: section.title, groups: [...new Set(teams.map(t=>t.league_type))]
    .map(league => ({ league, items: teams.filter(t => t.league_type === league && section.include(t)) }))
    .filter(group => group.items.length) })).filter(section => section.groups.length)
}
