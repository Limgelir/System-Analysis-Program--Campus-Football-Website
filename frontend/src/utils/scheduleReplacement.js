import { displayMatchTime } from './matchTime.js'
import { venueText } from './matchSignup.js'

export function replacementDescription(row) {
  const old = row.replacement
  return `场序 ${old.field_order}\n原：${old.match_date} ${displayMatchTime(old.match_time, old.match_end_time)} · ${old.team_a_name_snapshot} vs ${old.team_b_name_snapshot} · ${venueText(old)}\n新：${row.match_date} ${displayMatchTime(row.match_time, row.match_end_time)} · ${row.team_a_name} vs ${row.team_b_name} · ${venueText(row)}`
}
export const replacementNotice = '仅更新日期、比赛时间、对阵和场地；保留原裁判安排设置、已选派裁判、报名和全部选派／报名历史，无需重新报名。'
