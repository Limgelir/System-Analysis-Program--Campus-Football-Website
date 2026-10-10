const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

module.exports = async function({t,pool,state,request,expectStatus}) {
  await t.test('追加生成器：全表旧行不变、失败回滚、重复及并发幂等、功能 API 可继续操作',async()=>{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(),'refweb-append-credentials-'));
    const script = path.resolve(__dirname,'../../scripts/demoAppend.js');
    const [[admin]] = await pool.execute('SELECT id FROM admin WHERE username=?',[state.admin.username]);
    const [[season]] = await pool.query('SELECT id FROM seasons WHERE is_active=1');
    const file = batch => path.join(directory,`${batch}.seed`);
    const run = (batch,command='append',overrides={})=>execFile(process.execPath,[script,command,`--batch=${batch}`,`--season-id=${season.id}`,`--admin-id=${admin.id}`],{
      env:{...process.env,DEMO_APPEND_CONFIRM:`APPEND_${process.env.DB_NAME}`,DEMO_APPEND_OUTPUT:file(batch),...overrides},timeout:180000,maxBuffer:3*1024*1024
    });
    const hash = row=>crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
    const uploadSnapshot = async()=>{
      const entries = {};
      async function walk(directory, prefix='') {
        for(const item of await fs.readdir(directory,{withFileTypes:true})) {
          const relative=prefix+item.name, full=path.join(directory,item.name);
          if(item.isDirectory())await walk(full,`${relative}/`);
          else entries[relative]=hash(await fs.readFile(full));
        }
      }
      await walk(process.env.UPLOAD_DIR);
      return entries;
    };
    const capture = async()=>{
      const [tables] = await pool.query('SHOW TABLES');
      const snapshots = {};
      for(const row of tables){
        const table=Object.values(row)[0];
        const [keys]=await pool.execute("SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION",[table]);
        assert.ok(keys.length,table);
        const key = row=>JSON.stringify(keys.map(k=>row[k.name]));
        const [records]=await pool.query(`SELECT * FROM \`${table}\``);
        snapshots[table]={key,rows:new Map(records.map(r=>[key(r),hash(r)]))};
      }
      return snapshots;
    };
    const assertPreserved = async(before,exact=false)=>{
      for(const [table,snapshot] of Object.entries(before)){
        const [rows]=await pool.query(`SELECT * FROM \`${table}\``);
        const after=new Map(rows.map(r=>[snapshot.key(r),hash(r)]));
        if(exact)assert.equal(after.size,snapshot.rows.size,`${table} 行数不变`);
        for(const [key,value] of snapshot.rows)assert.equal(after.get(key),value,`${table} 旧记录 ${key} 必须原样保留`);
      }
    };
    try {
      const before=await capture();
      const uploadsBefore=await uploadSnapshot();
      const plan=JSON.parse((await run('append-api','plan',{DEMO_APPEND_CONFIRM:''})).stdout);
      assert.equal(plan.status,'plan');assert.equal(plan.added_accounts,30);
      await assert.rejects(fs.stat(file('append-api')),e=>e.code==='ENOENT');
      await assertPreserved(before,true);
      await assert.rejects(run('append-api','append',{DEMO_APPEND_CONFIRM:''}),/DEMO_APPEND_CONFIRM/);
      await fs.writeFile(file('existing-file'),'private-old-credentials');
      await assert.rejects(run('existing-file'),/凭据文件已存在/);
      assert.equal(await fs.readFile(file('existing-file'),'utf8'),'private-old-credentials');
      await assertPreserved(before,true);

      const generated=await run('append-api');
      const summary=JSON.parse(generated.stdout);
      assert.equal(summary.status,'appended');assert.equal(summary.added_accounts,30);
      assert.equal(summary.added_schedules,31);assert.equal(summary.added_teams,14);
      await assertPreserved(before);
      assert.deepEqual(await uploadSnapshot(),uploadsBefore,'原上传文件内容和路径全部保持不变');
      const creds=JSON.parse(await fs.readFile(file('append-api'),'utf8'));
      assert.equal(creds.referee_accounts.length,30);
      assert.equal(new Set(creds.referee_accounts.map(r=>r.initial_password)).size,30);
      assert.ok(creds.referee_accounts.every(r=>!generated.stdout.includes(r.initial_password)));
      for(const ref of creds.referee_accounts) {
        const [events]=await pool.execute('SELECT before_snapshot,after_snapshot FROM referee_season_registration_events WHERE referee_id=? AND season_id=? ORDER BY id',[ref.id,season.id]);
        const json=value=>typeof value==='string'?JSON.parse(value):value;
        for(let i=1;i<events.length;i++)assert.deepEqual(json(events[i].before_snapshot),json(events[i-1].after_snapshot),'注册历史前后快照衔接一致');
      }
      if(process.platform!=='win32')assert.equal((await fs.stat(file('append-api'))).mode & 0o777,0o600);
      const [[active]]=await pool.query('SELECT id FROM seasons WHERE is_active=1');assert.equal(active.id,season.id);
      const [history]=await pool.execute('SELECT is_active FROM seasons WHERE id=?',[creds.historical_season_id]);assert.equal(history[0].is_active,0);

      const adminLogin=await request('/api/admin/login',{body:state.admin});expectStatus(adminLogin,200,'旧管理员继续登录');
      const token=adminLogin.data.data.token;
      const workbench=await request(`/api/schedule/workbench?season_id=${season.id}`,{token});
      expectStatus(workbench,200,'新场景工作台');
      assert.ok(Number(workbench.data.data.summary.attention)>=9);
      assert.ok(Number(workbench.data.data.summary.proxy_pending)>=3);
      const login=async n=>request('/api/referee/login',{body:{student_id:creds.referee_accounts[n].student_id,password:creds.referee_accounts[n].initial_password}});
      const temporary=await login(0);expectStatus(temporary,200,'新随机临时密码登录');
      assert.equal(temporary.data.data.must_change_password,true);
      expectStatus(await request('/api/season-registration/current',{token:temporary.data.data.token}),403,'临时密码必须先改密');
      expectStatus(await request(`/api/referee/${creds.referee_accounts[0].id}/password`,{method:'PUT',token:temporary.data.data.token,
        body:{oldPassword:creds.referee_accounts[0].initial_password,newPassword:'AppendChanged!2026'}}),200,'生成账号可完成首次改密');
      const changedMain=await request('/api/referee/login',{body:{student_id:creds.referee_accounts[0].student_id,password:'AppendChanged!2026'}});
      expectStatus(changedMain,200,'改密后登录');
      const ready=await login(4);expectStatus(ready,200,'普通演示账号登录');
      expectStatus(await request('/api/season-registration/current',{token:ready.data.data.token}),200,'可读赛季注册');
      expectStatus(await login(28),401,'停用演示账号不能登录');
      for(const kind of ['双方已提交并有管理员修订','裁判员已退回','非系统裁判员待管理员代填','非系统裁判员已代填且裁判监督退回']){
        const match=creds.schedule_assignments.find(s=>s.scenario===kind);
        const result=await request(`/api/report/schedule/${match.id}`,{token});expectStatus(result,200,kind);
        if(kind==='双方已提交并有管理员修订'){
          assert.equal(result.data.data.report.main_report_status,'submitted');
          assert.equal(result.data.data.sections.main.version_no,2);
        }
        if(kind==='裁判员已退回')assert.equal(result.data.data.report.main_report_status,'returned');
        if(kind==='非系统裁判员已代填且裁判监督退回')assert.equal(result.data.data.report.supervisor_review_status,'returned');
      }
      const matchOf=kind=>creds.schedule_assignments.find(s=>s.scenario===kind);
      const returnedMatch=matchOf('裁判员已退回');
      expectStatus(await request(`/api/report/schedule/${returnedMatch.id}/main`,{token:changedMain.data.data.token,
        body:{stats:[{role:'main',running_distance_m:9300}]}}),200,'生成的退回报告可重填');
      expectStatus(await request(`/api/report/schedule/${returnedMatch.id}/main/submit`,{token:changedMain.data.data.token,body:{}}),200,'生成的退回报告可重新提交');
      const proxyMatch=matchOf('非系统裁判员待管理员代填');
      expectStatus(await request(`/api/report/admin/schedule/${proxyMatch.id}/main`,{token,body:{home_score:0,away_score:0,goals:[]}}),200,'生成的非系统裁判员报告可管理员代填');
      expectStatus(await request(`/api/report/admin/schedule/${proxyMatch.id}/main/submit`,{token,body:{}}),200,'代填报告可提交');
      const reviewMatch=matchOf('非系统裁判员已代填且裁判监督退回');
      expectStatus(await request(`/api/report/schedule/${reviewMatch.id}/supervisor/submit`,{token:ready.data.data.token,body:{}}),200,'系统裁判监督可重交合成退回评分');
      const revised=await request(`/api/report/admin/schedule/${matchOf('双方已提交并有管理员修订').id}/sections/main/revise`,{
        token,body:{reason:'继续验收生成的报告',data:{stats:[{role:'main',running_distance_m:9400}]}}});
      expectStatus(revised,200,'合成版本可继续管理员修订');
      assert.equal(revised.data.data.sections.main.version_no,3);
      const audit=()=>execFile(process.execPath,[path.resolve(__dirname,'../../scripts/audit.js')],{env:process.env,timeout:30000,maxBuffer:3*1024*1024});
      await audit();

      // 模拟用户验收后改过姓名、足协状态和密码；同批次重跑不得覆盖这些变化。
      await pool.execute('UPDATE referee SET name=?,password_hash=?,shanghai_fa_registered=1 WHERE id=?',['验收后已修改',await require('bcryptjs').hash('Changed!2026',4),creds.referee_accounts[10].id]);
      const changed=await capture(), credentialHash=hash(await fs.readFile(file('append-api'),'utf8'));
      assert.equal(JSON.parse((await run('append-api')).stdout).status,'skipped');
      await assertPreserved(changed,true);
      assert.equal(hash(await fs.readFile(file('append-api'),'utf8')),credentialHash);
      // 部分冲突绝不自动修复或覆盖，避免把人工修改后的账号误当作缺失样例。
      await pool.execute('UPDATE referee SET student_id=? WHERE id=?',['renamed-by-owner',creds.referee_accounts[10].id]);
      const renamed=await capture();
      await assert.rejects(run('append-api'),/部分同名账号/);
      await assertPreserved(renamed,true);

      // 新批次并发只成功追加一次；第一进程完成后第二进程不得改密码或追加第二份。
      const parallel=await Promise.all([run('append-next'),run('append-next')]);
      assert.deepEqual(parallel.map(r=>JSON.parse(r.stdout).status).sort(),['appended','skipped']);
      await assertPreserved(renamed);
      await audit();
      assert.deepEqual(await uploadSnapshot(),uploadsBefore);

      // 制造队名唯一键冲突：错误发生在新账号已写入事务之后，整批必须回滚。
      await pool.execute('INSERT INTO team (season_id,team_name,league_type) VALUES (?,?,?)',[season.id,'追加conflict-api-足协杯1','足协杯']);
      const conflictBefore=await capture();
      await assert.rejects(run('conflict-api'),/ER_DUP_ENTRY/);
      await assertPreserved(conflictBefore,true);
      await assert.rejects(fs.stat(file('conflict-api')),e=>e.code==='ENOENT');
      await audit();
    } finally {
      // 仅移除 mkdtemp 返回的本轮私有临时凭据目录，业务上传目录由总运行器管理。
      await fs.rm(directory,{recursive:true,force:true});
    }
  });
};
