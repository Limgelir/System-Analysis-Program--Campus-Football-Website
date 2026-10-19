import {test,expect} from '@playwright/test'
import crypto from 'node:crypto'
import {createRequire} from 'node:module'
const XLSX=createRequire(import.meta.url)('../../../backend/node_modules/xlsx')
test.describe.configure({mode:'serial'})
const password=process.env.E2E_PASSWORD,png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=','base64')
let admin,referee,supervisor,contexts=[],season,match,externalMatch,signupMatchId,teams=[],refIds=[],tokens=[],adminToken,pageErrors=[]
async function pageFor(browser,viewport){const c=await browser.newContext({baseURL:process.env.E2E_BASE_URL,viewport:viewport||{width:1440,height:1000}});contexts.push(c);const p=await c.newPage();p.on('pageerror',e=>pageErrors.push(e.message));p.on('dialog',d=>d.accept());return p}
async function login(p,role='admin',account='e2e-admin',pass=password){await p.goto(role==='admin'?'/admin-login':'/referee-login');await p.getByPlaceholder(role==='admin'?'请输入用户名':'请输入学号').fill(account);await p.getByPlaceholder('请输入密码',{exact:true}).fill(pass);await p.getByRole('button',{name:'登录',exact:true}).click();await expect(p).toHaveURL(new RegExp(role==='admin'?'/admin-dashboard$':'/referee-dashboard$'))}
async function api(p,path,method='GET',data,token=adminToken){
 if(path==='/schedule'&&method==='POST') data={venue:'樱花人草',...data};
 const m=/^\/schedule\/(\d+)(?:\/assign-referees)?$/.exec(path);
 if(m&&method==='PUT'&&data&&data.schedule_revision===undefined){const d=await p.request.get('/api/schedule/'+m[1],{headers:{Authorization:'Bearer '+token}});if(d.ok())data={...data,schedule_revision:(await d.json()).data.schedule_revision};}
const r=await p.request.fetch('/api'+path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(r.ok(),`${method} ${path}: ${await r.text()}`).toBeTruthy();return r.json()}
async function selectSignupCompetition(p){
 await p.locator('.competition-tabs button').filter({hasText:'足协杯'}).click();
 const membership=p.locator('.membership');await expect(membership.locator('.summary')).toBeVisible();
 if(await membership.getByRole('button',{name:'保存参队信息',exact:true}).count()){
  await membership.getByLabel('未参加',{exact:true}).check();await membership.getByRole('button',{name:'保存参队信息',exact:true}).click();await expect(membership.getByRole('button',{name:'修改参队信息'})).toBeVisible();
 }
}
async function review(p,action,reason){await p.getByRole('button',{name:action,exact:true}).first().click();const modal=p.locator('.review-modal');await expect(modal).toBeVisible();if(reason)await modal.locator('textarea').fill(reason);await modal.getByRole('button',{name:action==='通过'?'通过申请':action==='驳回'?'驳回申请':'退回修改',exact:true}).click();await expect(modal).toBeHidden()}
test.beforeAll(async({browser})=>{admin=await pageFor(browser);referee=await pageFor(browser);supervisor=await pageFor(browser);await login(admin);adminToken=await admin.evaluate(()=>localStorage.getItem('adminToken'))})
test.afterAll(async()=>{for(const c of contexts)await c.close()})
test.afterEach(()=>{expect(pageErrors,'浏览器不应出现未捕获 JS 错误').toEqual([])})

// Phase 3 interaction checks run after the original business workflow below.

test('管理员创建启用赛季；裁判提交、驳回、重交、通过；未通过不可选派',async()=>{
  await admin.goto('/admin-seasons');await admin.getByPlaceholder('例如：2025-fall').fill('e2e-season');await admin.getByPlaceholder('例如：2025秋').fill('浏览器验收赛季');
  await admin.locator('input[type=date]').nth(0).fill('2026-01-01');await admin.locator('input[type=date]').nth(1).fill('2028-12-31');await admin.getByLabel('创建后立即启用该赛季').check();await admin.getByRole('button',{name:'创建赛季',exact:true}).click();await expect(admin.locator('.current-card')).toContainText('浏览器验收赛季');
  season=(await api(admin,'/season/current')).data;
  await login(referee,'referee','E2E-1');await referee.getByRole('button',{name:'参加本赛季注册'}).click();await referee.getByLabel('学院',{exact:true}).selectOption('土木工程学院');await referee.getByRole('button',{name:'提交审核',exact:true}).click();await expect(referee.locator('.status-pill').first()).toContainText('审核中');
  const before=await api(admin,`/season-registration/admin/eligible?season_id=${season.id}&query=E2E-1`);expect(before.data.items).toHaveLength(0);
  await admin.goto('/admin-season-registrations');await review(admin,'驳回','请核对当前级别');await referee.reload();await expect(referee.locator('.review-reason')).toContainText('请核对当前级别');await referee.getByRole('button',{name:'修改后重新提交'}).click();await referee.locator('.registration-form select').filter({has:referee.locator('option[value="预备国家级"]')}).selectOption('预备国家级');await referee.getByRole('button',{name:'提交审核',exact:true}).click();await expect(referee.locator('.status-pill').first()).toContainText('审核中');
  await admin.reload();await review(admin,'通过','资料已核对');await referee.reload();await expect(referee.locator('.status-pill').first()).toContainText('已注册');
  for(let i=1;i<=6;i++){
    const r=await admin.request.post('/api/referee/login',{data:{student_id:`E2E-${i}`,password}});expect(r.ok()).toBeTruthy();const payload=(await r.json()).data;refIds.push(payload.id);tokens.push(payload.token);
    if(i>1){const sub=await api(admin,'/season-registration/current/submit','POST',{name:`浏览器裁判${i}`,college:'土木工程学院',height_cm:175,weight_kg:65,grade:'一级',match_types:['足协杯']},payload.token);await api(admin,`/season-registration/admin/${sub.data.id}/approve`,'POST',{reason:'测试准备'})}
  }
  const after=await api(admin,`/season-registration/admin/eligible?season_id=${season.id}&query=E2E-1`);expect(after.data.items.some(r=>r.referee_id===refIds[0])).toBeTruthy();
})

test('先建后派、裁判搜索、非系统名单新增与来源显示',async()=>{
  const iso=d=>new Date(Date.now()+d+8*3600000).toISOString().replace('Z','+08:00');
  let settings=(await api(admin,'/player-admin/season-settings/'+season.id)).data;
  const set=await admin.request.put('/api/player-admin/season-settings/'+season.id,{headers:{Authorization:'Bearer '+adminToken,'If-Match':String(settings.revision)},data:{registration_opens_at:iso(-7200000),registration_closes_at:iso(86400000),competitions:['大联赛','足协杯','新生杯'].map(league_type=>({yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1,league_type,is_enabled:true,rules_text:'浏览器导入测试',registration_opens_at:iso(-7200000),registration_closes_at:iso(86400000),change_windows:[{opens_at:iso(-7200000),closes_at:iso(86400000)}]}))}});expect(set.ok()).toBeTruthy();
  for(const [i,name]of ['浏览器主队','浏览器客队'].entries()){
    const student_id='E2E-PLAYER-'+i;
    await api(admin,'/player/register','POST',{student_id,name:name+'球员',college:'土木工程学院',gender:'male',password,password_confirm:password},null);
    const p=(await api(admin,'/player/login','POST',{student_id,password},null)).data;
    const sub=await admin.request.post('/api/player/season-registration/submit',{headers:{Authorization:'Bearer '+p.token,'If-Match':'0','Idempotency-Key':crypto.randomUUID()},multipart:{season_id:String(season.id),account_revision:String(p.revision),academic_image:{name:'test.png',mimeType:'image/png',buffer:png}}});expect(sub.status()).toBe(201);const reg=(await sub.json()).data;
    const approve=await admin.request.post('/api/player-admin/season-registrations/'+reg.registration.id+'/approve',{headers:{Authorization:'Bearer '+adminToken,'If-Match':String(reg.revision)},data:{account_revision:p.revision}});expect(approve.ok()).toBeTruthy();
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['学号','姓名','号码','场上队长','守门员','外援','运训','备注'],[student_id,name+'球员','1','是','是','否','是','浏览器测试']]),'名单');
    await admin.goto('/admin-teams');const importer=admin.locator('.roster-import').first();await importer.getByLabel('队伍名称',{exact:true}).fill(name);await importer.getByLabel('赛事类型',{exact:true}).selectOption('足协杯');await importer.getByLabel('负责人当前学号').fill(student_id);await importer.getByLabel('负责人姓名',{exact:true}).fill(name+'球员');for(const label of ['上衣主要颜色','裤子主要颜色','袜子主要颜色'])await importer.getByLabel(label).fill('红');await importer.getByLabel('新版名单 Excel').setInputFiles({name:'roster.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(wb,{type:'buffer',bookType:'xlsx'})});await importer.getByRole('button',{name:'预览导入名单',exact:true}).click();await expect(importer.locator('.import-preview')).toContainText(name+'球员');await importer.getByRole('button',{name:'确认审核通过并立即导入'}).click();await expect(importer.getByRole('status')).toContainText('立即生效');teams.push((await api(admin,'/team/list')).data.teams.find(t=>t.team_name===name).id);
  }
  await admin.goto('/admin-schedule');const form=admin.locator('form.form');await expect(form.getByLabel('本场需要第四官员')).toBeChecked();await expect(form.getByLabel('本场需要裁判监督')).not.toBeChecked();await form.locator('select').nth(0).selectOption('足协杯');await form.locator('select').nth(1).selectOption(String(teams[0]));await form.locator('select').nth(2).selectOption(String(teams[1]));await form.locator('input[type=date]').fill('2026-09-07');await form.getByLabel('比赛时间').fill('17:35');await form.getByLabel('比赛场地 *').selectOption('樱花人草');await form.getByPlaceholder('例如 A1、J1、1').fill('A1');await form.getByRole('button',{name:'添加赛程'}).click();await expect(admin.locator('.alert.success')).toContainText('已创建');
  match=(await api(admin,`/schedule?season_id=${season.id}`)).data[0];
  await admin.goto(`/admin-assignments?view=all&season_id=${season.id}&match=${match.id}`);
  await admin.getByLabel('本场需要裁判监督',{exact:true}).check();
  const pickers=admin.locator('.referee-picker');await expect(pickers).toHaveCount(5);
  for(let i=0;i<5;i++){await pickers.nth(i).locator('input[type=search]').fill(`E2E-${i+1}`);await pickers.nth(i).locator('.result-item').filter({hasText:`E2E-${i+1}`}).first().click()}
  await admin.getByRole('button',{name:'保存选派',exact:true}).click();await expect(admin.getByRole('status')).toContainText('选派已保存');
  await admin.goto('/admin-external-referees');await admin.getByRole('button',{name:'新增非系统裁判',exact:true}).click();await admin.getByLabel('姓名',{exact:true}).fill('浏览器非系统裁判员');await admin.getByLabel('备注/来源').fill('自动化测试专用');await admin.getByRole('button',{name:'保存',exact:true}).click();await expect(admin.locator('tbody')).toContainText('浏览器非系统裁判员');
  const ext=(await api(admin,'/officials/external?query='+encodeURIComponent('浏览器非系统裁判员'))).data.items[0];
  const r=await api(admin,'/schedule','POST',{match_type:'足协杯',team_a_id:teams[0],team_b_id:teams[1],match_time: '17:35', match_date: '2026-09-08',field_order:2,main_referee_id:`external:${ext.id}`,assistant1_id:refIds[1],assistant2_id:refIds[2],fourth_official_id:refIds[3],supervisor_id:refIds[4]});externalMatch=r.data;
  await admin.goto('/admin-schedule');await expect(admin.locator('tbody')).toContainText('浏览器非系统裁判员');
  await admin.goto('/admin-teams');await expect(admin.getByText(/浏览器[主客]队球员/).first()).toBeVisible();
  const history=admin.locator('details').filter({hasText:'历史名单（默认折叠'});await expect(history).not.toHaveAttribute('open','');await history.locator('summary').click();await expect(history).toContainText('暂无历史批次');
  const templateDownload=admin.waitForEvent('download');await admin.locator('.roster-import').first().getByRole('button',{name:'下载名单模板'}).click();expect(await (await templateDownload).failure()).toBeNull();
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),rosterMatch=(await api(admin,'/schedule','POST',{match_type:'足协杯',team_a_id:teams[0],team_b_id:teams[1],match_time: '17:35', match_date: today,field_order:300})).data;
  await admin.goto(`/admin-schedule/${rosterMatch.id}`);const card=admin.locator('.match-roster-card');await expect(card.getByRole('heading',{name:'本场比赛使用的名单'})).toBeVisible();await card.locator('select').first().selectOption({index:1});await card.getByLabel('切换理由').first().fill('尚未开赛，核实后选择当前正式名单');await card.getByRole('button',{name:'切换此队比赛名单'}).first().click();await expect(card.getByRole('status')).toContainText('已切换');await card.locator('details').first().locator('summary').click();await expect(card).toContainText('浏览器主队球员');
})

