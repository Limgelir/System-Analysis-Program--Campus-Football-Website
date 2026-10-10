const test=require('node:test');
const assert=require('node:assert/strict');
const {kickoffTime,kickoffReached}=require('../utils/scheduleDeletion');

test('删除截止按中国标准时间，开球前一秒与恰好开球严格区分',()=>{
  const match={match_date:'2026-09-24',match_time:'17:35:00'};
  assert.equal(kickoffTime(match),'2026-09-24 17:35:00');
  assert.equal(kickoffReached(match,'2026-09-24 17:34:59'),false);
  assert.equal(kickoffReached(match,'2026-09-24 17:35:00'),true);
  assert.equal(kickoffReached(match,'2026-09-24 17:35:01'),true);
});

test('报名、选派或报告已提交不改变开球前可删；时间待定一律禁止',()=>{
  const {decision}=require('../utils/scheduleDeletion');
  const schedule={id:1,match_date:'2026-09-24',match_time:'17:35',main_referee_id:2,signup_count:3,report_main_status:'submitted'};
  assert.equal(decision(schedule,'2026-09-24 17:34:59').can_delete,true);
  assert.equal(decision(schedule,'2026-09-24 17:35:00').reason_code,'SCHEDULE_KICKOFF_REACHED');
  assert.equal(decision({...schedule,match_time:null},'2026-09-23 12:00:00').reason_code,'SCHEDULE_KICKOFF_UNSET');
  assert.equal(decision(schedule).can_delete,false);
});

test('跨日和午夜开球不会被浏览器或进程时区改变',()=>{
  const match={match_date:'2026-09-25',match_time:'00:00'};
  assert.equal(kickoffReached(match,'2026-09-24 23:59:59'),false);
  assert.equal(kickoffReached(match,'2026-09-25 00:00:00'),true);
  assert.equal(kickoffReached(match,'2026-09-26 00:00:00'),true);
  assert.equal(kickoffReached({match_date:'2026-09-25',match_time:null},'2026-09-24 12:00:00'),null);
});
