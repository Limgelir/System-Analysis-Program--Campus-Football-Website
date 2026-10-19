// Local acceptance only: random isolated database, loopback server and synthetic data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { loadTestConnectionEnvironment, executeSqlScript } = require('./runApiIntegrationTests');
const { runPendingMigrations } = require('../utils/migrationRunner');
const root = path.resolve(__dirname, '../..'), cache = path.join(root, '.cache');
const timeMode = process.argv.includes('--match-time');
const port = timeMode ? 5230 : 5226;
const stem = timeMode ? 'schedule-time' : 'schedule-import';
async function main() {
  const options = loadTestConnectionEnvironment();
  if (!fs.existsSync(path.join(root, 'frontend/dist/index.html'))) throw Error('请先构建管理端前端');
  fs.mkdirSync(cache, { recursive: true });
  const database = `refweb_import_preview_${crypto.randomBytes(6).toString('hex')}_test`;
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'refweb-import-preview-'));
  const c = await mysql.createConnection(options.connection);
  let owned = false, server, pool;
  try {
    await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); owned = true;
    const schema = fs.readFileSync(path.join(root, 'db/final_schema.sql'), 'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i, `CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i, `USE \`${database}\`;`);
    await executeSqlScript(c, schema); await runPendingMigrations(c);
    const password = 'Local!' + crypto.randomBytes(12).toString('base64url');
    await c.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())', ['schedule-admin', await bcrypt.hash(password, 10)]);
    Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', DB_NAME: database, UPLOAD_DIR: uploads, CORS_ORIGIN: '', TRUST_PROXY: 'false', JWT_SECRET: crypto.randomBytes(48).toString('base64url'), API_RATE_LIMIT_MAX: '5000', LOGIN_RATE_LIMIT_MAX: '200' });
    const app = require('../server'); pool = require('../db'); require('../utils/uploadPaths').ensureUploadDirectories();
    const site = require('../utils/previewSite')(app, path.join(root, 'frontend/dist'));
    server = await new Promise((resolve, reject) => { const s = site.listen(port, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'schedule-admin', password }) });
    const token = (await login.json()).data.token;
    const response = await fetch(base + '/api/season', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ season_code: 'LOCAL-BULK', season_name: '赛程批量导入本地验收', start_date: '2026-01-01', end_date: '2099-12-31', is_active: true }) });
    if (!response.ok) throw Error('创建本地验收赛季失败');
    const season = (await response.json()).data;
    for (const league of ['校内邀请赛', '五人制邀请赛']) {
      await c.execute('INSERT INTO season_competitions(season_id,league_type) VALUES (?,?)', [season.id, league]);
      for (const teamName of ['土木学院', '机械学院', '建筑学院']) {
        const team = (await c.execute('INSERT INTO team(season_id,team_name,league_type) VALUES (?,?,?)', [season.id, teamName, league]))[0].insertId;
        const batch = (await c.execute('INSERT INTO team_roster_batches(team_id,season_id,version_no) VALUES (?,?,1)', [team, season.id]))[0].insertId;
        for (let i = 1; i <= 3; i++) await c.execute('INSERT INTO team_player(roster_batch_id,team_id,jersey_number,player_name,is_captain,is_goalkeeper,remark) VALUES (?,?,?,?,?,?,?)', [batch, team, String(i), '验收球员' + i, Number(i === 1), Number(i === 2), '本地虚构名单']);
      }
    }
    const headers = require('../utils/scheduleImportParser').HEADERS;
    const day = new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10);
    const samples = {
      '精确队名': [['A1', day, '17:35', '土木学院', '机械学院', '樱花人草', ''], ['A2', day, '19:00', '建筑学院', '机械学院', '其它', '西区球场']],
      '相似队名': [['B1', day, '17:35', '土木学院队', '机械学院', '嘉定人草', '']],
      '错误行': [['C1', '2026-02-30', '25:00', '土木学院', '机械学院', '其它', '']]
    };
    let referee = null;
    if (timeMode) {
      const api = async (url, body, auth = token, method = 'POST') => {
        const r=await fetch(base+'/api'+url,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(body)});
        const data=await r.json();if(!r.ok)throw Error(data.message||'验收数据创建失败');return data.data;
      };
      const studentId='schedule-referee';
      await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,is_active,must_change_password,token_version) VALUES (?,'验收裁判',?,'一级','预备国家级','2025-01-01','足协杯',1,0,0)",[studentId,await bcrypt.hash(password,10)]);
      const ref=await api('/referee/login',{student_id:studentId,password});
      const registration=await api('/season-registration/current/submit',{name:'验收裁判',height_cm:175,weight_kg:65,college:'土木工程学院',grade:'一级',match_types:['足协杯']},ref.token);
      await api('/season-registration/admin/'+registration.id+'/approve',{reason:'本地比赛时间验收'});
      const [teams]=await c.execute("SELECT id FROM team WHERE season_id=? AND league_type='校内邀请赛' ORDER BY id",[season.id]);
      const match=await api('/schedule',{match_type:'校内邀请赛',team_a_id:teams[0].id,team_b_id:teams[1].id,match_date:day,match_time:'15:00-16:00',field_order:'R1',venue:'樱花人草',supervisor_required:false});
      await api('/match-signups/'+match.id,{action:'save',intentions:['main'],revision:0,schedule_revision:match.schedule_revision},ref.token,'PUT');
      await api('/schedule/'+match.id+'/assign-referees',{main_referee_id:ref.id,schedule_revision:match.schedule_revision},token,'PUT');
      referee={student_id:studentId,password};
      samples['替换与新增']=[['R1',day,'16:00-17:00','土木学院','建筑学院','嘉定人草',''],['R2',day,'18:00','建筑学院','机械学院','樱花人草','']];
      samples['错误行']=[['R3',day,'23:00-01:00','土木学院','机械学院','樱花人草','']];
    }
    const prefix=timeMode?'比赛时间验收':'赛程验收';
    for (const [name, rows] of Object.entries(samples)) fs.writeFileSync(path.join(cache, `${prefix}-${name}.csv`), '\uFEFF' + [headers, ...rows].map(row => row.map(v => '"' + v.replaceAll('"', '""') + '"').join(',')).join('\r\n'));
    fs.writeFileSync(path.join(cache, `${stem}-preview.seed`), JSON.stringify({ database, url: base, admin: { username: 'schedule-admin', password }, referee }, null, 2), { mode: 0o600 });
    const instructions=timeMode?`裁判入口：${base}/referee-login\n裁判学号：${referee.student_id}\n裁判密码与上方管理员相同。\n\n1. 赛程管理已有R1（15:00-16:00），验收裁判已经报名并被选派。\n2. 单场新增同赛事R1，填16:00-17:00，先取消弹窗，再确认替换。\n3. 批量导入“比赛时间验收-替换与新增.csv”，核对R1替换、R2新增；先取消，再确认。\n4. 裁判端进入选派报名，选择校内邀请赛，查看完整比赛时间、已报名、已选派及时间变更提示。\n5. 编辑R1为单时间16:00，核对结束时间被移除；上传错误行验证跨午夜被拒绝。`:`展开“批量导入赛程”，选择校内邀请赛，上传“赛程验收-精确队名.csv”并确认。相似队名样例需确认映射，错误行样例禁止提交。`;
    fs.writeFileSync(path.join(cache, `${stem}-local-acceptance.md`), `# 本地验收\n\n入口：${base}/admin-login\n\n账号：schedule-admin\n\n密码：${password}\n\n仅连接随机隔离测试库，全部球队和球员均为虚构。\n\n${instructions}\n\n空白Excel模板：D:/RefWeb/赛程导入模板.xlsx，网页也可下载。\n\n停止：在 .cache 下创建 ${stem}-preview.stop 文件；程序会关闭服务并删除本次隔离库。\n`, { mode: 0o600 });
    console.log(`本地验收已就绪：${base}；账号见 .cache/${stem}-local-acceptance.md`);
    const stop = path.join(cache, `${stem}-preview.stop`); if (fs.existsSync(stop)) fs.unlinkSync(stop);
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
    if (path.dirname(uploads) === os.tmpdir() && path.basename(uploads).startsWith('refweb-import-preview-')) fs.rmSync(uploads, { recursive: true, force: true });
  }
}
main().catch(e => { console.error('本地验收启动失败：', e.message); process.exitCode = 1; });