test('选派列表允许裁判员与第四官员双向选择同一人，系统和非系统均可保存回显',async()=>{
  const date=new Date(Date.now()+8*3600000+2*86400000).toISOString().slice(0,10);
  for(const [source,order,query] of [['system',[0,3],'E2E-1'],['external',[3,0],'浏览器非系统裁判员']]){
    const m=(await api(admin,'/schedule','POST',{match_type:'足协杯',team_a_id:teams[0],team_b_id:teams[1],match_date:date,match_time:'17:35',venue:'樱花人草',field_order:'兼任-'+source,assistant1_id:refIds[1],assistant2_id:refIds[2],supervisor_required:false})).data;
    await admin.goto(`/admin-assignments?view=all&season_id=${season.id}&match=${m.id}`);
    const editor=admin.locator('#match-'+m.id),pickers=editor.locator('.referee-picker');
    for(const index of order){await pickers.nth(index).locator('input[type=search]').fill(query);await pickers.nth(index).locator('.result-item').filter({hasText:query}).first().click()}
    await editor.getByRole('button',{name:'保存选派',exact:true}).click();await expect(editor.getByRole('status')).toContainText('选派已保存');
    const saved=(await api(admin,'/schedule/'+m.id)).data;
    expect(saved.main_referee_id_selection).toBe(saved.fourth_official_id_selection);expect(saved.is_assignment_complete).toBe(true);
    await admin.reload();await expect(editor.locator('.status')).toHaveText('已完成选派');
    await expect(pickers.nth(0).locator('.selected-card strong')).toHaveText(await pickers.nth(3).locator('.selected-card strong').innerText());
    if(source==='system'){await editor.scrollIntoViewIfNeeded();await admin.screenshot({path:'test-results/dual-main-fourth.png'})}
    await api(admin,'/schedule/'+m.id,'DELETE',{schedule_revision:saved.schedule_revision});
  }
})

