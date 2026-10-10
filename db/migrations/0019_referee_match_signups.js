const tables = [
  `CREATE TABLE IF NOT EXISTS referee_match_signups (
    id INT PRIMARY KEY AUTO_INCREMENT,
    schedule_id INT NOT NULL,
    referee_id INT NOT NULL,
    status ENUM('active','withdrawn') NOT NULL,
    intentions JSON NOT NULL,
    revision INT UNSIGNED NOT NULL,
    match_date_snapshot DATE NOT NULL,
    match_time_snapshot TIME NOT NULL,
    venue_snapshot VARCHAR(20) DEFAULT NULL,
    venue_detail_snapshot VARCHAR(120) DEFAULT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_match_signup (schedule_id,referee_id),
    KEY idx_referee_signup (referee_id,schedule_id),
    FOREIGN KEY (schedule_id) REFERENCES match_schedules(id) ON DELETE RESTRICT,
    FOREIGN KEY (referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
    CHECK (JSON_TYPE(intentions)='ARRAY' AND JSON_LENGTH(intentions) BETWEEN 1 AND 4)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS referee_match_signup_events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    signup_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    operation ENUM('signup','update','withdraw','reapply') NOT NULL,
    before_snapshot JSON DEFAULT NULL,
    after_snapshot JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_signup_event_revision (signup_id,revision),
    FOREIGN KEY (signup_id) REFERENCES referee_match_signups(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
module.exports = {
  version:'0019', name:'referee_match_signups',
  description:'裁判比赛报名、意向与追加历史；赛程版本防止旧页面覆盖',
  rollback:'优先前向修复。回退前备份，不能删除报名、历史或迁移记录；有报名历史的比赛禁止直接删除。',
  async up(c) {
    const [[column]] = await c.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND COLUMN_NAME='schedule_revision'");
    if (!column.n) await c.query('ALTER TABLE match_schedules ADD COLUMN schedule_revision INT UNSIGNED NOT NULL DEFAULT 0');
    for (const [name,type] of [['venue','VARCHAR(20)'],['venue_detail','VARCHAR(120)']]) {
      const [[v]]=await c.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND COLUMN_NAME=?",[name]);
      if(!v.n) await c.query('ALTER TABLE match_schedules ADD COLUMN '+name+' '+type+' DEFAULT NULL');
    }
    for (const sql of tables) await c.query(sql);
  },
  tables
};
