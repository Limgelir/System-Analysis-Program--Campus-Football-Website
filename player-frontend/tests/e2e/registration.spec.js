import { test, expect } from '@playwright/test'
import path from 'node:path'
import { device } from './device.js'
test.describe.configure({ mode: 'serial' })
const pass = process.env.E2E_PASSWORD
let player, admin, contexts = [], errors = [], seasonId
let png
const inputTime = delta => new Date(Date.now() + delta + 8 * 3600000).toISOString().slice(0,16)
async function upload() { await player.getByLabel('1系统学籍信息截图', { exact: true }).setInputFiles({ name: '测试学籍.png', mimeType: 'image/png', buffer: png }); await player.getByRole('button', { name: '提交审核', exact: true }).click(); await expect(player.getByRole('status')).toContainText('材料已提交') }
async function query() { await admin.goto('/admin-player-registrations'); await admin.getByLabel('申请状态').selectOption(''); await admin.getByLabel('搜索球员').fill('BROWSER-ACADEMIC'); await admin.getByRole('button', { name: '查询', exact: true }).click(); await expect(admin.locator('tbody tr')).toHaveCount(1); await admin.getByRole('button', { name: '查看申请' }).click(); await expect(admin.locator('.detail')).toBeVisible() }
test.beforeAll(async ({ browser }) => {
  for (const url of [process.env.E2E_BASE_URL, process.env.E2E_ADMIN_URL]) { const c = await browser.newContext({ baseURL: url, ...device }); contexts.push(c); const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); if (!player) player = p; else admin = p }
  const demo = await contexts[0].newPage(); await demo.setViewportSize({ width: 640, height: 420 }); await demo.setContent('<html lang="zh"><body style="margin:0;padding:45px;font-family:Microsoft YaHei,sans-serif;background:#eef3f9;color:#243f60"><p style="color:#627c99">球员系统 · 本地验收</p><h1>虚构测试材料</h1><hr style="border:0;border-top:1px solid #c4d2e1"><p>用于验证截图上传、审核和历史版本。</p><p>此图片不包含真实个人信息。</p><p style="margin-top:60px;color:#925e25">仅供软件测试，不是学籍证明。</p></body></html>'); png = await demo.screenshot({ path: path.resolve('../.cache/player-batch2-academic-demo.png') }); await demo.close()
  await admin.goto('/admin-login'); await admin.getByPlaceholder('请输入用户名').fill('e2e-admin'); await admin.getByPlaceholder('请输入密码', { exact: true }).fill(pass); await admin.getByRole('button', { name: '登录', exact: true }).click(); await expect(admin).toHaveURL(/admin-dashboard$/)
  const token = await admin.evaluate(() => localStorage.getItem('adminToken'))
  const r = await admin.request.post('/api/season', { headers: { Authorization: `Bearer ${token}` }, data: { season_code: 'BROWSER-ACADEMIC', season_name: '浏览器球员学籍测试赛季', start_date: '2026-01-01', end_date: '2026-12-31', is_active: true } }); expect(r.status()).toBe(201); seasonId = (await r.json()).data.id
  const signup = await player.request.post('/api/player/register', { data: { student_id: 'BROWSER-ACADEMIC', name: '浏览器学籍球员', college: '土木工程学院', password: pass, gender:'male',password_confirm: pass } }); expect(signup.status()).toBe(201)
  await player.goto('/login'); await player.getByLabel('学号', { exact: true }).fill('BROWSER-ACADEMIC'); await player.getByLabel('密码', { exact: true }).fill(pass); await player.getByRole('button', { name: '登录', exact: true }).click(); await expect(player).toHaveURL(/dashboard$/)
})
test.afterAll(async () => { for (const c of contexts) await c.close() })
test.afterEach(() => expect(errors).toEqual([]))
test('管理员配置中国时间、三个赛事和多轮名单窗口；球员提交并撤回重提', async () => {
  await player.goto('/season-registration'); await expect(player.getByText('管理员尚未设置个人注册窗口。')).toBeVisible()
  await admin.goto('/admin-seasons'); await admin.getByLabel('配置赛季').selectOption(String(seasonId)); await expect(admin.getByLabel('个人注册开放时间')).toBeVisible()
  await admin.getByLabel('个人注册开放时间').fill(inputTime(-3600000)); await admin.getByLabel('个人注册截止时间').fill(inputTime(3600000))
  await expect(admin.getByText('本赛季尚未添加赛事。')).toBeVisible()
  for(const name of ['大联赛','四平足协杯','新生杯']){
    await admin.getByLabel('比赛类型',{exact:true}).selectOption(name);await admin.getByRole('button',{name:'添加赛事',exact:true}).click()
    for(const [field,value] of [['黄牌累计张数','3'],['黄牌停赛场数','2'],['红牌累计张数','1'],['红牌停赛场数','1']])await admin.getByLabel(name+field,{exact:true}).fill(value)
  }
  await admin.getByLabel('本赛季举办大联赛').check(); await admin.getByLabel('本赛季举办四平足协杯').check(); await admin.getByLabel('大联赛规则说明').fill('测试规则：外援、运训人数由管理员判断。')
  for (let i = 1; i <= 2; i++) { await admin.getByRole('button', { name: '添加大联赛修改时间段' }).click(); await admin.getByLabel(`大联赛第${i}轮开放`).fill(inputTime(i * 7200000)); await admin.getByLabel(`大联赛第${i}轮截止`).fill(inputTime(i * 7200000 + 3600000)) }
  await admin.getByRole('button', { name: '保存球员报名设置' }).click(); await expect(admin.getByRole('status')).toContainText('设置已保存')
  await admin.screenshot({ path: path.resolve('../.cache/player-batch2-settings.png'), fullPage: true })
  await player.getByRole('button', { name: '刷新状态' }).click(); await upload(); await expect(player.locator('.status.pending')).toBeVisible(); await expect(player.locator('.material-card img')).toBeVisible()
  player.once('dialog',d=>d.accept()); await player.getByRole('button', { name: '撤回申请' }).click(); await expect(player.locator('.status.withdrawn')).toBeVisible(); await upload()
})
test('管理员核对截图、截止后退回补正，通过后撤销仍能截止后重提', async () => {
  await query(); await expect(admin.locator('.detail img')).toBeVisible(); expect(await admin.locator('.detail img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0)
  await admin.getByRole('button', { name: '退回补正', exact: true }).click(); await expect(admin.getByRole('alert')).toContainText('不能为空')
  await admin.getByLabel('审核说明／退回或撤销原因').fill('请上传更清晰的截图'); await admin.getByRole('button', { name: '退回补正', exact: true }).click(); await expect(admin.getByRole('status')).toContainText('申请已退回')
  await admin.goto('/admin-seasons'); await admin.getByLabel('配置赛季').selectOption(String(seasonId)); await expect(admin.getByLabel('个人注册开放时间')).toBeVisible(); await admin.getByLabel('个人注册开放时间').fill(inputTime(-7200000)); await admin.getByLabel('个人注册截止时间').fill(inputTime(-3600000)); await admin.getByRole('button', { name: '保存球员报名设置' }).click(); await expect(admin.getByRole('status')).toContainText('设置已保存')
  await player.getByRole('button', { name: '刷新状态' }).click(); await expect(player.getByRole('heading', { name: '补正学籍材料' })).toBeVisible(); await expect(player.locator('.review-reason')).toContainText('更清晰')
  await player.getByLabel('1系统学籍信息截图', { exact: true }).setInputFiles({ name: '未提交材料.png', mimeType: 'image/png', buffer: png })
  player.once('dialog', d => d.dismiss()); await player.getByLabel('查看学籍记录').selectOption({ index: 1 }); await expect(player.getByLabel('查看学籍记录')).toHaveValue(''); await expect(player.locator('.local-preview')).toBeVisible()
  player.once('dialog', d => d.accept()); await player.getByLabel('查看学籍记录').selectOption({ index: 1 }); await expect(player.getByText('历史学籍记录，只读。')).toBeVisible(); await player.getByLabel('查看学籍记录').selectOption(''); await expect(player.getByRole('heading', { name: '补正学籍材料' })).toBeVisible(); await upload()
  await query(); await admin.getByRole('button', { name: '通过审核', exact: true }).click(); await expect(admin.getByRole('status')).toContainText('审核已通过'); await player.getByRole('button', { name: '刷新状态' }).click(); await expect(player.locator('.status.approved')).toBeVisible()
  await admin.getByLabel('审核说明／退回或撤销原因').fill('测试撤销后补正'); await admin.getByRole('button', { name: '撤销当季资格' }).click(); await expect(admin.getByRole('status')).toContainText('已撤销'); await player.getByRole('button', { name: '刷新状态' }).click(); await expect(player.locator('.status.revoked')).toBeVisible(); await upload()
  await query(); await admin.getByRole('button', { name: '通过审核', exact: true }).click(); await expect(admin.getByRole('status')).toContainText('审核已通过'); await admin.screenshot({ path: path.resolve('../.cache/player-batch2-review.png'), fullPage: true })
})
test('手机注册状态、旧材料切换、站内提示和管理员审核没有横向溢出', async () => {
  await player.setViewportSize({ width: 390, height: 844 }); await player.getByRole('button', { name: '刷新状态' }).click(); await expect(player.locator('.status.approved')).toBeVisible(); await player.getByLabel('查看提交版本').selectOption({ index: 3 }); await expect(player.locator('.material-card img')).toBeVisible(); expect(await player.evaluate(() => document.documentElement.scrollWidth <=document.documentElement.clientWidth)).toBe(true)
  await player.screenshot({ path: path.resolve('../.cache/player-batch2-registration-mobile.png'), fullPage: true }); await player.goto('/dashboard'); await expect(player.getByText('你的当季学籍审核已通过。').first()).toBeVisible()
  await admin.setViewportSize({ width: 390, height: 844 }); expect(await admin.evaluate(() => document.documentElement.scrollWidth <=document.documentElement.clientWidth)).toBe(true); await admin.screenshot({ path: path.resolve('../.cache/player-batch2-review-mobile.png'), fullPage: true })
})
