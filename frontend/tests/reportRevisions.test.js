import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {scheduleCsv} from '../src/utils/scheduleExport.js'
function componentFile(file,globals={}) {
  const source=fs.readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8')
  const script=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .+$/gm,'').replace('export default','const component =')
  return vm.runInNewContext(script+'; component',{console,ReportHistoryPanel:{},MatchDiscipline:{},ReportSnapshot:{},alert:()=>{},window:{confirm:()=>true},...globals})
}
function report(api={}) {
  const component=componentFile('pages/RefereeReportDetail.vue',{reportAPI:api})
  const ctx={...component.data(),$route:{name:'AdminScheduleReportDetail'},schedule:{id:7,officials:[{role:'main',source_type:'system'},{role:'supervisor',source_type:'system'}]},report:{main_report_status:'submitted',supervisor_review_status:'submitted'},viewerPermissions:{can_admin_revise:true,can_return_main:true,can_return_supervisor:true},sections:{main:{revision:5,version_no:1},supervisor:{revision:3,version_no:1}}}
  for(const [name,fn] of Object.entries(component.methods))ctx[name]=fn.bind(ctx)
  for(const [name,fn] of Object.entries(component.computed))Object.defineProperty(ctx,name,{get:fn.bind(ctx)})
  return ctx
}
test('管理员修订明确进入分区；内容、裁判监督和图片不能同时被编辑',()=>{
  const ctx=report()
  assert.equal(ctx.canEditMainSection,false);assert.equal(ctx.canEditSupervisorSection,false);assert.equal(ctx.canEditImage,false)
  ctx.revisionSection='main';assert.equal(ctx.canEditMainSection,true);assert.equal(ctx.canEditImage,false);assert.equal(ctx.canEditSupervisorSection,false)
  ctx.revisionSection='supervisor';assert.equal(ctx.canEditSupervisorSection,true);assert.equal(ctx.canEditMainSection,false)
  ctx.revisionSection='image';assert.equal(ctx.canEditImage,true);assert.equal(ctx.canEditMainSection,false)
  ctx.$route={name:'RefereeReportDetail'};assert.equal(ctx.canEditImage,false)
})
test('退回状态优先于保留的原提交时间，普通裁判只可编辑自己的已退回分区',()=>{
  const ctx=report();ctx.$route={name:'RefereeReportDetail'};ctx.viewerRoleCode='main';ctx.viewerPermissions={can_edit_main:true};ctx.report.main_report_status='returned'
  assert.equal(ctx.canEditMainSection,true);assert.equal(ctx.canEditSupervisorSection,false)
  assert.equal(ctx.formatReportProgress('returned','2026-01-01','2026-01-02'),'已退回，待重填')
  ctx.report.main_report_status='submitted';assert.equal(ctx.canEditMainSection,false)
  assert.match(scheduleCsv([{report_main_status:'returned',report_supervisor_status:'submitted'}]),/"已退回","已提交"$/)
})
test('无原因不调用管理员接口；版本冲突保留本地编辑且不自动重试',async()=>{
  let calls=0,reloads=0
  const ctx=report({reviseSection:async()=>{calls++;throw {response:{status:409,data:{message:'版本已更新，请刷新'}}}}})
  ctx.revisionSection='main';ctx.loadReport=async()=>{reloads++}
  await ctx.saveAdminRevision();assert.equal(calls,0)
  ctx.revisionReason='核实跑动';ctx.form.stats.main.running_distance_m=1234
  await ctx.saveAdminRevision();assert.equal(calls,1);assert.equal(reloads,0);assert.equal(ctx.revisionSection,'main');assert.equal(ctx.form.stats.main.running_distance_m,1234)
  assert.match(ctx.revisionError,/版本已更新/);assert.equal(ctx.saving,false)
})
test('保存修订走独立接口并发送当前修订号；成功退出修订模式',async()=>{
  let received,reloaded=0
  const ctx=report({reviseSection:async(...args)=>{received=args}})
  ctx.revisionSection='supervisor';ctx.revisionReason=' 修正评价 ';ctx.form.reviews=[{target_role:'main',score:8}];ctx.loadReport=async()=>{reloaded++}
  await ctx.saveAdminRevision()
  assert.equal(received[0],7);assert.equal(received[1],'supervisor');assert.equal(received[3],'修正评价');assert.equal(received[4],3)
  assert.equal(ctx.revisionSection,null);assert.equal(reloaded,1)
})

test('进入修订与退回使用页内二次确认，取消确认不改变报告',async()=>{
  let returned=0,loaded=0
  const ctx=report({returnSection:async()=>{returned++}});ctx.loadReport=async()=>{loaded++};ctx.revisionReason='核对记录'
  await ctx.beginAdminRevision();assert.equal(ctx.revisionConfirmation,'begin');assert.equal(ctx.writeBusy,true);assert.equal(loaded,0)
  ctx.revisionConfirmation=null;assert.equal(ctx.revisionSection,null)
  await ctx.returnSelectedSection();assert.equal(returned,0);assert.equal(ctx.revisionConfirmation,'return')
  await ctx.confirmAdminAction();assert.equal(returned,1);assert.equal(loaded,1);assert.equal(ctx.revisionConfirmation,null)
  ctx.schedule.supervisor_name='测试裁判监督';assert.match(ctx.getRefereeNameForRole('supervisor'),/测试裁判监督（裁判监督 · 系统裁判）/)
})
test('裁判提交先保存，使用保存返回的新版本提交，避免自冲突',async()=>{
  const calls=[]
  const ctx=report({saveMainReport:async(id,data,rev)=>{calls.push(['save',rev]);return {data:{sections:{main:{revision:6,version_no:1}}}}},submitMainReport:async(id,rev)=>calls.push(['submit',rev])})
  ctx.$route={name:'RefereeReportDetail'};ctx.viewerRoleCode='main';ctx.viewerPermissions={can_edit_main:true};ctx.report.main_report_status='returned';ctx.loadReport=async()=>{}
  await ctx.submitMainReport();assert.deepEqual(calls,[['save',5],['submit',6]])
})

