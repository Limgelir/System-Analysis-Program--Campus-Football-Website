const {test}=require('node:test');const assert=require('node:assert/strict');
const q=require('../utils/listQuery');const {filters}=require('../utils/scheduleFilters');
test('分页严格校验、最大页长与筛选值，不宽松吞掉非法参数',()=>{
  assert.deepEqual(q.pagination({}),{page:1,pageSize:20});
  for(const v of ['0','-1','1abc','1e1',' 1','1.5',[],{},'9007199254740992']) assert.throws(()=>q.pagination({page:v}));
  assert.throws(()=>q.pagination({page_size:'101'}));assert.throws(()=>q.text(['a'],'搜索'));
  assert.throws(()=>filters({date_from:'2026-02-30'},1));assert.throws(()=>filters({date_from:'2026-12-01',date_to:'2026-01-01'},1));assert.throws(()=>filters({report_status:'unknown'},1));
});
test('导出公式注入中和、双引号转义、筛选通配符当作字面值',()=>{
  for(const value of ['=1+1','  =1+1','\t@sum(1)','-2','+cmd']) assert.ok(q.csvCell(value).startsWith('"\''));
  assert.equal(q.csvCell('姓名"测试'),'"姓名""测试"');assert.equal(q.like('a%_!'),'%a!%!_!!%');assert.throws(()=>q.guardExport(5001));
});
