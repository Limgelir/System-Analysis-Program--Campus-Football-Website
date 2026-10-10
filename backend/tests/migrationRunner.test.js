const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checksum,
  loadMigrations,
  validateMigrationSequence,
  compareMigrations,
  formatMigrationProblems,
  migrationLockName,
  runPendingMigrations
} = require('../utils/migrationRunner');

test('迁移文件按连续版本加载并包含必要元数据', () => {
  const migrations = loadMigrations();

  assert.ok(migrations.length >= 1);
  assert.equal(migrations[0].version, '0001');
  assert.equal(migrations[0].name, 'current_schema_baseline');
  assert.equal(typeof migrations[0].up, 'function');
  assert.equal(migrations[0].checksum.length, 64);
});

test('迁移版本不连续时拒绝执行', () => {
  assert.throws(
    () => validateMigrationSequence([
      { version: '0001' },
      { version: '0003' }
    ]),
    /必须从 0001 连续递增/
  );
});

test('迁移比较可以识别待执行版本', () => {
  const migrations = [
    { version: '0001', name: 'baseline', checksum: 'a' },
    { version: '0002', name: 'next', checksum: 'b' }
  ];
  const result = compareMigrations(migrations, [
    { version: '0001', name: 'baseline', checksum: 'a' }
  ]);

  assert.deepEqual(result.pending.map(item => item.version), ['0002']);
  assert.deepEqual(result.issues, []);
});

test('迁移比较可以识别执行后被修改或被删除的文件', () => {
  const changed = compareMigrations(
    [{ version: '0001', name: 'baseline', checksum: 'new' }],
    [{ version: '0001', name: 'baseline', checksum: 'old' }]
  );
  assert.match(changed.issues[0], /执行后被修改/);

  const missing = compareMigrations([], [
    { version: '0001', name: 'baseline', checksum: 'old' }
  ]);
  assert.match(missing.issues[0], /本地文件不存在/);
});

test('迁移状态问题会包含记录表和待执行版本提示', () => {
  const problems = formatMigrationProblems({
    tableExists: false,
    issues: [],
    pending: [{ version: '0001', name: 'baseline' }]
  });

  assert.equal(problems.length, 2);
  assert.match(problems.join(' '), /schema_migrations/);
  assert.match(problems.join(' '), /0001_baseline/);
});

test('迁移校验和使用稳定的 SHA-256', () => {
  assert.equal(
    checksum('refweb'),
    '3c05c1c61f3489300c1eb747102e3b1224f63e6f3706150bb2c4bc670f500039'
  );
  assert.equal(checksum('line1\nline2\n'), checksum('line1\r\nline2\r\n'));
});

test('迁移锁保留已有短名称并接受恰好64字符的锁名', () => {
  assert.equal(migrationLockName('referee_system'), 'referee_system:schema_migrations');
  const databaseName = 'a'.repeat(64 - ':schema_migrations'.length);
  assert.equal(migrationLockName(databaseName), `${databaseName}:schema_migrations`);
});

test('长库名和随机测试库的迁移锁不超长且按完整库名隔离', () => {
  const ciDatabase = 'campus_football_course_ci_test_337875cf8912_test';
  assert.ok(`${ciDatabase}:schema_migrations`.length > 64);
  for (const databaseName of [ciDatabase, 'a'.repeat(64), 'a'.repeat(47), '学'.repeat(64)]) {
    const name = migrationLockName(databaseName);
    assert.match(name, /^[a-f0-9]{64}$/);
    assert.equal(migrationLockName(databaseName), name);
    assert.notEqual(migrationLockName(`${databaseName.slice(0, -1)}b`), name);
  }
});

test('没有选择数据库时拒绝创建迁移锁', () => {
  for (const name of [null, undefined, '']) {
    assert.throws(() => migrationLockName(name), /选择目标数据库/);
  }
});

test('迁移失败时仍释放原来取得的长名称锁', async () => {
  const calls = [];
  const databaseName = 'campus_football_course_ci_test_337875cf8912_test';
  const failure = new Error('simulated schema failure');
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT DATABASE()')) return [[{ databaseName }]];
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
      assert.fail(`Unexpected query: ${sql}`);
    },
    async query() { throw failure; }
  };
  await assert.rejects(runPendingMigrations(connection), error => error === failure);
  const acquire = calls.find(call => call.sql.startsWith('SELECT GET_LOCK'));
  const release = calls.find(call => call.sql.startsWith('SELECT RELEASE_LOCK'));
  assert.equal(acquire.params[0], migrationLockName(databaseName));
  assert.deepEqual(release.params, [acquire.params[0]]);
});

test('锁等待超时或失败时不执行迁移，也不释放其它进程的锁', async () => {
  for (const acquired of [0, null]) {
    const connection = {
      async execute(sql) {
        if (sql.startsWith('SELECT DATABASE()')) return [[{ databaseName: 'course' }]];
        if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired }]];
        assert.fail('没有取得锁时不应释放锁');
      },
      async query() { assert.fail('没有取得锁时不应修改数据库'); }
    };
    await assert.rejects(runPendingMigrations(connection), /无法取得数据库迁移锁/);
  }
});
