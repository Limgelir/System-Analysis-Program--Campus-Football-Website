import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { device } from './device.js'
const options = JSON.parse(fs.readFileSync(new URL('../../../shared-data/colleges.json', import.meta.url), 'utf8')).map(x => x.name)
const password = process.env.E2E_PASSWORD
const center = '上海自主智能无人系统科学中心'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=', 'base64')
test('学院选择、球员旧账号保留与提示、裁判随时修改、学籍截图示例', async ({ browser }) => {
  test.setTimeout(120000)
  const pc = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, ...device })
  const rc = await browser.newContext({ baseURL: process.env.E2E_ADMIN_URL, ...device })
  const p = await pc.newPage(), r = await rc.newPage(), errors = []
  for (const page of [p,r]) page.on('pageerror', e => errors.push(e.message))
  const kind = process.env.E2E_MOBILE === '1' ? 'mobile' : 'desktop'
  async function api(url, data, token, method = data === undefined ? 'GET' : 'POST', revision, status = 200) {
    const result = await p.request.fetch(process.env.E2E_ADMIN_URL + url, { method, data, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(revision == null ? {} : { 'If-Match': String(revision) }), 'Idempotency-Key': crypto.randomUUID() } })
    expect(result.status(), await result.text()).toBe(status); return (await result.json()).data
  }
  async function loginPlayer(id) {
    await p.goto('/login'); await p.getByLabel('学号', { exact: true }).fill(id); await p.getByLabel('密码', { exact: true }).fill(password)
    await p.getByRole('button', { name: '登录', exact: true }).click(); await expect(p).toHaveURL(/dashboard$/); if (id !== 'COLLEGE-NEW') { await expect(p.getByRole('dialog')).toBeVisible(); await p.getByLabel('性别', {exact:true}).selectOption('male'); await p.getByRole('button',{name:'确认性别并继续'}).click(); await expect(p.getByRole('dialog')).not.toBeVisible() }
  }
  try {
    await p.goto('/register')
    await expect(p.getByLabel('学院', { exact: true }).locator('option')).toHaveText(['请选择学院', ...options])
    await p.getByLabel('姓名', { exact: true }).fill('学院浏览器球员'); await p.getByLabel('学号', { exact: true }).fill('COLLEGE-NEW')
    await p.getByLabel('学院', { exact: true }).selectOption(center); await p.getByLabel('性别', { exact: true }).selectOption('male')
    await p.getByLabel('密码', { exact: true }).fill(password); await p.getByLabel('确认密码', { exact: true }).fill(password)
    await p.getByRole('button', { name: '注册账号', exact: true }).click(); await expect(p).toHaveURL(/login\?/)
    await loginPlayer('COLLEGE-NEW'); await expect(p.locator('.college-notice')).toHaveCount(0)
    await p.goto('/account'); await expect(p.locator('.old-college')).toContainText(center)
    await expect(p.getByLabel('新学院', { exact: true }).locator('option')).toHaveText(['请选择学院', ...options])
    await expect(p.getByRole('button', { name: '提交学院修改审核', exact: true })).toBeDisabled()
    await p.screenshot({ path: path.resolve('../.cache/college-player-settings-' + kind + '.png'), fullPage: true })
    await pc.clearCookies(); await p.evaluate(() => localStorage.clear()); await p.reload()
    await loginPlayer('COLLEGE-MATCHED'); await expect(p.locator('.welcome')).toContainText('土木学院'); await expect(p.locator('.college-notice')).toBeVisible()
    await p.evaluate(() => localStorage.clear()); await p.reload(); await loginPlayer('COLLEGE-LEGACY')
    await expect(p.locator('.college-notice')).toContainText('原填写：中德'); await p.reload(); await expect(p.locator('.college-notice')).toBeVisible()
    await p.getByRole('link', { name: '去申请修改学院', exact: true }).click()
    await expect(p.locator('.college-legacy')).toContainText('中德'); await expect(p.getByLabel('新学院', { exact: true })).toHaveValue('')
    await p.getByLabel('新学院', { exact: true }).selectOption('中德工程学院'); await p.locator('#college-change-file').setInputFiles({name:'test.png',mimeType:'image/png',buffer:png}); await p.getByRole('button', { name: '提交学院修改审核', exact: true }).click()
    await expect(p.locator('.pending-college')).toContainText('待审核'); await p.goto('/dashboard'); await expect(p.locator('.college-notice')).toBeVisible()
    // The screenshot example is a static reference, never the user's submitted material.
    const admin = await api('/api/admin/login', { username: 'e2e-admin', password })
    const season = await api('/api/season', { season_code: 'COLLEGE-BROWSER', season_name: '学院与截图示例验收', start_date: '2026-01-01', end_date: '2028-12-31', is_active: true }, admin.token, 'POST', null, 201)
    const iso = delta => new Date(Date.now() + delta + 8*3600000).toISOString().replace('Z','+08:00')
    await api('/api/player-admin/season-settings/' + season.id, { registration_opens_at: iso(-86400000), registration_closes_at: iso(86400000), competitions: [] }, admin.token, 'PUT', 0)
    await p.goto('/season-registration'); await expect(p.locator('.academic-example img')).toBeVisible()
    await expect.poll(() => p.locator('.academic-example img').evaluate(img => img.naturalWidth)).toBeGreaterThan(1000)
    const popupPromise = p.waitForEvent('popup'); await p.getByRole('link', { name: '查看学籍截图示例大图' }).click(); const popup = await popupPromise
    await popup.waitForLoadState(); expect((await popup.request.get(popup.url())).status()).toBe(200); await popup.close()
    await expect(p.getByRole('button', { name: '提交审核', exact: true })).toBeDisabled()
    await p.locator('.page-title h1').click()
    await p.screenshot({ path: path.resolve('../.cache/college-academic-example-' + kind + '.png'), fullPage: true })
    // Referee registration uses precisely the same catalogue.
    await r.goto('/referee-register'); await expect(r.getByLabel('学院', { exact: true }).locator('option')).toHaveText(['请选择学院', ...options])
    await r.getByPlaceholder('请输入学号').fill('COLLEGE-NEW-REF'); await r.getByPlaceholder('请输入姓名').fill('学院浏览器裁判')
    await r.getByLabel('学院', { exact: true }).selectOption(center)
    const selects = r.locator('.referee-form select')
    await selects.nth(0).selectOption('男'); await selects.nth(2).selectOption('裁判学员'); await selects.nth(3).selectOption('三级'); await selects.nth(4).selectOption('false')
    await r.locator('input[type=number]').nth(0).fill('175'); await r.locator('input[type=number]').nth(1).fill('65')
    await r.getByLabel('院内赛', { exact: true }).check(); await r.locator('input[type=file]').setInputFiles({ name:'id.png',mimeType:'image/png',buffer:png })
    await r.locator('input[type=password]').nth(0).fill(password); await r.locator('input[type=password]').nth(1).fill(password)
    await r.getByRole('button', { name:'注册',exact:true }).click(); await expect(r).toHaveURL(/referee-login$/)
    await r.getByPlaceholder('请输入学号').fill('E2E-20'); await r.getByPlaceholder('请输入密码', { exact:true }).fill(password)
    await r.getByRole('button', { name:'登录',exact:true }).click(); await expect(r).toHaveURL(/referee-dashboard$/)
    await expect(r.locator('.college-notice')).toContainText('测试学院'); await r.getByRole('button', { name:'去选择学院',exact:true }).click()
    const form = r.locator('.college-settings'); await expect(form.locator('.college-legacy')).toContainText('测试学院')
    await form.getByLabel('学院', { exact:true }).selectOption(center); await form.getByRole('button', { name:'保存学院',exact:true }).click(); await expect(form.getByRole('status')).toContainText('已保存')
    await r.locator('.close-btn').click(); await expect(r.locator('.college-notice')).toHaveCount(0)
    await r.reload(); await r.getByRole('button', { name:'设置',exact:true }).click(); await expect(form.getByLabel('学院', { exact:true })).toHaveValue(center)
    await form.scrollIntoViewIfNeeded()
    await r.screenshot({ path:path.resolve('../.cache/college-referee-settings-'+kind+'.png'),animations:'disabled' })
    for (const page of [p,r]) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    expect(errors).toEqual([])
  } finally { await pc.close(); await rc.close() }
})
