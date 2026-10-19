import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {exportError} from '../src/utils/download.js'
function component(name,deps){
  const script=readFileSync(new URL(`../src/pages/${name}.vue`,import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'').replace('export default','return')
  const options=new Function(...Object.keys(deps),script)(...Object.values(deps))
  const vm={...options.data(),$route:{query:{}},$router:{replace:q=>q}}
  for(const[name,fn]of Object.entries(options.methods))vm[name]=fn.bind(vm)
  return {vm,options}
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
test('账号快速翻页迟到的成功/失败不覆盖新页，离开页面销毁临时密码',async()=>{
  const a=deferred(),b=deferred(),c=deferred();const pending=[a,b,c]
  const {vm,options}=component('AdminRefereeManagement',{adminAPI:{getAllReferees:()=>pending.shift().promise},ListPagination:{},AdminTeamImport:{},REFEREE_GRADES:[],downloadBlob(){},exportError})
  const first=vm.loadReferees(),second=vm.loadReferees();b.resolve({data:[{id:2}],meta:{pagination:{page:2,total:2},summary:{total_accounts:2}}});await second;a.reject(new Error('旧请求失败'));await first
  assert.equal(vm.referees[0].id,2);assert.equal(vm.error,'');assert.equal(vm.loading,false)
  const third=vm.loadReferees();vm.temporaryPassword='secret';options.beforeUnmount.call(vm);c.resolve({data:[],meta:{}});await third
  assert.equal(vm.temporaryPassword,'');assert.equal(vm.referees[0].id,2)
})
test('审核详情迟到失败不关闭新详情或提前结束加载',async()=>{
  const a=deferred(),b=deferred(),pending=[a,b]
  const {vm}=component('AdminSeasonRegistrationManagement',{seasonRegistrationAPI:{getAdminDetail:()=>pending.shift().promise},ListPagination:{},AdminTeamImport:{},REFEREE_GRADES:[],downloadBlob(){},exportError})
  const first=vm.openDetail(1),second=vm.openDetail(2);a.reject(new Error('旧详情失败'));await first
  assert.equal(vm.detailVisible,true);assert.equal(vm.detailLoading,true);assert.equal(vm.pageError,'')
  b.resolve({data:{id:2}});await second;assert.equal(vm.detail.id,2);assert.equal(vm.detailLoading,false)
})
test('队伍切换不能被旧名单覆盖，当前批次不重复列入历史',async()=>{
  const a=deferred(),b=deferred(),c=deferred(),d=deferred(),rosters=[a,b],batches=[c,d]
  const {vm,options}=component('AdminTeamManagement',{teamAPI:{getCurrentRoster:()=>rosters.shift().promise,getRosterBatches:()=>batches.shift().promise},seasonAPI:{},ListPagination:{},AdminTeamImport:{},AdminTeamEditor:{},confirmDraftLeave:()=>true})
  const first=vm.loadSelectedTeamDetails(1),second=vm.loadSelectedTeamDetails(2)
  b.resolve({data:{roster_batch:{id:22}}});d.resolve({data:{batches:[{id:22},{id:21}]}});await second
  a.resolve({data:{roster_batch:{id:11}}});c.resolve({data:{batches:[{id:11}]}});await first
  assert.equal(vm.currentRoster.roster_batch.id,22);assert.deepEqual(options.computed.historyBatches.call(vm),[{id:21}]);assert.equal(vm.selectedBatchDetail,null)
})
test('导出失败读取 Blob 业务提示，不下载错误 JSON 作为表格',async()=>{
  assert.equal(await exportError({response:{data:new Blob([JSON.stringify({message:'请缩小筛选范围'})])}}),'请缩小筛选范围')
  assert.equal(await exportError({response:{data:new Blob(['bad'])}}),'导出失败')
})
