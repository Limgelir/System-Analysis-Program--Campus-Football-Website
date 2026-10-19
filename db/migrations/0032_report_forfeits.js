module.exports = {
  version: '0032', name: 'report_forfeits',
  description: '比赛报告记录主队、客队或双方弃权，判定比分与球员进球分开保存',
  rollback: '保留弃权报告和历史快照，使用前向修复；旧版不支持弃权比分，不可直接回退应用。',
  async up(c) {
    const [[column]] = await c.execute("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_reports' AND COLUMN_NAME='forfeit_side'");
    if (!column.n) await c.query("ALTER TABLE match_reports ADD COLUMN forfeit_side ENUM('none','home','away','both') NOT NULL DEFAULT 'none' COMMENT '弃权方；none表示正常比赛'");
  }
};
