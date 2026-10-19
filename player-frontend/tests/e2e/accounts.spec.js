import { test, expect } from '@playwright/test'
import path from 'node:path'
import { device } from './device.js'
test.describe.configure({ mode: 'serial' })
const pass = process.env.E2E_PASSWORD, newPass = pass + 'x'
let player, admin, contexts = [], errors = []
const shot = name => path.resolve('../.cache', `player-${name}.png`)
async function login(page, id, password = pass) {
  await page.goto('/login'); await page.getByLabel('学号', { exact: true }).fill(id); await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page).toHaveURL(/\/(dashboard|account)$/)
}
async function register(page, id) {
  await page.goto('/register'); await page.getByLabel('姓名', { exact: true }).fill('浏览器球员'); await page.getByLabel('学号', { exact: true }).fill(id); await page.getByLabel('学院', { exact: true }).selectOption('土木工程学院'); await page.getByLabel('性别', { exact: true }).selectOption('female'); await page.getByLabel('密码', { exact: true }).fill(pass); await page.getByLabel('确认密码', { exact: true }).fill(pass); await page.getByRole('button', { name: '注册账号', exact: true }).click(); await expect(page).toHaveURL(/\/login\?/)
}
test.beforeAll(async ({ browser }) => {
  for (const url of [process.env.E2E_BASE_URL, process.env.E2E_ADMIN_URL]) {
    const c = await browser.newContext({ baseURL: url, ...device }); contexts.push(c)
    const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); if (!player) player = p; else admin = p
  }
})
test.afterAll(async () => { for (const c of contexts) await c.close() })
test.afterEach(() => expect(errors).toEqual([]))
test('桌面注册、登录、资料修改、学号变更后历史编号不变与旧号释放', async () => {
  await player.goto('/login'); await player.screenshot({ path: shot('login-desktop'), fullPage: true })
  await register(player, 'BROWSER-PLAYER-1'); await login(player, 'BROWSER-PLAYER-1')
  await expect(player).toHaveURL(/\/dashboard$/); await expect(player.getByText('暂无启用赛季', { exact: true })).toBeVisible()
  await player.screenshot({ path: shot('dashboard-desktop'), fullPage: true })
  if(await player.getByRole('button',{name:'展开导航'}).isVisible())await player.getByRole('button',{name:'展开导航'}).click(); await player.getByRole('link', { name: '账号设置' }).click(); const identifier = await player.locator('.account-content>.muted').innerText()
  await player.getByLabel('姓名', { exact: true }).fill('修改后的球员'); await player.getByRole('button', { name: '保存资料' }).click(); await expect(player.getByRole('status')).toContainText('基本资料已保存')
  await player.getByLabel('新学号', { exact: true }).fill('BROWSER-PLAYER-NEW'); await player.getByLabel('验证当前密码').fill(pass); await player.getByRole('button', { name: '修改学号并重新登录' }).click(); await expect(player).toHaveURL(/\/login\?notice=changed/)
  await login(player, 'BROWSER-PLAYER-NEW'); if(await player.getByRole('button',{name:'展开导航'}).isVisible())await player.getByRole('button',{name:'展开导航'}).click(); await player.getByRole('link', { name: '账号设置' }).click(); await expect(player.locator('.account-content>.muted')).toHaveText(identifier)
  const reused = await player.request.post('/api/player/register', { data: { student_id: 'BROWSER-PLAYER-1', name: '同名另一人', college: '土木工程学院', password: pass, gender:'male',password_confirm: pass } }); expect(reused.status()).toBe(201)
})
test('原管理员端查询、重置密码、强制改密、启停和学号纠正', async () => {
  await admin.goto('/admin-login'); await admin.getByPlaceholder('请输入用户名').fill('e2e-admin'); await admin.getByPlaceholder('请输入密码', { exact: true }).fill(pass); await admin.getByRole('button', { name: '登录', exact: true }).click(); await expect(admin).toHaveURL(/\/admin-dashboard$/)
  await admin.getByRole('button', { name: '前往球员账号管理' }).click(); await admin.getByPlaceholder('姓名、学号或学院').fill('BROWSER-PLAYER-NEW'); await admin.getByRole('button', { name: '查询', exact: true }).click(); await expect(admin.locator('tbody tr')).toHaveCount(1); await admin.getByRole('button', { name: '管理', exact: true }).click()
  await admin.getByLabel('核实／操作原因').fill('已核实本人忘记密码'); await admin.getByRole('button', { name: '确认重置密码' }).click(); await expect(admin.getByLabel('临时密码', { exact: true })).toBeVisible(); const temporary = await admin.getByLabel('临时密码', { exact: true }).inputValue()
  await player.reload(); await expect(player).toHaveURL(/\/login/); await login(player, 'BROWSER-PLAYER-NEW', temporary); await expect(player).toHaveURL(/\/account$/); await expect(player.getByText('管理员已重置密码，请先用临时密码设置新密码。')).toBeVisible()
  await player.getByLabel('临时密码', { exact: true }).fill(temporary); await player.getByLabel('新密码', { exact: true }).fill(newPass); await player.getByLabel('确认新密码').fill(newPass); await player.getByRole('button', { name: '修改密码并重新登录' }).click(); await expect(player).toHaveURL(/\/login/); await login(player, 'BROWSER-PLAYER-NEW', newPass); await expect(player).toHaveURL(/\/dashboard$/)
  await admin.getByRole('button', { name: '关闭详情' }).click(); await admin.getByRole('button', { name: '管理', exact: true }).click(); await admin.getByLabel('管理操作').selectOption('status'); await admin.getByLabel('核实／操作原因').fill('测试停用'); await admin.getByRole('button', { name: '确认停用账号' }).click(); await expect(admin.locator('.detail>p')).toContainText('停用')
  await player.reload(); await expect(player).toHaveURL(/\/login/)
  await admin.getByLabel('核实／操作原因').fill('恢复测试'); await admin.getByRole('button', { name: '确认启用账号' }).click(); await expect(admin.locator('.detail>p')).toContainText('启用')
  await admin.getByLabel('管理操作').selectOption('student-id'); await admin.getByLabel('新学号', { exact: true }).fill('BROWSER-CORRECTED'); await admin.getByLabel('核实／操作原因').fill('核实后纠正学号'); await admin.getByRole('button', { name: '确认纠正学号' }).click(); await expect(admin.locator('.detail>p')).toContainText('BROWSER-CORRECTED')
  await admin.screenshot({ path: shot('admin-desktop'), fullPage: true })
  await login(player, 'BROWSER-CORRECTED', newPass); await expect(player).toHaveURL(/\/dashboard$/)
})
test('两个页面并发改资料时提示冲突，不覆盖已保存的版本', async () => {
  await player.goto('/account'); const second = await contexts[0].newPage(); await second.goto('/account')
  await expect(second.getByLabel('姓名', { exact: true })).toHaveValue('修改后的球员')
  await player.getByLabel('姓名', { exact: true }).fill('并发后的姓名'); await player.getByRole('button', { name: '保存资料' }).click(); await expect(player.getByRole('status')).toContainText('已保存')
  // 学院组件会刷新共享账号信息；姓名表单仍须提交自己加载时的版本。
  await second.getByRole('button', { name: '刷新申请状态', exact: true }).click()
  await expect(second.getByRole('button', { name: '刷新申请状态', exact: true })).toBeEnabled()
  await expect(second.getByLabel('姓名', { exact: true })).toHaveValue('修改后的球员')
  await second.getByLabel('姓名', { exact: true }).fill('旧页面覆盖'); await second.getByRole('button', { name: '保存资料' }).click(); await expect(second.getByRole('alert')).toContainText('账号资料已变化'); second.once('dialog', d => d.dismiss()); await second.getByRole('button', { name: '刷新最新资料' }).click(); await expect(second.getByLabel('姓名', { exact: true })).toHaveValue('旧页面覆盖'); second.once('dialog', d => d.accept()); await second.getByRole('button', { name: '刷新最新资料' }).click(); await expect(second.getByLabel('姓名', { exact: true })).toHaveValue('并发后的姓名'); await second.close()
})
test('手机注册登录与账号设置无横向溢出，错误提示清晰', async ({ browser }) => {
  const c = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); contexts.push(c); const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message))
  await register(p, 'BROWSER-MOBILE'); await login(p, 'BROWSER-MOBILE'); await expect(p).toHaveURL(/\/dashboard$/); await p.screenshot({ path: shot('dashboard-mobile'), fullPage: true })
  await p.getByRole('button',{name:'展开导航'}).click(); await p.getByRole('link', { name: '账号设置' }).click(); expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await p.getByLabel('新学号', { exact: true }).fill('BROWSER-CORRECTED'); await p.getByLabel('验证当前密码').fill(pass); await p.getByRole('button', { name: '修改学号并重新登录' }).click(); await expect(p.getByRole('alert')).toContainText('已被注册'); await p.getByLabel('验证当前密码').fill(''); await p.screenshot({ path: shot('account-mobile'), fullPage: true })
})


