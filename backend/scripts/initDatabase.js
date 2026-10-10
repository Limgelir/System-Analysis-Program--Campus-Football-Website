// 只初始化已经创建、确认无表的目标数据库；永不自动 DROP DATABASE。
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { executeSqlScript } = require('./runApiIntegrationTests');
const { runPendingMigrations, assertMigrationsCurrent } = require('../utils/migrationRunner');
const { maintenanceConnection } = require('../utils/maintenanceConnection');

async function initialize(env = process.env) {
  const name = env.DB_NAME;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name || '') || env.INIT_CONFIRM !== `INIT_EMPTY_${name}`) throw new Error('需要 INIT_CONFIRM=INIT_EMPTY_目标库名');
  const connection = await mysql.createConnection({ ...maintenanceConnection(env, 'INIT'), database: name });
  try {
    const [[{ count }]] = await connection.execute('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=?', [name]);
    const [[{ routines }]] = await connection.execute('SELECT COUNT(*) AS routines FROM information_schema.routines WHERE routine_schema=?', [name]);
    if (Number(count) || Number(routines)) throw new Error('目标数据库非空，拒绝初始化；已有库只能运行 migrate');
    // 删除原 SQL 的固定 CREATE DATABASE/USE，仅在连接绑定的空库上初始化。
    let source = fs.readFileSync(path.resolve(__dirname, '../../db/final_schema.sql'), 'utf8')
      .replace(/CREATE DATABASE IF NOT EXISTS referee_system\s+DEFAULT CHARACTER SET utf8mb4\s+COLLATE utf8mb4_unicode_ci\s*;/i, '')
      .replace(/USE referee_system\s*;/i, '');
    if (/^\s*(?:USE\s+|CREATE\s+DATABASE\s+)/im.test(source)) throw new Error('初始化 SQL 包含未经处理的数据库切换');
    if (env.INIT_DB_SOCKET) {
      // Root creates the trigger, but it executes with the restricted application's privileges.
      if (!/^[a-zA-Z0-9_]+$/.test(env.DB_USER || '') || env.DB_USER === 'root' || env.DB_HOST !== '127.0.0.1') throw new Error('socket初始化需要127.0.0.1本库专用账号');
      source = source.replace(/CREATE TRIGGER /g, `CREATE DEFINER=${mysql.escape(env.DB_USER)}@'127.0.0.1' TRIGGER `);
    }
    await executeSqlScript(connection, source);
    await runPendingMigrations(connection);
    await assertMigrationsCurrent(connection);
    console.log('空库初始化与完整迁移完成');
  } finally { await connection.end(); }
}
if (require.main === module) {
  require('dotenv').config();
  initialize().catch(() => { console.error('初始化失败：检查确认值、空库状态、权限和迁移记录；不自动清库重试'); process.exitCode = 1; });
}
module.exports = { initialize };
