const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const mysql = require('mysql2/promise');
const { initialize } = require('../../scripts/initDatabase');
const { restore } = require('../../scripts/restoreBackup');
const { listBackups } = require('../../scripts/backupMaintenance');
const { verifyBackup, inventory } = require('../../utils/backupIntegrity');

module.exports = async ({ t, pool }) => {
  await t.test('阶段5/6：空库保护、实际 mysqldump 和隔离恢复保持全部业务表及上传文件', async () => {
    assert.equal(process.env.REFWEB_INTEGRATION_TEST, '1');
    const suffix = require('node:crypto').randomBytes(6).toString('hex');
    const initial = `tj_init_${suffix}_test`, target = `tj_restore_${suffix}_test`;
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tj-ops-restore-'));
    const env = { ...process.env, BACKUP_DIR: path.join(temp, 'backups'), BACKUP_CONSISTENCY: 'test-isolated', BACKUP_INCLUDE_DEPLOYMENT: 'false' };
    const audit = async auditEnv => {
      try { const result = await execFile(process.execPath, ['scripts/audit.js'], { cwd: path.resolve(__dirname, '../..'), env: auditEnv, windowsHide: true }); return { code: 0, stdout: result.stdout }; }
      catch (error) { if (error.code !== 1 || error.stderr || !error.stdout?.includes('missing_upload_count')) throw error; return { code: 1, stdout: error.stdout }; }
    };
    let initialOwned = false, targetOwned = false, connection;
    try {
      await pool.query(`CREATE DATABASE \`${initial}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); initialOwned = true;
      await initialize({ ...env, DB_NAME: initial, INIT_CONFIRM: `INIT_EMPTY_${initial}` });
      await fs.mkdir(path.join(temp, 'empty-uploads'));
      assert.equal((await audit({ ...env, DB_NAME: initial, UPLOAD_DIR: path.join(temp, 'empty-uploads') })).code, 0, '新空库必须通过零问题审计');
      await execFile(process.execPath, ['scripts/backup.js'], { cwd: path.resolve(__dirname, '../..'), env: { ...env, DB_NAME: initial, UPLOAD_DIR: path.join(temp, 'empty-uploads'), BACKUP_DIR: path.join(temp, 'empty-backups') }, windowsHide: true });
      assert.deepEqual(await fs.readdir(path.join(temp, 'empty-uploads')), [], '首次备份只能读取上传源，不能以root创建网站子目录');
      await assert.rejects(initialize({ ...env, DB_NAME: initial, INIT_CONFIRM: `INIT_EMPTY_${initial}` }), /非空/);
      await assert.rejects(initialize({ ...env, DB_NAME: initial, INIT_CONFIRM: 'wrong' }), /INIT_CONFIRM/);
      // API 测试已经串行结束，源为随机隔离测试库，接下来没有并行写请求。
      // 负面测试直接插入的最小夹具可能有审计异常；恢复必须原样保留，而不是擅自修数据。
      const sourceAudit = await audit(env);
      await execFile(process.execPath, ['scripts/backup.js'], { cwd: path.resolve(__dirname, '../..'), env, windowsHide: true });
      const backup = (await listBackups(env.BACKUP_DIR))[0];
      assert.ok(backup); await verifyBackup(backup.directory);
      await pool.query(`CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); targetOwned = true;
      const restoreEnv = { ...env, RESTORE_DB_NAME: target, RESTORE_UPLOAD_DIR: path.join(temp, 'restored-uploads'), RESTORE_CONFIRM: `RESTORE_${target}` };
      await assert.rejects(restore(backup.directory, { ...restoreEnv, RESTORE_DB_NAME: env.DB_NAME }), /不同/);
      await assert.rejects(restore(backup.directory, { ...restoreEnv, RESTORE_DB_NAME: initial, RESTORE_CONFIRM: `RESTORE_${initial}` }), /非空/);
      await restore(backup.directory, restoreEnv);
      await assert.rejects(restore(backup.directory, restoreEnv), /已经存在/);
      connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: target, dateStrings: ['DATE'] });
      const [tables] = await pool.query('SHOW TABLES');
      for (const row of tables) {
        const table = Object.values(row)[0];
        assert.match(table, /^[a-z0-9_]+$/);
        const [before] = await pool.query(`SELECT * FROM \`${table}\``), [after] = await connection.query(`SELECT * FROM \`${table}\``);
        assert.deepEqual(after.map(r => JSON.stringify(r)).sort(), before.map(r => JSON.stringify(r)).sort(), `${table} 必须逐行一致`);
      }
      assert.deepEqual(await inventory(restoreEnv.RESTORE_UPLOAD_DIR), await inventory(env.UPLOAD_DIR));
      assert.deepEqual(await audit({ ...env, DB_NAME: target, UPLOAD_DIR: restoreEnv.RESTORE_UPLOAD_DIR }), sourceAudit, '恢复后的全部审计结果必须与源库一致');
      await fs.appendFile(path.join(backup.directory, 'database.sql'), '\n-- corrupt');
      await assert.rejects(restore(backup.directory, restoreEnv), /校验失败/);
      console.log(`恢复演练：${tables.length} 张表全部行、完整上传文件及审计结果与源库一致；新空库零问题审计通过`);
    } finally {
      if (connection) await connection.end();
      if (initialOwned) await pool.query(`DROP DATABASE \`${initial}\``);
      if (targetOwned) await pool.query(`DROP DATABASE \`${target}\``);
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
};
