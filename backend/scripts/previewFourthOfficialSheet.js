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
  const database = `refweb_fourth_preview_${crypto.randomBytes(6).toString('hex')}_test`;
  const c = await mysql.createConnection(options.connection);
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'refweb-fourth-preview-'));
  let owned = false, server, pool;
  try {
    await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); owned = true;
    const schema = fs.readFileSync(path.join(root, 'db/final_schema.sql'), 'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i, `CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i, `USE \`${database}\`;`);
    await executeSqlScript(c, schema); await runPendingMigrations(c);
    const password = 'Local!' + crypto.randomBytes(12).toString('base64url');
    await c.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())', ['fourth-admin', await bcrypt.hash(password, 10)]);
    const fixture = await require('./seedFourthOfficialSheet')(c, { active: true });
    Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', DB_NAME: database, UPLOAD_DIR: uploads, CORS_ORIGIN: '', TRUST_PROXY: 'false', JWT_SECRET: crypto.randomBytes(48).toString('base64url'), API_RATE_LIMIT_MAX: '5000', LOGIN_RATE_LIMIT_MAX: '200' });
    const app = require('../server'); pool = require('../db'); require('../utils/uploadPaths').ensureUploadDirectories();
    const site = require('../utils/previewSite')(app, path.join(root, 'frontend/dist'));
    server = await new Promise((resolve, reject) => { const s = site.listen(5234, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
    const base = 'http://127.0.0.1:5234';
    fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cache/fourth-sheet-preview.seed'), JSON.stringify({ url: base, admin: { username: 'fourth-admin', password }, fixture }, null, 2));
    fs.writeFileSync(path.join(root, '.cache/fourth-sheet-local-acceptance.txt'), `入口：${base}/admin-login\n账号：fourth-admin\n密码：${password}\n\n全部为隔离测试库中的虚构数据。\n进入赛程管理，点击对应场次的“生成四官单”，选择版本并下载。\nA01：11人制，两页，两队各30人，左队2号、右队10号首发格标×，有监督，其它场地只显示具体名称。\nA02：11人制，无监督，普通场地，预计停赛已在前一场执行，无×。\nB01：8人制，一页，两队各17人，左队2号、右队10号首发格标×；红/白/红与蓝/白/蓝；日期时间、场序与具体场地。\nB02：8人制，无×，普通场地。\n停止：在 .cache 中创建 fourth-sheet-preview.stop 文件。\n`);
    fs.appendFileSync(path.join(root, '.cache/fourth-sheet-local-acceptance.txt'), '\n长姓名与标记检查：A01、B01 左队1号为“阿卜杜热合曼·买买提江(C)(GK)(F)(S)”；两队7号为英文长姓名；8号为中文长姓名。2号仅足球特长生也标S，6号同时具有运训和足球特长生只标一个S。姓名最多两行，字号按格子自动缩小。\n');
    console.log(`四官单本地验收就绪：${base}；账号见 .cache/fourth-sheet-local-acceptance.txt`);
    const stop = path.join(root, '.cache/fourth-sheet-preview.stop'); if (fs.existsSync(stop)) fs.unlinkSync(stop);
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
    if (path.dirname(uploads) === os.tmpdir() && path.basename(uploads).startsWith('refweb-fourth-preview-')) fs.rmSync(uploads, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('本地验收启动失败：', error.message); process.exitCode = 1; });
