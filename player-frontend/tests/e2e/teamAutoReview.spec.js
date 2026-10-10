import { test, expect } from '@playwright/test'
import crypto from 'node:crypto'
import path from 'node:path'
import { device } from './device.js'

test('赛事可选规则、自动失败管理员可见、跨赛事参队与学籍详情、修改后人工批准',async({browser})=>{
  test.setTimeout(120000)
  const adminContext=await browser.newContext({baseURL:process.env.E2E_ADMIN_URL,...device})
  const playerContext=await browser.newContext({baseURL:process.env.E2E_BASE_URL,...device})
  const admin=await adminContext.newPage(),player=await playerContext.newPage(),errors=[]
  for(const page of [admin,player])page.on('pageerror',e=>errors.push(e.message))
  const password=process.env.E2E_PASSWORD
  try{
    await admin.goto('/admin-login');await admin.getByPlaceholder('请输入用户名').fill('e2e-admin');await admin.getByPlaceholder('请输入密码',{exact:true}).fill(password);await admin.getByRole('button',{name:'登录',exact:true}).click();await expect(admin).toHaveURL(/admin-dashboard$/)
    const token=await admin.evaluate(()=>localStorage.getItem('adminToken'))
    async function api(url,data,auth=token,method=data===undefined?'GET':'POST',revision,status=200){
      const r=await admin.request.fetch(url,{method,data,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),'Idempotency-Key':crypto.randomUUID(),...(revision==null?{}:{'If-Match':String(revision)})}})
      expect(r.status(),await r.text()).toBe(status);return (await r.json()).data
    }
    const season=await api('/api/season',{season_code:'BROWSER-AUTO',season_name:'浏览器自动审核赛季',start_date:'2026-01-01',end_date:'2027-12-31',is_active:true},token,'POST',null,201)
    const iso=d=>new Date(Date.now()+d+8*3600000).toISOString().replace('Z','+08:00')
    const config=await api('/api/player-admin/season-settings/'+season.id,{registration_opens_at:iso(-86400000),registration_closes_at:iso(86400000),competitions:['自动审核测试杯','跨赛事测试杯'].map(league_type=>({league_type,is_enabled:true,rules_text:'自动检查后人工审核',registration_opens_at:iso(-86400000),registration_closes_at:iso(86400000),change_windows:[],yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1}))},token,'PUT',0)
    const material=await playerContext.newPage();await material.setViewportSize({width:640,height:400});await material.setContent('<html lang="zh"><body style="padding:40px;background:#eef3f9;font-family:Microsoft YaHei"><h1>虚构学籍审核材料</h1><p>球队自动审核 · 本地验收</p><p>仅用于软件测试，不含真实个人信息。</p></body></html>');const png=await material.screenshot({path:path.resolve('../.cache/team-auto-review-academic.png')});await material.close()
    const people=[]
    for(let i=0;i<3;i++){
      const student_id='BROWSER-AUTO-'+i,name='自动审核成员'+i,college=i===2?'建筑与城市规划学院':'土木工程学院'
      await api('/api/player/register',{student_id,name,college,password,gender:'male',password_confirm:password},null,'POST',null,201)
      const p=await api('/api/player/login',{student_id,password},null);people.push(p)
      if(i){const r=await admin.request.post('/api/player/season-registration/submit',{headers:{Authorization:'Bearer '+p.token,'If-Match':'0','Idempotency-Key':crypto.randomUUID()},multipart:{season_id:String(season.id),account_revision:String(p.revision),academic_image:{name:'虚构学籍.png',mimeType:'image/png',buffer:png}}});expect(r.status()).toBe(201);const d=(await r.json()).data;await api('/api/player-admin/season-registrations/'+d.registration.id+'/approve',{account_revision:p.revision},token,'POST',d.revision)}
    }
    // A current formal membership in another competition is visible during review.
    let other=await api('/api/player/team-applications',{season_id:season.id,competition_id:config.competitions[1].id,team_name:'跨赛事已通过球队'},people[0].token,'POST',null,201)
    other=await api('/api/player/team-applications/'+other.application.id,{team_name:other.application.team_name,shirt_color:null,shorts_color:null,socks_color:null,members:[{player_id:people[1].id,jersey_number:'1',is_captain:true,is_goalkeeper:false,is_foreign:false,is_sports_training:false}]},people[0].token,'PUT',other.application.revision)
    other=await api('/api/player/team-applications/'+other.application.id+'/submit',{},people[0].token,'POST',other.application.revision)
    const review=await api('/api/player-admin/team-applications/'+other.application.id);await api('/api/player-admin/team-applications/'+other.application.id+'/approve',{review_token:review.review_token},token,'POST',review.application.revision)
    async function setLimits(values){
      await admin.goto('/admin-seasons');await admin.getByLabel('配置赛季').selectOption(String(season.id))
      for(const[label,value]of Object.entries(values))await admin.getByLabel('自动审核测试杯'+label,{exact:true}).fill(value)
      await admin.getByRole('button',{name:'保存球员报名设置',exact:true}).click();await expect(admin.getByText('球员报名设置已保存。',{exact:true})).toBeVisible()
    }
    await setLimits({'大名单最低人数':'3','大名单最高人数':'','最多学院数':'1','最多外援人数':'0','最多运训人数':'0'})
    const saved=await api('/api/player-admin/season-settings/'+season.id);expect(saved.competitions[0].max_players).toBeNull();expect(saved.competitions[0].max_foreign_players).toBe(0)
    await player.goto('/login');await player.getByLabel('学号',{exact:true}).fill('BROWSER-AUTO-0');await player.getByLabel('密码',{exact:true}).fill(password);await player.getByRole('button',{name:'登录',exact:true}).click();await expect(player).toHaveURL(/dashboard$/)
    await player.goto('/team-applications');await player.getByLabel('报名赛事').selectOption({label:'自动审核测试杯'});await player.getByLabel('新球队名称').fill('自动审核浏览器球队');await player.getByRole('button',{name:'创建报名草稿'}).click();await expect(player).toHaveURL(/team-applications\/\d+$/)
    for(let i=1;i<=2;i++){await player.getByLabel('添加球员学号').fill('BROWSER-AUTO-'+i);await player.getByRole('button',{name:'按学号添加',exact:true}).click();await player.getByLabel('自动审核成员'+i+'号码').fill(String(i))}
    await player.getByLabel('自动审核成员1任场上队长').check();await player.getByLabel('自动审核成员2外援',{exact:true}).check();await player.getByLabel('自动审核成员2运训',{exact:true}).check()
    await player.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(player.getByRole('status')).toContainText('草稿已保存')
    async function submit(){await player.getByRole('button',{name:'预览并提交',exact:true}).click();await player.getByRole('button',{name:'确认提交整队审核',exact:true}).click()}
    await submit();await expect(player.getByRole('alert')).toContainText('自动审核失败');await expect(player.locator('.automatic-result li')).toHaveCount(4)
    const kind=process.env.E2E_MOBILE==='1'?'mobile':'desktop'
    await player.screenshot({path:path.resolve('../.cache/team-auto-review-player-'+kind+'.png'),fullPage:true})
    async function openReview(status){await admin.goto('/admin-team-applications');await admin.getByLabel('球队申请状态').selectOption(status);await admin.getByLabel('查询队名').fill('自动审核浏览器球队');await admin.getByRole('button',{name:'查询球队报名',exact:true}).click();await expect(admin.locator('tbody tr')).toHaveCount(1);await admin.getByRole('button',{name:'查看球队申请',exact:true}).click();await expect(admin.locator('.team-review-detail')).toBeVisible()}
    await openReview('auto_failed');await expect(admin.locator('tbody tr')).toContainText('自动审核失败');await expect(admin.locator('tbody tr li')).toHaveCount(4)
    await expect(admin.getByRole('button',{name:'通过整队报名',exact:true})).toHaveCount(0)
    await expect(admin.locator('.approved-teams')).toContainText('跨赛事已通过球队（跨赛事测试杯）');await expect(admin.getByText('并无参加其它队伍',{exact:true})).toBeVisible()
    await expect(admin.locator('.review-member').filter({hasText:'1号 · 自动审核成员1'})).toContainText('本赛季其它已通过球队数（全部赛事）：1')
    await expect(admin.locator('.review-member').filter({hasText:'2号 · 自动审核成员2'})).toContainText('本赛季其它已通过球队数（全部赛事）：0')
    await expect(admin.locator('.team-review-detail')).not.toContainText('同类赛事已通过球队数')
    await admin.getByRole('button',{name:'自动审核成员1学籍详情',exact:true}).click();await expect(admin.locator('.academic-review img')).toBeVisible();expect(await admin.locator('.academic-review img').evaluate(i=>i.naturalWidth)).toBeGreaterThan(100)
    await admin.screenshot({path:path.resolve('../.cache/team-auto-review-admin-'+kind+'.png'),fullPage:true})
    for(const page of [admin,player])expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
    await admin.getByRole('button',{name:'人工通过自动审核失败',exact:true}).click();await expect(admin.getByRole('alert')).toContainText('不能为空')
    await setLimits({'大名单最低人数':'2','最多学院数':'2','最多外援人数':'1','最多运训人数':'1'})
    await player.getByRole('button',{name:'重新载入（放弃未保存）',exact:true}).click();await submit();await expect(player.getByRole('status')).toContainText('自动审核通过')
    await openReview('pending');await admin.getByRole('button',{name:'通过整队报名',exact:true}).click();await expect(admin.getByRole('status')).toContainText('已进入正式球队库')
    // Revoke and resubmit through both user interfaces, retaining the same application.
    await expect(admin.getByRole('button',{name:'撤销报名通过',exact:true})).toBeDisabled()
    await admin.getByLabel('撤销通过原因（必填，向球队展示）',{exact:true}).fill('请核对名单后重新报名')
    admin.once('dialog',dialog=>dialog.accept())
    await admin.getByRole('button',{name:'撤销报名通过',exact:true}).click()
    await expect(admin.getByRole('status')).toContainText('已撤销报名通过')
    await expect(admin.locator('.team-review-detail')).toContainText('已撤销通过')
    await player.getByRole('button',{name:'重新载入（放弃未保存）',exact:true}).click()
    await expect(player.getByRole('heading',{name:'已撤销通过',exact:true})).toBeVisible()
    await expect(player.getByText('上次撤销通过原因：请核对名单后重新报名',{exact:true})).toBeVisible()
    await expect(player.getByRole('button',{name:'保存草稿',exact:true})).toBeEnabled()
    await player.screenshot({path:path.resolve('../.cache/team-revocation-player-'+kind+'.png'),fullPage:true})
    await submit();await expect(player.getByRole('status')).toContainText('等待管理员人工审核')
    await openReview('pending');await admin.getByRole('button',{name:'通过整队报名',exact:true}).click()
    await expect(admin.getByRole('status')).toContainText('已进入正式球队库')
    await expect(admin.locator('.admin-team-history')).toContainText('管理员撤销通过')
    await admin.screenshot({path:path.resolve('../.cache/team-revocation-admin-'+kind+'.png'),fullPage:true})
    // Retain an independent failed application and explicitly approve it with a reason.
    await setLimits({'大名单最低人数':'3'})
    let failed=await api('/api/player/team-applications',{season_id:season.id,competition_id:config.competitions[0].id,team_name:'自动审核浏览器特批队'},people[0].token,'POST',null,201)
    failed=await api('/api/player/team-applications/'+failed.application.id,{team_name:failed.application.team_name,members:[{player_id:people[1].id,jersey_number:'1',is_captain:true,is_goalkeeper:false,is_foreign:false,is_sports_training:false}]},people[0].token,'PUT',failed.application.revision)
    await api('/api/player/team-applications/'+failed.application.id+'/submit',{},people[0].token,'POST',failed.application.revision)
    await admin.goto('/admin-team-applications');await admin.getByLabel('查询队名').fill('自动审核浏览器特批队');await admin.getByRole('button',{name:'查询球队报名',exact:true}).click();await expect(admin.locator('tbody tr')).toHaveCount(1);await expect(admin.locator('tbody tr')).toContainText('自动审核浏览器特批队');await admin.getByRole('button',{name:'查看球队申请',exact:true}).click()
    await admin.getByLabel('整队审核说明／退回理由／人工通过原因',{exact:true}).fill('组委会批准测试队以当前人数报名')
    await admin.getByRole('button',{name:'人工通过自动审核失败',exact:true}).click();await expect(admin.getByRole('status')).toContainText('已人工通过')
    await expect(admin.locator('.automatic-override')).toContainText('组委会批准测试队');await expect(admin.locator('.automatic-result')).toContainText('上次自动审核：失败')
    expect(errors).toEqual([])
  }finally{await adminContext.close();await playerContext.close()}
})
