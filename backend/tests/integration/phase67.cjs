const assert = require('node:assert/strict');
const { runPendingMigrations } = require('../../utils/migrationRunner');
module.exports = async function({t,pool,state,request,expectStatus}) {
  if(process.env.REFWEB_INTEGRATION_TEST !== '1' || !process.env.DB_NAME.endsWith('_test')) throw Error('只允许隔离测试库');
  const token=state.tokens.admin, sup=state.phase5bAccounts[3];
  const externals=[];
  let match, body, primary;
  await t.test('6/7 旧数据库无损增量迁移并保持旧密码、报告、审核和姓名快照',async()=>{
    const c=await pool.getConnection();
    const tables=['admin','referee','referee_season_registrations','referee_season_registration_events','match_schedules','match_reports','match_cards','match_goals','match_referee_stats','match_referee_reviews'];
    const snapshot=async()=>{
      const result={};
      for(const table of tables) result[table]=(await c.query(`SELECT * FROM ${table} ORDER BY id`))[0].map(row=>{const {assignment_id,target_assignment_id,reviewer_assignment_id,...old}=row; return old;});
      return result;
    };
    try {
      const before=await snapshot();
      assert.ok(before.match_reports.some(r=>r.main_report_status==='submitted'));
      // 仅隔离库模拟阶段 5B；旧版本不曾存在实际操作者事件，不伪造历史。
      await c.query('DROP TABLE competition_discipline_events');
      await c.query('DROP TABLE match_publications');
      await c.query('DROP TABLE report_section_history');
      await c.query('DROP TABLE report_section_states');
      await c.query('DROP TABLE report_actor_events');
      await c.query('ALTER TABLE match_referee_stats DROP FOREIGN KEY fk_stats_assignment, DROP COLUMN assignment_id, MODIFY referee_id INT NOT NULL');
      await c.query('ALTER TABLE match_referee_reviews DROP FOREIGN KEY fk_reviews_target_assignment, DROP FOREIGN KEY fk_reviews_reviewer_assignment, DROP COLUMN target_assignment_id, DROP COLUMN reviewer_assignment_id, MODIFY target_referee_id INT NOT NULL');
      await c.query('DROP TABLE match_official_assignments');
      await c.query('DROP TABLE external_referees');
      await c.query("DELETE FROM schema_migrations WHERE version >= '0009'");
      await runPendingMigrations(c);
      assert.deepEqual(await snapshot(),before);
      const [[counts]]=await c.query(`SELECT (SELECT COUNT(*) FROM match_official_assignments) AS actual,
        (SELECT COALESCE(SUM((main_referee_id IS NOT NULL)+(assistant1_id IS NOT NULL)+(assistant2_id IS NOT NULL)+(fourth_official_id IS NOT NULL)+(supervisor_id IS NOT NULL)),0) FROM match_schedules) AS expected`);
      assert.equal(Number(counts.actual),Number(counts.expected));
      await runPendingMigrations(c);
      assert.deepEqual(await snapshot(),before);
    } finally {c.release();}
  });
  await t.test('非系统名单管理只限管理员，同名新增需确认且不创建账号',async()=>{
    const [[before]]=await pool.query('SELECT COUNT(*) AS n FROM referee');
    expectStatus(await request('/api/officials/external'),401,'未登录');
    expectStatus(await request('/api/officials/external',{token:sup.token}),403,'裁判访问名单');
    for(let i=0;i<4;i++) {
      const r=await request('/api/officials/external',{token,body:{name:`67外部裁判${i}`,note:`单位${i}`}});
      expectStatus(r,201,'创建外部裁判'); externals.push(r.data.data);
    }
    const duplicate=await request('/api/officials/external',{token,body:{name:externals[0].name}});
    expectStatus(duplicate,409,'同名需确认');
    assert.equal(duplicate.data.code,'DUPLICATE_NAME_CONFIRMATION_REQUIRED');
    const same=await request('/api/officials/external',{token,body:{name:externals[0].name,note:'同名不同人',confirm_duplicate:true}});
    expectStatus(same,201,'确认同名'); externals.push(same.data.data);
    expectStatus(await request('/api/officials/external',{token,body:{name:'非法',is_active:'false'}}),400,'拒绝字符串状态');
    expectStatus(await request('/api/officials/external',{token,body:{name:'非法',password:'not-an-account'}}),400,'拒绝账号字段');
    const [[after]]=await pool.query('SELECT COUNT(*) AS n FROM referee'); assert.equal(after.n,before.n);
    const registrationService=require('../../services/seasonRegistrationService');
    const overview=await registrationService.listForAdmin();
    assert.equal(overview.summary.external_referees,5);
    assert.equal(overview.summary.total_accounts,Number(after.n));
  });
  await t.test('搜索与选派来源隔离、同名确认、场上重复岗位均有后端约束',async()=>{
    const [teams]=await pool.execute('SELECT id FROM team WHERE season_id=? AND league_type=? ORDER BY id',[state.newSeasonId,'足协杯']);
    body={match_type:'足协杯',team_a_id:teams[0].id,team_b_id:teams[1].id,match_time: '17:35', match_date: '2027-09-03',field_order:670,
      main_referee_id:`external:${externals[0].id}`,assistant1_id:`external:${externals[1].id}`,assistant2_id:`external:${externals[2].id}`,fourth_official_id:`external:${externals[3].id}`,supervisor_id:`system:${sup.id}`};
    const candidates=await request(`/api/officials/candidates?season_id=${state.newSeasonId}&role=main&query=67外部`,{token});
    expectStatus(candidates,200,'混合候选搜索'); assert.equal(candidates.data.data.items.length,5);
    const supervisors=await request(`/api/officials/candidates?season_id=${state.newSeasonId}&role=supervisor`,{token});
    assert.ok(supervisors.data.data.items.some(a=>a.source_type==='external'));
    expectStatus(await request('/api/schedule',{token,body:{...body,assistant1_id:body.main_referee_id}}),400,'禁止同一外部人兼任');
    const sameName={...body,assistant1_id:`external:${externals[4].id}`};
    const conflict=await request('/api/schedule',{token,body:sameName});
    expectStatus(conflict,409,'同场同名需确认'); assert.equal(conflict.data.code,'OFFICIAL_SAME_NAME_CONFIRMATION_REQUIRED');
    const created=await request('/api/schedule',{token,body:{...sameName,confirm_distinct_people:true}});
    expectStatus(created,200,'确认同名不同人后选派'); match=created.data.data;
    assert.equal(match.main_referee_id,null); assert.equal(match.is_assignment_complete,true); assert.equal(match.officials.length,5);
    const updated=await request(`/api/schedule/${match.id}/assign-referees`,{token,method:'PUT',body:{assistant1_id:body.assistant1_id}});
    expectStatus(updated,200,'未开始时允许更换'); match=updated.data.data; primary=match.officials.find(a=>a.role==='main');
    await assert.rejects(pool.execute("INSERT INTO match_official_assignments (schedule_id,role,source_type,external_referee_id,name_snapshot) VALUES (?,'supervisor','external',?,'非法')",[match.id,externals[4].id]), /check constraint|Duplicate entry/i);
    const systemMatch=await request('/api/schedule',{token,body:{...body,field_order:671,main_referee_id:`system:${sup.id}`,supervisor_id:null}});
    expectStatus(systemMatch,200,'系统裁判员赛程');
    expectStatus(await request(`/api/report/admin/schedule/${systemMatch.data.data.id}/main`,{token,body:{}}),403,'管理员不得代填系统裁判员');
  });
  await t.test('非系统名单改名停用不改历史姓名、资格或已有选派；新选派被拒绝',async()=>{
    const name=externals[0].name;
    expectStatus(await request(`/api/officials/external/${externals[0].id}`,{token,method:'PUT',body:{name:'67外部改名',note:'已改名',is_active:false}}),200,'改名停用');
    const detail=await request(`/api/schedule/${match.id}`,{token}); assert.equal(detail.data.data.main_referee_name,name);
    expectStatus(await request('/api/schedule',{token,body:{...body,field_order:672}}),409,'停用人不得新选派');
    const patch=await request(`/api/schedule/${match.id}/assign-referees`,{token,method:'PUT',body:{main_referee_id:body.main_referee_id}});
    expectStatus(patch,200,'原岗位不重新校验且不改历史快照');
  });
  await t.test('管理员专用代填、第四官员记录单上传、真实操作人、外部统计及系统裁判监督评分形成完整报告',async()=>{
    const url=`/api/report/admin/schedule/${match.id}`;
    const detail=await request(`/api/report/schedule/${match.id}`,{token});
    assert.equal(detail.data.data.viewer_permissions.can_proxy_main,true);
    assert.equal(detail.data.data.viewer_permissions.can_edit_supervisor,false);
    expectStatus(await request(`${url}/main`,{token:sup.token,body:{}}),403,'裁判不能调用代填');
    expectStatus(await request(`/api/report/schedule/${match.id}/main`,{token,body:{}}),403,'管理员不复用裁判接口');
    expectStatus(await request(`/api/report/schedule/${match.id}/supervisor`,{token,body:{reviews:[]}}),403,'管理员不能代填裁判监督');
    const [players]=await pool.execute('SELECT id,team_id FROM team_player WHERE team_id=?',[match.team_a_id]);
    const goal={player_team_id:match.team_a_id,credited_team_id:match.team_a_id,team_player_id:players[0].id,goal_type:'normal',minute_base:20,minute_extra:0};
    expectStatus(await request(`${url}/main`,{token,body:{home_score:31}}),400,'同一比分上限');
    expectStatus(await request(`${url}/main`,{token,body:{home_score:1,goals:[]}}),400,'同一进球校验');
    expectStatus(await request(`${url}/main`,{token,body:{home_score:1,away_score:0,goals:[goal],stats:[{role:'main',running_distance_m:-1}]}}),400,'后续统计校验失败整体回滚');
    const [[rolledBack]]=await pool.execute('SELECT home_score,main_report_started_at FROM match_reports WHERE id=?',[match.report_id]);
    assert.equal(rolledBack.home_score,0); assert.equal(rolledBack.main_report_started_at,null);
    const [[eventsBefore]]=await pool.execute('SELECT COUNT(*) AS n FROM report_actor_events WHERE report_id=?',[match.report_id]); assert.equal(Number(eventsBefore.n),0);
    const saved=await request(`${url}/main`,{token,body:{home_score:1,away_score:0,goals:[goal],stats:[{role:'main',running_distance_m:8500},{role:'assistant1',running_distance_m:6000}]}});
    expectStatus(saved,200,'代填保存');
    const stat=saved.data.data.stats.find(s=>s.role==='main'); assert.equal(stat.referee_id,null); assert.equal(stat.assignment_id,primary.id);
    const event=saved.data.data.actor_events[0]; assert.equal(event.source_type,'admin_proxy'); assert.equal(event.actor_name_snapshot,state.admin.username);
    const image=new FormData(); image.append('fourth_official_image',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'test.png');
    expectStatus(await request(`${url}/fourth-official-image`,{token,body:image}),200,'代填上传图片');
    expectStatus(await request(`/api/files/report/${match.id}/fourth-official-image`,{token}),200,'管理员读取私有图片');
    expectStatus(await request(`/api/files/report/${match.id}/fourth-official-image`),401,'图片拒绝未登录');
    expectStatus(await request(`/api/schedule/${match.id}/assign-referees`,{token,method:'PUT',body:{main_referee_id:`external:${externals[2].id}`}}),400,'代填后岗位锁定');
    const reviews=['main','assistant1','assistant2','fourth'].map(target_role=>({target_role,score:8.5,advice:'测试评价'}));
    const reviewed=await request(`/api/report/schedule/${match.id}/supervisor`,{token:sup.token,body:{reviews}});
    expectStatus(reviewed,200,'系统裁判监督评价四个外部岗位');
    assert.ok(reviewed.data.data.reviews.every(rv=>rv.target_referee_id===null && rv.target_assignment_id));
    expectStatus(await request(`/api/report/schedule/${match.id}/supervisor/submit`,{token:sup.token,body:{}}),200,'裁判监督提交');
    const both=await Promise.all([request(`${url}/main/submit`,{token,body:{}}),request(`${url}/main/submit`,{token,body:{}})]);
    assert.deepEqual(both.map(r=>r.status).sort(),[200,400]);
    expectStatus(await request(`${url}/main`,{token,body:{home_score:0}}),400,'提交后管理员也不能改');
    expectStatus(await request(`${url}/fourth-official-image`,{token,method:'DELETE'}),400,'提交后不能删图');
    // Keep this fixture for subsequent history checks; future reports no longer block deletion.
    const deleteState=(await request(`/api/schedule/${match.id}`,{token})).data.data.delete_state;
    assert.equal(deleteState.can_delete,true,'有报告的未开球比赛允许删除');
    const [[n]]=await pool.execute("SELECT COUNT(*) AS n FROM report_actor_events WHERE report_id=? AND operation='submit_main'",[match.report_id]); assert.equal(Number(n.n),1);
  });
  await t.test('非系统编号与账号编号重合不授予报告权限、不混入个人统计，历史姓名仍保留',async()=>{
    const reportService=require('../../services/reportService'), scheduleService=require('../../services/scheduleService');
    const [[account]]=await pool.execute('SELECT id FROM referee WHERE id=?',[externals[0].id]);
    assert.ok(account,'隔离数据必须包含重号系统账号');
    await assert.rejects(reportService.getReportByScheduleId(match.id,{id:account.id,role:'referee'}),e=>e.statusCode===403);
    await assert.rejects(reportService.updateMainReport(match.id,account.id,{}),e=>e.statusCode===403);
    const trends=await scheduleService.listStatTrendsForReferee(account.id);
    assert.ok(trends.every(row=>Number(row.schedule_id)!==Number(match.id)));
    const detail=await reportService.getReportByScheduleId(match.id,{id:sup.id,role:'referee'});
    assert.equal(detail.schedule.main_referee_name,externals[0].name);
    assert.ok(detail.reviews.every(r=>r.target_referee_id===null));
    assert.ok(detail.actor_events.some(e=>e.operation==='submit_supervisor'&&e.source_type==='referee'));
  });
};
