module.exports = {
  version: '0018',
  name: 'schedule_match_time',
  description: '赛程增加中国标准时间的分钟级开球时间，既有比赛保持时间待定',
  rollback: '旧行不回填时间。回退前备份数据库；优先前向修复，不能删除时间列或迁移记录来回退。',
  async up(connection) {
    const [[column]] = await connection.execute(
      "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND COLUMN_NAME='match_time'"
    );
    if (!column.n) await connection.query('ALTER TABLE match_schedules ADD COLUMN match_time TIME DEFAULT NULL AFTER match_date');
    const [[constraint]] = await connection.execute(
      "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND CONSTRAINT_NAME='chk_schedule_match_time'"
    );
    if (!constraint.n) await connection.query(`ALTER TABLE match_schedules ADD CONSTRAINT chk_schedule_match_time
      CHECK (match_time IS NULL OR (match_time >= '00:00:00' AND match_time < '24:00:00' AND SECOND(match_time)=0))`);
  }
};
