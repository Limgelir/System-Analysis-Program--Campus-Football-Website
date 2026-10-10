import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppearanceGate, requestAppearance } from '../../shared-ui/appearanceGate.mjs'

function fixture(options = {}) {
  let session = { role: 'player', token: 'player-one' }
  const applied = [], loaded = []
  const gate = createAppearanceGate({
    getSession: () => session,
    request: async () => ({ enabled: true, account: { role: 'player', id: 7 } }),
    load: async () => loaded.push(true), apply: value => applied.push(value), ...options
  })
  return { gate, applied, loaded, setSession: value => { session = value } }
}
const route = path => ({ path })

test('未登录不查询资格，初次根路由也能正确提交本地预览状态', async () => {
  const guest = fixture({ getSession: () => null, request: () => assert.fail('guest request') })
  const to = route('/login'); await guest.gate.prepare(to, route('/')); guest.gate.commit(to)
  assert.equal(guest.applied.at(-1).enabled, false)
  const preview = fixture({ preview: true, getSession: () => null, request: () => assert.fail('preview request') })
  const home = route('/'); await preview.gate.prepare(home, route('/')); preview.gate.commit(home)
  assert.equal(preview.applied.at(-1).localPreview, true)
  const lab = route('/glass-preview'); await preview.gate.prepare(lab, home); preview.gate.commit(lab)
  assert.equal(preview.applied.at(-1).enabled, false)
})

test('授权账号按角色和ID记忆，普通账号、错误角色及接口异常均回旧版', async () => {
  for (const response of [false, { enabled: false }, { enabled: true, account: { role: 'admin', id: 7 } }, { enabled: true, account: { role: 'player', id: '7' } }, new Error('offline')]) {
    const f = fixture({ request: async () => { if (response instanceof Error) throw response; return response } })
    const to = route('/dashboard'); await f.gate.prepare(to); f.gate.commit(to)
    assert.equal(f.applied.at(-1).enabled, false); assert.equal(f.loaded.length, 0)
  }
  const f = fixture(), to = route('/dashboard'); await f.gate.prepare(to); f.gate.commit(to)
  assert.equal(f.applied.at(-1).key, 'player:7'); assert.equal(f.loaded.length, 1)
})

test('旧账号迟到响应与取消导航不能打开新版', async () => {
  let finish
  const f = fixture({ request: () => new Promise(resolve => { finish = resolve }) })
  const to = route('/dashboard'), pending = f.gate.prepare(to)
  f.setSession({ role: 'player', token: 'different-account' })
  finish({ enabled: true, account: { role: 'player', id: 7 } }); await pending; f.gate.commit(to)
  assert.equal(f.loaded.length, 0); assert.equal(f.applied.length, 0)
  const other = fixture(), cancelled = route('/account'); await other.gate.prepare(cancelled); other.gate.commit(cancelled, new Error('cancelled'))
  assert.equal(other.applied.length, 0)
})

test('并发导航只提交最后一次决定，退出登录清除当前效果', async () => {
  const finishes = []
  const f = fixture({ request: () => new Promise(resolve => finishes.push(resolve)) })
  const a = route('/a'), b = route('/b'), first = f.gate.prepare(a), last = f.gate.prepare(b)
  finishes[1]({ enabled: false }); await last; f.gate.commit(b)
  finishes[0]({ enabled: true, account: { role: 'player', id: 7 } }); await first; f.gate.commit(a)
  assert.equal(f.applied.length, 1); assert.equal(f.applied[0].enabled, false)
  f.setSession(null); f.gate.checkSession(b); assert.equal(f.applied.at(-1).enabled, false)
})

test('同页锚点不重置正在编辑的页面，跨页重新检查总开关', async () => {
  let enabled = true, requests = 0
  const f = fixture({ request: async () => { requests++; return { enabled, account: { role: 'player', id: 7 } } } })
  const first = route('/dashboard'); await f.gate.prepare(first); f.gate.commit(first)
  enabled = false
  const anchor = { path: '/dashboard', hash: '#settings' }; await f.gate.prepare(anchor, first); f.gate.commit(anchor)
  assert.equal(requests, 1); assert.equal(f.applied.at(-1).enabled, true)
  const next = route('/account'); await f.gate.prepare(next, first); f.gate.commit(next)
  assert.equal(requests, 2); assert.equal(f.applied.at(-1).enabled, false)
})

test('组件加载失败回旧版；加载途中退出账号不能再启用', async () => {
  const broken = fixture({ load: async () => { throw new Error('chunk failed') } })
  const to = route('/dashboard'); await broken.gate.prepare(to); broken.gate.commit(to)
  assert.equal(broken.applied.at(-1).enabled, false)
  let finish, started
  const loading = new Promise(resolve => { started = resolve })
  const f = fixture({ load: () => { started(); return new Promise(resolve => { finish = resolve }) } })
  const pending = f.gate.prepare(to); await loading; f.setSession(null); f.gate.reset(); finish(); await pending; f.gate.commit(to)
  assert.equal(f.applied.at(-1).enabled, false); assert.equal(f.applied.length, 1)
})

test('资格请求不缓存，不伪造成功，超时中止', async () => {
  const s = { token: 'test', role: 'player' }
  const decision = await requestAppearance(s, { base: 'https://example.test/', fetcher: async (url, options) => {
    assert.equal(url, 'https://example.test/api/appearance'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit')
    assert.equal(options.headers.Authorization, 'Bearer test')
    return { ok: true, json: async () => ({ success: true, data: { enabled: false } }) }
  } })
  assert.equal(decision.enabled, false)
  assert.equal((await requestAppearance(s, { fetcher: async () => ({ ok: false }) })).enabled, false)
  await assert.rejects(requestAppearance(s, { timeoutMs: 5, fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) }), /aborted/)
})