test('比赛时间在轻量编辑、详情、裁判页同步，午夜合法，手机表单不溢出',async()=>{
  await admin.goto('/admin-schedule');
  const row=admin.locator('tbody > tr').filter({has:admin.getByRole('button',{name:'轻量编辑',exact:true})}).first();
  await expect(row).toContainText('17:35');
  await row.getByRole('button',{name:'轻量编辑',exact:true}).click();
  await admin.getByLabel('比赛时间',{exact:true}).fill('18:00');
  await admin.getByRole('button',{name:'保存轻量编辑',exact:true}).click();
  await expect(admin.locator('.alert.success').first()).toContainText('已更新');
  await admin.goto(`/admin-schedule/${match.id}`);
  await expect(admin.getByLabel('比赛时间',{exact:true})).toHaveValue('18:00');
  await admin.getByLabel('比赛时间',{exact:true}).fill('00:00');
  await admin.getByRole('button',{name:'保存赛程更新',exact:true}).click();
  await expect(admin.locator('.alert.success').first()).toBeVisible();
  expect((await api(admin,`/schedule/${match.id}`)).data.match_time).toBe('00:00');
  await admin.getByLabel('比赛时间',{exact:true}).fill('17:35');
  await admin.getByRole('button',{name:'保存赛程更新',exact:true}).click();
  await expect.poll(async()=> (await api(admin,`/schedule/${match.id}`)).data.match_time).toBe('17:35');
  await admin.setViewportSize({width:390,height:844});
  await expect.poll(()=>admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await admin.locator('#formData-match-time').scrollIntoViewIfNeeded();
  await admin.screenshot({path:'test-results/mobile-match-time.png'});
  await admin.setViewportSize({width:1440,height:1000});
  await referee.goto('/referee-dashboard');await expect(referee.locator('body')).toContainText('17:35');
  await referee.goto(`/referee-report/${match.id}`);await expect(referee.locator('body')).toContainText('17:35');
})

test('系统裁判员、裁判监督各自填写；报告提交锁定；图片上传后可追溯',async()=>{
  await referee.goto(`/referee-report/${match.id}`);
  await expect(referee.getByRole('heading',{name:'裁判员填写区',exact:true})).toBeVisible();
  await referee.locator('input[type=file]').setInputFiles({name:'e2e.png',mimeType:'image/png',buffer:png});
  await referee.getByRole('button',{name:'上传第四官员记录单',exact:true}).click();await expect(referee.locator('.preview-image')).toBeVisible();
  await referee.getByRole('button',{name:'提交裁判员区',exact:true}).click();await expect(referee.getByRole('heading',{name:'裁判员区（只读）',exact:true})).toBeVisible();
  await login(supervisor,'referee','E2E-5');await supervisor.goto(`/referee-report/${match.id}`);const scores=supervisor.locator('.review-item input[type=number]');await expect(scores).toHaveCount(4);for(let i=0;i<4;i++)await scores.nth(i).fill('8.5');await supervisor.getByRole('button',{name:'提交裁判监督区',exact:true}).click();await expect(supervisor.getByRole('button',{name:'提交裁判监督区',exact:true})).toHaveCount(0);
  await admin.goto(`/admin-schedule/${match.id}`);await expect(admin.getByText(/已锁定|锁定/).first()).toBeVisible();
  const denied=await referee.request.post(`/api/report/admin/schedule/${match.id}/sections/main/return`,{data:{reason:'越权'},headers:{Authorization:`Bearer ${tokens[0]}`,'If-Match':'0'}});expect(denied.status()).toBe(403);
})

test('管理员修订仍锁定、退回才解锁、重提和历史图片；非系统裁判员由管理员代填',async()=>{
  await admin.goto(`/admin-schedule/${match.id}/report`);await admin.getByLabel('原因（必填，最多 500 字）').fill('浏览器验收修订');await admin.getByRole('button',{name:'进入管理员修订',exact:true}).click();await admin.getByRole('button',{name:'确认继续',exact:true}).click();await admin.getByRole('button',{name:/保存裁判员区修订/}).click();await expect(admin.locator('.report-notice')).toContainText('修订');
  await admin.getByLabel('原因（必填，最多 500 字）').fill('请裁判员核对后重提');await admin.getByRole('button',{name:'退回重填',exact:true}).click();await admin.getByRole('button',{name:'确认继续',exact:true}).click();await expect(admin.locator('.return-notice').first()).toContainText('请裁判员核对后重提');
  await referee.reload();await expect(referee.getByRole('heading',{name:'裁判员填写区',exact:true})).toBeVisible();await referee.getByRole('button',{name:'提交裁判员区',exact:true}).click();await expect(referee.getByRole('heading',{name:'裁判员区（只读）',exact:true})).toBeVisible();
  await admin.reload();await admin.getByLabel('操作对象').selectOption('image');await admin.getByLabel('原因（必填，最多 500 字）').fill('移除当前测试图，保留历史');await admin.getByRole('button',{name:'进入管理员修订',exact:true}).click();await admin.getByRole('button',{name:'确认继续',exact:true}).click();await admin.getByRole('button',{name:'删除第四官员记录单',exact:true}).click();await admin.getByRole('button',{name:'确认移除当前图片',exact:true}).click();await expect(admin.locator('.preview-image')).toHaveCount(0);
  await admin.getByRole('button',{name:'查看裁判员区历史'}).click();await admin.getByRole('button',{name:'查看前后内容'}).first().click();await admin.getByRole('button',{name:'查看操作前图片'}).click();await expect(admin.getByAltText('操作前第四官员记录单历史图片')).toBeVisible();
  const unauthorized=await admin.request.get(`/api/files/report/${match.id}/fourth-official-image`);expect(unauthorized.status()).toBe(401);
  await admin.goto(`/admin-schedule/${externalMatch.id}/report`);await expect(admin.getByText(/代非系统裁判员填写：/)).toBeVisible();await expect(admin.getByRole('button',{name:'退回重填',exact:true})).toHaveCount(0);await admin.getByRole('button',{name:'提交裁判员区',exact:true}).click();await expect(admin.getByRole('heading',{name:'裁判员区（只读）',exact:true})).toBeVisible();
})

test('账号筛选分页导出、随机临时密码、停用及旧会话失效',async()=>{
  await admin.goto('/admin-referees');await admin.getByLabel('每页数量').selectOption('10');await expect(admin.locator('tbody tr')).toHaveCount(10);await admin.getByRole('button',{name:'下一页',exact:true}).click();await expect(admin).toHaveURL(/page=2/);
  const downloadPromise=admin.waitForEvent('download');await admin.getByRole('button',{name:'导出筛选账号'}).click();const download=await downloadPromise;expect(await download.failure()).toBeNull();
  await admin.getByLabel('姓名或学号').fill('E2E-6');await admin.getByRole('button',{name:'查询',exact:true}).click();await expect(admin.locator('tbody tr')).toHaveCount(1);await admin.getByRole('button',{name:'详情',exact:true}).click();await admin.getByRole('button',{name:/重置密码/}).click();await expect(admin.locator('.temporary-password-box')).toBeVisible();
  const old=await admin.request.get('/api/season-registration/current',{headers:{Authorization:`Bearer ${tokens[5]}`}});expect(old.status()).toBe(401);
  await admin.getByRole('button',{name:/停用账号/}).click();await expect(admin.getByText('已停用',{exact:false}).first()).toBeVisible();
})

test('管理员页面创建账号交付随机密码，首次登录改密后重新登录',async({browser})=>{
  await admin.goto('/admin-referees');await admin.getByRole('button',{name:'新增裁判账号',exact:true}).click();
  const form=admin.locator('.create-form');
  await form.getByLabel('学号',{exact:true}).fill('E2E-NEW');await form.getByLabel('姓名',{exact:true}).fill('页面创建裁判');
  await form.getByLabel('升入当前级别时间').fill('2025-01-01');await form.getByLabel('学院').fill('土木工程学院');
  await form.getByLabel('身高（cm）').fill('175');await form.getByLabel('体重（kg）').fill('65');await form.getByLabel('足协杯',{exact:true}).check();
  await form.locator('input[type=file]').setInputFiles({name:'id.png',mimeType:'image/png',buffer:png});await form.getByRole('button',{name:'创建账号',exact:true}).click();
  await expect(admin.locator('.credential')).toBeVisible();const temporary=await admin.locator('.credential code').textContent();expect(temporary.length).toBeGreaterThanOrEqual(16);
  await admin.getByRole('button',{name:'已记录，隐藏密码'}).click();await expect(admin.locator('.credential')).toHaveCount(0);
  const fresh=await pageFor(browser);await login(fresh,'referee','E2E-NEW',temporary);await expect(fresh.locator('.password-warning').first()).toContainText('先修改密码');
  await fresh.getByPlaceholder('请输入旧密码').fill(temporary);await fresh.getByPlaceholder('请输入新密码（至少8位）').fill(password);await fresh.getByPlaceholder('请再次输入新密码').fill(password);await fresh.getByRole('button',{name:'确认修改',exact:true}).click();await expect(fresh).toHaveURL(/\/referee-login$/);
  await login(fresh,'referee','E2E-NEW');await expect(fresh.locator('.password-warning')).toHaveCount(0);
})

test('双页面同版本修订冲突保留输入，图片替换保留旧图历史',async({browser})=>{
  const second=await pageFor(browser);await login(second);
  for(const p of [admin,second]){await p.goto(`/admin-schedule/${match.id}/report`);await p.getByLabel('原因（必填，最多 500 字）').fill('双页面并发验收');await p.getByRole('button',{name:'进入管理员修订',exact:true}).click();await p.getByRole('button',{name:'确认继续',exact:true}).click()}
  await second.locator('fieldset').first().locator('input[type=number]').nth(2).fill('3');
  await admin.getByRole('button',{name:/保存裁判员区修订/}).click();await expect(admin.locator('.report-notice')).toContainText('修订');
  await second.getByRole('button',{name:/保存裁判员区修订/}).click();await expect(second.locator('.revision-error')).toContainText('已被其他操作更新');await expect(second.locator('fieldset').first().locator('input[type=number]').nth(2)).toHaveValue('3');
  const images=[];
  for(let i=0;i<2;i++){
    await admin.reload();await admin.getByLabel('操作对象').selectOption('image');await admin.getByLabel('原因（必填，最多 500 字）').fill('替换测试图 '+i);await admin.getByRole('button',{name:'进入管理员修订',exact:true}).click();await admin.getByRole('button',{name:'确认继续',exact:true}).click();
    await admin.locator('input[type=file]').setInputFiles({name:`replacement${i}.png`,mimeType:'image/png',buffer:png});await admin.getByRole('button',{name:i===0?'上传第四官员记录单':'替换第四官员记录单',exact:true}).click();await expect(admin.locator('.report-notice')).toBeVisible();await expect(admin.locator('.preview-image')).toBeVisible();images.push(await admin.locator('.preview-image').getAttribute('src'));
  }
  await admin.getByRole('button',{name:'查看裁判员区历史'}).click();await admin.getByRole('button',{name:'查看前后内容'}).first().click();await admin.getByRole('button',{name:'查看操作前图片'}).click();await admin.getByRole('button',{name:'查看操作后图片'}).click();await expect(admin.getByAltText('操作前第四官员记录单历史图片')).toBeVisible();await expect(admin.getByAltText('操作后第四官员记录单历史图片')).toBeVisible();
})

test('390px 手机宽度关键页面无整页横向溢出，筛选与报告历史可操作',async({browser})=>{
  const mobile=await pageFor(browser,{width:390,height:844});await login(mobile);
  for(const route of ['/admin-dashboard','/admin-referees','/admin-season-registrations',`/admin-schedule/${match.id}/report`]){
    await mobile.goto(route);await expect(mobile.locator('h1,h3,.title').first()).toBeVisible();await expect.poll(()=>mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  }
  await mobile.getByRole('button',{name:'查看裁判员区历史'}).click();await mobile.getByRole('button',{name:'查看前后内容'}).first().click();await expect(mobile.locator('.history-detail')).toBeVisible();await expect.poll(()=>mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  await mobile.locator('.history-detail').screenshot({path:'test-results/mobile-history.png'});
  await mobile.evaluate(()=>window.scrollTo(0,0));await mobile.screenshot({path:'test-results/mobile-report.png'});
})

test('裁判多选报名、管理员报名优先选派与未报名候选可选',async()=>{
  const tomorrow=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,10);
  const signMatch=(await api(admin,'/schedule','POST',{match_type:'足协杯',team_a_id:teams[0],team_b_id:teams[1],match_date:tomorrow,match_time:'17:35',venue:'其它',venue_detail:'浏览器测试球场',field_order:90})).data;
  // Always exercise multiple match days, regardless of which older fixtures fall in the current seven-day window.
  const anotherDay=new Date(Date.now()+2*86400000+8*3600000).toISOString().slice(0,10);
  await api(admin,'/schedule','POST',{match_type:'足协杯',team_a_id:teams[0],team_b_id:teams[1],match_date:anotherDay,match_time:'17:35',field_order:91});
  signupMatchId=signMatch.id;
  await referee.goto('/referee-dashboard');await referee.getByRole('button',{name:'选派报名',exact:true}).click();
  await selectSignupCompetition(referee);
  await referee.getByRole('button',{name:'修改参队信息',exact:true}).click();
  await referee.getByLabel('已参加（可多选，数量不限）',{exact:true}).check();
  await referee.getByLabel('浏览器主队',{exact:true}).check();await referee.getByLabel('浏览器客队',{exact:true}).check();
  await referee.getByRole('button',{name:'保存参队信息',exact:true}).click();
  await expect(referee.locator('.membership .summary')).toContainText('浏览器主队');
  await referee.reload();await selectSignupCompetition(referee);
  await expect(referee.locator('.membership .summary')).toContainText('浏览器客队');
  await expect(referee.getByRole('button',{name:'保存参队信息',exact:true})).toHaveCount(0);
  const card=referee.locator(`[data-schedule-id="${signMatch.id}"]`);await expect(card).toContainText('浏览器测试球场');
  await card.getByLabel('裁判员',{exact:true}).check();await card.getByLabel('助理裁判员',{exact:true}).check();await card.getByRole('button',{name:'提交报名',exact:true}).click();await expect(card).toContainText('当前意向：裁判员、助理裁判员');
  await admin.goto(`/admin-schedule/${signMatch.id}`);await expect(admin.locator('.info-grid').first()).toContainText('有效报名：1人');
  await admin.goto('/admin-assignments');
  const assignment=admin.locator(`[data-schedule-id="${signMatch.id}"]`);
  const matchDay=admin.locator('.match-day').filter({has:assignment});
  await expect(matchDay).toHaveCount(1);await expect(matchDay.locator('.registrants')).toContainText('浏览器裁判1');
  expect(await admin.locator('.match-day').count()).toBeGreaterThan(1);
  const picker=assignment.locator('.referee-picker').first();await picker.locator('input[type=search]').focus();await expect(picker.locator('.result-item').first()).toContainText('已报名 · 意向匹配');await expect(picker.locator('.result-item').nth(1)).toContainText('未报名');
  await picker.locator('.result-item').first().click();await assignment.getByRole('button',{name:'保存选派',exact:true}).click();await expect(assignment.getByRole('status')).toHaveText('选派已保存');
  await referee.getByRole('button',{name:'刷新比赛状态',exact:true}).click();await expect(card).toContainText('已选派：裁判员');await expect(referee.getByRole('status')).toHaveCount(0);
  await card.getByRole('button',{name:'撤回报名',exact:true}).click();await expect(card).toContainText('已撤回');await expect(card).toContainText('已选派：裁判员');
  await card.getByRole('button',{name:'重新报名',exact:true}).click();await expect(card).toContainText('已报名');await expect(referee.getByRole('status')).toHaveText('意向已保存；正式选派以“我的执法”为准');
  await admin.goto(`/admin-schedule/${signMatch.id}`);await admin.getByRole('button',{name:'查看报名名单与变化记录',exact:true}).click();await expect(admin.locator('.signup-summary')).toContainText('裁判员、助理裁判员');await admin.getByRole('button',{name:'变化记录',exact:true}).click();await expect(admin.locator('.signup-summary ol')).toContainText('重新报名');
  await admin.getByLabel('比赛时间',{exact:true}).fill('18:00');await admin.getByLabel('比赛场地 *').selectOption('嘉定天然草');await admin.getByRole('button',{name:'保存赛程更新',exact:true}).click();await expect(admin.locator('.alert.success')).toBeVisible();
  await referee.getByRole('button',{name:'刷新比赛状态',exact:true}).click();await expect(card).toContainText('比赛时间已变更');await expect(card).toContainText('比赛场地已变化');await card.getByRole('button',{name:'保存意向',exact:true}).click();await expect(card).not.toContainText('比赛时间已变更');
})

test('手机390px完整报名修改撤回与未注册提示，旧页面冲突保留意向',async({browser})=>{
  const phone=await pageFor(browser,{width:390,height:844});await login(phone,'referee','E2E-2');await phone.getByRole('button',{name:'选派报名',exact:true}).click();
  // 列表首场可能是今天已经开球的名单测试赛；按已知的明日比赛定位，避免夜间误点禁用项。
  await selectSignupCompetition(phone);
  const card=phone.locator(`[data-schedule-id="${signupMatchId}"]`);await card.getByLabel('裁判监督',{exact:true}).check();await card.getByRole('button',{name:'提交报名',exact:true}).click();await expect(card).toContainText('当前意向：裁判监督');
  const stale=await pageFor(browser);await login(stale,'referee','E2E-2');await stale.goto('/referee-signups');await selectSignupCompetition(stale);const staleCard=stale.locator(`[data-schedule-id="${signupMatchId}"]`);await staleCard.getByLabel('第四官员',{exact:true}).check();
  await card.getByLabel('助理裁判员',{exact:true}).check();await card.getByRole('button',{name:'保存意向',exact:true}).click();await expect(card).toContainText('助理裁判员、裁判监督');
  await staleCard.getByRole('button',{name:'保存意向',exact:true}).click();await expect(stale.getByRole('alert')).toContainText('报名状态已更新');await expect(staleCard.getByLabel('第四官员',{exact:true})).toBeChecked();
  await expect.poll(()=>phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();await phone.screenshot({path:'test-results/mobile-match-signup.png',fullPage:true});
  await card.getByRole('button',{name:'撤回报名',exact:true}).click();await expect(card).toContainText('已撤回');
  const unregistered=await pageFor(browser);await login(unregistered,'referee','E2E-7');await unregistered.goto('/referee-signups');await selectSignupCompetition(unregistered);await expect(unregistered.getByText('尚未完成本赛季注册',{exact:false}).first()).toBeVisible();await expect(unregistered.locator(`[data-schedule-id="${signupMatchId}"]`).getByRole('button',{name:'提交报名',exact:true})).toBeDisabled();
})


test('阶段3：列表筛选与页码贯穿详情、报告、返回和浏览器后退',async()=>{
  const ext=(await api(admin,'/officials/external?query='+encodeURIComponent('浏览器非系统裁判员'))).data.items[0];
  for(let i=0;i<11;i++)await api(admin,'/schedule','POST',{match_type:'足协杯',team_a_id:teams[0],team_b_id:teams[1],match_date:'2026-09-22',match_time:'18:00',field_order:2000+i,main_referee_id:'external:'+ext.id});
  const query=new URLSearchParams({season_id:String(season.id),match_type:'足协杯',date_from:'2026-09-22',date_to:'2026-09-22',source_type:'external',report_status:'main_pending',page:'2',page_size:'10'});
  const list='/admin-schedule?'+query;
  await admin.goto(list);await expect(admin.locator('.list-pagination').first()).toContainText('第 2 /');
  await admin.getByRole('button',{name:'查看详情',exact:true}).first().click();
  await expect(admin).toHaveURL(new RegExp('admin-schedule/[0-9]+[?]'));const detail=admin.url();await admin.getByRole('button',{name:'代非系统裁判填写',exact:true}).click();
  expect(Object.fromEntries(new URL(admin.url()).searchParams)).toEqual(Object.fromEntries(query));
  await admin.getByRole('button',{name:'返回赛程详情',exact:true}).click();
  await expect(admin).toHaveURL(detail);await admin.getByRole('button',{name:'返回赛程列表',exact:true}).click();
  expect(Object.fromEntries(new URL(admin.url()).searchParams)).toEqual(Object.fromEntries(query));
  await expect(admin.getByLabel('开始日期')).toHaveValue('2026-09-22');await expect(admin.getByLabel('岗位来源')).toHaveValue('external');await expect(admin.getByLabel('报告状态')).toHaveValue('main_pending');await expect(admin.locator('.list-pagination').first()).toContainText('第 2 /');
  await admin.getByRole('button',{name:'查看详情',exact:true}).first().click();await expect(admin).toHaveURL(new RegExp('admin-schedule/[0-9]+[?]'));await admin.goBack();await expect(admin.locator('.list-pagination').first()).toContainText('第 2 /');
  await admin.evaluate(()=>window.scrollTo(0,0));await admin.screenshot({path:'test-results/phase3-admin-schedule.png',fullPage:true});
  await admin.goto(detail.split('?')[0]);await admin.getByRole('button',{name:'返回赛程列表',exact:true}).click();await expect.poll(()=>new URL(admin.url()).searchParams.get('season_id')).toBe(String(season.id));
});

test('阶段3：取消离开保护输入、表单错误、弹窗焦点和手机导航',async({browser})=>{
  const p=await pageFor(browser);await login(p);await p.goto('/admin-schedule');
  p.removeAllListeners('dialog');let lastDialog='';p.on('dialog',async d=>{lastDialog=d.message();await d.dismiss()});
  await p.getByLabel('比赛时间 *',{exact:true}).fill('17:36');await p.getByRole('link',{name:'赛季设置',exact:true}).click();await expect(p).toHaveURL(/admin-schedule$/);expect(lastDialog).toContain('未保存');await expect(p.getByLabel('比赛时间 *',{exact:true})).toHaveValue('17:36');
  p.removeAllListeners('dialog');p.on('dialog',d=>d.accept());await p.getByRole('link',{name:'赛季设置',exact:true}).click();await expect(p).toHaveURL(/admin-seasons$/);
  await p.goto('/admin-schedule');await p.getByRole('button',{name:'添加赛程',exact:true}).click();await expect(p.locator('.field-error').first()).toBeVisible();
  await p.goto('/admin-external-referees');await p.getByRole('button',{name:'新增非系统裁判',exact:true}).click();const dialog=p.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByLabel('姓名',{exact:true})).toBeFocused();
  await p.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'取消',exact:true})).toBeFocused();await p.keyboard.press('Tab');await expect(dialog.getByLabel('姓名',{exact:true})).toBeFocused();await p.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(p.getByRole('button',{name:'新增非系统裁判',exact:true})).toBeFocused();
  await p.goto('/admin-referee/'+refIds[0]);await p.getByRole('button',{name:'编辑资料',exact:true}).click();await p.getByLabel('姓名',{exact:true}).fill('尚未保存的姓名');
  await p.getByLabel('已执法场次（基础值）：',{exact:true}).fill('3');await p.getByRole('button',{name:'保存',exact:true}).click();await expect(p.locator('.alert.success')).toContainText('基础值已保存');await expect(p.getByLabel('姓名',{exact:true})).toHaveValue('尚未保存的姓名');
  p.removeAllListeners('dialog');p.on('dialog',d=>d.dismiss());await p.getByRole('link',{name:'赛季设置',exact:true}).click();await expect(p.getByLabel('姓名',{exact:true})).toHaveValue('尚未保存的姓名');await expect(p).toHaveURL(new RegExp('/admin-referee/'+refIds[0]+'$'));
  p.removeAllListeners('dialog');p.on('dialog',d=>d.accept());await p.getByRole('button',{name:'取消',exact:true}).click();await expect(p.locator('.editor-card')).toBeHidden();
  await p.setViewportSize({width:390,height:844});await p.getByRole('button',{name:'展开导航'}).click();await expect(p.getByRole('navigation',{name:'管理员端导航'})).toBeVisible();await p.getByRole('link',{name:'待处理工作台'}).click();await expect(p).toHaveURL(/admin-dashboard$/);await expect(p.getByRole('button',{name:'展开导航'})).toHaveAttribute('aria-expanded','false');
  await p.screenshot({path:'test-results/phase3-admin-mobile.png'});
  for(const route of ['/admin-schedule','/admin-seasons','/admin-teams','/admin-team-applications','/admin-player-registrations','/admin-players','/admin-external-referees']){await p.goto(route);await expect.poll(()=>p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy()}
  await referee.goto('/referee-dashboard');await referee.screenshot({path:'test-results/phase3-referee-desktop.png',fullPage:true});
  await referee.goto('/referee-signups');await referee.screenshot({path:'test-results/phase3-signups-desktop.png',fullPage:true});
  await referee.setViewportSize({width:390,height:844});await referee.screenshot({path:'test-results/phase3-signups-mobile.png'});await referee.setViewportSize({width:1440,height:1000});
});


