const {test}=require('node:test');
const assert=require('node:assert/strict');
const {availability,windowEnd,parseIntentions,checkScheduleRevision}=require('../utils/matchSignup');
const {validateVenue,VENUES}=require('../utils/matchVenue');
const row={is_active:1,ended_at:null,referee_active:1,registration_status:'approved',match_date:'2026-12-31',match_time:'17:35',signup_status:null};
test('自然日窗口跨月、跨年、闰年准确，开球当秒关闭所有操作',()=>{
  assert.equal(windowEnd('2026-12-29'),'2027-01-04');assert.equal(windowEnd('2028-02-25'),'2028-03-02');
  assert.equal(availability(row,'2026-12-31 17:34:59').can_apply,true);
  assert.equal(availability({...row,signup_status:'active'},'2026-12-31 17:35:00').can_change,false);
  assert.equal(availability({...row,match_time:'00:00'},'2026-12-31 00:00:00').can_apply,false);
  assert.equal(availability({...row,match_date:'2027-01-06'},'2026-12-31 00:00:00').can_apply,true);
  assert.equal(availability({...row,match_date:'2027-01-07'},'2026-12-31 00:00:00').can_apply,false);
});
test('改期移出窗口仍可修改有效旧报名，未报名/撤回者不能在窗口外重报',()=>{
  const shifted={...row,match_date:'2027-01-10',signup_status:'active'};
  assert.equal(availability(shifted,'2026-12-31 00:00:00').can_change,true);
  assert.equal(availability({...shifted,signup_status:'withdrawn'},'2026-12-31 00:00:00').can_change,false);
  for(const change of [{is_active:0},{ended_at:'2026-01-01'},{referee_active:0},{registration_status:'returned'},{match_time:null}]) assert.equal(availability({...shifted,...change},'2026-12-31 00:00:00').can_change,false);
});
test('意向白名单、去重、版本拒绝隐式转换',()=>{
  assert.deepEqual(parseIntentions(['supervisor','assistant']),['assistant','supervisor']);
  for(const value of [[],null,'main',['main','main'],['assistant1'],['main',{}]])assert.throws(()=>parseIntentions(value));
  for(const value of [null,undefined,'0',-1,1])assert.throws(()=>checkScheduleRevision(value,0),{code:'SCHEDULE_REVISION_CONFLICT'});
  checkScheduleRevision(0,0);
});
test('场地固定选项与其它地点校验，旧比赛可待定',()=>{
  for(const venue of VENUES.filter(v=>v!=='其它'))assert.deepEqual(validateVenue({venue}),{venue,venue_detail:null});
  assert.deepEqual(validateVenue({venue:'其它',venue_detail:'  体育馆东侧  '}),{venue:'其它',venue_detail:'体育馆东侧'});
  for(const data of [{},{venue:'随意'},{venue:'其它'},{venue:'其它',venue_detail:' '},{venue:'其它',venue_detail:'字'.repeat(121)},{venue:'铁笼',venue_detail:'另一处'}])assert.throws(()=>validateVenue(data));
  assert.deepEqual(validateVenue({}, {allowUnknown:true}),{venue:null,venue_detail:null});
});
