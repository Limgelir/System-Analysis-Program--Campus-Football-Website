import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { scheduleCsv } from '../src/utils/scheduleExport.js'

function picker(api) {
  const source = fs.readFileSync(new URL('../src/components/SearchableRefereeSelect.vue',import.meta.url),'utf8')
  const script=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .+$/gm,'').replace('export default','const component =')
  const component=vm.runInNewContext(script+'; component',{officialAPI:api,window:{setTimeout,clearTimeout,confirm:()=>true}})
  const emitted=[]
  const ctx={...component.data(),modelValue:'',seasonId:1,roleField:'main_referee_id',disabled:false,excludedIds:[],currentOption:null,$emit:(...args)=>emitted.push(args)}
  for(const [k,f] of Object.entries(component.methods)) ctx[k]=f.bind(ctx)
  for(const [k,f] of Object.entries(component.computed)) Object.defineProperty(ctx,k,{get:f.bind(ctx)})
  return {ctx,component,emitted}
}
const system={source_type:'system',referee_id:1,name_snapshot:'系统甲'}
const external={source_type:'external',external_referee_id:1,name_snapshot:'外部甲'}
test('搜索保留来源ID，排除相同人但不排除另一来源同号，旧ID兼容回显',()=>{
  const {ctx,emitted}=picker({})
  ctx.items=[system,external]; ctx.excludedIds=['1']
  assert.equal(ctx.availableItems.length,1)
  assert.equal(ctx.availableItems[0].source_type,'external')
  ctx.selectItem(external); assert.equal(emitted[0][1],'external:1')
  ctx.modelValue='external:1'; assert.equal(ctx.selectedDisplay.name,'外部甲')
  ctx.modelValue=1; assert.equal(ctx.selectedDisplay.name,'系统甲')
})
test('搜索迟到请求不能覆盖新条件；关闭、禁用及离开页面后响应失效',async()=>{
  for(const cancel of ['closeResults','disabled','beforeUnmount']) {
    let resolve
    const {ctx,component}=picker({candidates:()=>new Promise(r=>resolve=r)})
    const pending=ctx.loadPage(1)
    if(cancel==='disabled') component.watch.disabled.call(ctx,true)
    else if(cancel==='beforeUnmount') component.beforeUnmount.call(ctx)
    else ctx.closeResults()
    resolve({data:{items:[external],pagination:{page:1}}}); await pending
    assert.equal(ctx.items.length,0)
    assert.equal(ctx.loading,false)
  }
})
test('新增非系统同名需确认重试，裁判监督岗位也可新增',async()=>{
  const calls=[]
  const {ctx,emitted}=picker({create:async data=>{
    calls.push(data)
    if(!data.confirm_duplicate) throw {response:{data:{code:'DUPLICATE_NAME_CONFIRMATION_REQUIRED',message:'有同名'}}}
    return {data:{id:9,name:data.name,note:data.note}}
  }})
  ctx.newName='同名甲'; ctx.newNote='另一人'; await ctx.createExternal()
  assert.equal(calls.length,2); assert.equal(calls[1].confirm_duplicate,true)
  assert.equal(emitted[0][1],'external:9')
  ctx.roleField='supervisor_id'; await ctx.createExternal(); assert.equal(calls.length,4); assert.equal(emitted[1][1],'external:9')
})
test('选派API仅在同名冲突且用户明确确认后重试，不吞掉其他错误',async()=>{
  const source=fs.readFileSync(new URL('../src/api/index.js',import.meta.url),'utf8').replace(/^import .+$/gm,'').replaceAll('export ','')
  let confirmed=false, calls=[]
  const api={post:async (path,payload)=>{
    calls.push(payload)
    if(!payload.confirm_distinct_people) throw {response:{data:{code:'OFFICIAL_SAME_NAME_CONFIRMATION_REQUIRED',message:'同名'}}}
    return {ok:true}
  }}
  const ctx=vm.runInNewContext(source+'; ({scheduleAPI,buildSchedulePayload,normalizeScheduleRecord})',{api,window:{confirm:()=>confirmed}})
  for(const value of ['A1','a1','01','1','J1','决赛']){assert.equal(ctx.buildSchedulePayload({field_order:value}).field_order,value);assert.equal(ctx.normalizeScheduleRecord({field_order:value}).field_order,value)}
  const data={main_referee_id:'external:7',assistant1_id:'system:7'}
  const payload=ctx.buildSchedulePayload(data)
  assert.equal(payload.main_referee_id,'external:7'); assert.equal(payload.assistant1_id,'system:7')
  await assert.rejects(ctx.scheduleAPI.create(data)); assert.equal(calls.length,1)
  confirmed=true; await ctx.scheduleAPI.create(data); assert.equal(calls.length,3)
  assert.equal(calls[2].confirm_distinct_people,true)
  const record=ctx.normalizeScheduleRecord({officials:[external],main_referee_id_selection:'external:1'})
  assert.equal(record.officials[0].source_type,'external')
})
test('管理员代填只开放裁判员区，系统裁判员仍只读，提交后按钮锁定',()=>{
  const source=fs.readFileSync(new URL('../src/pages/RefereeReportDetail.vue',import.meta.url),'utf8')
  const script=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .+$/gm,'').replace('export default','const component =')
  const component=vm.runInNewContext(script+'; component',{console,ReportHistoryPanel:{},MatchDiscipline:{}})
  const ctx={...component.data(),$route:{name:'AdminScheduleReportDetail'},viewerPermissions:{can_proxy_main:true,can_edit_main:true,can_edit_supervisor:false},viewerRoleCode:'admin',report:{main_report_status:'draft'}}
  for(const [k,f] of Object.entries(component.computed)) if(typeof f==='function') Object.defineProperty(ctx,k,{get:f.bind(ctx)})
  assert.equal(ctx.isProxyMain,true); assert.equal(ctx.canEditMainSection,true); assert.equal(ctx.canEditSupervisorSection,false)
  ctx.report.main_report_status='submitted'; assert.equal(ctx.canEditMainSection,false)
  ctx.viewerPermissions={can_proxy_main:false,can_edit_main:false}; assert.equal(ctx.isAdminReadonly,true)
  assert.equal(ctx.backButtonText,'返回赛程详情')
  const own={isAdminPage:false,viewerPermissions:{can_read_all_reviews:false},viewerRoleCode:'main',viewerRoleCodes:['main','fourth'],form:{reviews:[{target_role:'main'},{target_role:'assistant1'},{target_role:'fourth'}]}}
  assert.deepEqual(component.computed.filteredReviews.call(own).map(r=>r.target_role),['main','fourth'])
})
test('CSV保留姓名快照来源和状态，并转义引号、换行及表格公式',()=>{
  const csv=scheduleCsv([{season_name:'测试赛季',officials:[{role:'main',source_type:'external',name_snapshot:'=HYPERLINK("bad")\n甲'}],report_main_status:'submitted'}])
  assert.ok(csv.startsWith('\ufeff'))
  assert.ok(csv.includes('非系统裁判'))
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")\n甲"'))
  assert.match(csv,/"已提交","未提交"$/)
})

