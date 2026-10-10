// 迁移必须自包含，不能引用将来可能变化的业务选项常量。
const COLUMNS = [
  ['referee', 'grade', '当前级别'],
  ['referee', 'target_level', '目标级别'],
  ['referee_season_registrations', 'grade_snapshot', '当季当前级别快照']
];

module.exports = {
  version: '0007',
  name: 'reserve_national_grade',
  description: '账号当前/目标级别及赛季资料快照新增预备国家级，保留所有原有值',
  rollback: '迁移前备份。已有预备国家级记录时不能直接缩小 ENUM；优先修复后前向迁移，必要时恢复整套备份。',
  async up(connection) {
    for (const [table, column, comment] of COLUMNS) {
      const [rows] = await connection.execute(
        `SELECT COLUMN_TYPE AS columnType FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, column]
      );
      if (!rows.length) throw new Error(`缺少迁移前置字段：${table}.${column}`);
      if (!rows[0].columnType.includes("'预备国家级'")) {
        await connection.query(`ALTER TABLE ${table} MODIFY COLUMN ${column}
          ENUM('三级', '二级', '一级', '预备国家级', '国家级') NOT NULL COMMENT '${comment}'`);
      }
    }
  }
};