test('阶段3：球员导航、未保存输入保护和公开查询错误重试',async({browser})=>{
  const c=await browser.newContext({baseURL:process.env.E2E_BASE_URL,viewport:{width:390,height:844}});contexts.push(c);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  await login(p,'BROWSER-CORRECTED',newPass);await expect(p).toHaveURL(/dashboard$/);
  await p.getByRole('button',{name:'展开导航'}).click();await p.getByRole('link',{name:'账号设置',exact:true}).click();await expect(p.getByRole('button',{name:'展开导航'})).toHaveAttribute('aria-expanded','false');
  await p.getByLabel('姓名',{exact:true}).fill('这段修改应被保留');p.once('dialog',d=>d.dismiss());await p.getByRole('button',{name:'展开导航'}).click();await p.getByRole('link',{name:'我的主页',exact:true}).click();await expect(p).toHaveURL(/account$/);await expect(p.getByLabel('姓名',{exact:true})).toHaveValue('这段修改应被保留');
  p.once('dialog',d=>d.accept());await p.getByRole('link',{name:'我的主页',exact:true}).click();await expect(p).toHaveURL(/dashboard$/);await p.screenshot({path:shot('phase3-home-mobile'),fullPage:true});
  await p.route('**/api/public/seasons',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,message:'测试：网络暂不可用'})}));
  await p.goto('/public');await expect(p.getByRole('alert')).toContainText('测试：网络暂不可用');await p.unroute('**/api/public/seasons');await p.getByRole('button',{name:'重新加载',exact:true}).click();await expect(p.getByRole('alert')).toHaveCount(0);
  await expect(p.getByLabel('查询赛季')).toBeDisabled();await expect(p.getByText('暂无可查询的赛季',{exact:true})).toBeVisible();
  await expect.poll(()=>p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();await p.screenshot({path:shot('phase3-public-mobile'),fullPage:true});
  await p.setViewportSize({width:1440,height:1000});await p.goto('/dashboard');await p.screenshot({path:shot('phase3-home-desktop'),fullPage:true});
});
