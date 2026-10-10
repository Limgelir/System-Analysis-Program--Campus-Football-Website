const pool = require('../db');
const {
  getMigrationStatus,
  assertMigrationsCurrent,
  runPendingMigrations
} = require('../utils/migrationRunner');

const command = process.argv[2] || 'up';
const supportedCommands = new Set(['up', 'status', 'check']);

function printStatus(status) {
  const appliedVersions = new Set(status.applied.map(item => String(item.version)));
  const rows = status.migrations.map(migration => ({
    version: migration.version,
    name: migration.name,
    status: appliedVersions.has(migration.version) ? 'applied' : 'pending'
  }));
  console.table(rows);

  if (!status.tableExists) {
    console.log('schema_migrations 表尚未建立');
  }
  for (const issue of status.issues) {
    console.error(`✗ ${issue}`);
  }
}

async function main() {
  if (!supportedCommands.has(command)) {
    throw new Error(`未知命令 ${command}，可用命令: up, status, check`);
  }

  const connection = await pool.getConnection();
  try {
    if (command === 'up') {
      const result = await runPendingMigrations(connection);
      if (result.executed.length === 0) {
        console.log('✓ 数据库已经是最新版本，无需执行迁移');
      } else {
        for (const migration of result.executed) {
          console.log(`✓ 已执行 ${migration.version}_${migration.name}`);
        }
        console.log(`✓ 共执行 ${result.executed.length} 个迁移`);
      }
      return;
    }

    const status = await getMigrationStatus(connection);
    printStatus(status);

    if (command === 'check') {
      await assertMigrationsCurrent(connection);
      console.log('✓ 数据库迁移状态正常');
      return;
    }

    if (status.issues.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    connection.release();
  }
}

main()
  .catch(error => {
    console.error(`✗ 数据库迁移失败: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
