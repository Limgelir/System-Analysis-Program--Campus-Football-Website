const suffix = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const columns = [
  ['team_applications', 'source_type', "ENUM('online','admin_import') NOT NULL DEFAULT 'online'"],
  ['team_applications', 'base_team_revision', 'INT UNSIGNED DEFAULT NULL'],
  ['team_applications', 'base_snapshot', 'JSON DEFAULT NULL'],
  ['team_applications', 'created_by_admin_id', 'INT DEFAULT NULL'],
  ['team_applications', 'import_file_name', 'VARCHAR(255) DEFAULT NULL'],
  ['team_applications', 'open_change_team_id', "INT GENERATED ALWAYS AS (CASE WHEN kind='roster_change' AND status IN ('draft','pending','returned') THEN team_id ELSE NULL END) STORED"],
  ['team_application_members', 'remark', 'VARCHAR(255) DEFAULT NULL'],
  ['team_roster_batches', 'metadata_snapshot', 'JSON DEFAULT NULL']
];
const indexes = [
  ['team_applications', 'uq_open_roster_change', 'UNIQUE INDEX uq_open_roster_change (open_change_team_id)'],
  ['team_applications', 'uq_admin_import_request', 'UNIQUE INDEX uq_admin_import_request (created_by_admin_id,request_key)']
];
const tables = [
  `CREATE TABLE IF NOT EXISTS match_roster_selections (
    schedule_id INT NOT NULL,
    team_id INT NOT NULL,
    roster_batch_id INT DEFAULT NULL,
    revision INT UNSIGNED NOT NULL,
    selected_by_admin_id INT DEFAULT NULL,
    selection_reason VARCHAR(500) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (schedule_id,team_id),
    FOREIGN KEY (schedule_id) REFERENCES match_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES team(id) ON DELETE RESTRICT,
    FOREIGN KEY (roster_batch_id) REFERENCES team_roster_batches(id) ON DELETE RESTRICT,
    FOREIGN KEY (selected_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
  )` + suffix,
  `CREATE TABLE IF NOT EXISTS match_roster_selection_events (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    schedule_id INT NOT NULL,
    team_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    actor_admin_id INT DEFAULT NULL,
    operation VARCHAR(40) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    before_snapshot JSON DEFAULT NULL,
    after_snapshot JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_match_roster_event (schedule_id,team_id,revision),
    FOREIGN KEY (schedule_id) REFERENCES match_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES team(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
  )` + suffix
];
module.exports = {
  version: '0016', name: 'roster_changes_and_imports',
  description: '即时名单变更、审核导入与比赛独立名单版本',
  rollback: '先备份再增量迁移；保留正式名单、比赛选择及审核历史，失败后优先前向修复，不删除历史回退。',
  columns, indexes, tables,
  async up(c) {
    for (const [table, name, definition] of columns) {
      const [[row]] = await c.execute('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, name]);
      if (!row.n) await c.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
    for (const [table, name, definition] of indexes) {
      const [[row]] = await c.execute('SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?', [table, name]);
      if (!row.n) await c.query(`ALTER TABLE ${table} ADD ${definition}`);
    }
    for (const sql of tables) await c.query(sql);
  }
};
