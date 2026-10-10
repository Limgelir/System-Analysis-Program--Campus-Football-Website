const test = require('node:test');
const assert = require('node:assert/strict');
const {parseSelection,prepare} = require('../utils/officialAssignments');
const {buildViewerContext} = require('../utils/reportAccess');
test('选派来源严格区分系统账号与非系统编号，支持非系统裁判监督',()=>{
  assert.deepEqual(parseSelection(12,'main'),{source_type:'system',id:12,key:'system:12'});
  assert.equal(parseSelection('external:12','fourth').source_type,'external');
  for(const v of [-1,0,1.5,'1x','external:0','external:1x',true,{},[],NaN]) assert.throws(()=>parseSelection(v,'main'));
  assert.equal(parseSelection('external:12','supervisor').source_type,'external');
});
test('管理员对非系统裁判员获得对应区代填权限，不获得系统裁判监督代填权限',()=>{
  for(const source of ['system','external']) {
    const schedule={main_referee_id:source==='system'?7:null,officials:[{role:'main',source_type:source,referee_id:source==='system'?7:null,external_referee_id:source==='external'?7:null}]};
    const p=buildViewerContext(schedule,{id:7,role:'admin'}).viewer_permissions;
    assert.equal(p.can_proxy_main,source==='external'); assert.equal(p.can_edit_supervisor,false);
    if(source==='external') assert.equal(buildViewerContext(schedule,{id:7,role:'referee'}).viewer_permissions.can_view,false);
  }
});
test('报告开始后先拒绝选派变更，不再查询新候选人资格',async()=>{
  const db={execute(){throw Error('不应查询新候选人')}};
  await assert.rejects(prepare(db,1,{main_report_started_at:new Date(),officials:[]},{main_referee_id:'external:99'}),/锁定/);
});
test('系统及非系统裁判员可兼任第四官员且无需同名确认，助理岗位仍互斥',async()=>{
  for(const source of ['system','external']) {
    const db={execute:async(_sql,[id])=>[[{id,name:'姓名'+id,name_snapshot:'姓名'+id}]]};
    const data={main_referee_id:source+':1',fourth_official_id:source+':1'};
    const result=await prepare(db,1,{},data);
    assert.deepEqual(result.next.map(a=>a.role),['main','fourth']);
    for(const field of ['assistant1_id','assistant2_id']) await assert.rejects(prepare(db,1,{},{...data,[field]:source+':1'}),{code:'REFEREE_DUPLICATE_ASSIGNMENT'});
  }
});
