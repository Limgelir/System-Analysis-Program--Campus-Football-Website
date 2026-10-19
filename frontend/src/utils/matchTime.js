export function displayMatchTime(value, endTime) {
  return value == null || value === '' ? '时间待定' : String(value).slice(0, 5) + (endTime ? '-' + String(endTime).slice(0, 5) : '')
}
export function displayMatchDate(value) {
  return value ? String(value).slice(0, 10) : '-'
}
export function matchTimeError(value, required = true) {
  if (!value) return required ? '请填写比赛时间（例如15:00或15:00-16:00）' : ''
  const parts = typeof value === 'string' ? value.split('-') : []
  return parts.length >= 1 && parts.length <= 2 && parts.every(part => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(part)) && (parts.length === 1 || parts[1] > parts[0]) ? '' : '比赛时间须为HH:mm或HH:mm-HH:mm，结束时间须晚于开始时间（不支持跨午夜）'
}
export function fieldOrderSortKey(value) { return String(value ?? '').replace(/\d+/g,part=>{const digits=part.replace(/^0+(?=\d)/,'');return `#${String(digits.length).padStart(2,'0')}:${digits}`}) }
const binaryCompare=(a,b)=>a<b?-1:a>b?1:0
// Dates are business-date strings; do not parse them in the browser's time zone.
export function compareMatchSchedule(a, b, descendingDate = false) {
  const date = displayMatchDate(a.match_date).localeCompare(displayMatchDate(b.match_date))
  if (date) return descendingDate ? -date : date
  const time = (a.match_time || '99:99').localeCompare(b.match_time || '99:99')
  return time || binaryCompare(fieldOrderSortKey(a.field_order),fieldOrderSortKey(b.field_order)) || binaryCompare(String(a.field_order??''),String(b.field_order??'')) || (a.id ?? a.schedule_id ?? 0) - (b.id ?? b.schedule_id ?? 0)
}
