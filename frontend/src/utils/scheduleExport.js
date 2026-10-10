import {venueText} from './matchSignup.js'
const roles = [['main','裁判员'],['assistant1','第一助理裁判员'],['assistant2','第二助理裁判员'],['fourth','第四官员'],['supervisor','裁判监督']]
// 包含来源与姓名快照；禁止表格软件把用户输入当作公式执行。
function cell(value) {
  let text = String(value ?? '')
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}
export function scheduleCsv(schedules) {
  const statusLabel = status => status === 'returned' ? '已退回' : status === 'submitted' ? '已提交' : '未提交'
  const header = ['赛季','赛事类型','场序','日期','开球时间', '比赛场地','主队','客队',...roles.flatMap(([,label]) => [label, label+'来源']), '裁判员报告','裁判监督报告']
  const rows = schedules.map(s => [s.season_name || s.season_code, s.match_type, s.field_order, s.match_date, s.match_time ?? '时间待定', venueText(s),
    s.team_a_name_snapshot || s.team_a_name, s.team_b_name_snapshot || s.team_b_name,
    ...roles.flatMap(([role]) => {
      if(role === 'supervisor' && s.supervisor_required === false) return ['无需裁判监督','']
      if(role === 'fourth' && s.fourth_required === false) return ['无需第四官员','']
      const a = s.officials?.find(item => item.role === role)
      return a ? [a.name_snapshot, a.source_type === 'external' ? '非系统裁判' : '系统裁判'] : ['未选派','']
    }), statusLabel(s.report?.main_report_status ?? s.report_main_status ?? s.main_report_status), s.supervisor_required === false ? '无需裁判监督报告' : statusLabel(s.report?.supervisor_review_status ?? s.report_supervisor_status ?? s.supervisor_review_status)])
  return '\ufeff' + [header,...rows].map(row => row.map(cell).join(',')).join('\r\n')
}
