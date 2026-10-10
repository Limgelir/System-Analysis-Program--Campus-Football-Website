import { test, expect } from '@playwright/test'
import crypto from 'node:crypto'
import path from 'node:path'
import { device } from './device.js'

test('性别补填与锁定、赛事标签开关、合并去重和仍然提交人工审核', async ({ browser }) => {
  test.setTimeout(120000)
  const pc = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, ...device })
  const ac = await browser.newContext({ baseURL: process.env.E2E_ADMIN_URL, ...device })
  const player = await pc.newPage(), admin = await ac.newPage(), errors = []
  const password = process.env.E2E_PASSWORD, kind = process.env.E2E_MOBILE === '1' ? 'mobile' : 'desktop'
  for (const page of [player, admin]) page.on('pageerror', e => errors.push(e.message))
  let adminToken
  async function api(url, data, token = adminToken, method = data === undefined ? 'GET' : 'POST', revision, status = 200) {
    const r = await admin.request.fetch(url, { method, data, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Idempotency-Key': crypto.randomUUID(), ...(revision == null ? {} : { 'If-Match': String(revision) }) } })
    expect(r.status(), await r.text()).toBe(status); return (await r.json()).data
  }
  try {
    await admin.goto('/admin-login'); await admin.getByPlaceholder('请输入用户名').fill('e2e-admin'); await admin.getByPlaceholder('请输入密码', { exact: true }).fill(password); await admin.getByRole('button', { name: '登录', exact: true }).click(); await expect(admin).toHaveURL(/admin-dashboard$/)
    adminToken = await admin.evaluate(() => localStorage.getItem('adminToken'))
    await player.goto('/register'); await player.getByLabel('姓名', { exact: true }).fill('新注册女球员'); await player.getByLabel('学号', { exact: true }).fill('GENDER-NEW'); await player.getByLabel('学院', { exact: true }).selectOption('土木工程学院'); await player.getByLabel('密码', { exact: true }).fill(password); await player.getByLabel('确认密码', { exact: true }).fill(password)
    await player.getByRole('button', { name: '注册账号', exact: true }).click(); await expect(player).toHaveURL(/register$/)
    await player.getByLabel('性别', { exact: true }).selectOption('female'); await player.getByRole('button', { name: '注册账号', exact: true }).click(); await expect(player).toHaveURL(/login\?/)
    await player.getByLabel('学号', { exact: true }).fill('GENDER-LEGACY'); await player.getByLabel('密码', { exact: true }).fill(password); await player.getByRole('button', { name: '登录', exact: true }).click()
    await expect(player.getByRole('dialog')).toBeVisible(); await player.keyboard.press('Escape'); await expect(player.getByRole('dialog')).toBeVisible(); await player.reload(); await expect(player.getByRole('dialog')).toBeVisible()
    await player.screenshot({ path: path.resolve('../.cache/player-gender-dialog-' + kind + '.png'), fullPage: true })
    await player.getByLabel('性别', { exact: true }).selectOption('female'); await player.getByRole('button', { name: '确认性别并继续' }).click(); await expect(player.getByRole('dialog')).not.toBeVisible()
    await player.goto('/account'); await expect(player.getByText('性别：女（已锁定，如需修改请联系管理员）')).toBeVisible()
    await admin.goto('/admin-players'); await admin.getByPlaceholder('姓名、学号或学院').fill('GENDER-LEGACY'); await admin.getByRole('button', { name: '查询', exact: true }).click(); await expect(admin.locator('tbody tr')).toHaveCount(1); await admin.getByRole('button', { name: '管理', exact: true }).click(); await admin.getByLabel('管理操作').selectOption('gender'); await admin.getByLabel('新性别').selectOption('male'); await admin.getByLabel('核实／操作原因').fill('本人申请核实更正'); await admin.getByRole('button', { name: '确认修改性别' }).click(); await expect(admin.getByRole('status')).toContainText('性别已更新')
    await player.reload(); await expect(player.getByText('性别：男（已锁定，如需修改请联系管理员）')).toBeVisible()
    const season = await api('/api/season', { season_code: 'GENDER-TAGS', season_name: '性别与标签验收', start_date: '2026-01-01', end_date: '2027-12-31', is_active: true }, adminToken, 'POST', null, 201)
    const iso = d => new Date(Date.now() + d + 8 * 3600000).toISOString().replace('Z', '+08:00')
    const config = await api('/api/player-admin/season-settings/' + season.id, { registration_opens_at: iso(-86400000), registration_closes_at: iso(86400000), competitions: [{ league_type: '标签测试杯', is_enabled: true, rules_text: '', registration_opens_at: iso(-86400000), registration_closes_at: iso(86400000), change_windows: [], yellow_threshold: 3, yellow_suspension: 1, red_threshold: 1, red_suspension: 1 }] }, adminToken, 'PUT', 0)
    await admin.goto('/admin-seasons'); await admin.getByLabel('配置赛季').selectOption(String(season.id)); await admin.getByLabel('使用运训标签', { exact: true }).uncheck(); await admin.getByLabel('使用足球特长生标签', { exact: true }).check(); await admin.getByRole('button', { name: '添加合并人数限制', exact: true }).click(); await admin.getByLabel('标签测试杯第1组外援', { exact: true }).check(); await admin.getByLabel('标签测试杯第1组足球特长生', { exact: true }).check(); await admin.getByLabel('标签测试杯第1组合计最多人数').fill('1'); await admin.getByRole('button', { name: '保存球员报名设置', exact: true }).click(); await expect(admin.getByText('球员报名设置已保存。', { exact: true })).toBeVisible()
    await admin.locator('.competition-settings').screenshot({ path: path.resolve('../.cache/player-tag-settings-' + kind + '.png') })
    const people = []
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=', 'base64')
    for (const student_id of ['GENDER-LEGACY', 'GENDER-MEMBER']) {
      const p = await api('/api/player/login', { student_id, password }, null); people.push(p)
      const r = await admin.request.post('/api/player/season-registration/submit', { headers: { Authorization: 'Bearer ' + p.token, 'If-Match': '0', 'Idempotency-Key': crypto.randomUUID() }, multipart: { season_id: String(season.id), account_revision: String(p.revision), academic_image: { name: 'test.png', mimeType: 'image/png', buffer: png } } })
      expect(r.status(), await r.text()).toBe(201); const d = (await r.json()).data; await api('/api/player-admin/season-registrations/' + d.registration.id + '/approve', { account_revision: p.revision }, adminToken, 'POST', d.revision)
    }
    await player.goto('/team-applications'); await player.getByLabel('报名赛事').selectOption(String(config.competitions[0].id)); await expect(player.locator('.automatic-review')).toContainText('足球特长生：指本科阶段未通过足球单招、足球高水平等方式入学的队员'); await expect(player.locator('.automatic-review')).not.toContainText('运训')
    await player.getByLabel('新球队名称').fill('标签人工审核队'); await player.getByRole('button', { name: '创建报名草稿' }).click()
    for (const [i,p] of people.entries()) { await player.getByLabel('添加球员学号').fill(p.student_id); await player.getByRole('button', { name: '按学号添加', exact: true }).click(); await player.getByLabel(p.name + '号码').fill(String(i+1)); await player.getByLabel(p.name + '足球特长生', { exact: true }).check() }
    await player.getByLabel(people[0].name + '任场上队长').check(); await player.getByLabel(people[0].name + '外援', { exact: true }).check(); await player.getByRole('button', { name: '保存草稿', exact: true }).click(); await expect(player.getByRole('button', { name: '预览并提交', exact: true })).toBeDisabled(); await expect(player.getByRole('alert')).toContainText('队伍中有人未选择性别')
    await api('/api/player/me/gender', { gender: 'female' }, people[1].token, 'PUT', people[1].revision)
    await player.getByRole('button', { name: '重新载入（放弃未保存）', exact: true }).click(); await player.getByRole('button', { name: '预览并提交', exact: true }).click(); await player.getByRole('button', { name: '确认提交整队审核', exact: true }).click(); await expect(player.locator('.automatic-result')).toContainText('合计（去重）为2人')
    await player.getByRole('button', { name: '仍然提交申请（人工审核）', exact: true }).click(); await expect(player.getByRole('status')).toContainText('已提交人工审核'); await expect(player.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0)
    await player.screenshot({ path: path.resolve('../.cache/player-tag-manual-' + kind + '.png'), fullPage: true })
    await admin.goto('/admin-team-applications'); await admin.getByLabel('查询队名').fill('标签人工审核队'); await admin.getByRole('button', { name: '查询球队报名', exact: true }).click(); await expect(admin.locator('tbody')).toContainText('申请人工审核'); await admin.getByRole('button', { name: '查看球队申请', exact: true }).click(); await expect(admin.locator('.team-review-detail')).not.toContainText('运训'); await admin.getByLabel('整队审核说明／退回理由／人工通过原因').fill('核验后允许人数特例'); await admin.getByRole('button', { name: '人工通过自动审核失败', exact: true }).click(); await expect(admin.getByRole('status')).toContainText('已人工通过')
    await player.reload(); await player.getByRole('link', { name: '查看当前正式名单及申请中期变更 →' }).click(); await expect(player.locator('.member-cards')).toContainText('足球特长生'); await expect(player.locator('.member-cards')).not.toContainText('运训')
    const formal = Number(player.url().split('/').at(-1))
    await admin.goto('/admin-seasons'); await admin.getByLabel('配置赛季').selectOption(String(season.id)); await admin.getByLabel('使用足球特长生标签', { exact: true }).uncheck(); await admin.getByRole('button', { name: '保存球员报名设置', exact: true }).click(); await expect(admin.getByText('球员报名设置已保存。', { exact: true })).toBeVisible()
    await player.goto('/public/teams/' + formal); await expect(player.locator('.public-team')).not.toContainText('足球特长生'); await expect(player.locator('.public-team')).not.toContainText('运训')
    for (const page of [player, admin]) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    expect(errors).toEqual([])
  } finally { await pc.close(); await ac.close() }
})
