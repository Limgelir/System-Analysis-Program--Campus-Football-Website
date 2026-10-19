import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const mysql = require('../../../backend/node_modules/mysql2/promise')
const xlsx = require('../../../backend/node_modules/xlsx')
let fixture
async function connection() {
  if (process.env.REFWEB_E2E !== '1' || !process.env.DB_NAME?.startsWith('tj_refweb_e2e_')) throw Error('仅限隔离E2E库')
  return mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME })
}
test.beforeAll(async () => {
  const c = await connection()
  try { fixture = await require('../../../backend/scripts/seedAssignmentExport')(c, { active: true }) }
  finally { await c.end() }
})
for (const mobile of [false, true]) test(`比赛日CSV导出、最新选派和失败重试（${mobile ? '手机' : '桌面'}）`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/admin-login')
  await page.getByPlaceholder('请输入用户名').fill('e2e-admin')
  await page.getByPlaceholder('请输入密码', { exact: true }).fill(process.env.E2E_PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/admin-dashboard$/)
  await page.goto(`/admin-assignments?view=all&season_id=${fixture.seasonId}`)
  const day = page.locator('.match-day').filter({ has: page.locator('#match-' + fixture.matches.A02) })
  const button = day.getByRole('button', { name: '导出本比赛日 CSV', exact: true })
  await expect(button).toBeVisible()
  // Unsaved edits must neither be committed nor included in the export.
  const fourth = page.locator('#match-' + fixture.matches.A02).getByLabel('本场需要第四官员')
  await fourth.uncheck()
  const savedName = mobile ? '最新已保存裁判乙' : '最新已保存裁判甲'
  const c = await connection()
  try { await c.execute("UPDATE match_official_assignments SET name_snapshot=? WHERE schedule_id=? AND role='main'", [savedName, fixture.matches.A02]) }
  finally { await c.end() }
  async function downloadRows() {
    const event = page.waitForEvent('download'); await button.click(); const download = await event
    expect(await download.failure()).toBeNull()
    expect(download.suggestedFilename()).toContain(`大联赛-${fixture.date}.csv`)
    const bytes = await readFile(await download.path())
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191])
    const wb = xlsx.read(bytes.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true })
    return xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  }
  const rows = await downloadRows()
  expect(rows.map(r => r['场序'])).toEqual(['A01', 'A02', 'A03', 'A04'])
  expect(rows[1]['裁判员']).toBe(savedName); expect(rows[1]['第四官员']).toBe('未选派')
  expect(rows[2]['裁判监督']).toBe('无需监督'); expect(rows[3]['第四官员']).toBe('不适用')
  await expect(fourth).not.toBeChecked()
  await fourth.check()
  await page.route('**/assignment-board/export?*', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '该赛事在这个比赛日暂无比赛，请刷新后重试' }) }))
  await button.click(); await expect(day.getByRole('alert')).toContainText('暂无比赛')
  await expect(button).toBeEnabled(); await page.unroute('**/assignment-board/export?*')
  expect(await downloadRows()).toHaveLength(4); await expect(day.getByRole('alert')).toHaveCount(0)
  await button.scrollIntoViewIfNeeded()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy()
  await page.screenshot({ path: `test-results/assignment-export-${mobile ? 'mobile' : 'desktop'}.png` })
  // The seven-day board hides kicked-off/undated matches; CSV still exports the full day.
  await page.getByRole('button', { name: '未来7天可报名比赛', exact: true }).click()
  await expect(day.locator('.assignment')).toHaveCount(2)
  expect((await downloadRows()).map(r => r['场序'])).toEqual(['A01', 'A02', 'A03', 'A04'])
  expect(errors).toEqual([])
})
