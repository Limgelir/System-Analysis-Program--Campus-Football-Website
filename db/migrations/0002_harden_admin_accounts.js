module.exports = {
  version: '0002',
  name: 'harden_admin_accounts',
  description: '为管理员增加首次改密状态、密码修改时间和令牌版本，并标记已有账号需要安全重置',
  rollback: '执行前备份 admin 表；回退时可删除 must_change_password、password_changed_at、token_version 三列，但会失去强制改密和令牌撤销能力。',
  async up(connection) {
    const [columns] = await connection.query(
      `SELECT column_name AS columnName
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'admin'`
    );
    const existing = new Set(columns.map(row => row.columnName));

    if (!existing.has('must_change_password')) {
      await connection.query(`
        ALTER TABLE admin
        ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 1
        COMMENT '是否必须在继续使用管理功能前修改密码'
        AFTER password_hash
      `);
    }
    if (!existing.has('password_changed_at')) {
      await connection.query(`
        ALTER TABLE admin
        ADD COLUMN password_changed_at DATETIME NULL
        COMMENT '最近一次安全设置密码的时间'
        AFTER must_change_password
      `);
    }
    if (!existing.has('token_version')) {
      await connection.query(`
        ALTER TABLE admin
        ADD COLUMN token_version INT NOT NULL DEFAULT 0
        COMMENT '递增后使旧 JWT 失效'
        AFTER password_changed_at
      `);
    }

    await connection.query(`
      UPDATE admin
         SET must_change_password = 1
       WHERE password_changed_at IS NULL
    `);
  }
};
