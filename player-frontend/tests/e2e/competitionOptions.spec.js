import {test,expect} from '@playwright/test'
import {device} from './device.js'
import {createRequire} from 'node:module'
const mysql=createRequire(import.meta.url)('../../../backend/node_modules/mysql2/promise')

test('旧版空赛事不显示或阻塞保存，保存一项后各端只出现这一项，再添加自定义赛事',async({browser})=>{
  test.setTimeout(120000)
  if(process.env.REFWEB_E2E!=='1'||process.env.NODE_ENV!=='test'||!/^tj_refweb_e2e_[a-f0-9]{12}_test$/.test(process.env.DB_NAME||'')||!['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST))throw Error('Only the runner-owned local random test database is allowed')
  const adminContext=await browser.newContext({baseURL:process.env.E2E_ADMIN_URL,...device})
  const playerContext=await browser.newContext({baseURL:process.env.E2E_BASE_URL,...device})
  const admin=await adminContext.newPage(),player=await playerContext.newPage(),errors=[]
  for(const page of [admin,player])page.on('pageerror',e=>errors.push(e.message))
  let seasonId
  let previous,headers
  const expectedOptions=async(select,names)=>{
    await expect.poll(()=>select.locator('option').evaluateAll(nodes=>nodes.filter(o=>o.value&&!o.disabled).map(o=>o.textContent.trim()))).toEqual(names)
  }
  const checkSites=async(names)=>{
    await admin.goto('/admin-teams');await expectedOptions(admin.getByLabel('赛事类型',{exact:true}).first(),names)
    await admin.goto('/admin-schedule');await expectedOptions(admin.locator('form select').first(),names);await expectedOptions(admin.getByLabel('比赛类型筛选'),names)
    await admin.goto('/admin-team-applications');await expectedOptions(admin.getByLabel('报名赛事'),names)
    await admin.goto('/admin-discipline');await expectedOptions(admin.getByLabel('赛事',{exact:true}),names)
    await player.goto('/public');await player.getByLabel('查询赛季').selectOption(seasonId);await expectedOptions(player.getByLabel('查询赛事'),names)
    await player.goto('/team-applications');await expectedOptions(player.getByLabel('报名赛事'),names)
  }
  try{
    const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME})
    try{
      const [s]=await c.execute("INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES ('OLD-EMPTY-E2E','旧版空赛事浏览器验收','2026-01-01','2028-12-31',0)")
      seasonId=String(s.insertId)
      for(const name of ['大联赛','足协杯','新生杯'])await c.execute('INSERT INTO season_competitions(season_id,league_type,revision) VALUES (?,?,5)',[seasonId,name])
    }finally{await c.end()}
    await admin.goto('/admin-login');await admin.getByPlaceholder('请输入用户名').fill('e2e-admin');await admin.getByPlaceholder('请输入密码',{exact:true}).fill(process.env.E2E_PASSWORD);await admin.getByRole('button',{name:'登录',exact:true}).click();await expect(admin).toHaveURL(/admin-dashboard$/)
    headers={Authorization:'Bearer '+await admin.evaluate(()=>localStorage.getItem('adminToken'))}
    previous=(await (await admin.request.get('/api/season/current',{headers})).json()).data?.id
    expect((await admin.request.put('/api/season/'+seasonId+'/activate',{headers})).ok()).toBeTruthy()
    expect((await player.request.post('/api/player/register',{data:{student_id:'OPTIONS-PLAYER',name:'赛事选项球员',college:'土木工程学院',password:process.env.E2E_PASSWORD,gender:'male',password_confirm:process.env.E2E_PASSWORD}})).status()).toBe(201)
    await player.goto('/login');await player.getByLabel('学号',{exact:true}).fill('OPTIONS-PLAYER');await player.getByLabel('密码',{exact:true}).fill(process.env.E2E_PASSWORD);await player.getByRole('button',{name:'登录',exact:true}).click();await expect(player).toHaveURL(/dashboard$/)
    await admin.goto('/admin-seasons');await admin.getByLabel('配置赛季').selectOption(seasonId);await expect(admin.getByText('本赛季尚未添加赛事。')).toBeVisible();await expect(admin.locator('.competition-settings')).toHaveCount(0)
    await admin.getByRole('button',{name:'保存球员报名设置'}).click();await expect(admin.getByRole('status')).toContainText('已保存')
    await checkSites([])
    for(const [name,expected]of [['四平足协杯',['四平足协杯']],['自定义校区赛',['四平足协杯','自定义校区赛']]]){
      await admin.goto('/admin-seasons');await admin.getByLabel('配置赛季').selectOption(seasonId)
      await admin.getByLabel('比赛类型',{exact:true}).selectOption(name==='四平足协杯'?name:'其它');if(name!=='四平足协杯')await admin.getByLabel('赛事名称',{exact:true}).fill(name)
      await admin.getByRole('button',{name:'添加赛事',exact:true}).click()
      await admin.getByRole('button',{name:'保存球员报名设置'}).click();await expect(admin.locator('.field-error').first()).toBeVisible()
      for(const [field,n]of [['黄牌累计张数','3'],['黄牌停赛场数','2'],['红牌累计张数','1'],['红牌停赛场数','1']])await admin.getByLabel(name+field,{exact:true}).fill(n)
      await admin.getByRole('button',{name:'保存球员报名设置'}).click();await expect(admin.getByRole('status')).toContainText('已保存');await admin.reload()
      await expect(admin.locator('.competition-settings')).toHaveCount(expected.length);await expect(admin.getByLabel('大联赛黄牌累计张数',{exact:true})).toHaveCount(0)
      await checkSites(expected)
    }
    expect(errors).toEqual([])
  }finally{
    if(headers)await admin.request.put('/api/season/'+(previous||seasonId)+(previous?'/activate':'/deactivate'),{headers})
    await adminContext.close();await playerContext.close()
  }
})
