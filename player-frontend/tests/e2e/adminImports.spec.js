import {test,expect} from '@playwright/test'
import {device} from './device.js'
import {createRequire} from 'node:module'
import crypto from 'node:crypto'
const XLSX=createRequire(import.meta.url)('../../../backend/node_modules/xlsx')
test('管理员窗口外导入未注册名单，颜色选填并显示斜杠，注册审核后可管理球队',async({browser})=>{
  test.setTimeout(120000)
  const adminContext=await browser.newContext({baseURL:process.env.E2E_ADMIN_URL,...device}),playerContext=await browser.newContext({baseURL:process.env.E2E_BASE_URL,...device})
  const admin=await adminContext.newPage(),player=await playerContext.newPage(),errors=[]
  for(const p of [admin,player])p.on('pageerror',e=>errors.push(e.message))
  let headers,previous,seasonId
  const api=async(path,data,method='GET',extra={})=>{const r=await admin.request.fetch('/api'+path,{method,data,headers:{...headers,...extra}});expect(r.ok(),await r.text()).toBeTruthy();return (await r.json()).data}
  const name='特殊导入浏览器队',student='BROWSER-IMPORT-CAPTAIN',personName='浏览器未注册队长',password=process.env.E2E_PASSWORD
  try{
    await admin.goto('/admin-login');await admin.getByPlaceholder('请输入用户名').fill('e2e-admin');await admin.getByPlaceholder('请输入密码',{exact:true}).fill(password);await admin.getByRole('button',{name:'登录',exact:true}).click();await expect(admin).toHaveURL(/admin-dashboard$/)
    headers={Authorization:'Bearer '+await admin.evaluate(()=>localStorage.getItem('adminToken'))}
    previous=(await (await admin.request.get('/api/season/current',{headers})).json()).data
    const season=await api('/season',{season_code:'BROWSER-IMPORT',season_name:'特殊导入浏览器赛季',start_date:'2026-01-01',end_date:'2099-12-31',is_active:true},'POST')
    seasonId=season.id
    const time=n=>new Date(Date.now()+n+8*3600000).toISOString().replace('Z','+08:00')
    await api('/player-admin/season-settings/'+season.id,{registration_opens_at:time(-3600000),registration_closes_at:time(86400000),competitions:[{league_type:'窗口外导入赛',is_enabled:false,registration_opens_at:null,registration_closes_at:null,rules_text:'',change_windows:[],yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1}]},'PUT',{'If-Match':'0'})
    await admin.goto('/admin-teams');const form=admin.locator('.roster-import').first()
    await form.getByLabel('队伍名称',{exact:true}).fill(name);await form.getByLabel('赛事类型',{exact:true}).selectOption('窗口外导入赛');await form.getByLabel('负责人当前学号').fill(student);await form.getByLabel('负责人姓名',{exact:true}).fill(personName)
    for(const label of ['上衣主要颜色','裤子主要颜色','袜子主要颜色'])await expect(form.getByLabel(label)).not.toHaveAttribute('required')
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['学号','姓名','号码','场上队长','守门员','外援','运训','备注'],[student,personName,'7','是','否','否','否',''],['BROWSER-IMPORT-MEMBER','浏览器未注册队员','9','否','否','否','否','']]),'名单')
    await form.getByLabel('新版名单 Excel').setInputFiles({name:'离线名单.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})})
    await form.getByRole('button',{name:'预览导入名单',exact:true}).click();await expect(form.locator('.import-preview')).toContainText('待关联 2 人');await expect(form.locator('.import-preview')).toContainText('上衣：/；裤子：/；袜子：/')
    await form.getByRole('button',{name:'确认审核通过并立即导入'}).click();await expect(form.getByRole('status')).toContainText('立即生效')
    const team=(await api('/team/list')).teams.find(t=>t.team_name===name)
    await player.goto('/public/teams/'+team.id);await expect(player.locator('.public-team')).toContainText(personName);await expect(player.locator('.public-team')).toContainText('球衣（上衣／裤子／袜子）：/ / / / /')
    // Use the real register/qualification APIs, then check the resulting player UI.
    const created=await player.request.post('/api/player/register',{data:{student_id:student,name:personName,college:'土木工程学院',password,gender:'male',password_confirm:password}});expect(created.status()).toBe(201)
    await player.goto('/login');await player.getByLabel('学号',{exact:true}).fill(student);await player.getByLabel('密码',{exact:true}).fill(password);await player.getByRole('button',{name:'登录',exact:true}).click()
    await expect(player).not.toHaveURL(/\/login$/)
    const token=await player.evaluate(()=>localStorage.getItem('playerToken'))
    const ph={Authorization:'Bearer '+token}
    const profile=await player.request.get('/api/player/me',{headers:ph});expect(profile.ok()).toBeTruthy();const account=(await profile.json()).data
    expect((await player.request.get('/api/player/teams/'+team.id,{headers:ph})).status()).toBe(403)
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=','base64')
    const submitted=await player.request.post('/api/player/season-registration/submit',{headers:{...ph,'If-Match':'0','Idempotency-Key':crypto.randomUUID()},multipart:{season_id:String(season.id),account_revision:String(account.revision),academic_image:{name:'proof.png',mimeType:'image/png',buffer:png}}});expect(submitted.status()).toBe(201);const reg=(await submitted.json()).data
    await api('/player-admin/season-registrations/'+reg.registration.id+'/approve',{account_revision:account.revision},'POST',{'If-Match':String(reg.revision)})
    await player.goto('/teams/'+team.id);await expect(player.getByRole('heading',{name,exact:true})).toBeVisible();await expect(player.locator('body')).toContainText('负责人：'+personName);await expect(player.locator('body')).toContainText('球衣（上衣／裤子／袜子）：/ / / / /')
    expect(errors).toEqual([])
  }finally{
    if(previous?.id&&headers)await api('/season/'+previous.id+'/activate',{},'PUT')
    else if(seasonId&&headers)await api('/season/'+seasonId+'/deactivate',{},'PUT')
    await adminContext.close();await playerContext.close()
  }
})
