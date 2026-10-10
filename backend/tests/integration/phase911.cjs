const assert=require('node:assert/strict');
const {runPendingMigrations}=require('../../utils/migrationRunner');
module.exports=async function({t,pool,state,request,expectStatus}){
  const token=state.tokens.admin;let account,temp,refToken;
  await t.test('9 升级只新增登录防护表，存量账号密码、业务内容和报告历史不变',async()=>{
    const c=await pool.getConnection();try{
      const tables=['admin','referee','referee_profile','seasons','team','team_player','team_roster_batches','match_schedules','match_reports','match_cards','match_goals','match_referee_stats','match_referee_reviews','referee_season_registrations','referee_season_registration_events','match_official_assignments','external_referees','report_actor_events','report_section_states','report_section_history'];
      const snapshot=async()=>{const out={};for(const name of tables)out[name]=(await c.query(`SELECT * FROM ${name}`))[0];return out};const before=await snapshot();
      await c.query('DROP TABLE login_security_buckets');await c.query('DROP TABLE security_events');await c.query("DELETE FROM schema_migrations WHERE version>='0012'");
      await runPendingMigrations(c);assert.deepEqual(await snapshot(),before);await runPendingMigrations(c);assert.deepEqual(await snapshot(),before);
    }finally{c.release()}
  });
  await t.test('9 管理员新建使用随机临时密码，首次改密、重置、停用撤销旧令牌且有脱敏审计',async()=>{
    const created=await request('/api/referee/admin/add',{token,body:{student_id:'PH911-INIT',name:'生命周期测试',grade:'三级',target_level:'二级',level_promoted_at:'2025-01-01',match_types:['足协杯']}});
    expectStatus(created,201,'新建账号');account=created.data.data.id;temp=created.data.data.temporary_password;assert.ok(temp?.length>=16);assert.notEqual(temp,'PH911-INIT');
    expectStatus(await request('/api/referee/login',{body:{student_id:'PH911-INIT',password:'PH911-INIT'}}),401,'学号不是密码');
    const login=await request('/api/referee/login',{body:{student_id:'PH911-INIT',password:temp}});expectStatus(login,200,'临时密码');refToken=login.data.data.token;
    assert.equal(login.data.data.must_change_password,true);expectStatus(await request('/api/season-registration/current',{token:refToken}),403,'先改密');
    expectStatus(await request(`/api/referee/${account}/password`,{method:'PUT',token:refToken,body:{oldPassword:temp,newPassword:'Changed!P911'}}),200,'修改临时密码');
    expectStatus(await request('/api/referee/all',{token:refToken}),401,'旧令牌立即失效');
    const next=await request('/api/referee/login',{body:{student_id:'PH911-INIT',password:'Changed!P911'}});refToken=next.data.data.token;
    const reset=await request(`/api/admin/referee/${account}/reset-password`,{token,body:{}});expectStatus(reset,200,'重置');assert.notEqual(reset.data.data.temporary_password,temp);
    expectStatus(await request('/api/referee/all',{token:refToken}),401,'重置撤销会话');
    await request(`/api/admin/referee/${account}/status`,{token,method:'PATCH',body:{is_active:false}});
    const disabled=await request('/api/referee/login',{body:{student_id:'PH911-INIT',password:reset.data.data.temporary_password}});
    const unknown=await request('/api/referee/login',{body:{student_id:'PH911-MISSING',password:'wrong'}});assert.equal(disabled.data.message,unknown.data.message);
    const [events]=await pool.execute('SELECT * FROM security_events WHERE target_role=? AND target_id=?',['referee',account]);
    for(const name of ['account_created','password_changed','password_reset','account_disabled'])assert.ok(events.some(e=>e.event_type===name),name);
    assert.ok(events.filter(e=>e.event_type==='password_reset').every(e=>e.actor_role==='admin'));
    const serialized=JSON.stringify(events);for(const secret of [temp,reset.data.data.temporary_password,refToken,'PH911-INIT'])assert.ok(!serialized.includes(secret));
  });
  await t.test('9 账号+IP 连续失败短锁，其他账号不受组合锁影响；过期可恢复',async()=>{
    for(let i=0;i<5;i++){const r=await request('/api/referee/login',{body:{student_id:'THROTTLE-PAIR',password:'wrong'}});expectStatus(r,i===4?429:401,'失败计数');}
    const blocked=await request('/api/referee/login',{body:{student_id:'throttle-pair',password:'wrong'}});expectStatus(blocked,429,'大小写不能绕过');assert.ok(Number(blocked.headers.get('retry-after'))>0);
    expectStatus(await request('/api/referee/login',{body:{student_id:'ANOTHER-ACCOUNT',password:'wrong'}}),401,'不同账号不被组合锁阻断');
    const {securityKey}=require('../../utils/securityEvents');const key=securityKey('referee:throttle-pair');
    const [keys]=await pool.execute('SELECT DISTINCT ip_key FROM security_events WHERE account_key=?',[key]);
    // 登录服务通过驱动写入应用时钟的Date；测试过期也使用同一时钟，不能混入数据库服务器时区。
    await pool.execute('UPDATE login_security_buckets SET blocked_until=? WHERE bucket_key IN (?,?)',[new Date(Date.now()-1000),securityKey(`account:${key}`),securityKey(`pair:${key}:${keys[0].ip_key}`)]);
    expectStatus(await request('/api/referee/login',{body:{student_id:'THROTTLE-PAIR',password:'wrong'}}),401,'过期重新计数');
  });
  await t.test('9 账号维度限制跨来源失败；新来源成功仅记风险信号，重载服务不清空锁',async()=>{
    const {protectedLogin}=require('../../services/loginSecurityService');
    for(let i=0;i<20;i++)await assert.rejects(()=>protectedLogin({role:'referee',identifier:'spread-account',password:'wrong',ip:`192.0.2.${i+1}`,verify:async()=>{throw Error('学号或密码错误')}}),e=>e.statusCode===(i===19?429:401));
    delete require.cache[require.resolve('../../services/loginSecurityService')];
    await assert.rejects(()=>require('../../services/loginSecurityService').protectedLogin({role:'referee',identifier:'spread-account',password:'wrong',ip:'192.0.2.99',verify:async()=>{throw Error('学号或密码错误')}}),e=>e.statusCode===429);
    const verify=(...args)=>require('../../services/adminService').login(...args);
    for(const ip of ['192.0.2.100','192.0.2.101'])await protectedLogin({role:'admin',identifier:state.admin.username,password:state.admin.password,ip,verify});
    const [[event]]=await pool.query("SELECT COUNT(*) total FROM security_events WHERE event_type='login_new_ip' AND target_role='admin'");assert.ok(event.total>=1);
  });
  await t.test('9 数据库认为同一账号的 Unicode 别名不能绕过账号登录锁',async()=>{
    const created=await request('/api/referee/admin/add',{token,body:{student_id:'PH911-SS',name:'别名保护测试',grade:'三级',target_level:'二级',level_promoted_at:'2025-01-01',match_types:['足协杯']}});expectStatus(created,201,'创建专用账号');
    const [[alias]]=await pool.execute('SELECT id FROM referee WHERE student_id=?',['PH911-ß']);assert.equal(alias.id,created.data.data.id,'确认数据库实际将两个拼写视为同一账号');
    const {protectedLogin}=require('../../services/loginSecurityService');
    const verify=(...args)=>require('../../services/refereeService').login(...args);
    for(let i=0;i<5;i++)await assert.rejects(()=>protectedLogin({role:'referee',identifier:i%2?'PH911-ß':'PH911-SS',password:'wrong',ip:'192.0.2.200',verify}),e=>e.statusCode===(i===4?429:401));
    await assert.rejects(()=>protectedLogin({role:'referee',identifier:'PH911-SS',password:created.data.data.temporary_password,ip:'192.0.2.200',verify}),e=>e.statusCode===429);
  });
  await t.test('10 账号后端分页、组合搜索、导出全筛选、非法参数及越权',async()=>{
    const p1=await request('/api/admin/referee/all?page_size=1',{token});const p2=await request('/api/admin/referee/all?page_size=1&page=2',{token});
    expectStatus(p1,200,'账号分页');assert.equal(p1.data.data.length,1);assert.notEqual(p1.data.data[0].id,p2.data.data[0].id);assert.ok(p1.data.meta.pagination.total>1);
    const selected=await request('/api/admin/referee/all?query=PH911&is_active=0',{token});assert.deepEqual(selected.data.data.map(r=>r.id),[account]);
    assert.equal((await request('/api/admin/referee/all?query=%25',{token})).data.data.length,0,'百分号不作为通配符');
    for(const query of ['page=0','page=1e1','page_size=101','is_active=banana','query[]=x','page=1&page=2'])expectStatus(await request('/api/admin/referee/all?'+query,{token}),400,'非法分页');
    const csv=await request('/api/admin/referee/export?page_size=1',{token});expectStatus(csv,200,'导出');assert.ok(csv.data.split('\r\n').length>2,'不只导出一页');for(const secret of ['password_hash','token_version',temp])assert.ok(!csv.data.includes(secret));
    expectStatus(await request('/api/admin/referee/export',{token:state.tokens.main}),403,'裁判不能导出账号');
    expectStatus(await request(`/api/admin/referee/${state.refereeIds.main}`,{token,method:'DELETE'}),400,'历史账号不能删除');
  });
  await t.test('10 赛季审核历史筛选与导出独立快照；分页严格校验',async()=>{
    const r=await request(`/api/season-registration/admin?season_id=${state.seasonId}&status=approved&page_size=1`,{token});expectStatus(r,200,'历史审核');assert.ok(r.data.data.seasons.length>1);assert.equal(r.data.data.items.length,1);
    const csv=await request(`/api/season-registration/admin/export?season_id=${state.seasonId}`,{token});expectStatus(csv,200,'历史已通过导出');assert.ok(csv.data.includes('当季-main'));assert.ok(!csv.data.includes('password'));
    for(const query of ['page=0','page=1abc','page_size=1000','status[]=approved','grade[]=一级','query[]=x'])expectStatus(await request('/api/season-registration/admin?'+query,{token}),400,'审核分页拒绝非法值');
  });
  await t.test('10 工作台未来7天按北京时间跨日，不受数据库会话时区影响',async()=>{
    const {statuses}=require('../../utils/scheduleFilters');
    const c=await pool.getConnection();
    try {
      for(const timezone of ['+00:00','+08:00','-05:00']){
        await c.query('SET SESSION time_zone=?',[timezone]);
        for(const [instant,dates] of [
          ['2026-09-18T15:59:59Z',[['2026-09-17',0],['2026-09-18',1],['2026-09-24',1],['2026-09-25',0]]],
          ['2026-09-18T16:00:00Z',[['2026-09-18',0],['2026-09-19',1],['2026-09-25',1],['2026-09-26',0]]]
        ]){
          await c.query('SET timestamp=?',[Date.parse(instant)/1000]);
          for(const [date,expected] of dates){
            // 无选派的虚拟比赛只测试业务日期窗口，不修改任何实际赛程。
            const [[row]]=await c.query(`SELECT ${statuses.attention} AS needs_attention FROM (SELECT -1 AS id, -1 AS season_id, 1 AS supervisor_required, 1 AS fourth_required, CAST(? AS DATE) AS match_date) s`,[date]);
            assert.equal(Number(row.needs_attention),expected,`${timezone} / ${instant} / ${date}`);
          }
        }
      }
    }finally{c.destroy();} // 固定时钟只作用于此连接，不放回连接池。
  });
  await t.test('10 赛程组合条件、分页、跨页导出与工作台缺岗/失效资格提醒，不修改历史',async()=>{
    const before=(await pool.query('SELECT * FROM match_schedules ORDER BY id'))[0];
    const base=`season_id=${state.seasonId}`;
    const page=await request(`/api/schedule?${base}&page_size=1`,{token});expectStatus(page,200,'赛程分页');assert.equal(page.data.data.length,1);assert.ok(page.data.meta.total>=1);
    const submitted=await request(`/api/schedule?${base}&report_status=submitted`,{token});assert.ok(submitted.data.data.every(s=>s.report_main_status==='submitted'&&s.report_supervisor_status==='submitted'));
    const ext=await request(`/api/schedule?${base}&source_type=external`,{token});expectStatus(ext,200,'来源过滤');
    for(const query of ['report_status=no','source_type=no','date_from=2026-02-30','date_from=2027-01-01&date_to=2026-01-01','page_size=0'])expectStatus(await request(`/api/schedule?${base}&${query}`,{token}),400,'筛选拒绝非法值');
    const csv=await request(`/api/schedule/export?${base}&page_size=1`,{token});expectStatus(csv,200,'赛程全筛选导出');assert.ok(csv.data.includes('裁判员报告'));
    const [[external]]=await pool.query("SELECT s.season_id,a.name_snapshot FROM match_official_assignments a JOIN match_schedules s ON s.id=a.schedule_id WHERE a.role='main' AND a.source_type='external' LIMIT 1");
    assert.ok(external,'存在非系统裁判员测试赛程');
    const externalCsv=await request(`/api/schedule/export?season_id=${external.season_id}`,{token});assert.ok(externalCsv.data.includes(`\"${external.name_snapshot}\",\"非系统\"`),'导出裁判员真实来源而非误标系统');
    const work=await request(`/api/schedule/workbench?${base}`,{token});expectStatus(work,200,'工作台');assert.ok(work.data.data.summary.total>=1);
    assert.deepEqual((await pool.query('SELECT * FROM match_schedules ORDER BY id'))[0],before);
    const [[empty]]=await pool.query('SELECT s.* FROM match_schedules s WHERE NOT EXISTS(SELECT 1 FROM match_official_assignments a WHERE a.schedule_id=s.id) LIMIT 1');
    // 与业务筛选同用北京时间；CURRENT_DATE() 在 UTC 的 CI 数据库中可能仍是昨天。
    if(empty){try{await pool.execute('UPDATE match_schedules SET match_date=DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR) WHERE id=?',[empty.id]);const next=await request(`/api/schedule/workbench?season_id=${empty.season_id}`,{token});assert.ok(next.data.data.items.some(s=>s.id===empty.id));}finally{await pool.execute('UPDATE match_schedules SET match_date=? WHERE id=?',[empty.match_date,empty.id]);}}
    const [[assigned]]=await pool.query("SELECT s.id,s.season_id,s.match_date,r.id referee_id,r.is_active,rs.id registration_id,rs.status FROM match_schedules s JOIN match_official_assignments a ON a.schedule_id=s.id AND a.source_type='system' JOIN referee r ON r.id=a.referee_id JOIN referee_season_registrations rs ON rs.referee_id=r.id AND rs.season_id=s.season_id WHERE r.is_active=1 AND rs.status='approved' LIMIT 1");
    assert.ok(assigned);
    const snapshots=(await pool.query('SELECT * FROM match_official_assignments ORDER BY id'))[0];
    try {
      await pool.execute('UPDATE match_schedules SET match_date=DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR) WHERE id=?',[assigned.id]);
      await pool.execute('UPDATE referee SET is_active=0 WHERE id=?',[assigned.referee_id]);
      const check=async()=>{const r=await request(`/api/schedule?season_id=${assigned.season_id}&report_status=attention`,{token});expectStatus(r,200,'资格核查筛选');assert.ok(r.data.data.some(s=>s.id===assigned.id));};
      await check();await pool.execute('UPDATE referee SET is_active=1 WHERE id=?',[assigned.referee_id]);
      await pool.execute("UPDATE referee_season_registrations SET status='returned' WHERE id=?",[assigned.registration_id]);await check();
    } finally {
      await pool.execute('UPDATE referee SET is_active=? WHERE id=?',[assigned.is_active,assigned.referee_id]);
      await pool.execute('UPDATE referee_season_registrations SET status=? WHERE id=?',[assigned.status,assigned.registration_id]);
      await pool.execute('UPDATE match_schedules SET match_date=? WHERE id=?',[assigned.match_date,assigned.id]);
    }
    assert.deepEqual((await pool.query('SELECT * FROM match_official_assignments ORDER BY id'))[0],snapshots,'提醒不替换历史选派');
  });
};
