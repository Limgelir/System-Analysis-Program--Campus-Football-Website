import { matchTimeError } from '../src/utils/matchTime.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { scheduleReturnQuery } from '../src/utils/scheduleNavigation.js'

// Exercise the actual Options API methods with injected API dependencies. The
// template is separately checked by vite build and a real browser acceptance run.
const source = readFileSync(new URL('../src/pages/AdminSchedule.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*$/gm, '').replace('export default', 'return')
function makeVm(scheduleAPI, query = {}, teamAPI = { getSeasonTeams: async () => ({ data: { teams: [] } }) }) {
  const component = new Function('scheduleAPI', 'teamAPI', 'SearchableRefereeSelect', 'ListPagination', 'matchTimeError', 'VenueFields', 'AdminMatchSignups', 'venueText', 'CompetitionOptions', 'AdminScheduleImport', 'FourthOfficialSheetDialog', script)(scheduleAPI, teamAPI, {}, {}, matchTimeError, {}, {}, value=>value.venue, {}, {}, {})
  const vm = { ...component.data(), $route: { query }, $router: { push: value => value } }
  for (const [key, method] of Object.entries(component.methods)) vm[key] = method.bind(vm)
  for (const [key, value] of Object.entries(component.computed)) {
    Object.defineProperty(vm, key, { get: (typeof value === 'function' ? value : value.get).bind(vm) })
  }
  return { vm, component }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const season = id => ({ id, season_name: `赛季${id}`, is_active: id === 2 ? 1 : 0 })
const result = id => ({ data: [{ id: id * 10, season_id: id, match_type: '足协杯' }],
  meta: { selected_season: season(id), current_season: season(2), seasons: [season(2), season(1)] } })

test('首次默认由后端解析当前赛季；历史赛季禁止在该视图新建', async () => {
  const queries = []
  const { vm } = makeVm({ getAll: async query => { queries.push(query); return result(query.season_id || 2) } })
  await vm.loadSchedules()
  assert.equal(queries[0].season_id, undefined)
  assert.equal(vm.canCreateSchedule, true)
  vm.$route.query = { season_id: '1', match_type: '新生杯' }
  await vm.loadSchedules()
  assert.equal(queries[1].season_id, '1')
  assert.equal(vm.canCreateSchedule, false)
  assert.equal(vm.filteredScheduleList.length, 0)
  assert.equal(vm.schedules.length, 1)
  await vm.handleAddSchedule()
  assert.match(vm.pageError, /当前启用赛季/)
})

test('快速切换时迟到的旧成功/失败响应均不能覆盖列表、计数与加载状态', async () => {
  for (const oldFails of [false, true]) {
    const old = deferred(), latest = deferred()
    const { vm } = makeVm({ getAll: query => query.season_id === '1' ? old.promise : latest.promise }, { season_id: '1' })
    const first = vm.loadSchedules()
    vm.$route.query = { season_id: '2' }
    const second = vm.loadSchedules()
    assert.deepEqual(vm.schedules, [])
    assert.equal(vm.canCreateSchedule, false)
    latest.resolve(result(2))
    await second
    oldFails ? old.reject(new Error('旧请求失败')) : old.resolve(result(1))
    await first
    assert.equal(vm.selectedSeason.id, 2)
    assert.equal(vm.schedules[0].season_id, 2)
    assert.equal(vm.scheduleLoading, false)
    assert.equal(vm.scheduleWarning, '')
  }
})

test('无启用赛季和查询错误均清空原列表，不回退历史数据', async () => {
  const { vm } = makeVm({ getAll: async () => ({ data: [], meta: { seasons: [season(1)], current_season: null, selected_season: null } }) })
  vm.schedules = result(1).data
  await vm.loadSchedules()
  assert.equal(vm.schedules.length, 0)
  assert.equal(vm.selectedSeason, null)
  assert.equal(vm.canCreateSchedule, false)
  const bad = makeVm({ getAll: async () => { throw new Error('赛季不存在') } }).vm
  bad.schedules = result(1).data
  await bad.loadSchedules()
  assert.deepEqual(bad.schedules, [])
  assert.match(bad.scheduleWarning, /赛季不存在/)
})

test('离开页面后旧请求失效；切换赛季关闭选派与编辑面板', async () => {
  const wait = deferred()
  const { vm, component } = makeVm({ getAll: () => wait.promise })
  vm.activeAssignmentScheduleId = 1
  vm.editDialogVisible = true
  const loading = vm.loadSchedules()
  assert.equal(vm.activeAssignmentScheduleId, null)
  assert.equal(vm.editDialogVisible, false)
  component.beforeUnmount.call(vm)
  wait.resolve(result(1))
  await loading
  assert.deepEqual(vm.schedules, [])
})

test('历史轻量编辑按比赛所属赛季读取队伍，关闭后迟到详情不再写入', async () => {
  const detail = deferred(), seasonIds = []
  const { vm } = makeVm({ getDetail: () => detail.promise }, {}, {
    getSeasonTeams: async id => { seasonIds.push(id); return { data: { teams: [] } } }
  })
  const loading = vm.openQuickEdit({ id: 10, season_id: 1 })
  vm.closeQuickEdit()
  detail.resolve({ data: { id: 10, season_id: 1 } })
  await loading
  assert.deepEqual(seasonIds, [1])
  assert.equal(vm.editingScheduleRecord, null)
})

test('详情和报告返回保留赛季与类型；直接打开历史详情返回对应赛季', () => {
  const query = { season_id: '1', match_type: '足协杯' }
  assert.deepEqual(scheduleReturnQuery(query, 2), query)
  assert.deepEqual(scheduleReturnQuery({}, 1), { season_id: '1' })
  assert.deepEqual(scheduleReturnQuery({}, null), {})
})

test('往返详情保留日期、来源、报告状态及分页，仅接收已知的单值筛选', () => {
  const query = { season_id:'3', match_type:'足协杯', date_from:'2026-09-18', date_to:'2026-09-25', source_type:'external', report_status:'main_pending', page:'2', page_size:'10' }
  assert.deepEqual(scheduleReturnQuery(query, 4), query)
  assert.deepEqual(scheduleReturnQuery({ ...query, injected:'unused', page:['1','2'] }, 4), Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'page')))
})

test('撤销球队退出正式列表后，原赛程轻量编辑仍保留双方选择且不污染新建选项', async () => {
  const match = { id:10,season_id:2,match_type:'足协杯',team_a_id:11,team_b_id:12,team_a_name_snapshot:'已撤销队',team_b_name_snapshot:'对手' }
  const active = [{ id:12,team_name:'对手',league_type:'足协杯' }]
  const { vm } = makeVm({ getDetail:async()=>({data:match}) }, {}, { getSeasonTeams:async()=>({data:{teams:[...active]}}) })
  vm.teams = [...active]
  await vm.openQuickEdit(match)
  assert.equal(vm.editForm.team_a_id,'11')
  assert.equal(vm.editFilteredTeams.find(t=>t.id===11).team_name,'已撤销队')
  assert.equal(vm.editTeams.filter(t=>t.id===12).length,1)
  assert.deepEqual(vm.teams,active)
})

test('开球前已报名、已选派及已提交报告可删除；浏览器时区不影响服务器截止', () => {
  const {vm}=makeVm({})
  const match={id:1,main_referee_id:2,signup_count:5,report_main_status:'submitted',
    deleteReceivedAt:performance.now(),delete_state:{can_delete:true,checked_at:'2026-09-24T17:34:00+08:00',kickoff_at:'2026-09-24T17:35:00+08:00'}}
  assert.equal(vm.canDeleteSchedule(match),true)
  match.deleteReceivedAt-=61000
  assert.equal(vm.canDeleteSchedule(match),false)
  assert.match(vm.deleteScheduleReason(match),/已到开球/)
  assert.equal(vm.canDeleteSchedule({...match,delete_state:{can_delete:false,reason_message:'请先补齐开球时间'}}),false)
})

test('删除确认告知关联记录范围，取消不发请求，确认携带赛程版本', async () => {
  const calls=[],{vm}=makeVm({delete:async(...args)=>{calls.push(args);return {data:{}}}})
  const match={id:8,schedule_revision:3,field_order:'A1',match_time:'17:35',deleteReceivedAt:performance.now(),
    delete_state:{can_delete:true,checked_at:'2026-09-24T17:34:00+08:00',kickoff_at:'2026-09-24T17:35:00+08:00'}}
  vm.getDisplayTeams=()=> '甲 vs 乙';vm.getDisplayDate=()=> '2026-09-24';vm.displayMatchTime=()=> '17:35';vm.loadSchedules=async()=>{}
  const previous=globalThis.window
  try{
    globalThis.window={confirm:message=>{assert.match(message,/报名历史、选派、报告与附件/);return false}}
    await vm.handleDeleteSchedule(match);assert.equal(calls.length,0)
    globalThis.window.confirm=()=>true
    await vm.handleDeleteSchedule(match);assert.deepEqual(calls,[[8,3]])
  }finally{globalThis.window=previous}
})
