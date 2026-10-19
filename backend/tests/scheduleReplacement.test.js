const test=require('node:test'),assert=require('node:assert/strict');
const {assertReplaceable}=require('../services/scheduleReplacementService');
test('替换严格使用开始时间：前一秒允许，开始时刻拒绝，结束时间不延长窗口',()=>{
  const old={match_date:'2030-01-01',match_time:'15:00',match_end_time:'16:00'},next={...old,match_time:'17:00'};
  assert.doesNotThrow(()=>assertReplaceable(old,next,'2030-01-01 14:59:59'));
  assert.throws(()=>assertReplaceable(old,next,'2030-01-01 15:00:00'),{code:'SCHEDULE_REPLACEMENT_CLOSED'});
  assert.throws(()=>assertReplaceable(next,old,'2030-01-01 15:00:00'),{code:'SCHEDULE_REPLACEMENT_CLOSED'});
  assert.throws(()=>assertReplaceable({...old,main_report_started_at:'2030-01-01'},next,'2030-01-01 14:00:00'),{code:'SCHEDULE_CORE_LOCKED'});
});
