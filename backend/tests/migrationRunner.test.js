const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checksum,
  loadMigrations,
  validateMigrationSequence,
  compareMigrations,
  formatMigrationProblems
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
