module.exports = {
  version: '0034', name: 'admin_team_management',
  description: '保存球队退回与撤销通过的完整恢复信息，支持管理员撤销误操作',
  rollback: '保留历史操作和恢复快照，使用前向修复；不得删除申请、名单或赛程。',
  async up(c) {
    const [[row]] = await c.execute("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='team_applications' AND COLUMN_NAME='admin_undo'");
    if (!row.n) await c.query('ALTER TABLE team_applications ADD COLUMN admin_undo JSON DEFAULT NULL');
  }
};
