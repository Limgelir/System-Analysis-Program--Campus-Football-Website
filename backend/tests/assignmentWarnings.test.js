const test = require('node:test');
const assert = require('node:assert/strict');
const { overlaps, warnings } = require('../services/assignmentWarningService');
const slot = (match_time,match_end_time=null)=>({match_time,match_end_time});
test('完整区间相交才提醒，包含关系也重合；首尾相接、待定时间不重合',()=>{
  assert.equal(overlaps(slot('15:00','17:00'),slot('16:00','18:00')),true);
  assert.equal(overlaps(slot('15:00:00','17:00:00'),slot('15:30','16:00')),true);
  assert.equal(overlaps(slot('15:00','17:00'),slot('17:00','18:00')),false);
  assert.equal(overlaps(slot(null),slot(null)),false);
});
test('任一比赛缺结束时间，仅同一开球时刻提醒，不推算时长',()=>{
  assert.equal(overlaps(slot('15:00'),slot('15:00','17:00')),true);
  assert.equal(overlaps(slot('15:00'),slot('16:00')),false);
  assert.equal(overlaps(slot('15:00','17:00'),slot('16:00')),false);
});
test('同一人兼任只查一次，跨来源同编号分开，逐场逐岗位提示',async()=>{
  const c={execute:async(sql,params)=>{
    assert.deepEqual(params,['2026-10-18',1,'system:2','external:2']);
    assert.match(sql,/s\.id<>\?/);
    return [[{...slot('15:30','17:30'),schedule_id:3,source_type:'system',referee_id:2,name_snapshot:'甲',role:'supervisor',match_type:'足协杯',field_order:'A2',team_a_name_snapshot:'主队',team_b_name_snapshot:'客队'},
      {...slot('17:00','18:00'),schedule_id:4,role:'main'}]];
  }};
  const result=await warnings(c,{...slot('15:00','17:00'),id:1,match_date:'2026-10-18'},
    {main_referee_id:'system:2',fourth_official_id:'system:2',supervisor_id:'external:2'});
  assert.equal(result.length,1);assert.match(result[0].message,/甲裁判员同时已经在.*A2.*担任裁判监督/);
});
