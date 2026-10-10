module.exports = {
  version: '0008',
  name: 'shanghai_fa_registration',
  description: '新增独立的上海足协注册标记；经负责人确认，存量账号初始化为否',
  rollback: '迁移前备份。回退应用时可保留此兼容字段；不得直接删除已由用户维护的数据。',
  async up(connection) {
    const [columns] = await connection.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'referee' AND column_name = 'shanghai_fa_registered'`);
    if (!columns.length) {
      await connection.query(`ALTER TABLE referee ADD COLUMN shanghai_fa_registered
        TINYINT(1) NOT NULL DEFAULT 0 COMMENT '本人填报是否在上海足协注册，与本站赛季注册无关' AFTER target_level`);
    }
    const [checks] = await connection.query(`SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE() AND table_name = 'referee'
        AND constraint_name = 'chk_referee_shanghai_fa_registered' AND constraint_type = 'CHECK'`);
    if (!checks.length) {
      await connection.query(`ALTER TABLE referee ADD CONSTRAINT chk_referee_shanghai_fa_registered
        CHECK (shanghai_fa_registered IN (0, 1))`);
    }
    // 已有字段不再次 UPDATE，重复执行不能把用户后来填的“是”重置为“否”。
  }
};
