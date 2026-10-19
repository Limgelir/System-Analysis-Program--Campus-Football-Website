const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { loadTestConnectionEnvironment, executeSqlScript } = require('./runApiIntegrationTests');
const { runPendingMigrations } = require('../utils/migrationRunner');
const root = path.resolve(__dirname, '../..');
async function main() {
  const options = loadTestConnectionEnvironment();
  const database = `refweb_assignment_changes_${crypto.randomBytes(6).toString('hex')}_test`;
  const c = await mysql.createConnection(options.connection);
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'refweb-assignment-changes-'));
  let owned = false, server, pool;
  try {
    await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); owned = true;
    const schema = fs.readFileSync(path.join(root, 'db/final_schema.sql'), 'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i, `CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i, `USE \`${database}\`;`);
    await executeSqlScript(c, schema); await runPendingMigrations(c);
    const password = 'Local!' + crypto.randomBytes(12).toString('base64url');
    await c.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())', ['assignment-admin', await bcrypt.hash(password, 10)]);
    const fixture = await require('./seedAssignmentExport')(c, { active: true });
    await c.execute("UPDATE seasons SET season_name='裁判选派调整本地验收' WHERE id=?",[fixture.seasonId]);
    await c.execute("UPDATE match_schedules SET match_time='15:00',match_end_time='17:00' WHERE id=?",[fixture.matches.A01]);
    await c.execute("UPDATE match_schedules SET match_time='16:00',match_end_time='18:00' WHERE id=?",[fixture.matches.A02]);
    await c.execute("UPDATE match_schedules SET match_time='17:00',match_end_time='18:00' WHERE id=?",[fixture.matches.A03]);
    Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', DB_NAME: database, UPLOAD_DIR: uploads, CORS_ORIGIN: '', TRUST_PROXY: 'false', JWT_SECRET: crypto.randomBytes(48).toString('base64url'), API_RATE_LIMIT_MAX: '5000', LOGIN_RATE_LIMIT_MAX: '200' });
    const app = require('../server'); pool = require('../db'); require('../utils/uploadPaths').ensureUploadDirectories();
    const site = require('../utils/previewSite')(app, path.join(root, 'frontend/dist'));
    server = await new Promise((resolve, reject) => { const s = site.listen(5238, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
    const base = 'http://127.0.0.1:5238';
    async function api(url,body,token,revision){
      const headers={'Content-Type':'application/json'};
      if(token)headers.Authorization='Bearer '+token;
      if(revision!==undefined)headers['If-Match']=String(revision);
      const r=await fetch(base+'/api'+url,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
      const result=await r.json();if(!r.ok)throw Error(result.message);return result.data;
    }
    const main=(await api('/referee/login',{student_id:fixture.refs[0].student_id,password:fixture.password})).token;
    const supervisor=(await api('/referee/login',{student_id:fixture.refs[4].student_id,password:fixture.password})).token;
    const reportUrl='/report/schedule/'+fixture.matches.A01;
    await api(reportUrl+'/main',{home_score:0,away_score:0,stats:[{role:'main',running_distance_m:5000},{role:'assistant1',running_distance_m:4000}]},main,0);
    await api(reportUrl+'/main/submit',{},main,1);
    await api(reportUrl+'/supervisor',{reviews:['main','assistant1','assistant2','fourth'].map(target_role=>({target_role,score:8,advice:'本地验收评分'}))},supervisor,0);
    await api(reportUrl+'/supervisor/submit',{},supervisor,1);
    fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cache/assignment-changes-preview.seed'), JSON.stringify({ url: base, admin: { username: 'assignment-admin', password }, fixture }, null, 2));
    fs.writeFileSync(path.join(root, '.cache/assignment-changes-local-acceptance.txt'), `入口：${base}/admin-login\n账号：assignment-admin\n密码：${password}\n\n全部为随机隔离测试库中的虚构数据。\n进入裁判选派，选择全部赛程，查看“裁判选派调整本地验收”。\nA01：裁判员及监督报告均已提交，仍可换人、清空或补选、取消岗位、切换五人制。\nA01（15:00-17:00）与 A02（16:00-18:00）重合；已有李助理的提示，选择周外部裁判还会显示另一条。直接保存即可。\nA03（17:00-18:00）与 A01 首尾相接，不提醒。\n从赛程详情打开报告，查看受影响分区自动退回，以及操作历史中的旧数据。\n停止并清理：在 .cache 中创建 assignment-changes-preview.stop 文件。\n`);
    console.log(`选派调整本地验收就绪：${base}；账号见 .cache/assignment-changes-local-acceptance.txt`);
    const stop = path.join(root, '.cache/assignment-changes-preview.stop'); if (fs.existsSync(stop)) fs.unlinkSync(stop);
    await new Promise(resolve => {
      const done = () => { clearInterval(timer); resolve(); };
      const timer = setInterval(() => { if (fs.existsSync(stop)) { fs.unlinkSync(stop); done(); } }, 1000);
      process.once('SIGINT', done); process.once('SIGTERM', done);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (pool) await pool.end();
    if (owned) await c.query(`DROP DATABASE \`${database}\``);
    await c.end();
    if (path.dirname(uploads) === os.tmpdir() && path.basename(uploads).startsWith('refweb-assignment-changes-')) fs.rmSync(uploads, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('本地验收启动失败：', error.message); process.exitCode = 1; });
