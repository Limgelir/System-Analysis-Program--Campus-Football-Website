const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');
const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.js$/;
const MIGRATION_TABLE = 'schema_migrations';
const LOCK_TIMEOUT_SECONDS = 10;

function checksum(content) {
  // Git 在 Windows 上可能把 LF 检出为 CRLF；统一换行后计算，避免跨平台误报篡改。
  const normalizedContent = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalizedContent).digest('hex');
}

function loadMigrations(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`迁移目录不存在: ${migrationsDir}`);
  }

  const migrations = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map(entry => {
      const match = entry.name.match(MIGRATION_FILE_PATTERN);
      const filePath = path.join(migrationsDir, entry.name);
      const source = fs.readFileSync(filePath, 'utf8');

      delete require.cache[require.resolve(filePath)];
      const definition = require(filePath);
      const [, version, name] = match;

      if (!definition || typeof definition.up !== 'function') {
        throw new Error(`迁移 ${entry.name} 必须导出 up(connection) 函数`);
      }
      if (definition.version !== version || definition.name !== name) {
        throw new Error(`迁移 ${entry.name} 导出的 version/name 必须与文件名一致`);
      }
      if (typeof definition.description !== 'string' || !definition.description.trim()) {
        throw new Error(`迁移 ${entry.name} 必须提供 description`);
      }
      if (typeof definition.rollback !== 'string' || !definition.rollback.trim()) {
        throw new Error(`迁移 ${entry.name} 必须提供 rollback 说明`);
      }

      return {
        ...definition,
        version,
        name,
        fileName: entry.name,
        filePath,
        checksum: checksum(source)
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));

  validateMigrationSequence(migrations);
  return migrations;
}

function validateMigrationSequence(migrations) {
  if (migrations.length === 0) {
    throw new Error('迁移目录中没有迁移文件');
  }

  migrations.forEach((migration, index) => {
    const expectedVersion = String(index + 1).padStart(4, '0');
    if (migration.version !== expectedVersion) {
      throw new Error(
        `迁移版本必须从 0001 连续递增：期望 ${expectedVersion}，实际 ${migration.version}`
      );
    }
  });
}

function compareMigrations(migrations, appliedRows) {
  const localByVersion = new Map(migrations.map(migration => [migration.version, migration]));
  const appliedByVersion = new Map(appliedRows.map(row => [String(row.version), row]));
  const issues = [];

  for (const row of appliedRows) {
    const version = String(row.version);
    const local = localByVersion.get(version);
    if (!local) {
      issues.push(`数据库已记录迁移 ${version}，但本地文件不存在`);
      continue;
    }
    if (row.name !== local.name) {
      issues.push(`迁移 ${version} 名称已变化（数据库: ${row.name}，本地: ${local.name}）`);
    }
    if (row.checksum !== local.checksum) {
      issues.push(`迁移 ${version}_${local.name} 在执行后被修改`);
    }
  }

  const pending = migrations.filter(migration => !appliedByVersion.has(migration.version));
  const firstPendingIndex = migrations.findIndex(migration => !appliedByVersion.has(migration.version));
  if (firstPendingIndex >= 0) {
    for (const migration of migrations.slice(firstPendingIndex + 1)) {
      if (appliedByVersion.has(migration.version)) {
        issues.push(`迁移 ${migration.version} 已执行，但更早的迁移仍未执行`);
      }
    }
  }

  return { pending, issues };
}

async function migrationTableExists(connection) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS tableCount
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [MIGRATION_TABLE]
  );
  return Number(rows[0].tableCount) === 1;
}

async function readAppliedMigrations(connection) {
  if (!(await migrationTableExists(connection))) {
    return { tableExists: false, rows: [] };
  }

  const [rows] = await connection.query(
    `SELECT version, name, checksum, applied_at
       FROM schema_migrations
      ORDER BY version ASC`
  );
  return { tableExists: true, rows };
}

