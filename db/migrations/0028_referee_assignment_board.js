module.exports = {
  version: '0028', name: 'referee_assignment_board',
  description: '可选第四官员与裁判员按赛事登记参队信息',
  rollback: '增量升级；旧比赛保留第四官员需求，出现问题通过备份恢复或前向修复。',
  async up(c) {
    const [[column]] = await c.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND COLUMN_NAME='fourth_required'");
    if (!column.n) await c.query('ALTER TABLE match_schedules ADD COLUMN fourth_required TINYINT(1) NOT NULL DEFAULT 1 CHECK (fourth_required IN (0,1))');
    await c.query(`CREATE TABLE IF NOT EXISTS referee_competition_memberships (
      referee_id INT NOT NULL, competition_id INT NOT NULL,
      team_ids JSON NOT NULL, revision INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (referee_id,competition_id),
      CONSTRAINT fk_ref_membership_referee FOREIGN KEY (referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
      CONSTRAINT fk_ref_membership_competition FOREIGN KEY (competition_id) REFERENCES season_competitions(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
};
