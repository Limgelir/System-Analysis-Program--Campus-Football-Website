const {test} = require('node:test');
const assert = require('node:assert/strict');
const {requiredReason,checkRevision,sectionPrefix,filterSnapshot} = require('../utils/reportHistory');
test('退回与修订原因必须为非空且不超过500字的文本',()=>{
  assert.equal(requiredReason(' 修正事实错误 '),'修正事实错误');
  for(const value of [undefined,null,'','  ',123,{},[],true,'字'.repeat(501)]) assert.throws(()=>requiredReason(value));
  assert.equal(requiredReason('字'.repeat(500)).length,500);
});
test('报告并发修订号拒绝缺失、伪造、过期及宽松数字',()=>{
  checkRevision(0,0);checkRevision('15',15);
  for(const value of [undefined,null,'',true,{},[],1.2,-1,'1x',' 1','1.0','Infinity']) assert.throws(()=>checkRevision(value,1));
  assert.throws(()=>checkRevision(1,2),error=>error.code==='REPORT_REVISION_CONFLICT'&&error.statusCode===409);
  assert.throws(()=>sectionPrefix('main_report_status'));
});
test('历史前后快照只向普通裁判展示自己的裁判监督评分，不修改存储快照',()=>{
  const snapshot={section:'supervisor',data:{reviews:[{target_role:'main',score:8},{target_role:'assistant1',score:7}]}};
  assert.equal(filterSnapshot(snapshot,'main').data.reviews.length,1);
  assert.equal(filterSnapshot(snapshot,'fourth').data.reviews.length,0);
  assert.equal(filterSnapshot(snapshot,'admin').data.reviews.length,2);
  assert.equal(filterSnapshot(snapshot,'supervisor').data.reviews.length,2);
  assert.equal(snapshot.data.reviews.length,2);
  const dual={section:'supervisor',data:{reviews:[...snapshot.data.reviews,{target_role:'fourth',score:9}]}};
  assert.deepEqual(filterSnapshot(dual,['main','fourth']).data.reviews.map(r=>r.target_role),['main','fourth']);
});
