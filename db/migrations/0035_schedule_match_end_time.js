module.exports = {
  version: '0035', name: 'schedule_match_end_time',
  description: '比赛时间支持可选的同日结束时间，开赛与报名仍使用开始时间',
  rollback: '使用前向修复；保留已有赛程、报名、选派及历史，不删除新增列。',
  async up(c) {
    const [[column]] = await c.execute("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND COLUMN_NAME='match_end_time'");
    if (!column.n) await c.query('ALTER TABLE match_schedules ADD COLUMN match_end_time TIME DEFAULT NULL AFTER match_time');
    const [[constraint]] = await c.execute("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND CONSTRAINT_NAME='chk_schedule_match_end_time'");
    if (!constraint.n) await c.query(`ALTER TABLE match_schedules ADD CONSTRAINT chk_schedule_match_end_time CHECK
      (match_end_time IS NULL OR (match_time IS NOT NULL AND match_end_time > match_time AND match_end_time < '24:00:00' AND SECOND(match_end_time)=0))`);
  }
};
