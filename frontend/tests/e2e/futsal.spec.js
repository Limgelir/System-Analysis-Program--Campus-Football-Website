import {test,expect} from '@playwright/test'
import {createRequire} from 'node:module'
const mysql=createRequire(import.meta.url)('../../../backend/node_modules/mysql2/promise')

test('五人制建赛程、选派、切换确认、报告及手机布局',async({page})=>{
 test.setTimeout(120000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 const password=process.env.E2E_PASSWORD
 const api=async(path,data,token,method=data===undefined?'GET':'POST')=>{
  const r=await page.request.fetch('/api'+path,{method,data,headers:token?{Authorization:'Bearer '+token}:{}})
  expect(r.ok(),path+': '+await r.text()).toBeTruthy();return (await r.json()).data
 }
 const admin=await api('/admin/login',{username:'e2e-admin',password})
 const day=n=>new Date(Date.now()+8*3600000+n*86400000).toISOString().slice(0,10)
 const season=await api('/season',{season_code:'E2E-FUTSAL',season_name:'五人制浏览器验收',start_date:day(0),end_date:'2099-12-31',is_active:true},admin.token)
 if(process.env.REFWEB_E2E!=='1'||!process.env.DB_NAME.startsWith('tj_refweb_e2e_'))throw Error('仅限隔离E2E库')
 const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME})
 const teams=[]
 try{await c.execute("INSERT INTO season_competitions(season_id,league_type) VALUES (?,'五人制验收赛')",[season.id]);for(const name of ['五人制主队','五人制客队'])teams.push((await c.execute("INSERT INTO team(season_id,team_name,league_type) VALUES (?,?,'五人制验收赛')",[season.id,name]))[0].insertId)}finally{await c.end()}
 const refs=[]
 for(const i of [17,18,19]){
  const r=await api('/referee/login',{student_id:'E2E-'+i,password});refs.push(r)
  const reg=await api('/season-registration/current/submit',{name:'浏览器裁判'+i,college:'土木工程学院',height_cm:175,weight_kg:65,grade:'三级',match_types:['足协杯']},r.token)
  await api('/season-registration/admin/'+reg.id+'/approve',{reason:'本地五人制验收'},admin.token)
 }
 await page.goto('/admin-login');await page.getByPlaceholder('请输入用户名').fill('e2e-admin');await page.getByPlaceholder('请输入密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/admin-dashboard$/)
 await page.goto('/admin-schedule')
 const form=page.locator('form').filter({has:page.getByRole('button',{name:'添加赛程',exact:true})})
 await form.locator('select').nth(0).selectOption('五人制验收赛');await form.locator('select').nth(1).selectOption(String(teams[0]));await form.locator('select').nth(2).selectOption(String(teams[1]))
 await form.locator('input[type=date]').fill(day(1));await form.locator('#formData-match-time').fill('17:35');await form.getByPlaceholder('例如 A1、J1、1').fill('F-UI')
 await form.getByLabel('五人制裁判安排').check();await expect(form.getByLabel('本场需要第四官员')).toHaveCount(0);await form.getByLabel('本场需要裁判监督').check()
 await form.getByLabel('比赛场地').selectOption('樱花人草')
 await form.getByRole('button',{name:'添加赛程',exact:true}).click();await expect(page.getByText('赛程已创建，并自动生成了空报告。')).toBeVisible()
 const list=await api('/schedule?season_id='+season.id,undefined,admin.token)
 const match=(list.schedules||list.items||list).find(m=>m.field_order==='F-UI')
 expect(match.futsal).toBe(true)
 await page.goto('/admin-assignments')
 const editor=page.locator('#match-'+match.id)
 await expect(editor.getByPlaceholder('搜索第二裁判员姓名或学号')).toBeVisible();await expect(editor.getByPlaceholder('搜索计时员姓名或学号')).toBeVisible();await expect(editor.getByPlaceholder('搜索第一助理裁判员姓名或学号')).toHaveCount(0)
 for(const [role,index]of [['裁判员',17],['第二裁判员',18],['计时员',19],['裁判监督',18]]){await editor.getByPlaceholder('搜索'+role+'姓名或学号',{exact:true}).fill('E2E-'+index);await editor.locator('.result-item:not(.result-create)').filter({hasText:'E2E-'+index}).click()}
 await editor.getByRole('button',{name:'保存选派',exact:true}).click();await expect(editor.getByText('选派已保存',{exact:true})).toBeVisible();await page.reload();await expect(editor.locator('.selected-card')).toHaveCount(4)
 await editor.getByLabel('五人制裁判安排').uncheck();page.once('dialog',d=>d.dismiss());await editor.getByRole('button',{name:'保存选派',exact:true}).click()
 expect((await api('/schedule/'+match.id,undefined,admin.token)).futsal).toBe(true)
 page.once('dialog',d=>d.accept());await editor.getByRole('button',{name:'保存选派',exact:true}).click();await expect(editor.getByText('选派已保存',{exact:true})).toBeVisible()
 const ordinary=await api('/schedule/'+match.id,undefined,admin.token);expect(ordinary.futsal).toBe(false);expect(ordinary.second_referee_id).toBeNull()
 await editor.getByLabel('五人制裁判安排').check();page.once('dialog',d=>d.accept());await editor.getByRole('button',{name:'保存选派',exact:true}).click();await expect(editor.getByText('选派已保存',{exact:true})).toBeVisible()
 for(const [role,index]of [['第二裁判员',18],['计时员',19]]){await editor.getByPlaceholder('搜索'+role+'姓名或学号',{exact:true}).fill('E2E-'+index);await editor.locator('.result-item:not(.result-create)').filter({hasText:'E2E-'+index}).click()}
 await editor.getByRole('button',{name:'保存选派',exact:true}).click();await expect(editor.getByText('选派已保存',{exact:true})).toBeVisible()
 await page.setViewportSize({width:390,height:844});await editor.scrollIntoViewIfNeeded();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();await page.screenshot({path:'test-results/futsal-assignment-mobile.png'})
 await page.goto('/referee-login');await page.getByPlaceholder('请输入学号').fill('E2E-17');await page.getByPlaceholder('请输入密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/referee-dashboard$/)
 await page.goto('/referee-signups');await page.getByRole('button',{name:/五人制验收赛/}).click()
 await page.getByLabel('未参加',{exact:true}).check();await page.getByRole('button',{name:'保存参队信息',exact:true}).click()
 const signup=page.locator('article[data-schedule-id="'+match.id+'"]')
 await expect(signup.locator('fieldset label')).toHaveText(['裁判员','第二裁判员','计时员','裁判监督'])
 await signup.getByLabel('第二裁判员',{exact:true}).check();await signup.getByLabel('计时员',{exact:true}).check();await signup.getByRole('button',{name:'提交报名',exact:true}).click();await expect(signup.getByText('当前意向：第二裁判员、计时员')).toBeVisible()
 await signup.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/futsal-signup-mobile.png'})
 await page.goto('/referee-report/'+match.id)
 const second=page.locator('.subsection').filter({has:page.getByRole('heading',{name:'第二裁判员执法数据',exact:true})})
 await expect(second).toBeVisible();await expect(page.getByText('助理裁判员数据（可选）',{exact:true})).toHaveCount(0);await expect(page.getByText('越位举旗',{exact:false})).toHaveCount(0);await expect(page.getByRole('heading',{name:'比赛记录单',exact:true})).toBeVisible()
 await second.locator('input').nth(0).fill('2500');await second.locator('input').nth(1).fill('175');await page.getByRole('button',{name:'保存裁判员区',exact:true}).click();await expect(page.locator('.report-notice')).toContainText('保存成功');await page.reload();await expect(second.locator('input').nth(0)).toHaveValue('2500')
 await second.locator('h4').scrollIntoViewIfNeeded();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();await page.screenshot({path:'test-results/futsal-report-mobile.png'})
 await page.setViewportSize({width:1440,height:1000});await second.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/futsal-report-desktop.png'})
 await page.getByRole('button',{name:'提交裁判员区',exact:true}).click();await expect(page.locator('.report-notice')).toContainText('提交成功');await expect(second.locator('input').first()).toBeDisabled()
 const report=await api('/report/schedule/'+match.id,undefined,refs[0].token);expect(report.stats.find(s=>s.role==='second').running_distance_m).toBe(2500);expect(report.stats.some(s=>s.role==='assistant1'||s.role==='assistant2')).toBe(false)
 expect(errors).toEqual([])
})
