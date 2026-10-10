import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { device } from './device.js'
const password=process.env.E2E_PASSWORD
const png=fs.readFileSync(new URL('../../../backend/tests/fixtures/team-auto-review-academic.png',import.meta.url))
const instruction='请提供1系统中“我的学籍”-“我的信息”-“学籍信息”截图，照片必须包含姓名，学籍信息，学院，否则将会退回'
test('球员学院修改提交、退回重提、人工通过与撤回，学院通过前不变',async({browser})=>{
  test.setTimeout(120000)
  const pc=await browser.newContext({baseURL:process.env.E2E_BASE_URL,...device}),ac=await browser.newContext({baseURL:process.env.E2E_ADMIN_URL,...device})
  const p=await pc.newPage(),a=await ac.newPage(),errors=[],kind=process.env.E2E_MOBILE==='1'?'mobile':'desktop'
  for(const page of [p,a])page.on('pageerror',e=>errors.push(e.message))
  p.on('dialog',dialog=>dialog.accept())
  try{
    const body={student_id:'COLLEGE-REVIEW-BROWSER',name:'学院审核浏览器球员',college:'土木工程学院',password,gender:'male',password_confirm:password}
    expect((await p.request.post('/api/player/register',{data:body})).status()).toBe(201)
    await p.goto('/login');await p.getByLabel('学号',{exact:true}).fill(body.student_id);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录',exact:true}).click();await expect(p).toHaveURL(/dashboard$/)
    await p.goto('/account');const panel=p.locator('.college-change-settings')
    await expect(panel.locator('.old-college')).toContainText('土木工程学院');await expect(panel.locator('.academic-example .field-help')).toHaveText(instruction)
    await expect(panel.locator('.academic-example img')).toBeVisible();await expect.poll(()=>panel.locator('.academic-example img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(1000)
    await panel.getByLabel('新学院',{exact:true}).selectOption('上海自主智能无人系统科学中心');await expect(panel.getByRole('button',{name:'提交学院修改审核'})).toBeDisabled()
    const upload=()=>panel.locator('#college-change-file').setInputFiles({name:'学院修改验收.png',mimeType:'image/png',buffer:png})
    await upload();await panel.scrollIntoViewIfNeeded();await p.screenshot({path:path.resolve('../.cache/college-change-submit-'+kind+'.png'),fullPage:true,animations:'disabled'})
    await panel.getByRole('button',{name:'提交学院修改审核'}).click();await expect(panel.locator('.pending-college')).toContainText('土木工程学院 → 上海自主智能无人系统科学中心');await expect(panel.locator('.old-college')).toContainText('土木工程学院')
    await expect(panel.locator('#college-change-file')).toHaveCount(0)
    await a.goto('/admin-login');await a.getByPlaceholder('请输入用户名').fill('e2e-admin');await a.getByPlaceholder('请输入密码',{exact:true}).fill(password);await a.getByRole('button',{name:'登录',exact:true}).click();await expect(a).toHaveURL(/admin-dashboard$/)
    await a.getByRole('button',{name:'前往球员修改学院审核',exact:true}).click();await a.getByLabel('搜索球员').fill(body.student_id);await a.getByRole('button',{name:'查询',exact:true}).click()
    await a.getByRole('button',{name:'查看申请',exact:true}).click();await expect(a.locator('.comparison')).toContainText('原学院：土木工程学院');await expect(a.locator('.detail img')).toBeVisible()
    await expect(a.getByRole('button',{name:'退回学院修改'})).toBeDisabled();await a.getByLabel('审核说明／退回理由').fill('请提供包含姓名和学院的完整截图')
    await a.getByRole('button',{name:'退回学院修改'}).click();await expect(a.getByRole('status')).toContainText('已退回')
    await panel.getByRole('button',{name:'刷新申请状态'}).click();await expect(panel.locator('.college-history')).toContainText('请提供包含姓名和学院的完整截图');await expect(panel.locator('.old-college')).toContainText('土木工程学院')
    await expect(panel.locator('#college-change-file')).toHaveValue('');await panel.getByLabel('新学院',{exact:true}).selectOption('上海自主智能无人系统科学中心');await upload();await panel.getByRole('button',{name:'提交学院修改审核'}).click();await expect(panel.locator('.pending-college')).toBeVisible()
    await a.getByRole('button',{name:'查询',exact:true}).click();await a.getByRole('button',{name:'查看申请',exact:true}).click();await expect(a.locator('.detail img')).toBeVisible()
    await a.locator('.detail').scrollIntoViewIfNeeded();await a.screenshot({path:path.resolve('../.cache/college-change-admin-'+kind+'.png'),fullPage:true,animations:'disabled'})
    await a.getByRole('button',{name:'通过学院修改'}).click();await expect(a.getByRole('status')).toContainText('学院修改已通过')
    await panel.getByRole('button',{name:'刷新申请状态'}).click();await expect(panel.locator('.old-college')).toContainText('上海自主智能无人系统科学中心');await expect(panel.locator('.pending-college')).toHaveCount(0)
    await panel.getByRole('button',{name:'查看申请详情'}).first().click();await expect(panel.locator('.college-detail img')).toBeVisible();await expect(panel.locator('.college-detail')).toContainText('审核通过')
    await p.goto('/dashboard');await expect(p.locator('.welcome')).toContainText('上海自主智能无人系统科学中心');await expect(p.locator('.notifications')).toContainText('你的学院修改申请已通过')
    await p.goto('/account');await panel.getByLabel('新学院',{exact:true}).selectOption('土木工程学院');await upload();await panel.getByRole('button',{name:'提交学院修改审核'}).click();await expect(panel.locator('.pending-college')).toBeVisible()
    await panel.getByRole('button',{name:'撤回学院申请'}).click();await expect(panel.locator('.pending-college')).toHaveCount(0);await expect(panel.locator('.old-college')).toContainText('上海自主智能无人系统科学中心');await expect(panel.locator('.college-history')).toContainText('已撤回')
    for(const page of [p,a])expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
    expect(errors).toEqual([])
  }finally{await pc.close();await ac.close()}
})
