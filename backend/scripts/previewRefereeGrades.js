// 本地验收专用：仅创建随机测试库，退出时仅清理本进程创建的资源。
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const mysql = require('mysql2/promise'), bcrypt = require('bcryptjs');
const { loadTestConnectionEnvironment, executeSqlScript } = require('./runApiIntegrationTests');
const { runPendingMigrations } = require('../utils/migrationRunner');
const { REFEREE_GRADES } = require('../utils/refereeProfileRules');
const root = path.resolve(__dirname, '../..'), cache = path.join(root, '.cache');
async function main() {
  const options = loadTestConnectionEnvironment();
  if (!fs.existsSync(path.join(root, 'frontend/dist/index.html'))) throw Error('请先构建 frontend');
  fs.mkdirSync(cache, { recursive: true });
  const database = `refweb_grade_preview_${crypto.randomBytes(6).toString('hex')}_test`;
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'refweb-grade-preview-'));
  const c = await mysql.createConnection(options.connection);
  let owned = false, server, pool;
  try {
    await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); owned = true;
    const schema = fs.readFileSync(path.join(root, 'db/final_schema.sql'), 'utf8')
      .replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i, `CREATE DATABASE IF NOT EXISTS \`${database}\``)
      .replace(/USE\s+referee_system\s*;/i, `USE \`${database}\`;`);
    await executeSqlScript(c, schema); await runPendingMigrations(c);
    Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', DB_NAME: database, UPLOAD_DIR: uploads,
      CORS_ORIGIN: '', TRUST_PROXY: 'false', JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
      API_RATE_LIMIT_MAX: '5000', LOGIN_RATE_LIMIT_MAX: '300', REGISTRATION_RATE_LIMIT_MAX: '300' });
    const password = 'Local!' + crypto.randomBytes(12).toString('base64url'), hash = await bcrypt.hash(password, 10);
    await c.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())', ['grade-admin', hash]);
    const app = require('../server'); pool = require('../db'); require('../utils/uploadPaths').ensureUploadDirectories();
    const site = require('../utils/previewSite')(app, path.join(root, 'frontend/dist'));
    server = await new Promise((resolve, reject) => { const s = site.listen(5216, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
    const base = 'http://127.0.0.1:5216';
    const api = async (url, body, token) => {
      const response = await fetch(base + '/api' + url, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) throw Error(url + ': ' + result.message);
      return result.data;
    };
    const admin = await api('/admin/login', { username: 'grade-admin', password });
    const season = await api('/season', { season_code: 'LOCAL-GRADES', season_name: '裁判学员与自行改级别验收', start_date: '2026-01-01', end_date: '2028-12-31', is_active: true }, admin.token);
    const referees = [];
    for (const [i, grade] of [...REFEREE_GRADES, '裁判学员'].entries()) {
      const student_id = 'LOCAL-GRADE-' + (i + 1), name = i === 6 ? '未注册学员' : '验收' + grade;
      const [r] = await c.execute(`INSERT INTO referee(student_id,name,grade,target_level,level_promoted_at,password_hash,match_types,must_change_password,is_active,password_changed_at)
        VALUES (?,?,?,?,?,?,'足协杯',0,1,NOW())`, [student_id, name, grade, grade === '裁判学员' ? '三级' : grade, grade === '裁判学员' ? null : '2025-01-01', hash]);
      await c.execute("INSERT INTO referee_profile(referee_id,gender,college,height_cm,weight_kg) VALUES (?,'男','土木工程学院',175,65)", [r.insertId]);
      const user = await api('/referee/login', { student_id, password });
      if (i < 6) {
        const registration = await api('/season-registration/current/submit', { name, grade, college: '土木工程学院', height_cm: 175, weight_kg: 65, match_types: ['足协杯'] }, user.token);
        if (i !== 2) await api('/season-registration/admin/' + registration.id + '/approve', { reason: '虚构验收样例' }, admin.token);
      }
      referees.push({ student_id, name, grade, password, status: i === 6 ? '未注册' : i === 2 ? '审核中' : '已通过' });
    }
    const file = path.join(cache, 'referee-grades-preview.seed');
    fs.writeFileSync(file, JSON.stringify({ warning: '仅限本机随机测试库；账号均为虚构，重新启动会生成新密码。',
      admin: { username: 'grade-admin', password, url: base + '/admin-login' }, referees, season, referee_url: base + '/referee-login', register_url: base + '/referee-register' }, null, 2), { mode: 0o600 });
    const stop = path.join(cache, 'referee-grades-preview.stop');
    if (fs.existsSync(stop)) fs.unlinkSync(stop);
    console.log(`本地级别验收已就绪：${base}；账号见 ${file}。按 Ctrl+C 或创建 .cache/referee-grades-preview.stop 结束。`);
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
    if (path.dirname(uploads) === os.tmpdir() && path.basename(uploads).startsWith('refweb-grade-preview-')) fs.rmSync(uploads, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('级别验收环境启动失败：' + error.message); process.exitCode = 1; });
