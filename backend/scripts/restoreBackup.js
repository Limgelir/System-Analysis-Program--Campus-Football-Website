const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { createReadStream } = require('node:fs');
const mysql = require('mysql2/promise');
const { verifyBackup, overlaps } = require('../utils/backupIntegrity');
const { assertMigrationsCurrent } = require('../utils/migrationRunner');
const { maintenanceConnection } = require('../utils/maintenanceConnection');

async function restore(source, env = process.env) {
  const manifest = await verifyBackup(source);
  if (!['service-stopped', 'test-isolated'].includes(manifest.consistency)) throw new Error('该备份没有停写一致性保证，拒绝自动恢复');
  const database = env.RESTORE_DB_NAME, destination = env.RESTORE_UPLOAD_DIR;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(database || '') || database === env.DB_NAME || database === manifest.database) throw new Error('必须指定与源库、当前业务库不同的 RESTORE_DB_NAME');
  if (env.RESTORE_CONFIRM !== `RESTORE_${database}`) throw new Error('需要 RESTORE_CONFIRM=RESTORE_目标库名');
  if (!destination || !path.isAbsolute(destination) || !env.UPLOAD_DIR || !path.isAbsolute(env.UPLOAD_DIR) || overlaps(destination, env.UPLOAD_DIR) || overlaps(destination, source)) throw new Error('恢复上传目录必须为独立绝对路径');
  try { await fs.lstat(destination); throw new Error('恢复上传目录已经存在，拒绝覆盖'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const options = maintenanceConnection(env, 'RESTORE');
  const connection = await mysql.createConnection({ ...options, database });
  try {
    const [[row]] = await connection.execute('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=?', [database]);
    const [[routine]] = await connection.execute('SELECT COUNT(*) AS count FROM information_schema.routines WHERE routine_schema=?', [database]);
    if (Number(row.count) || Number(routine.count)) throw new Error('恢复数据库非空，拒绝覆盖');
    const login = options.socketPath ? [`--socket=${options.socketPath}`, '--user=root'] : [`--host=${env.DB_HOST}`, `--port=${env.DB_PORT || 3306}`, `--user=${env.DB_USER}`];
    const child = spawn(env.MYSQL_PATH || 'mysql', [...login, '--default-character-set=utf8mb4', '--binary-mode', database], {
      shell: false, windowsHide: true, env: { ...env, MYSQL_PWD: env.DB_PASSWORD }, stdio: ['pipe', 'ignore', 'pipe']
    });
    child.stderr.resume(); // mysql 错误可能包含 SQL 值，不能输出敏感材料。
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('mysql 恢复失败，目标隔离库可能只恢复一部分；保留现场排查'))); });
    await Promise.all([done, pipeline(createReadStream(path.join(source, 'database.sql')), child.stdin)]);
    await assertMigrationsCurrent(connection);
    await fs.mkdir(destination, { mode: 0o700 });
    // 根目录由本次 mkdir 独占创建；逐项复制，既保留空目录，也不覆盖已有文件。
    for (const name of await fs.readdir(path.join(source, 'uploads'))) {
      await fs.cp(path.join(source, 'uploads', name), path.join(destination, name), { recursive: true, force: false, errorOnExist: true });
    }
    console.log('隔离恢复完成；尚未切换生产配置，请先运行 audit 并核对业务与图片');
    return manifest;
  } finally { await connection.end(); }
}
if (require.main === module) {
  require('dotenv').config();
  if (process.argv.length !== 3) { console.error('用法: node scripts/restoreBackup.js 备份目录'); process.exitCode = 1; }
  else restore(path.resolve(process.argv[2])).catch(error => { console.error(`恢复失败: ${error.code || (error.message.includes('password') ? '检查配置' : error.message)}`); process.exitCode = 1; });
}
module.exports = { restore };
