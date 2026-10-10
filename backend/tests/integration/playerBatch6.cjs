const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
module.exports=async({t,pool,state,request,expectStatus})=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'refweb-player-demo-'));
  const [[admin]]=await pool.execute('SELECT id FROM admin WHERE username=?',[state.admin.username]);
  const file=batch=>path.join(directory,`${batch}.seed`),script=path.resolve(__dirname,'../../scripts/playerDemo.js');
  const run=(batch,command='append',size='small',env={})=>execFile(process.execPath,[script,command,`--batch=${batch}`,`--admin-id=${admin.id}`,`--size=${size}`],{env:{...process.env,PLAYER_DEMO_CONFIRM:`APPEND_${process.env.DB_NAME}`,PLAYER_DEMO_OUTPUT:file(batch),...env},timeout:180000,maxBuffer:1024*1024});
  const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
  async function capture(){const result={};for(const r of(await pool.query('SHOW TABLES'))[0]){const name=Object.values(r)[0],rows=(await pool.query(`SELECT * FROM \`${name}\``))[0];result[name]=rows.map(hash);}return result;}
  async function preserved(before,exact=false){for(const [table,rows]of Object.entries(before)){const after=(await pool.query(`SELECT * FROM \`${table}\``))[0].map(hash);if(exact)assert.equal(after.length,rows.length,table);const seen=new Set(after);for(const h of rows)assert.ok(seen.has(h),`${table} 旧记录保持`);}}
  const call=async(url,body,token=state.tokens.admin,method,headers)=>{const r=await request(url,{body,token,method,headers});expectStatus(r,200,url);return r.data.data;};
  let small,large;
  try{
    await t.test('第六批生成器只读预览、授权、旧数据保留、真实材料及重复批次安全',async()=>{
      const before=await capture();
      assert.equal(JSON.parse((await run('pb6-small','plan','small',{PLAYER_DEMO_CONFIRM:''})).stdout).players,24);
      await preserved(before,true);await assert.rejects(fs.stat(file('pb6-small')),{code:'ENOENT'});
      await assert.rejects(run('pb6-small','append','small',{PLAYER_DEMO_CONFIRM:''}),/PLAYER_DEMO_CONFIRM/);
      const uploadDir=require('../../utils/playerAcademicUpload').DIRECTORY;
      const originalFiles=(await fs.readdir(uploadDir)).sort();
      await pool.query("CREATE TRIGGER pb6_fixture_failure BEFORE INSERT ON team FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected player demo failure'");
      try{await assert.rejects(run('pb6-failure'),/ER_SIGNAL_EXCEPTION/);}finally{await pool.query('DROP TRIGGER pb6_fixture_failure');}
      await preserved(before,true);assert.deepEqual((await fs.readdir(uploadDir)).sort(),originalFiles);await assert.rejects(fs.stat(file('pb6-failure')),{code:'ENOENT'});
      const out=await run('pb6-small');small=JSON.parse(await fs.readFile(file('pb6-small'),'utf8'));
      assert.equal(small.players.length,24);assert.equal(small.referees.length,5);assert.equal(small.teams.length,6);
      for(const p of [...small.players,...small.referees])assert.ok(!out.stdout.includes(p.password),'不输出密码');
      await preserved(before);assert.equal((await pool.execute('SELECT is_active FROM seasons WHERE id=?',[small.season.id]))[0][0].is_active,0);
      // 幂等标记不依赖可被本人修改的学号或管理员可改的赛季名称。
      await pool.execute('UPDATE player_accounts SET name=?,student_id=? WHERE id=?',['已人工修改','PB6-CHANGED',small.players[1].id]);
      const after=await capture();assert.equal(JSON.parse((await run('pb6-small')).stdout).status,'skipped');await preserved(after,true);
      await assert.rejects(run('pb6-small','append','large'),/不能更改规模/);
      const publicTeam=await call('/api/public/teams/'+small.teams[0].team_id,undefined,null);
      assert.deepEqual(publicTeam.matches.map(m=>m.status),['published','revising','unpublished']);
      assert.equal(publicTeam.matches[1].result.home_score,1);assert.equal(publicTeam.players[1].is_foreign,1);assert.equal(publicTeam.players[1].is_sports_training,1);
      const reg=await call('/api/player-admin/season-registrations/'+small.players[1].registration_id);
      assert.equal((await request(`/api/player-admin/season-registrations/${reg.registration.id}/files/${reg.files[0].id}`,{token:state.tokens.admin})).status,200);
    });
    await t.test('第六批同批次并发只生成一次，500人列表分页完整与球队统计查询实测',async()=>{
      const before=await capture(),checks=require('../../scripts/audit').checks;
      const auditCounts=await Promise.all(checks.map(async check=>{const [rows]=await pool.query(check.sql);return check.countRows?rows.length:Number(rows[0]?.issue_count||0);}));
      const runs=await Promise.allSettled([run('pb6-large','append','large',{NODE_ENV:'production',PLAYER_DEMO_ALLOW_PRODUCTION:'true'}),run('pb6-large','append','large',{NODE_ENV:'production',PLAYER_DEMO_ALLOW_PRODUCTION:'true'})]);
      for(const r of runs)if(r.status==='rejected')throw r.reason;const out=runs.map(r=>r.value);
      assert.deepEqual(out.map(r=>JSON.parse(r.stdout).status).sort(),['appended','skipped']);await preserved(before);
      large=JSON.parse(await fs.readFile(file('pb6-large'),'utf8'));assert.equal(large.players.length,500);assert.equal(large.teams.length,48);
      const ids=[];let total;const times=[];
      for(let page=1;page<=5;page++){const start=performance.now(),d=await call(`/api/player-admin?q=PD-pb6-large-&page_size=100&page=${page}`);times.push(performance.now()-start);total=d.pagination.total;ids.push(...d.players.map(p=>p.id));}
      assert.equal(total,500);assert.equal(new Set(ids).size,500);
      const registrations=await call(`/api/player-admin/season-registrations?season_id=${large.season.id}&page_size=100`);assert.equal(registrations.pagination.total,498);
      const login=await call('/api/player/login',{student_id:large.players[1].student_id,password:large.players[1].password},null,'POST');
      const readings=await Promise.all(Array.from({length:12},async()=>{const start=performance.now();const rows=await call(`/api/player/my-teams?season_id=${large.season.id}`,undefined,login.token);assert.ok(rows.some(r=>r.id===large.teams[0].team_id&&r.is_member&&r.can_manage));return performance.now()-start;}));
      const stats=await call('/api/player/team-results/'+large.teams[0].team_id,undefined,login.token);assert.equal(stats.my_goals,3);
      const review=await call('/api/player-admin/team-applications/'+large.applications[1].id);assert.equal(review.members[0].approved_team_count,1);
      const measurements={accounts:500,teams:48,page_100_ms:times.map(Math.round),parallel_requests:12,my_teams_ms:readings.map(Math.round)};
      console.log('PLAYER_SCALE_MEASUREMENTS '+JSON.stringify(measurements));
      // 前置用例故意构造过旧报告的不完整行；生成器不能改变或增加这些既有问题。
      for(const [i,check]of checks.entries()){const [rows]=await pool.query(check.sql);assert.equal(check.countRows?rows.length:Number(rows[0]?.issue_count||0),auditCounts[i],check.name);}
    });
    await t.test('第六批生成数据可继续真实审核、学号添加、系统裁判报告重提及私有权限校验',async()=>{
      await call(`/api/season/${large.season.id}/activate`,{},state.tokens.admin,'PUT');
      const manager=await call('/api/player/login',{student_id:large.players[0].student_id,password:large.players[0].password},null,'POST');
      const draft=large.applications.find(a=>a.status==='draft');
      const found=await call(`/api/player/team-applications/${draft.id}/players?student_id=${large.players[1].student_id}`,undefined,manager.token);assert.equal(found.id,large.players[1].id);
      const reg=await call('/api/player-admin/season-registrations/'+large.players.at(-5).registration_id);
      await call(`/api/player-admin/season-registrations/${reg.registration.id}/approve`,{account_revision:reg.account.revision},state.tokens.admin,'POST',{'If-Match':String(reg.registration.revision)});
      const fileUrl=`/api/player/season-registration/${reg.registration.id}/files/${reg.files[0].id}`;
      expectStatus(await request(fileUrl,{token:manager.token}),403,'负责人不能看别人截图');expectStatus(await request(fileUrl),401,'游客不能看截图');
      const ref=large.referees[0],login=await call('/api/referee/login',{student_id:ref.student_id,password:ref.password},null,'POST');
      const matchId=large.matches[1].id;await call(`/api/report/schedule/${matchId}/main/submit`,{},login.token,'POST');
      const results=await call('/api/public/teams/'+large.teams[0].team_id,undefined,null);assert.equal(results.matches.find(m=>m.id===matchId).result.home_score,0);
      const report=await call(`/api/report/schedule/${large.matches[0].id}`);assert.ok(report.match_rosters[0].players.every(p=>p.player_account_id));
    });
  }finally{for(const batch of ['pb6-small','pb6-large'])await fs.unlink(file(batch)).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(directory);}
};
