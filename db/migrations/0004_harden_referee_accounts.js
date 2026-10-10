module.exports = {
  version: '0004',
  name: 'harden_referee_accounts',
  description: '为裁判账号增加启停状态、首次改密状态、密码修改时间和 JWT 令牌版本',
  rollback: '执行前备份 referee 表；回退时可删除 idx_referee_is_active、chk_referee_is_active、chk_referee_must_change_password 及四个新增字段，但会失去账号停用和令牌撤销能力。',
  async up(connection) {
    const [columns] = await connection.query(`
      SELECT column_name AS columnName
        FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'referee'
    `);
    const existing = new Set(columns.map(row => row.columnName));

    if (!existing.has('must_change_password')) {
      await connection.query(`
        ALTER TABLE referee
        ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '是否必须在继续使用裁判功能前修改密码'
        AFTER password_hash
      `);
    }
    if (!existing.has('password_changed_at')) {
      await connection.query(`
        ALTER TABLE referee
        ADD COLUMN password_changed_at DATETIME NULL
        COMMENT '最近一次安全设置密码的时间'
        AFTER must_change_password
      `);
    }
    if (!existing.has('token_version')) {
      await connection.query(`
        ALTER TABLE referee
        ADD COLUMN token_version INT NOT NULL DEFAULT 0
        COMMENT '递增后使旧 JWT 失效'
        AFTER password_changed_at
      `);
    }
    if (!existing.has('is_active')) {
      await connection.query(`
        ALTER TABLE referee
        ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1
        COMMENT '账号是否允许登录和使用裁判功能'
        AFTER token_version
      `);
    }

    const [constraints] = await connection.query(`
      SELECT constraint_name AS constraintName
        FROM information_schema.table_constraints
       WHERE constraint_schema = DATABASE()
         AND table_name = 'referee'
         AND constraint_type = 'CHECK'
    `);
    const constraintNames = new Set(constraints.map(row => row.constraintName));
    if (!constraintNames.has('chk_referee_must_change_password')) {
      await connection.query(`
        ALTER TABLE referee
        ADD CONSTRAINT chk_referee_must_change_password CHECK (must_change_password IN (0, 1))
      `);
    }
    if (!constraintNames.has('chk_referee_is_active')) {
      await connection.query(`
        ALTER TABLE referee
        ADD CONSTRAINT chk_referee_is_active CHECK (is_active IN (0, 1))
      `);
    }

    const [indexes] = await connection.query(`
      SELECT index_name AS indexName
        FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = 'referee'
    `);
    if (!new Set(indexes.map(row => row.indexName)).has('idx_referee_is_active')) {
      await connection.query('ALTER TABLE referee ADD KEY idx_referee_is_active (is_active)');
    }
  }
};
