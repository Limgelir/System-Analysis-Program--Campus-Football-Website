// 固定本次迁移的字段定义，不引用业务常量；旧值及赛季历史保持不变。
const COLUMNS = [
  ['referee', 'grade', '当前级别'],
  ['referee', 'target_level', '目标级别'],
  ['referee_season_registrations', 'grade_snapshot', '当季当前级别快照']
];

module.exports = {
  version: '0024',
  name: 'referee_trainee_grade',
  description: '三级以下新增裁判学员；级别日期允许为空，由业务校验仅对学员开放；保留账号及赛季历史',
  rollback: '升级前备份。已有学员或空日期记录时不能直接缩小 ENUM 或恢复 NOT NULL；优先前向修复，必要时恢复整套备份。',
  async up(connection) {
    for (const [table, column, comment] of COLUMNS) {
      const [rows] = await connection.execute(
        `SELECT COLUMN_TYPE AS columnType FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column]
      );
      if (!rows.length) throw new Error(`缺少迁移前置字段：${table}.${column}`);
      if (!rows[0].columnType.includes("'裁判学员'")) {
        await connection.query(`ALTER TABLE ${table} MODIFY COLUMN ${column}
          ENUM('裁判学员', '三级', '二级', '一级', '预备国家级', '国家级') NOT NULL COMMENT '${comment}'`);
      }
    }
    const [[date]] = await connection.query(`SELECT IS_NULLABLE AS nullable FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'referee' AND column_name = 'level_promoted_at'`);
    if (!date) throw new Error('缺少迁移前置字段：referee.level_promoted_at');
    if (date.nullable !== 'YES') {
      await connection.query("ALTER TABLE referee MODIFY COLUMN level_promoted_at DATE NULL COMMENT '升入当前级别的时间，裁判学员可不填'");
    }
  }
};
