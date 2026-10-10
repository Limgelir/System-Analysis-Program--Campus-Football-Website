import { test, expect } from '@playwright/test'
import path from 'node:path'
import crypto from 'node:crypto'
import { device } from './device.js'

test.describe.configure({ mode: 'serial' })
const pass = process.env.E2E_PASSWORD
const contexts = [], errors = [], accounts = []
let manager, captain, ordinary, admin, adminToken, seasonId, config, applicationUrl
const iso = delta => new Date(Date.now() + delta + 8 * 3600000).toISOString().replace('Z', '+08:00')
async function api(url, data, token = adminToken, method = 'GET', revision, status = 200, extra = {}) {
  if(url==='/api/schedule'&&method==='POST')data={venue:'樱花人草',...data};
  const match=/^\/api\/schedule\/(\d+)(?:\/assign-referees)?$/.exec(url);
  if(match&&method==='PUT'&&data&&data.schedule_revision===undefined){const d=await admin.request.get('/api/schedule/'+match[1],{headers:{Authorization:'Bearer '+token}});if(d.ok())data={...data,schedule_revision:(await d.json()).data.schedule_revision};}
  const response = await admin.request.fetch(url, { method, data, headers: { Authorization: `Bearer ${token}`, ...(revision === undefined ? {} : { 'If-Match': String(revision) }), ...extra } })
  expect(response.status(), `${method} ${url}: ${await response.text()}`).toBe(status)
  return (await response.json()).data
}
async function window(open) {
  config = await api(`/api/player-admin/season-settings/${seasonId}`, {
    registration_opens_at: iso(-7200000), registration_closes_at: iso(86400000),
    competitions: (config.competitions.length?config.competitions:['大联赛','足协杯','新生杯'].map(league_type=>({league_type}))).map(c => ({ yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1,league_type: c.league_type, is_enabled: c.league_type !== '新生杯', rules_text: '外援与运训分别计数，由管理员人工审核。', registration_opens_at: iso(-7200000), registration_closes_at: iso(open ? 86400000 : -3600000), change_windows: [] }))
  }, adminToken, 'PUT', config.revision)
}
async function login(page, index) {
  if (index === 4) await page.evaluate(() => localStorage.clear())
  await page.goto('/login'); await page.getByLabel('学号', { exact: true }).fill(`BROWSER-TEAM-${index}`); await page.getByLabel('密码', { exact: true }).fill(pass)
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page).toHaveURL(/dashboard$/)
}
async function add(index) {
  await manager.getByLabel('添加球员学号').fill(`BROWSER-TEAM-${index}`); await manager.getByRole('button', { name: '按学号添加', exact: true }).click()
  await expect(manager.locator('.member-card').filter({ has: manager.getByRole('heading', { name: `组队浏览器${index}`, exact: true }) })).toBeVisible()
}
async function save(page = manager) { await page.getByRole('button', { name: '保存草稿', exact: true }).click(); await expect(page.getByRole('status')).toContainText('草稿已保存') }
async function submit() { await manager.getByRole('button', { name: '预览并提交', exact: true }).click(); await manager.getByRole('button', { name: '确认提交整队审核', exact: true }).click(); await expect(manager.getByRole('status')).toContainText('整队申请已提交') }
async function query() {
  await admin.goto('/admin-team-applications'); await admin.getByLabel('球队申请状态').selectOption(''); await admin.getByLabel('查询队名').fill('浏览器组队验收')
  await admin.getByRole('button', { name: '查询球队报名', exact: true }).click(); await expect(admin.locator('tbody tr')).toHaveCount(1); await admin.getByRole('button', { name: '查看球队申请', exact: true }).click(); await expect(admin.locator('.team-review-detail')).toBeVisible()
}
test.beforeAll(async ({ browser }) => {
  for (let i = 0; i < 4; i++) {
    const c = await browser.newContext({ baseURL: i === 3 ? process.env.E2E_ADMIN_URL : process.env.E2E_BASE_URL, ...device }); contexts.push(c)
    const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('response', r => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`) })
    if (i === 0) manager = p; else if (i === 1) captain = p; else if (i === 2) ordinary = p; else admin = p
  }
  await admin.goto('/admin-login'); await admin.getByPlaceholder('请输入用户名').fill('e2e-admin'); await admin.getByPlaceholder('请输入密码', { exact: true }).fill(pass); await admin.getByRole('button', { name: '登录', exact: true }).click(); await expect(admin).toHaveURL(/admin-dashboard$/)
  adminToken = await admin.evaluate(() => localStorage.getItem('adminToken'))
  seasonId = (await api('/api/season', { season_code: 'BROWSER-TEAM', season_name: '浏览器球队测试赛季', start_date: '2026-01-01', end_date: '2026-12-31', is_active: true }, adminToken, 'POST', undefined, 201)).id
  config = await api(`/api/player-admin/season-settings/${seasonId}`); await window(true)
  const demo = await contexts[0].newPage(); await demo.setViewportSize({ width: 640, height: 420 }); await demo.setContent('<html lang="zh"><body style="padding:40px;font-family:Microsoft YaHei;background:#eef3f9;color:#243f60"><h1>虚构测试学籍材料</h1><p>同济大学校园球员管理系统 · 本地验收</p><p>此图不包含真实个人信息，不是学籍证明。</p></body></html>'); const png = await demo.screenshot({ path: path.resolve('../.cache/player-batch3-academic-demo.png') }); await demo.close()
  for (let i = 0; i <= 4; i++) {
    await api('/api/player/register', { student_id: `BROWSER-TEAM-${i}`, name: `组队浏览器${i}`, college: '土木工程学院', password: pass, gender:'male',password_confirm: pass }, null, 'POST', undefined, 201)
    const p = await api('/api/player/login', { student_id: `BROWSER-TEAM-${i}`, password: pass }, null, 'POST'); accounts.push(p)
    if (i >= 1 && i <= 3) {
      const response = await admin.request.post('/api/player/season-registration/submit', { headers: { Authorization: `Bearer ${p.token}`, 'If-Match': '0', 'Idempotency-Key': crypto.randomUUID() }, multipart: { season_id: String(seasonId), account_revision: String(p.revision), academic_image: { name: '虚构材料.png', mimeType: 'image/png', buffer: png } } }); expect(response.status()).toBe(201)
      const reg = (await response.json()).data; await api(`/api/player-admin/season-registrations/${reg.registration.id}/approve`, { account_revision: p.revision }, adminToken, 'POST', reg.revision)
    }
  }
  await login(manager, 0); await login(captain, 1); await login(ordinary, 2)
})
test.afterAll(async () => { for (const c of contexts) await c.close() })
test.afterEach(() => expect(errors).toEqual([]))

test('负责人建队、队长协作、普通队员只读；旧页面不能覆盖新修改', async () => {
  await manager.goto('/team-applications'); await manager.getByLabel('报名赛事').selectOption({ label: '大联赛' }); await manager.getByLabel('新球队名称').fill('浏览器组队验收'); await manager.getByRole('button', { name: '创建报名草稿' }).click(); await expect(manager).toHaveURL(/team-applications\/\d+$/); applicationUrl = new URL(manager.url()).pathname
  await add(1); await add(2); await manager.getByLabel('组队浏览器1任场上队长').check(); await manager.getByLabel('组队浏览器1守门员', { exact: true }).check(); await manager.getByLabel('组队浏览器2外援', { exact: true }).check(); await manager.getByLabel('组队浏览器2运训', { exact: true }).check()
  await manager.getByLabel('组队浏览器1号码').fill('0'); await manager.getByLabel('组队浏览器2号码').fill('10')
  for (const label of ['上衣主要颜色', '裤子主要颜色', '袜子主要颜色']) await manager.getByLabel(label).fill('红')
  await save(); await captain.goto(applicationUrl); await expect(captain.getByRole('button', { name: '保存草稿' })).toBeVisible()
  await ordinary.goto(applicationUrl); await expect(ordinary.getByRole('button', { name: '保存草稿' })).toHaveCount(0); await expect(ordinary.locator('.member-card').first()).not.toContainText('BROWSER-TEAM-1')
  await captain.getByLabel('袜子主要颜色').fill('白'); await save(captain)
  await manager.getByLabel('上衣主要颜色').fill('蓝'); await manager.getByRole('button', { name: '保存草稿' }).click(); await expect(manager.getByRole('alert')).toContainText('内容已变化'); await expect(manager.getByLabel('上衣主要颜色')).toHaveValue('蓝')
  manager.once('dialog',d=>d.dismiss()); await manager.getByRole('button', { name: '重新载入（放弃未保存）' }).click(); await expect(manager.getByLabel('上衣主要颜色')).toHaveValue('蓝'); manager.once('dialog',d=>d.accept()); await manager.getByRole('button', { name: '重新载入（放弃未保存）' }).click(); await expect(manager.getByLabel('袜子主要颜色')).toHaveValue('白'); await submit()
  await expect(manager.getByRole('button', { name: '保存草稿' })).toHaveCount(0)
})

test('管理员查看学籍并指定退回人员；截止后只开放指定替换，重提后正式发布', async () => {
  await window(false); await query(); await expect(admin.locator('.admin-team-counts')).toContainText('外援 1'); await expect(admin.locator('.admin-team-counts')).toContainText('运训 1')
  await admin.getByRole('button', { name: '组队浏览器1学籍详情' }).click(); await expect(admin.locator('.academic-review img')).toBeVisible(); expect(await admin.locator('.academic-review img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0)
  await admin.getByRole('button', { name: '退回球队补正' }).click(); await expect(admin.getByRole('alert')).toContainText('不能为空')
  await admin.getByLabel('允许替换组队浏览器2').check(); await admin.getByLabel('组队浏览器2的退回说明').fill('指定球员需要替换'); await admin.getByLabel('整队审核说明／退回理由').fill('请更换指定球员，其他人员不变'); await admin.getByRole('button', { name: '退回球队补正' }).click(); await expect(admin.getByRole('status')).toContainText('已退回')
  await manager.reload(); await expect(manager.getByRole('button', { name: '替换组队浏览器2', exact: true })).toBeVisible(); await expect(manager.getByRole('button', { name: '移除组队浏览器1' })).toHaveCount(0); await expect(manager.getByLabel('添加球员学号')).toHaveCount(0)
  await manager.getByRole('button', { name: '替换组队浏览器2', exact: true }).click(); await manager.getByLabel('替换为此学号球员').fill('BROWSER-TEAM-3'); await manager.getByRole('button', { name: '确认替换球员' }).click(); await expect(manager.getByLabel('组队浏览器3号码')).toBeVisible(); await save(); await submit()
  await query(); await expect(admin.getByRole('heading', { name: '与原名单或上次退回版本的差异' })).toBeVisible(); await admin.getByRole('button', { name: '通过整队报名' }).click(); await expect(admin.getByRole('status')).toContainText('已进入正式球队库')
  await admin.screenshot({ path: path.resolve('../.cache/player-batch3-review.png'), fullPage: true }); await manager.reload(); await expect(manager.getByRole('heading', { name: '负责人／场上队长变更', exact: true })).toBeVisible()
})

test('窗口外角色申请可以撤回重提、退回再申请；审批后新负责人立即获得权限', async () => {
  const panel = manager.locator('.team-role-panel')
  await panel.getByLabel('新任人选学号').fill('BROWSER-TEAM-4'); await panel.getByRole('button', { name: '核对新任人选' }).click(); await expect(panel.getByText('组队浏览器4 · BROWSER-TEAM-4 · 土木工程学院', { exact: true })).toBeVisible(); await panel.getByRole('button', { name: '提交角色变更申请' }).click(); await expect(panel.getByRole('status')).toContainText('角色变更已提交')
  await panel.getByRole('button', { name: '撤回角色申请' }).click(); await expect(panel.locator('.role-requests')).toContainText('已撤回')
  await panel.getByRole('button', { name: '提交角色变更申请' }).click(); await expect(panel.locator('.role-requests li')).toHaveCount(2)
  await admin.goto('/admin-team-applications'); await admin.getByRole('button', { name: '角色变更', exact: true }).click(); await admin.getByRole('button', { name: '审核角色变更' }).click(); await admin.getByLabel('角色审核说明／退回理由').fill('补充交接说明'); await admin.getByRole('button', { name: '退回角色变更', exact: true }).click(); await expect(admin.getByRole('status')).toContainText('已退回')
  await panel.getByRole('button', { name: '刷新角色申请' }).click(); await expect(panel.locator('.role-requests')).toContainText('已退回'); await panel.getByLabel('角色变更说明').fill('已完成负责人交接'); await panel.getByRole('button', { name: '提交角色变更申请' }).click(); await expect(panel.locator('.role-requests li')).toHaveCount(3)
  await admin.getByRole('button', { name: '查询角色申请' }).click(); await admin.getByRole('button', { name: '审核角色变更' }).click(); await admin.getByRole('button', { name: '通过角色变更' }).click(); await expect(admin.getByRole('status')).toContainText('权限立即生效')
  await manager.reload(); await expect(manager.getByRole('alert')).toContainText('只有本队'); await expect(manager.locator('.team-role-panel')).toHaveCount(0)
  await login(ordinary, 4); await ordinary.goto(applicationUrl); await expect(ordinary.locator('.team-role-panel')).toBeVisible(); await expect(ordinary.getByText('负责人：组队浏览器4 · BROWSER-TEAM-4', { exact: true })).toBeVisible()
})

test('手机球队名单和审核详情可用，无页面横向溢出', async () => {
  await ordinary.setViewportSize({ width: 390, height: 844 }); await expect(ordinary.locator('.member-card')).toHaveCount(2); expect(await ordinary.evaluate(() => document.documentElement.scrollWidth <=document.documentElement.clientWidth)).toBe(true); await ordinary.screenshot({ path: path.resolve('../.cache/player-batch3-team-mobile.png'), fullPage: true })
  await query(); await admin.setViewportSize({ width: 390, height: 844 }); expect(await admin.evaluate(() => document.documentElement.scrollWidth <=document.documentElement.clientWidth)).toBe(true); await admin.screenshot({ path: path.resolve('../.cache/player-batch3-review-mobile.png'), fullPage: true })
})

test('第四批手机端从正式名单变更，队长协作，审核立即生效并保留旧申请',async()=>{
  await ordinary.setViewportSize({width:390,height:844});await admin.setViewportSize(device.viewport);
  config=await api(`/api/player-admin/season-settings/${seasonId}`);
  config=await api(`/api/player-admin/season-settings/${seasonId}`,{registration_opens_at:iso(-7200000),registration_closes_at:iso(86400000),competitions:config.competitions.map(c=>({yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1,league_type:c.league_type,is_enabled:c.is_enabled,rules_text:c.rules_text,registration_opens_at:c.registration_opens_at,registration_closes_at:c.registration_closes_at,change_windows:[{opens_at:iso(-7200000),closes_at:iso(86400000)}]}))},adminToken,'PUT',config.revision);
  const formal=(await api('/api/player'+applicationUrl,undefined,accounts[4].token)).application.team_id;
  await ordinary.goto('/dashboard');await ordinary.getByRole('link').filter({hasText:'浏览器组队验收'}).filter({hasText:'查看名单与比赛'}).click();await expect(ordinary).toHaveURL(new RegExp('/teams/'+formal+'$'));
  await ordinary.getByRole('button',{name:'从当前名单建立变更稿'}).click();await expect(ordinary.getByRole('heading',{name:'名单变更 · 草稿'})).toBeVisible();const url=new URL(ordinary.url()).pathname;
  await ordinary.getByRole('button',{name:'移除组队浏览器3'}).click();await ordinary.getByLabel('添加球员学号').fill('BROWSER-TEAM-2');await ordinary.getByRole('button',{name:'按学号添加',exact:true}).click();await ordinary.getByLabel('组队浏览器2号码').fill('22');await save(ordinary);
  await captain.goto(url);await captain.getByLabel('上衣主要颜色').fill('蓝');await save(captain);await ordinary.reload();await expect(ordinary.getByLabel('上衣主要颜色')).toHaveValue('蓝');
  await ordinary.getByRole('button',{name:'预览并提交',exact:true}).click();await ordinary.getByRole('button',{name:'确认提交整队审核'}).click();await expect(ordinary.getByRole('status')).toContainText('已提交');
  expect((await api(`/api/team/${formal}/current-roster`)).players.some(p=>p.player_account_id===accounts[3].id)).toBe(true);
  await admin.goto('/admin-team-applications');await admin.getByLabel('球队申请状态').selectOption('pending');await admin.getByLabel('查询队名').fill('浏览器组队验收');await admin.getByRole('button',{name:'查询球队报名'}).click();await expect(admin.locator('tbody tr')).toHaveCount(1);await expect(admin.locator('tbody tr')).toContainText('名单变更');await admin.getByRole('button',{name:'查看球队申请'}).click();await expect(admin.getByRole('heading',{name:'与原名单或上次退回版本的差异'})).toBeVisible();await admin.getByRole('button',{name:'通过名单变更（立即生效）'}).click();await expect(admin.getByRole('status')).toContainText('已通过');
  await ordinary.goto('/teams/'+formal);await expect(ordinary.getByText('当前正式名单第 2 版。',{exact:false})).toBeVisible();await expect(ordinary.getByRole('heading',{name:'22号 · 组队浏览器2'})).toBeVisible();await expect(ordinary.getByRole('heading',{name:/组队浏览器3/})).toHaveCount(0);expect(await ordinary.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);await ordinary.screenshot({path:path.resolve('../.cache/player-batch4-team-mobile.png'),fullPage:true});
  await captain.goto(applicationUrl);await expect(captain.getByLabel('组队浏览器3号码')).toBeVisible();await expect(captain.getByRole('link',{name:/查看当前正式名单/})).toBeVisible();
})

test('第五批公开名单、本人进球、管理员首次修订及手机比分页面',async()=>{
  const formal=(await api('/api/player'+applicationUrl,undefined,accounts[4].token)).application.team_id
  await window(true)
  const app=await api('/api/player/team-applications',{season_id:seasonId,competition_id:config.competitions.find(c=>c.league_type==='大联赛').id,team_name:'第五批浏览器客队'},accounts[4].token,'POST',undefined,201,{'Idempotency-Key':crypto.randomUUID()})
  const body={team_name:'第五批浏览器客队',shirt_color:'白',shorts_color:'白',socks_color:'白',members:[{player_id:accounts[3].id,jersey_number:'9',is_captain:true,is_goalkeeper:true,is_foreign:true,is_sports_training:true}]}
  let d=await api('/api/player/team-applications/'+app.application.id,body,accounts[4].token,'PUT',app.application.revision)
  d=await api('/api/player/team-applications/'+d.application.id+'/submit',{},accounts[4].token,'POST',d.application.revision)
  const reviewed=await api('/api/player-admin/team-applications/'+d.application.id)
  const approved=await api('/api/player-admin/team-applications/'+d.application.id+'/approve',{reason:'第五批浏览器验收',review_token:reviewed.review_token},adminToken,'POST',reviewed.application.revision)
  const ext=await api('/api/officials/external',{name:'第五批浏览器非系统裁判员',note:'测试'},adminToken,'POST',undefined,201)
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10)
  const m=await api('/api/schedule',{team_a_id:formal,team_b_id:approved.application.team_id,match_type:'大联赛',match_time: '00:00', match_date: today,field_order:500,main_referee_id:'external:'+ext.id},adminToken,'POST')
  const report=await api('/api/report/schedule/'+m.id),p=report.match_rosters.find(r=>r.team_id===formal).players[0]
  const guest=await contexts[0].browser().newContext({baseURL:process.env.E2E_BASE_URL,viewport:{width:390,height:844}});contexts.push(guest);const page=await guest.newPage()
  await page.goto('/public');await page.getByLabel('查询赛季').selectOption(String(seasonId));await page.getByRole('link',{name:/浏览器组队验收/}).click();await expect(page.getByText('待发布',{exact:false})).toBeVisible()
  const result={home_score:2,away_score:1,home_penalty_score:4,away_penalty_score:3,goals:[['normal',10],['penalty',20],['own_goal',30]].map(([type,minute])=>({player_team_id:formal,credited_team_id:type==='own_goal'?approved.application.team_id:formal,team_player_id:p.id,goal_type:type,minute_base:minute})),cards:[{team_id:formal,team_player_id:p.id,card_type:'red',minute_base:80}]}
  await api(`/api/report/admin/schedule/${m.id}/sections/main/revise`,{reason:'首次正式修订',data:result},adminToken,'POST',report.sections.main.revision)
  await page.getByRole('button',{name:'刷新比赛结果'}).click();await page.getByRole('button',{name:/历史比赛/}).click();await expect(page.locator('.score')).toHaveText('2 : 1');await expect(page.getByText('点球大战：4 : 3')).toBeVisible();await page.getByText('查看进球记录',{exact:true}).click();await expect(page.getByText('乌龙球（不计个人进球）',{exact:false})).toBeVisible()
  const nextDate=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,10)
  await api('/api/schedule',{team_a_id:formal,team_b_id:approved.application.team_id,match_type:'大联赛',match_time:'17:35',match_date:nextDate,field_order:'J1',main_referee_id:'external:'+ext.id},adminToken,'POST')
  await captain.goto('/public/teams/'+formal);await expect(captain.getByRole('button',{name:'未来赛程',exact:true})).toHaveAttribute('aria-pressed','true');await expect(captain.locator('.suspensions')).toContainText(p.player_name);await expect(captain.locator('.suspensions')).toContainText('累计红牌');await expect(captain.locator('.suspensions')).toContainText('第五批浏览器客队');await expect(captain.locator('.match-card')).toContainText('场序 J1')
  await captain.screenshot({path:path.resolve('../.cache/competition-player-suspensions.png'),fullPage:true})
  expect(await page.locator('body').innerText()).not.toContain('BROWSER-TEAM-');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true)
  await captain.goto('/public/teams/'+formal);await expect(captain.locator('.goal-total')).toContainText('2');await expect(page.getByText('点球大战：0 : 0',{exact:true})).toHaveCount(0);await page.screenshot({path:path.resolve('../.cache/player-batch5-public-mobile.png'),fullPage:true})
})

test('第五批结束赛季清理材料，审核历史可读且结束后不能报名',async()=>{
  await admin.goto('/admin-seasons');await admin.getByLabel('配置赛季').selectOption(String(seasonId));
  await expect(admin.getByRole('button',{name:'保存球员报名设置'})).toBeVisible()
  const cleanupButton=admin.getByRole('button',{name:'查看待清理材料'});await cleanupButton.scrollIntoViewIfNeeded()
  expect(await admin.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true)
  await cleanupButton.click();await expect(admin.locator('.season-cleanup')).toContainText('学籍截图共 3 张')
  await admin.getByLabel('输入赛季名称确认').fill('浏览器球队测试赛季');await admin.getByRole('button',{name:'确认结束赛季并清理截图'}).click();await expect(admin.getByRole('status')).toContainText('本赛季在线学籍材料已全部清理')
  await expect(admin.getByRole('button',{name:'保存球员报名设置'})).toBeDisabled();await captain.goto('/season-registration');await expect(captain.getByText('材料已清理。',{exact:true})).toBeVisible();await expect(captain.getByText('该赛季已经结束。',{exact:true})).toBeVisible()
})