test('图片移除须二次确认，独立原因与版本传递正确且成功提示不阻塞刷新',async()=>{
  let received,reloads=0
  const ctx=report({removeRevisionImage:async(...args)=>{received=args}})
  ctx.revisionSection='image';ctx.revisionReason='撤下扫描件';ctx.report.fourth_official_image_path='/uploads/reports/test.png';ctx.$refs={};ctx.loadReport=async()=>{reloads++}
  await ctx.removeFourthOfficialImage();assert.equal(received,undefined);assert.equal(ctx.imageRemovalPending,true);assert.equal(ctx.writeBusy,true)
  ctx.imageRemovalPending=false;assert.equal(received,undefined)
  await ctx.removeFourthOfficialImage(true);assert.deepEqual(received,[7,'撤下扫描件',5]);assert.equal(reloads,1);assert.equal(ctx.imageRemovalPending,false);assert.equal(ctx.revisionSection,null);assert.match(ctx.reportNotice,/历史图片保留/)
})
test('报告API每种写操作传递If-Match，删除图片也携带独立原因',async()=>{
  const source=fs.readFileSync(new URL('../src/api/index.js',import.meta.url),'utf8').replace(/^import .+$/gm,'').replaceAll('export ','')
  const calls=[],api={post:(...args)=>calls.push(args),delete:(...args)=>calls.push(args)}
  const client=vm.runInNewContext(source+'; reportAPI',{api})
  client.saveMainReport(7,{},0);client.submitSupervisorReport(7,3);client.reviseSection(7,'main',{},'原因',4);client.removeRevisionImage(7,'撤销',5)
  assert.equal(calls[0][2].headers['If-Match'],'0');assert.equal(calls[1][2].headers['If-Match'],'3');assert.equal(calls[2][2].headers['If-Match'],'4');assert.equal(calls[3][1].headers['If-Match'],'5');assert.equal(calls[3][1].data.reason,'撤销')
})
test('历史切换分区时丢弃迟到详情且不会永久禁用查看按钮',async()=>{
  let resolve
  const component=componentFile('components/ReportHistoryPanel.vue',{reportAPI:{getHistoryDetail:()=>new Promise(r=>resolve=r),getHistory:async()=>({data:{items:[],page:1,total:0}})},URL:{revokeObjectURL:()=>{}}})
  const ctx={...component.data(),scheduleId:7};for(const [name,fn]of Object.entries(component.methods))ctx[name]=fn.bind(ctx)
  const pending=ctx.viewEntry(1);assert.equal(ctx.detailLoading,true)
  await ctx.openHistory('supervisor');resolve({data:{id:1}});await pending
  assert.equal(ctx.detail,null);assert.equal(ctx.detailLoading,false);assert.equal(ctx.section,'supervisor')
})

test('裁判监督兼任时可编辑裁判监督区并看到所有岗位评分；无裁判监督隐藏编辑权限',()=>{
 const ctx=report();ctx.$route={name:'RefereeReportDetail'};ctx.viewerRoleCode='main';ctx.viewerPermissions={can_edit_main:true,can_edit_supervisor:true,can_read_all_reviews:true};ctx.report={main_report_status:'draft',supervisor_review_status:'draft'};ctx.form.reviews=[{target_role:'main'},{target_role:'assistant1'},{target_role:'assistant2'},{target_role:'fourth'}];
 assert.equal(ctx.canEditMainSection,true);assert.equal(ctx.canEditSupervisorSection,true);assert.equal(ctx.filteredReviews.length,4);
 ctx.schedule.supervisor_required=false;assert.equal(ctx.canEditSupervisorSection,false);assert.equal(ctx.supervisorProgressLabel,'无需裁判监督报告');
});
test('管理员代填非系统裁判监督使用专用接口，提交后锁定普通编辑',async()=>{
 let called=0;const ctx=report({saveProxySupervisorReport:async(id,body)=>{assert.equal(id,7);assert.equal(body.reviews.length,1);called++}});
 ctx.viewerPermissions={can_edit_supervisor:true,can_proxy_supervisor:true};ctx.report.supervisor_review_status='draft';ctx.form.reviews=[{target_role:'main',score:8}];ctx.loadReport=async()=>{};
 assert.equal(ctx.canEditSupervisorSection,true);assert.equal(ctx.isAdminReadonly,false);await ctx.saveSupervisorReport();assert.equal(called,1);
 ctx.report.supervisor_review_status='submitted';assert.equal(ctx.canEditSupervisorSection,false);
});
