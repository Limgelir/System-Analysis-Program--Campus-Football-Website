import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

function settingsContext(api) {
  // 执行真实 SFC 的选项式方法，不复制业务逻辑；页面渲染另由浏览器验收。
  const source = fs.readFileSync(new URL('../src/pages/RefereeDashboard.vue', import.meta.url), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .+$/gm, '').replace('export default {', 'const component = {')
  const storage = new Map()
  const component = vm.runInNewContext(`${script}; component`, {
    refereeAPI: api, scheduleAPI: {}, clearAuth() {}, SeasonRegistrationCard: {}, RefereeGradeSettings: {}, RefereeCollegeSettings: {}, collegeCatalog: [], console,
    localStorage: { setItem: (key, value) => storage.set(key, value) }
  })
  const context = component.data()
  context.refereeInfo = { id: 123, shanghai_fa_registered: false }
  for (const [name, method] of Object.entries(component.methods)) context[name] = method.bind(context)
  return { context, storage }
}

test('足协设置读取失败不能保存默认否，重试读取服务器最新值', async () => {
  let fail = true
  let writes = 0
  const { context } = settingsContext({
    getInfo: async () => { if (fail) throw new Error('网络中断'); return { data: { id: 123, shanghai_fa_registered: true } } },
    updateShanghaiFaRegistration: async () => { writes++ }
  })
  await context.openSettings()
  assert.equal(context.associationLoaded, false)
  assert.equal(context.associationMessage, '网络中断')
  await context.saveAssociation()
  assert.equal(writes, 0)
  fail = false
  await context.loadAssociation()
  assert.equal(context.associationValue, 'true')
  assert.equal(context.associationLoaded, true)
})

test('足协设置独立双向保存且只提交布尔标记，不附带密码或账号资料', async () => {
  const calls = []
  const { context, storage } = settingsContext({
    getInfo: async () => ({ data: { id: 123, shanghai_fa_registered: false } }),
    updateShanghaiFaRegistration: async (id, data) => { calls.push({id, data}); return {success:true,data} }
  })
  await context.openSettings()
  for (const flag of ['true', 'false']) {
    context.associationValue = flag
    await context.saveAssociation()
    assert.equal(context.refereeInfo.shanghai_fa_registered, flag === 'true')
    assert.equal(JSON.parse(storage.get('refereeInfo')).shanghai_fa_registered, flag === 'true')
    assert.match(context.associationMessage, /已保存/)
  }
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { id: 123, data: { shanghai_fa_registered: true } }, { id: 123, data: { shanghai_fa_registered: false } }
  ])
  assert.equal(context.passwordForm.oldPassword, '')
})

test('足协保存失败不修改缓存，保存中禁止重复请求和关闭弹窗', async () => {
  let rejectSave
  let writes = 0
  const { context, storage } = settingsContext({
    getInfo: async () => ({data: {id:123,shanghai_fa_registered:false}}),
    updateShanghaiFaRegistration: () => { writes++; return new Promise((_, reject) => { rejectSave = reject }) }
  })
  await context.openSettings()
  context.associationValue = 'true'
  const pending = context.saveAssociation()
  assert.equal(context.associationSaving, true)
  await context.saveAssociation()
  context.closeSettings()
  assert.equal(context.showSettings, true)
  assert.equal(writes, 1)
  rejectSave(new Error('保存失败'))
  await pending
  assert.equal(context.associationSaving, false)
  assert.equal(context.associationError, true)
  assert.equal(JSON.parse(storage.get('refereeInfo')).shanghai_fa_registered, false)
})
