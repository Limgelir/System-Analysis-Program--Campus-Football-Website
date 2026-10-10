const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { finished } = require('stream/promises');
const pool = require('../db');
const { BACKEND_ROOT, UPLOAD_ROOT } = require('../utils/uploadPaths');
const { getMigrationStatus } = require('../utils/migrationRunner');
const { overlaps, inventory, verifyBackup } = require('../utils/backupIntegrity');

process.umask(0o077);

function resolveBackupRoot() {
  const configured = String(process.env.BACKUP_DIR || '').trim();
  const root = configured
    ? path.resolve(BACKEND_ROOT, configured)
    : path.join(BACKEND_ROOT, 'backups');
  if (root === path.parse(root).root || root === BACKEND_ROOT || overlaps(root, UPLOAD_ROOT)) {
    throw new Error('BACKUP_DIR 不能是磁盘根目录或 backend 根目录');
  }
  return root;
}

function assertChildPath(parent, child) {
  const relative = path.relative(parent, child);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`备份目标不在 BACKUP_DIR 内: ${child}`);
  }
}

async function runMysqlDump(targetFile) {
  const command = process.env.MYSQLDUMP_PATH || 'mysqldump';
  const args = [
    `--host=${process.env.DB_HOST}`,
    `--port=${process.env.DB_PORT || 3306}`,
    `--user=${process.env.DB_USER}`,
    '--single-transaction',
    '--quick',
    // 不导出 InnoDB 表空间定义，避免备份账号必须获得全局 PROCESS 权限。
    '--no-tablespaces',
    '--triggers',
    '--set-gtid-purged=OFF',
    '--default-character-set=utf8mb4',
    process.env.DB_NAME
  ];
  const output = fs.createWriteStream(targetFile, { flags: 'wx', mode: 0o600 });
  const child = spawn(command, args, {
    shell: false,
    windowsHide: true,
    env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD }
  });
  let stderr = '';

  child.stdout.pipe(output);
  child.stderr.on('data', chunk => {
    if (stderr.length < 8000) stderr += chunk.toString();
  });

  const processFinished = new Promise((resolve, reject) => {
    child.once('error', error => reject(new Error(`无法启动 mysqldump: ${error.message}`)));
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`mysqldump 执行失败（退出码 ${code}）；检查数据库连接、权限及磁盘空间`));
    });
  });

  try { await Promise.all([processFinished, finished(output)]); }
  catch (error) {
    child.kill(); output.destroy();
    await finished(output).catch(() => {});
    throw error;
  }
}

async function main() {
  if (!process.env.DB_PASSWORD) {
    throw new Error('DB_PASSWORD 未配置');
  }
  if (process.env.NODE_ENV === 'production') {
    if (process.env.BACKUP_CONSISTENCY !== 'service-stopped') throw new Error('生产备份必须通过停服备份脚本执行，保证数据库和文件一致');
    await new Promise((resolve, reject) => {
      const socket = require('node:net').createConnection({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3000) });
      socket.setTimeout(3000);
      socket.once('connect', () => { socket.destroy(); reject(new Error('后端端口仍在监听，拒绝不一致备份')); });
      socket.once('timeout', () => { socket.destroy(); reject(new Error('无法确认后端已停止')); });
      socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    });
  }

  const connection = await pool.getConnection();
  let migrationRows;
  let pendingMigrations;
  try {
    const migrationStatus = await getMigrationStatus(connection);
    if (migrationStatus.issues.length > 0) {
      throw new Error(`迁移记录异常，拒绝生成不可确认的备份：${migrationStatus.issues.join('；')}`);
    }
    migrationRows = migrationStatus.applied.map(row => ({
      version: String(row.version),
      name: row.name,
      applied_at: row.applied_at
    }));
    pendingMigrations = migrationStatus.pending.map(item => ({
      version: item.version,
      name: item.name
    }));
  } finally {
    connection.release();
  }

  // Backup runs as root in production. Creating application directories here would
  // leave them root-owned and prevent the refweb service from starting on a new host.
  const uploadStat = await fs.promises.lstat(UPLOAD_ROOT);
  if (!uploadStat.isDirectory() || uploadStat.isSymbolicLink()) throw new Error('上传源目录不存在或不是独立真实目录，拒绝备份');
  const backupRoot = resolveBackupRoot();
  await fs.promises.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(backupRoot, 0o700);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + require('node:crypto').randomBytes(4).toString('hex');
  const finalDir = path.join(backupRoot, `refweb-${timestamp}`);
  const tempDir = path.join(backupRoot, `.refweb-${timestamp}.tmp`);
  assertChildPath(backupRoot, finalDir);
  assertChildPath(backupRoot, tempDir);

  await fs.promises.mkdir(tempDir, { recursive: false, mode: 0o700 });
  try {
    const databaseFile = path.join(tempDir, 'database.sql');
    await runMysqlDump(databaseFile);
    const databaseStat = await fs.promises.stat(databaseFile);
    if (databaseStat.size === 0) {
      throw new Error('mysqldump 生成了空文件');
    }

    await fs.promises.cp(UPLOAD_ROOT, path.join(tempDir, 'uploads'), {
      recursive: true,
      force: false,
      errorOnExist: true
    });
    if (process.env.BACKUP_INCLUDE_DEPLOYMENT === 'true') {
      // 运维包装器以 root 执行；配置含密钥，整个备份仅 root 可读且异机传输必须加密。
      for (const [name, source] of [['referee', '/var/www/tj-refweb'], ['player', '/var/www/tj-player'], ['config', '/etc/tj-refweb']]) {
        await inventory(source); // 先拒绝符号链接，避免意外备份目录以外的内容。
        await fs.promises.cp(source, path.join(tempDir, 'deployment', name), { recursive: true, errorOnExist: true });
      }
    }
    let revision = null;
    try { revision = require('node:child_process').execFileSync('git', ['-c', `safe.directory=${path.resolve(BACKEND_ROOT, '..')}`, 'rev-parse', 'HEAD'], { cwd: BACKEND_ROOT, encoding: 'utf8', windowsHide: true }).trim(); } catch {}
    const files = await inventory(tempDir);
    await fs.promises.writeFile(
      path.join(tempDir, 'manifest.json'),
      `${JSON.stringify({
        format: 2,
        consistency: process.env.BACKUP_CONSISTENCY || 'online-unverified',
        revision,
        created_at: new Date().toISOString(),
        database: process.env.DB_NAME,
        database_dump_bytes: databaseStat.size,
        migrations: migrationRows,
        pending_migrations_at_backup: pendingMigrations,
        files
      }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );

    await verifyBackup(tempDir);
    await fs.promises.rename(tempDir, finalDir);
    console.log(`✓ 数据库与上传文件备份完成: ${finalDir}`);
    console.log('✓ 备份未自动删除旧版本，请按部署策略复制到另一台机器或对象存储');
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

main()
  .catch(error => {
    console.error(`✗ 备份失败: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
