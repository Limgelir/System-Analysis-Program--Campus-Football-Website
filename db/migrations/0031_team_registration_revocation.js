module.exports = {
  version: '0031', name: 'team_registration_revocation',
  description: '在线球队报名支持管理员撤销通过，保留球队、名单、赛程及审核历史',
  rollback: '新增撤销状态后使用前向修复；不得删除球队、名单、赛程或审核历史来回退。',
  async up(c) {
    for (const [table, column, definition] of [
      ['team', 'registration_revoked', 'TINYINT NOT NULL DEFAULT 0'],
      ['team_applications', 'revoke_reason', 'VARCHAR(500) DEFAULT NULL'],
      ['team_roster_batches', 'application_revision', 'INT UNSIGNED NOT NULL DEFAULT 0']
    ]) {
      const [[row]] = await c.execute('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, column]);
      if (!row.n) await c.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    await c.query("ALTER TABLE team_applications MODIFY status ENUM('draft','pending','returned','withdrawn','approved','auto_failed','revoked') NOT NULL DEFAULT 'draft'");
    await c.query(`UPDATE team_roster_batches b SET application_revision=COALESCE(
      (SELECT MIN(e.revision) FROM team_application_events e WHERE e.application_id=b.application_id AND e.operation='approved'),0)
      WHERE b.application_id IS NOT NULL AND b.application_revision=0`);
    const [[index]] = await c.execute("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='team_roster_batches' AND INDEX_NAME='uq_batch_application_revision'");
    if (!index.n) await c.query('ALTER TABLE team_roster_batches ADD UNIQUE INDEX uq_batch_application_revision (application_id,application_revision)');
    const [[old]] = await c.execute("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='team_roster_batches' AND INDEX_NAME='uq_batch_application'");
    if (old.n) await c.query('ALTER TABLE team_roster_batches DROP INDEX uq_batch_application');
  }
};
