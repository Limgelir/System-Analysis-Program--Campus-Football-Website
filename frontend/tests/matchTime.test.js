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
  for(const text of ['开球时间','00:00','时间待定','17:35']) assert.ok(csv.includes(text))
})
