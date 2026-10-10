module.exports = {
  version: '0030', name: 'player_gender_and_team_tags',
  description: '球员性别、按赛事启用运训和足球特长生标签、单项及去重合并人数限制；保留旧账号性别为空待本人补填',
  rollback: '前向修复或恢复完整备份；不要删除账号、历史名单、审核记录或已执行迁移。',
  async up(c) {
    const columns = [
      ['player_accounts', 'gender', "ENUM('male','female') DEFAULT NULL"],
      ['season_competitions', 'enable_sports_training', 'TINYINT NOT NULL DEFAULT 1'],
      ['season_competitions', 'enable_football_specialty', 'TINYINT NOT NULL DEFAULT 0'],
      ['season_competitions', 'max_football_specialty_players', 'INT UNSIGNED DEFAULT NULL'],
      ['season_competitions', 'combined_player_limits', 'JSON DEFAULT NULL'],
      ['team_application_members', 'is_football_specialty', 'TINYINT NOT NULL DEFAULT 0'],
      ['team_player', 'is_football_specialty', 'TINYINT NOT NULL DEFAULT 0']
    ];
    for (const [table, name, type] of columns) {
      const [[row]] = await c.query('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, name]);
      if (!row.n) await c.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
};