async function ensureMigrationTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(20) NOT NULL COMMENT '迁移版本',
      name VARCHAR(255) NOT NULL COMMENT '迁移名称',
      checksum CHAR(64) NOT NULL COMMENT '迁移文件 SHA-256',
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '执行时间',
      PRIMARY KEY (version)
    ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
      COMMENT='数据库迁移记录'
  `);
}

function rowsToMap(rows, keyName, valueName) {
  const result = new Map();
  for (const row of rows) {
    const key = row[keyName];
    const value = row[valueName];
    if (!result.has(key)) result.set(key, new Set());
    result.get(key).add(value);
  }
  return result;
}

async function validateBaselineRequirements(connection, requirements) {
  if (!requirements || !requirements.tables) {
    throw new Error('基线迁移缺少 requirements.tables 定义');
  }

  const [columnRows] = await connection.query(`
    SELECT table_name AS tableName, column_name AS columnName
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
  `);
  const [indexRows] = await connection.query(`
    SELECT table_name AS tableName, index_name AS indexName
      FROM information_schema.statistics
     WHERE table_schema = DATABASE()
     GROUP BY table_name, index_name
  `);
  const [triggerRows] = await connection.query(`
    SELECT trigger_name AS triggerName
      FROM information_schema.triggers
     WHERE trigger_schema = DATABASE()
  `);

  const columns = rowsToMap(columnRows, 'tableName', 'columnName');
  const indexes = rowsToMap(indexRows, 'tableName', 'indexName');
  const triggers = new Set(triggerRows.map(row => row.triggerName));
  const missing = [];

  for (const [tableName, tableRequirement] of Object.entries(requirements.tables)) {
    if (!columns.has(tableName)) {
      missing.push(`缺少表 ${tableName}`);
      continue;
    }
    for (const columnName of tableRequirement.columns || []) {
      if (!columns.get(tableName).has(columnName)) {
        missing.push(`缺少字段 ${tableName}.${columnName}`);
      }
    }
    for (const indexName of tableRequirement.indexes || []) {
      if (!indexes.get(tableName)?.has(indexName)) {
        missing.push(`缺少索引 ${tableName}.${indexName}`);
      }
    }
  }

  for (const triggerName of requirements.triggers || []) {
    if (!triggers.has(triggerName)) {
      missing.push(`缺少触发器 ${triggerName}`);
    }
  }

  if (missing.length > 0) {
    const details = missing.slice(0, 20).join('；');
    const suffix = missing.length > 20 ? `；另有 ${missing.length - 20} 项` : '';
    throw new Error(
      `当前数据库不符合 0001 基线，未写入任何迁移记录：${details}${suffix}。` +
      '请先备份数据库并确认应补充迁移，空数据库请先导入 db/final_schema.sql。'
    );
  }
}

async function getMigrationStatus(connection, options = {}) {
  const migrations = loadMigrations(options.migrationsDir);
  const applied = await readAppliedMigrations(connection);
  const comparison = compareMigrations(migrations, applied.rows);
  return {
    migrations,
    tableExists: applied.tableExists,
    applied: applied.rows,
    pending: comparison.pending,
    issues: comparison.issues
  };
}

function formatMigrationProblems(status) {
  const messages = [...status.issues];
  if (!status.tableExists) {
    messages.push('数据库尚未建立 schema_migrations 记录表');
  }
  if (status.pending.length > 0) {
    messages.push(
      `存在 ${status.pending.length} 个待执行迁移：` +
      status.pending.map(item => `${item.version}_${item.name}`).join(', ')
    );
  }
  return messages;
}

async function assertMigrationsCurrent(connection, options = {}) {
  const status = await getMigrationStatus(connection, options);
  const problems = formatMigrationProblems(status);
  if (problems.length > 0) {
    throw new Error(`${problems.join('；')}。请在 backend 目录运行 npm run migrate。`);
  }
  return status;
}

async function acquireMigrationLock(connection) {
  const [rows] = await connection.execute(
    'SELECT GET_LOCK(CONCAT(DATABASE(), ?), ?) AS acquired',
    [':schema_migrations', LOCK_TIMEOUT_SECONDS]
  );
  if (Number(rows[0].acquired) !== 1) {
    throw new Error('无法取得数据库迁移锁，可能有另一个迁移进程正在运行');
  }
}

async function releaseMigrationLock(connection) {
  try {
    await connection.execute('SELECT RELEASE_LOCK(CONCAT(DATABASE(), ?))', [':schema_migrations']);
  } catch (error) {
    console.error('释放数据库迁移锁失败:', error.message);
  }
}

async function runPendingMigrations(connection, options = {}) {
  await acquireMigrationLock(connection);
  try {
    await ensureMigrationTable(connection);
    const status = await getMigrationStatus(connection, options);
    if (status.issues.length > 0) {
      throw new Error(status.issues.join('；'));
    }

    const executed = [];
    for (const migration of status.pending) {
      if (migration.baseline) {
        await validateBaselineRequirements(connection, migration.requirements);
      }

      await migration.up(connection);
      await connection.execute(
        `INSERT INTO schema_migrations (version, name, checksum)
         VALUES (?, ?, ?)`,
        [migration.version, migration.name, migration.checksum]
      );
      executed.push(migration);
    }

    return { ...status, executed };
  } finally {
    await releaseMigrationLock(connection);
  }
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  MIGRATION_FILE_PATTERN,
  checksum,
  loadMigrations,
  validateMigrationSequence,
  compareMigrations,
  migrationTableExists,
  readAppliedMigrations,
  ensureMigrationTable,
  validateBaselineRequirements,
  getMigrationStatus,
  formatMigrationProblems,
  assertMigrationsCurrent,
  runPendingMigrations
};
