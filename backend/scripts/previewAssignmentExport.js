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
  const database = `refweb_assignment_export_${crypto.randomBytes(6).toString('hex')}_test`;
  const c = await mysql.createConnection(options.connection);
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'refweb-assignment-export-'));
  let owned = false, server, pool;
  try {
    await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); owned = true;
    const schema = fs.readFileSync(path.join(root, 'db/final_schema.sql'), 'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i, `CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i, `USE \`${database}\`;`);
    await executeSqlScript(c, schema); await runPendingMigrations(c);
    const password = 'Local!' + crypto.randomBytes(12).toString('base64url');
    await c.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())', ['export-admin', await bcrypt.hash(password, 10)]);
    const fixture = await require('./seedAssignmentExport')(c, { active: true });
    Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', DB_NAME: database, UPLOAD_DIR: uploads, CORS_ORIGIN: '', TRUST_PROXY: 'false', JWT_SECRET: crypto.randomBytes(48).toString('base64url'), API_RATE_LIMIT_MAX: '5000', LOGIN_RATE_LIMIT_MAX: '200' });
    const app = require('../server'); pool = require('../db'); require('../utils/uploadPaths').ensureUploadDirectories();
    const site = require('../utils/previewSite')(app, path.join(root, 'frontend/dist'));
    server = await new Promise((resolve, reject) => { const s = site.listen(5236, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
    const base = 'http://127.0.0.1:5236';
    fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cache/assignment-export-preview.seed'), JSON.stringify({ url: base, admin: { username: 'export-admin', password }, fixture }, null, 2));
    fs.writeFileSync(path.join(root, '.cache/assignment-export-local-acceptance.txt'), `入口：${base}/admin-login\n账号：export-admin\n密码：${password}\n\n全部为隔离测试库中的虚构数据。\n进入裁判选派，选择全部赛程，查看“比赛日选派导出验收”。\n大联赛 ${fixture.date}：点击“导出本比赛日 CSV”，应有 A01～A04 四行。\nA01：当天已开球，裁判组完整；A02：部分已选派，含非系统裁判；A03：无需第四官员和监督；A04：五人制、时间待定。\n导出不包含次日 A05 或同日足协杯 B01。未来7天视图中的当天导出也应包含已开球和时间待定的全部四场。\n停止：在 .cache 中创建 assignment-export-preview.stop 文件。\n`);
    console.log(`比赛日选派导出本地验收就绪：${base}；账号见 .cache/assignment-export-local-acceptance.txt`);
    const stop = path.join(root, '.cache/assignment-export-preview.stop'); if (fs.existsSync(stop)) fs.unlinkSync(stop);
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
    if (path.dirname(uploads) === os.tmpdir() && path.basename(uploads).startsWith('refweb-assignment-export-')) fs.rmSync(uploads, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('本地验收启动失败：', error.message); process.exitCode = 1; });
