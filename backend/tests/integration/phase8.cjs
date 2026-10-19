const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const {runPendingMigrations} = require('../../utils/migrationRunner');
module.exports = async function({t,pool,state,request,expectStatus}) {
  if(process.env.REFWEB_INTEGRATION_TEST !== '1' || !process.env.DB_NAME.endsWith('_test')) throw Error('阶段8仅允许隔离数据库');
  const id=state.scheduleId,admin=state.tokens.admin,main=state.tokens.main,sup=state.tokens.supervisor;
  const url=`/api/report/admin/schedule/${id}`,normal=`/api/report/schedule/${id}`;
  const detail=async(token=admin)=>(await request(normal,{token})).data.data;
  const json=value=>typeof value==='string'?JSON.parse(value):value;
  const historyRows=async()=> (await pool.execute('SELECT * FROM report_section_history WHERE report_id=? ORDER BY id',[state.reportId || (await detail()).report.id]))[0];
  let original,firstImage,secondImage,imageEntry,otherId;
  const form=()=>{const data=new FormData();data.append('reason','更正第四官员记录单扫描件');data.append('fourth_official_image',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'audit.png');return data};
  await t.test('8 已有提交报告升级基线、原密码时间内容保留和重复迁移',async()=>{
    const c=await pool.getConnection();
    try {
      const tables=['admin','referee','match_reports','match_cards','match_goals','match_referee_stats','match_referee_reviews','match_schedules'];
      const snapshot=async()=>{const out={};for(const table of tables)out[table]=(await c.query(`SELECT * FROM ${table} ORDER BY id`))[0];return out};
      const before=await snapshot();
      await c.query('DROP TABLE competition_discipline_events');
      await c.query('DROP TABLE match_publications');
      await c.query('DROP TABLE report_section_history');await c.query('DROP TABLE report_section_states');
      await c.query("ALTER TABLE match_reports MODIFY main_report_status ENUM('draft','submitted') NOT NULL DEFAULT 'draft', MODIFY supervisor_review_status ENUM('draft','submitted') NOT NULL DEFAULT 'draft'");
      await c.query("DELETE FROM schema_migrations WHERE version>='0011'");
      await runPendingMigrations(c);assert.deepEqual(await snapshot(),before);
      original=await detail();
      assert.equal(original.sections.main.version_no,1);
      assert.equal(json(original.sections.main.original_submission).legacy_actor_unknown,true,'无法证明的旧提交人不伪造');
      const historyBefore=await historyRows();assert.ok(historyBefore.some(h=>h.operation==='baseline'));
      await runPendingMigrations(c);assert.deepEqual(await historyRows(),historyBefore);assert.deepEqual(await snapshot(),before);
    } finally{c.release()}
  });
  await t.test('8 专用管理员接口拒绝越权、无原因、越界分区及夹带赛程修改',async()=>{
    const before=await historyRows();
    expectStatus(await request(`${url}/sections/main/return`,{body:{reason:'测试'}}),401,'未登录');
    expectStatus(await request(`${url}/sections/main/revise`,{token:main,body:{reason:'测试',data:{home_score:0}}}),403,'裁判不能调用修订');
    for(const reason of ['',null,{},'字'.repeat(501)]) expectStatus(await request(`${url}/sections/main/return`,{token:admin,body:{reason}}),400,'非法原因');
    expectStatus(await request(`${url}/sections/other/return`,{token:admin,body:{reason:'测试'}}),400,'非法分区');
    expectStatus(await request(`${url}/sections/main/revise`,{token:admin,body:{reason:'测试',data:{main_referee_id:99}}}),400,'禁止改派');
    expectStatus(await request(`${url}/sections/main/revise`,{token:admin,body:{reason:'测试',data:{main_report_status:'draft'}}}),400,'禁止伪造状态');
    expectStatus(await request(`${url}/sections/main/return`,{token:admin,body:{reason:'测试',schedule_id:2}}),400,'禁止夹带');
    expectStatus(await request(`${url}/sections/main/revise`,{token:admin,autoRevision:false,body:{reason:'测试',data:{home_score:1}}}),409,'无版本不得修订');
    assert.deepEqual(await historyRows(),before);
  });
  await t.test('8 退回只开放裁判员区，原提交记录、另一分区提交状态保持',async()=>{
    const before=await detail(),revision=before.sections.main.revision;
    const returned=await request(`${url}/sections/main/return`,{token:admin,body:{reason:'核对进球时间'}});expectStatus(returned,200,'退回裁判员');
    const after=returned.data.data;
    assert.equal(after.report.main_report_status,'returned');assert.equal(after.report.supervisor_review_status,'submitted');
    assert.equal(after.report.main_report_submitted_at,before.report.main_report_submitted_at);
    assert.deepEqual(after.sections.main.original_submission,before.sections.main.original_submission);
    assert.equal(after.sections.main.return_reason,'核对进球时间');assert.equal(after.sections.main.version_no,1);
    expectStatus(await request(`${normal}/main`,{token:main,headers:{'If-Match':String(revision)},body:{home_score:1}}),409,'旧页面不能覆盖退回');
    expectStatus(await request(`${normal}/main`,{token:main,autoRevision:false,body:{home_score:1}}),409,'旧客户端必须刷新升级');
    expectStatus(await request(`${normal}/main`,{token:state.tokens.assistant1,body:{home_score:1}}),403,'只开放原裁判员');
    expectStatus(await request(`${normal}/supervisor`,{token:sup,body:{reviews:[]}}),400,'另一分区仍锁定');
    expectStatus(await request(`/api/schedule/${id}`,{token:admin,method:'PUT',body:{match_time: '17:35', match_date: '2026-12-31'}}),400,'退回仍不能改比赛');
    expectStatus(await request(`${url}/sections/main/return`,{token:admin,body:{reason:'重复退回'}}),400,'不能重复退回');
  });
  await t.test('8 重填保存、再次提交形成新版本；历史和首次提交人时间不覆盖',async()=>{
    const before=await historyRows();
    expectStatus(await request(`${normal}/main`,{token:main,body:{stats:[{role:'main',running_distance_m:9100}]}}),200,'原裁判员保存重填');
    assert.equal((await detail()).report.main_report_status,'returned');
    const submitted=await request(`${normal}/main/submit`,{token:main,body:{}});expectStatus(submitted,200,'再次提交');
    assert.equal(submitted.data.data.sections.main.version_no,2);assert.equal(submitted.data.data.sections.main.return_reason,null);
    assert.equal(json(submitted.data.data.sections.main.last_submission).actor.actor_referee_id,state.refereeIds.main);
    assert.deepEqual(submitted.data.data.sections.main.original_submission,original.sections.main.original_submission);
    const after=await historyRows();assert.deepEqual(after.slice(0,before.length),before,'旧历史完全不变');
  });
  await t.test('8 管理员修订保持已提交，错误校验与多表失败整体回滚',async()=>{
    const before=await detail(),historyBefore=await historyRows();
    for(const data of [{home_score:31},{home_score:2,goals:[]},{home_score:1,stats:[{role:'main',running_distance_m:-1}]},{stats:[{role:'main',assignment_id:999999,running_distance_m:10}]}]) {
      expectStatus(await request(`${url}/sections/main/revise`,{token:admin,body:{reason:'测试校验',data}}),400,'非法修订');
    }
    assert.deepEqual(await historyRows(),historyBefore);assert.deepEqual((await detail()).report,before.report);
    const revised=await request(`${url}/sections/main/revise`,{token:admin,body:{reason:'依据记录修正跑动距离',data:{stats:[{role:'main',running_distance_m:9200}]}}});expectStatus(revised,200,'管理员直接修订系统裁判员');
    assert.equal(revised.data.data.report.main_report_status,'submitted');assert.equal(revised.data.data.sections.main.version_no,3);
    assert.equal(revised.data.data.report.main_report_submitted_at,before.report.main_report_submitted_at);
    expectStatus(await request(`${normal}/main`,{token:main,body:{home_score:1}}),400,'修订不开放普通保存');
    const latest=(await historyRows()).at(-1);assert.equal(latest.actor_admin_id,Number(revised.data.data.viewer_assignment.user_id));
    assert.equal(json(latest.before_snapshot).data.stats.find(s=>s.role==='main').running_distance_m,9100);
    assert.equal(json(latest.after_snapshot).data.stats.find(s=>s.role==='main').running_distance_m,9200);
  });
  await t.test('8 并发管理员修订只成功一次；分区独立版本不互相覆盖',async()=>{
    const before=await detail(),revision=before.sections.main.revision;
    const writes=[9300,9400].map(distance=>request(`${url}/sections/main/revise`,{token:admin,headers:{'If-Match':String(revision)},body:{reason:'并发验收',data:{stats:[{role:'main',running_distance_m:distance}]}}}));
    assert.deepEqual((await Promise.all(writes)).map(r=>r.status).sort(),[200,409]);
    const after=await detail();assert.equal(after.sections.main.revision,revision+1);assert.equal(after.sections.supervisor.revision,before.sections.supervisor.revision);
  });
  await t.test('8 裁判监督修订、退回与重提遵循同样规则并保留评分隐私',async()=>{
    const before=await detail();
    const fail=await request(`${url}/sections/supervisor/revise`,{token:admin,body:{reason:'测试回滚',data:{reviews:[{target_role:'main',score:null}]}}});expectStatus(fail,400,'已提交评分不能改为缺项');
    assert.deepEqual((await detail()).reviews,before.reviews);
    expectStatus(await request(`${url}/sections/supervisor/revise`,{token:admin,body:{reason:'核实评分',data:{reviews:[{target_role:'main',score:9.2,advice:'修订建议'}]}}}),200,'修订裁判监督');
    const listing=await request(`${normal}/history/supervisor`,{token:main});expectStatus(listing,200,'裁判员可看修订记录');
    const entry=await request(`${normal}/history-entry/${listing.data.data.items[0].id}`,{token:main});expectStatus(entry,200,'裁判员可看自己评分前后');
    for(const side of ['before_snapshot','after_snapshot']) assert.ok(entry.data.data[side].data.reviews.every(r=>r.target_role==='main'));
    const returnResult=await request(`${url}/sections/supervisor/return`,{token:admin,body:{reason:'补充评分依据'}});expectStatus(returnResult,200,'单独退回裁判监督');
    assert.equal(returnResult.data.data.report.main_report_status,'submitted');
    expectStatus(await request(`${normal}/supervisor`,{token:sup,body:{reviews:[{target_role:'main',score:9.3,advice:'补充后提交'}]}}),200,'裁判监督重填');
    expectStatus(await request(`${normal}/supervisor/submit`,{token:sup,body:{}}),200,'裁判监督重新提交');
  });
  await t.test('8 第四官员记录单新增、替换、移除保留历史文件且仍需鉴权；失败上传不留孤立文件',async()=>{
    expectStatus(await request(`${url}/revision-image`,{token:admin,body:form()}),200,'修订新增图片');firstImage=(await detail()).report.fourth_official_image_path;
    const uploaded=await request(`${url}/revision-image`,{token:admin,body:form()});expectStatus(uploaded,200,'修订替换图片');secondImage=uploaded.data.data.report.fourth_official_image_path;assert.notEqual(firstImage,secondImage);
    imageEntry=(await historyRows()).at(-1);
    assert.equal(json(imageEntry.before_snapshot).data.fourth_official_image_path,firstImage);
    for(const side of ['before','after']) expectStatus(await request(`/api/files/report/${id}/history/${imageEntry.id}/${side}/image`,{token:admin}),200,'历史图片仍存在');
    expectStatus(await request(`/api/files/report/${id}/history/${imageEntry.id}/before/image`),401,'历史图拒绝匿名');
    expectStatus(await request(`/api/files/report/${id}/history/${imageEntry.id}/before/image`,{token:state.phase5bAccounts[0].token}),403,'历史图拒绝无关账号');
    const filesBefore=await fs.readdir(path.join(process.env.UPLOAD_DIR,'reports'));
    expectStatus(await request(`${url}/revision-image`,{token:admin,headers:{'If-Match':'0'},body:form()}),409,'过期图片修改拒绝');
    assert.deepEqual(await fs.readdir(path.join(process.env.UPLOAD_DIR,'reports')),filesBefore,'失败上传文件已清理');
    expectStatus(await request(`${url}/revision-image`,{token:admin,method:'DELETE',body:{reason:'扫描件已撤销'}}),200,'移除当前图片');
    assert.equal((await detail()).report.fourth_official_image_path,null);
    expectStatus(await request(`/api/files/report/${id}/fourth-official-image`,{token:admin}),404,'当前图片已移除');
    for(const image of [firstImage,secondImage]) assert.ok((await fs.stat(path.join(process.env.UPLOAD_DIR,'reports',path.basename(image)))).size>0);
    assert.equal((await detail()).report.main_report_status,'submitted');
  });
  await t.test('8 非系统裁判员不能退回但可修订，普通代填接口仍保持锁定',async()=>{
    const [[external]]=await pool.query("SELECT s.id FROM match_schedules s JOIN match_official_assignments a ON a.schedule_id=s.id AND a.role='main' AND a.source_type='external' JOIN match_reports r ON r.schedule_id=s.id WHERE r.main_report_status='submitted' LIMIT 1");
    assert.ok(external);otherId=external.id;
    expectStatus(await request(`/api/report/admin/schedule/${otherId}/sections/main/return`,{token:admin,body:{reason:'不能退回外部'}}),400,'外部裁判员不可退回');
    expectStatus(await request(`/api/report/admin/schedule/${otherId}/sections/main/revise`,{token:admin,body:{reason:'更正代填统计',data:{stats:[{role:'main',running_distance_m:8600}]}}}),200,'外部已提交可修订');
    expectStatus(await request(`/api/report/admin/schedule/${otherId}/main`,{token:admin,body:{}}),400,'普通代填仍锁定');
  });
  await t.test('8 历史按报告隔离、只读、分页完整且不泄露他人评分',async()=>{
    expectStatus(await request(`${normal}/history/main`),401,'历史未登录');
    expectStatus(await request(`${normal}/history/main`,{token:state.phase5bAccounts[0].token}),403,'历史无关账号');
    expectStatus(await request(`/api/report/schedule/${otherId}/history-entry/${imageEntry.id}`,{token:admin}),404,'禁止串报告读取历史');
    expectStatus(await request(`${normal}/history/main?page=-1`,{token:admin}),400,'非法分页');
    const before=await historyRows();
    expectStatus(await request(`${normal}/history-entry/${imageEntry.id}`,{token:admin,method:'DELETE'}),404,'无删除历史接口');
    expectStatus(await request(`${normal}/history-entry/${imageEntry.id}`,{token:admin,method:'PUT',body:{reason:'覆盖'}}),404,'无覆盖历史接口');
    assert.deepEqual(await historyRows(),before);
    for(let i=0;i<21;i++) expectStatus(await request(`${url}/sections/main/revise`,{token:admin,body:{reason:`分页验收${i}`,data:{stats:[{role:'main',running_distance_m:9500+i}]}}}),200,'追加分页历史');
    const first=await request(`${normal}/history/main`,{token:admin}),next=await request(`${normal}/history/main?page=2`,{token:admin});
    assert.equal(first.data.data.items.length,20);assert.ok(next.data.data.items.length>0);assert.ok(first.data.data.total>20);
    assert.ok(!next.data.data.items.some(b=>first.data.data.items.some(a=>a.id===b.id)));
  });
  await t.test('8 管理员修订草稿或已退回内容不自动提交；普通重填图片也保留历史',async()=>{
    const [[draft]]=await pool.query("SELECT s.id FROM match_schedules s JOIN match_reports r ON r.schedule_id=s.id JOIN match_official_assignments a ON a.schedule_id=s.id AND a.role='main' WHERE r.main_report_started_at IS NULL AND r.main_report_status='draft' LIMIT 1");
    assert.ok(draft);
    const drafted=await request(`/api/report/admin/schedule/${draft.id}/sections/main/revise`,{token:admin,body:{reason:'核实草稿统计',data:{stats:[{role:'main',running_distance_m:100}]}}});expectStatus(drafted,200,'修订草稿');
    assert.equal(drafted.data.data.report.main_report_status,'draft');assert.equal(drafted.data.data.sections.main.original_submission,null);
    expectStatus(await request(`${url}/sections/main/return`,{token:admin,body:{reason:'核实扫描件'}}),200,'再次退回');
    const revised=await request(`${url}/sections/main/revise`,{token:admin,body:{reason:'同时补充统计',data:{stats:[{role:'main',running_distance_m:9600}]}}});expectStatus(revised,200,'修订已退回');
    assert.equal(revised.data.data.report.main_report_status,'returned');assert.equal(revised.data.data.sections.main.return_reason,'核实扫描件');
    const uploaded=await request(`${normal}/fourth-official-image`,{token:main,body:form()});expectStatus(uploaded,200,'原裁判员重填上传');
    const kept=uploaded.data.data.report.fourth_official_image_path;
    expectStatus(await request(`${normal}/fourth-official-image`,{token:main,method:'DELETE'}),200,'原裁判员移除图片');
    assert.ok((await fs.stat(path.join(process.env.UPLOAD_DIR,'reports',path.basename(kept)))).size>0);
    expectStatus(await request(`${normal}/main/submit`,{token:main,body:{}}),200,'再次提交');
  });
  await t.test('8 升级前的空赛程在开球前可删除，已开球历史比赛保留',async()=>{
    const [[empty]]=await pool.query("SELECT r.schedule_id FROM match_reports r JOIN report_section_states s ON s.report_id=r.id WHERE r.main_report_started_at IS NULL AND r.supervisor_review_started_at IS NULL AND r.home_score=0 AND r.away_score=0 AND NOT EXISTS(SELECT 1 FROM report_section_history h WHERE h.report_id=r.id) LIMIT 1");
    assert.ok(empty);
    await pool.execute('UPDATE match_schedules SET match_date=?,match_time=? WHERE id=?',['2099-01-01','17:35',empty.schedule_id]);
    expectStatus(await request(`/api/schedule/${empty.schedule_id}`,{token:admin,method:'DELETE'}),200,'迁移后的空状态不阻止删除');
    expectStatus(await request(`/api/schedule/${id}`,{token:admin,method:'DELETE'}),400,'已开球的比赛仍不能删除');
  });
  await t.test('8 数据审计包含分区历史与已移除图片，升级后全项通过',async()=>{
    const {stdout}=await require('node:util').promisify(require('node:child_process').execFile)(process.execPath,[path.resolve(__dirname,'../../scripts/audit.js')],{env:process.env,cwd:path.resolve(__dirname,'../..'),timeout:15000});
    assert.match(stdout,/"missing_upload_count":0/);
    assert.match(stdout,/报告分区修订号与追加历史一致/);
  });
};