test('手动添加四平、嘉定及自定义赛事，保存四项停赛规则',async()=>{
  await admin.goto('/admin-seasons');await admin.getByLabel('配置赛季').selectOption(String(season.id));
  for(const name of ['四平足协杯','嘉定足协杯','浏览器邀请赛']){
    await admin.getByLabel('比赛类型',{exact:true}).selectOption(name==='浏览器邀请赛'?'其它':name);
    if(name==='浏览器邀请赛')await admin.getByLabel('赛事名称',{exact:true}).fill(name);
    await admin.getByRole('button',{name:'添加赛事',exact:true}).click();
    for(const [field,n] of [['黄牌累计张数','3'],['黄牌停赛场数','2'],['红牌累计张数','1'],['红牌停赛场数','1']])await admin.getByLabel(name+field,{exact:true}).fill(n);
  }
  await admin.getByRole('button',{name:'保存球员报名设置'}).click();await expect(admin.getByRole('status')).toContainText('已保存');
  await admin.reload();await expect(admin.getByLabel('浏览器邀请赛黄牌停赛场数')).toHaveValue('2');
  await admin.goto('/admin-schedule');for(const name of ['大联赛','新生杯','四平足协杯','嘉定足协杯','浏览器邀请赛'])await expect(admin.locator('form').first().locator('select').first().locator('option',{hasText:name})).toHaveCount(1);
});

