const fields = ['min_players','max_players','max_colleges','max_foreign_players','max_sports_training_players'];
module.exports = {
  version: '0023', name: 'team_automatic_review',
  description: '赛事可选报名限制、球队自动审核结果和失败状态；原赛事限制默认不限，保留正式球队及赛程',
  rollback: '先备份数据库。新增失败状态后应前向修复或使用匹配版本的完整备份，不删除申请、名单、比赛或旧迁移。',
  async up(c) {
    for (const [table,name,type] of [...fields.map(k=>['season_competitions',k,'INT UNSIGNED DEFAULT NULL']),['team_applications','auto_review','JSON DEFAULT NULL']]) {
      const [[row]] = await c.query('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,name]);
      if (!row.n) await c.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
    await c.query("ALTER TABLE team_applications MODIFY status ENUM('draft','pending','returned','withdrawn','approved','auto_failed') NOT NULL DEFAULT 'draft'");
    await c.query("ALTER TABLE team_applications MODIFY open_change_team_id INT GENERATED ALWAYS AS (CASE WHEN kind='roster_change' AND status IN ('draft','pending','returned','auto_failed') THEN team_id ELSE NULL END) STORED");
    const [[check]] = await c.query("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='season_competitions' AND CONSTRAINT_NAME='chk_team_registration_range'");
    if (!check.n) await c.query('ALTER TABLE season_competitions ADD CONSTRAINT chk_team_registration_range CHECK (min_players IS NULL OR max_players IS NULL OR min_players<=max_players)');
  }
};
