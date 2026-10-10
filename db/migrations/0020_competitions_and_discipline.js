const tables = [
  `CREATE TABLE IF NOT EXISTS competition_discipline_events (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    competition_id INT NOT NULL,
    operation ENUM('report','reset','adjust') NOT NULL,
    report_id INT DEFAULT NULL,
    source_history_id BIGINT UNSIGNED DEFAULT NULL,
    actor_admin_id INT DEFAULT NULL,
    reason VARCHAR(500) DEFAULT NULL,
    payload JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_discipline_report (report_id),
    KEY idx_discipline_competition (competition_id,id),
    FOREIGN KEY (competition_id) REFERENCES season_competitions(id) ON DELETE RESTRICT,
    FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE RESTRICT,
    FOREIGN KEY (source_history_id) REFERENCES report_section_history(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
module.exports = {
  version: '0020', name: 'competitions_and_discipline',
  description: '按赛季手动添加赛事、文本场序、红黄牌规则及停赛执行记录；保留账号与原业务记录',
  rollback: '先备份数据库和上传目录。优先前向修复；新增字符串场序或赛事后不可只回退代码。恢复必须使用匹配版本的配套备份，不删除纪律历史或迁移记录。',
  async up(c) {
    for (const [table, column] of [['team','league_type'],['match_schedules','match_type'],['season_competitions','league_type']]) {
      await c.query(`ALTER TABLE ${table} MODIFY ${column} VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL`);
    }
    const [[check]] = await c.query("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND CONSTRAINT_NAME='chk_schedule_field_order'");
    if (check.n) await c.query('ALTER TABLE match_schedules DROP CHECK chk_schedule_field_order');
    await c.query('ALTER TABLE match_schedules MODIFY field_order VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL');
    let needsSortBackfill=false;
    for (const [table,column,type] of [
      ['match_schedules','field_order_sort',"VARCHAR(800) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT ''"],
      ...['yellow_threshold','yellow_suspension','red_threshold','red_suspension'].map(name=>['season_competitions',name,'INT UNSIGNED DEFAULT NULL']),
      ['season_competitions','discipline_revision','INT UNSIGNED NOT NULL DEFAULT 0']
    ]) {
      const [[row]] = await c.query('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
      if (!row.n) { await c.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); if(column==='field_order_sort') needsSortBackfill=true; }
    }
    await c.query("ALTER TABLE match_cards MODIFY card_type ENUM('yellow','red','second_yellow_red') NOT NULL");
    // Existing local/demo data can remain readable. Empty seasons receive no automatic competitions.
    await c.query('INSERT IGNORE INTO season_competitions(season_id,league_type) SELECT season_id,league_type FROM team UNION SELECT season_id,match_type FROM match_schedules');
    const rows = needsSortBackfill ? (await c.query('SELECT id,field_order FROM match_schedules'))[0] : [];
    for (const row of rows) await c.execute('UPDATE match_schedules SET field_order_sort=? WHERE id=?',[String(row.field_order).replace(/\d+/g,part=>{const digits=part.replace(/^0+(?=\d)/,'');return '#'+String(digits.length).padStart(2,'0')+':'+digits;}),row.id]);
    for (const sql of tables) await c.query(sql);
  }, tables
};