test('两黄变红正式提交计红牌，裁判看到后场停赛，管理员表格纠正和清零',async()=>{
  const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const base={match_type:'足协杯',team_a_id:teams[0],team_b_id:teams[1],match_date:date,match_time:'00:00',main_referee_id:refIds[0]};
  const source=(await api(admin,'/schedule','POST',{...base,field_order:'纪律A1'})).data;
  const next=(await api(admin,'/schedule','POST',{...base,match_time:'00:01',field_order:'纪律J1'})).data;
  await referee.goto('/referee-report/'+source.id);await referee.getByRole('button',{name:'新增红黄牌',exact:true}).click();
  const card=referee.locator('.card-item');await card.locator('select').nth(1).selectOption({index:1});await card.locator('select').nth(2).selectOption('second_yellow_red');await card.locator('input[type=number]').first().fill('60');
  await referee.getByRole('button',{name:'提交裁判员区',exact:true}).click();await expect(referee.getByRole('heading',{name:'裁判员区（只读）',exact:true})).toBeVisible();
  await referee.goto('/referee-report/'+next.id);await expect(referee.locator('.discipline-notice')).toContainText('浏览器主队球员');await expect(referee.locator('.discipline-notice')).toContainText('累计红牌');
  await admin.goto('/admin-discipline');await admin.getByLabel('赛事',{exact:true}).selectOption({label:'足协杯'});
  const row=admin.locator('tbody tr').filter({hasText:'浏览器主队球员'});await expect(row.locator('td').nth(2)).toHaveText('0');await expect(row.locator('td').nth(3)).toHaveText('1');await expect(row.locator('td').nth(5)).toHaveText('1 场');
  await row.getByRole('button',{name:'纠正停赛'}).click();await admin.getByLabel('剩余停赛场数').fill('2');await admin.getByLabel('纠正原因').fill('浏览器验证管理员纠正');await admin.getByRole('button',{name:'确认纠正',exact:true}).click();await expect(row.locator('td').nth(5)).toHaveText('2 场');
  await admin.setViewportSize({width:390,height:844});await expect.poll(()=>admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();await admin.screenshot({path:'test-results/competition-discipline-mobile.png',fullPage:true});
  await admin.getByRole('button',{name:'累计红黄牌全部清零',exact:true}).click();await admin.getByLabel('阶段说明／清零原因').fill('浏览器验证阶段清零');await admin.getByLabel('输入完整赛事名称确认').fill('足协杯');await admin.getByRole('button',{name:'确认全部清零并解除停赛',exact:true}).click();await expect(row.locator('td').nth(3)).toHaveText('0');await expect(row.locator('td').nth(5)).toHaveText('0 场');await expect(row.locator('td').nth(4)).toHaveText('0／1');
  await referee.getByRole('button',{name:'刷新停赛名单'}).click();await expect(referee.locator('.discipline-notice')).not.toContainText('浏览器主队球员');
  await admin.goto('/admin-seasons');await expect(admin.getByLabel('足协杯红牌停赛场数',{exact:true})).toBeDisabled();await admin.setViewportSize({width:1440,height:1000});
});

test('历史补录选择后来上传名单，裁判可填红黄牌；已开始报告只能补齐缺失一方',async()=>{
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const source=(await api(admin,'/schedule','POST',{match_type:'足协杯',team_a_id:teams[0],team_b_id:teams[1],match_date:yesterday,match_time:'16:00',field_order:'补录浏览器A1',main_referee_id:refIds[0]})).data;
  await referee.goto('/referee-report/'+source.id);await referee.getByRole('button',{name:'新增红黄牌',exact:true}).click();
  await expect(referee.locator('.card-item select').nth(1).locator('option')).toHaveCount(1);
  // Save an empty draft first to reproduce an already-started report with missing rosters.
  await referee.locator('.card-item').getByRole('button',{name:'删除',exact:true}).click();
  const report=(await api(admin,'/report/schedule/'+source.id)).data;
  const save=await referee.request.post('/api/report/schedule/'+source.id+'/main',{headers:{Authorization:'Bearer '+tokens[0],'If-Match':String(report.sections.main.revision)},data:{home_score:0,away_score:0,goals:[],cards:[]}});expect(save.ok(),await save.text()).toBeTruthy();
  await admin.goto('/admin-schedule/'+source.id);const card=admin.locator('.match-roster-card');
  await expect(card).toContainText('报告已开始时只允许补齐缺失的一方');
  const home=card.locator('article').nth(0),away=card.locator('article').nth(1);
  await expect(home).toContainText('没有可用名单');await home.getByLabel('选择主队名单').selectOption({index:1});await home.getByLabel('切换理由').fill('补录昨日比赛，按原始名单补齐主队');await home.getByRole('button',{name:'补齐此队比赛名单',exact:true}).click();
  await expect(card.getByRole('status')).toContainText('已补齐');await expect(home.locator('form')).toHaveCount(0);await expect(away.locator('form')).toBeVisible();
  await referee.reload();await referee.getByRole('button',{name:'新增红黄牌',exact:true}).click();await referee.locator('.card-item select').nth(1).selectOption({index:1});await expect(referee.locator('.card-item select').nth(1)).not.toHaveValue('');
  await admin.setViewportSize({width:390,height:844});await away.getByLabel('选择客队名单').selectOption({index:1});await away.getByLabel('切换理由').fill('补录昨日比赛，按原始名单补齐客队');await away.getByRole('button',{name:'补齐此队比赛名单',exact:true}).click();await expect(away.locator('form')).toHaveCount(0);
  await expect.poll(()=>admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();await admin.screenshot({path:'test-results/roster-backfill-mobile.png',fullPage:true});
  await admin.setViewportSize({width:1440,height:1000});
});

test('开球前已有报名、选派和报告仍能删除，取消确认保留比赛，已开球按钮禁用',async()=>{
  const date=new Date(Date.now()+8*3600000+2*86400000).toISOString().slice(0,10);
  const future=(await api(admin,'/schedule','POST',{match_type:'足协杯',team_a_id:teams[0],team_b_id:teams[1],match_date:date,match_time:'17:35',field_order:'删除验收F1',main_referee_id:refIds[0],supervisor_required:false})).data;
  await api(referee,'/match-signups/'+future.id,'PUT',{action:'save',intentions:['main'],revision:0,schedule_revision:future.schedule_revision},tokens[0]);
  await referee.goto('/referee-report/'+future.id);
  await referee.getByRole('button',{name:'保存裁判员区',exact:true}).click();
  await expect(referee.locator('.report-notice')).toContainText('保存');
  await admin.goto('/admin-schedule');
  const row=admin.locator('tr').filter({has:admin.getByRole('cell',{name:'删除验收F1',exact:true})});
  await expect(row.getByRole('button',{name:'删除',exact:true})).toBeEnabled();
  await expect(row).toContainText('有效报名 1人');
  admin.removeAllListeners('dialog');
  admin.once('dialog',async dialog=>{expect(dialog.message()).toContain('报名历史、选派、报告与附件');await dialog.dismiss()});
  await row.getByRole('button',{name:'删除',exact:true}).click();await expect(row).toBeVisible();
  admin.once('dialog',dialog=>dialog.accept());
  await row.getByRole('button',{name:'删除',exact:true}).click();await expect(row).toHaveCount(0);
  await expect(admin.locator('.alert.success')).toContainText('已删除');
  const gone=await admin.request.get('/api/schedule/'+future.id,{headers:{Authorization:'Bearer '+adminToken}});expect(gone.status()).toBe(404);
  const past=admin.locator('tr').filter({has:admin.getByRole('cell',{name:'纪律A1',exact:true})});
  await expect(past.getByRole('button',{name:'删除',exact:true})).toBeDisabled();
  await expect(past.getByRole('button',{name:'删除',exact:true})).toHaveAttribute('title','已到开球时间，不能删除比赛');
  admin.on('dialog',dialog=>dialog.accept());
});