test('导出请求使用全部当前筛选条件，不再只导出浏览器当前分页',async()=>{
  const source=fs.readFileSync(new URL('../src/pages/AdminSchedule.vue',import.meta.url),'utf8')
  const script=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .+$/gm,'').replace('export default','const component =')
  let calls=0,downloaded
  const component=vm.runInNewContext(script+'; component',{
    FourthOfficialSheetDialog:{},CompetitionOptions:{},AdminScheduleImport:{},VenueFields:{},AdminMatchSignups:{},SearchableRefereeSelect:{},ListPagination:{},
    scheduleAPI:{exportFiltered:async query=>{calls++;assert.equal(query.season_id,'5');assert.equal(query.page,'2');return 'full-csv'}},
    downloadBlob:(blob,name)=>{downloaded={blob,name}},exportError:async e=>e.message
  })
  const ctx={scheduleLoading:true,exporting:false,selectedSeason:{id:5},$route:{query:{season_id:'5',page:'2',report_status:'returned'}}}
  await component.methods.exportSchedules.call(ctx);assert.equal(calls,0)
  ctx.scheduleLoading=false;await component.methods.exportSchedules.call(ctx)
  assert.equal(calls,1);assert.deepEqual(downloaded,{blob:'full-csv',name:'赛程选派-5.csv'});assert.equal(ctx.exporting,false)
})
