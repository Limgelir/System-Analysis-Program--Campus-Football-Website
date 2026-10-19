import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayMatchTime, displayMatchDate, compareMatchSchedule, matchTimeError } from '../src/utils/matchTime.js'
import { scheduleCsv } from '../src/utils/scheduleExport.js'
test('待定与午夜明确区分，日期显示不受时区转换影响', () => {
  assert.equal(displayMatchTime(null), '时间待定')
  assert.equal(displayMatchTime('00:00'), '00:00')
  assert.equal(displayMatchDate('2026-12-31'), '2026-12-31')
  assert.equal(matchTimeError('24:00').length > 0, true)
  assert.equal(matchTimeError('17:35'), '')
  assert.equal(matchTimeError(null, false), '')
  assert.ok(matchTimeError(null))
})
test('同日按时间排序且待定最后，CSV包含时间而不猜测旧比赛', () => {
  const items = [null,'18:00','00:00','17:35'].map((match_time, i) => ({id:i,match_date:'2026-12-31',match_time,field_order:i}))
  assert.deepEqual(items.toSorted(compareMatchSchedule).map(i=>i.match_time), ['00:00','17:35','18:00',null])
  const csv=scheduleCsv(items)
  for(const text of ['比赛时间','00:00','时间待定','17:35']) assert.ok(csv.includes(text))
})
test('比赛时间段完整展示，开赛排序仍使用开始时间', () => {
  assert.equal(displayMatchTime('15:00:00','16:00:00'), '15:00-16:00')
  assert.equal(matchTimeError('15:00-16:00'), '')
  for (const value of ['15:00-15:00','23:00-01:00','15:00-24:00','15:00-16:00-17:00']) assert.ok(matchTimeError(value))
  assert.ok(scheduleCsv([{match_time:'15:00',match_end_time:'16:00'}]).includes('15:00-16:00'))
})
