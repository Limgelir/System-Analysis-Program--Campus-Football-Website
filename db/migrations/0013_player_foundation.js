// 第1批只建立数据基础；报名、名单发布等写入口按后续批次开放。
const suffix = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const tables = [
  `CREATE TABLE IF NOT EXISTS player_accounts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    student_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    college VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT NOT NULL DEFAULT 1,
    must_change_password TINYINT NOT NULL DEFAULT 0,
    token_version INT UNSIGNED NOT NULL DEFAULT 0,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    password_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_player_student_id (student_id),
    KEY idx_player_name (name),
    CONSTRAINT chk_player_active CHECK (is_active IN (0,1)),
    CONSTRAINT chk_player_must_change CHECK (must_change_password IN (0,1))
  )`,
  `CREATE TABLE IF NOT EXISTS player_account_events (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    player_id INT NOT NULL,
    operation VARCHAR(40) NOT NULL,
    revision INT UNSIGNED NOT NULL,
    actor_player_id INT DEFAULT NULL,
    actor_admin_id INT DEFAULT NULL,
    reason VARCHAR(500) DEFAULT NULL,
    before_snapshot JSON DEFAULT NULL,
    after_snapshot JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_player_event_revision (player_id, revision),
    FOREIGN KEY (player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
    CONSTRAINT chk_player_event_actor CHECK ((actor_player_id IS NOT NULL) + (actor_admin_id IS NOT NULL) = 1)
  )`,
  `CREATE TABLE IF NOT EXISTS player_season_settings (
    season_id INT PRIMARY KEY,
    registration_opens_at DATETIME(3) DEFAULT NULL,
    registration_closes_at DATETIME(3) DEFAULT NULL,
    ended_at DATETIME(3) DEFAULT NULL,
    ended_by_admin_id INT DEFAULT NULL,
    cleanup_status ENUM('not_requested','pending','complete','failed') NOT NULL DEFAULT 'not_requested',
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT,
    FOREIGN KEY (ended_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
    CHECK (registration_opens_at IS NULL OR registration_closes_at IS NULL OR registration_opens_at < registration_closes_at)
  )`,
  `CREATE TABLE IF NOT EXISTS season_competitions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    season_id INT NOT NULL,
    league_type ENUM('足协杯','大联赛','新生杯') NOT NULL,
    is_enabled TINYINT NOT NULL DEFAULT 0,
    registration_opens_at DATETIME(3) DEFAULT NULL,
    registration_closes_at DATETIME(3) DEFAULT NULL,
    rules_text TEXT DEFAULT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    UNIQUE KEY uq_competition_season_type (season_id, league_type),
    UNIQUE KEY uq_competition_id_season (id, season_id),
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT,
    CHECK (is_enabled IN (0,1)),
    CHECK (registration_opens_at IS NULL OR registration_closes_at IS NULL OR registration_opens_at < registration_closes_at)
  )`,
  `CREATE TABLE IF NOT EXISTS roster_change_windows (
    id INT PRIMARY KEY AUTO_INCREMENT,
    competition_id INT NOT NULL,
    opens_at DATETIME(3) NOT NULL,
    closes_at DATETIME(3) NOT NULL,
    created_by_admin_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (competition_id) REFERENCES season_competitions(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
    CHECK (opens_at < closes_at)
  )`,
  `CREATE TABLE IF NOT EXISTS player_season_registrations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    player_id INT NOT NULL,
    season_id INT NOT NULL,
    status ENUM('pending','withdrawn','returned','approved','revoked') NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    profile_snapshot JSON NOT NULL,
    submitted_at DATETIME(3) NOT NULL,
    reviewed_at DATETIME(3) DEFAULT NULL,
    reviewed_by_admin_id INT DEFAULT NULL,
    return_reason VARCHAR(500) DEFAULT NULL,
    UNIQUE KEY uq_player_season (player_id, season_id),
    UNIQUE KEY uq_player_registration_scope (id, player_id, season_id),
    KEY idx_player_registration_review (season_id, status, submitted_at),
    FOREIGN KEY (player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS player_registration_files (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    registration_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    file_path VARCHAR(255) DEFAULT NULL,
    mime_type VARCHAR(60) NOT NULL,
    sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    cleaned_at DATETIME(3) DEFAULT NULL,
    UNIQUE KEY uq_registration_file_revision (registration_id, revision),
    FOREIGN KEY (registration_id) REFERENCES player_season_registrations(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS player_registration_events (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    registration_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    operation VARCHAR(40) NOT NULL,
    actor_player_id INT DEFAULT NULL,
    actor_admin_id INT DEFAULT NULL,
    reason VARCHAR(500) DEFAULT NULL,
    before_snapshot JSON DEFAULT NULL,
    after_snapshot JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_player_registration_revision (registration_id, revision),
    FOREIGN KEY (registration_id) REFERENCES player_season_registrations(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
    CHECK ((actor_player_id IS NOT NULL) + (actor_admin_id IS NOT NULL) = 1)
  )`,
  `CREATE TABLE IF NOT EXISTS team_applications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    season_id INT NOT NULL,
    competition_id INT NOT NULL,
    team_id INT DEFAULT NULL,
    manager_player_id INT NOT NULL,
    kind ENUM('initial','roster_change','admin_import') NOT NULL,
    status ENUM('draft','pending','returned','withdrawn','approved') NOT NULL DEFAULT 'draft',
    team_name VARCHAR(100) NOT NULL,
    shirt_color VARCHAR(50) DEFAULT NULL,
    shorts_color VARCHAR(50) DEFAULT NULL,
    socks_color VARCHAR(50) DEFAULT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    base_roster_batch_id INT DEFAULT NULL,
    submitted_at DATETIME(3) DEFAULT NULL,
    reviewed_at DATETIME(3) DEFAULT NULL,
    reviewed_by_admin_id INT DEFAULT NULL,
    effective_from DATE DEFAULT NULL,
    return_reason VARCHAR(500) DEFAULT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_team_application_scope (id, season_id),
    FOREIGN KEY (competition_id, season_id) REFERENCES season_competitions(id, season_id) ON DELETE RESTRICT,
    FOREIGN KEY (team_id, season_id) REFERENCES team(id, season_id) ON DELETE RESTRICT,
    FOREIGN KEY (manager_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (base_roster_batch_id) REFERENCES team_roster_batches(id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
    KEY idx_team_application_review (season_id, status, submitted_at)
  )`,
  `CREATE TABLE IF NOT EXISTS team_application_members (
    id INT PRIMARY KEY AUTO_INCREMENT,
    application_id INT NOT NULL,
    player_id INT NOT NULL,
    jersey_number VARCHAR(20) NOT NULL,
    is_captain TINYINT NOT NULL DEFAULT 0,
    is_goalkeeper TINYINT NOT NULL DEFAULT 0,
    is_foreign TINYINT NOT NULL DEFAULT 0,
    is_sports_training TINYINT NOT NULL DEFAULT 0,
    profile_snapshot JSON NOT NULL,
    captain_application_id INT GENERATED ALWAYS AS (CASE WHEN is_captain = 1 THEN application_id ELSE NULL END) STORED,
    UNIQUE KEY uq_application_player (application_id, player_id),
    UNIQUE KEY uq_application_number (application_id, jersey_number),
    UNIQUE KEY uq_application_captain (captain_application_id),
    UNIQUE KEY uq_application_member_scope (id, application_id),
    FOREIGN KEY (application_id) REFERENCES team_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    CHECK (is_captain IN (0,1) AND is_goalkeeper IN (0,1) AND is_foreign IN (0,1) AND is_sports_training IN (0,1))
  )`,
  `CREATE TABLE IF NOT EXISTS team_application_events (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    application_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    operation VARCHAR(40) NOT NULL,
    actor_player_id INT DEFAULT NULL,
    actor_admin_id INT DEFAULT NULL,
    reason VARCHAR(500) DEFAULT NULL,
    before_snapshot JSON DEFAULT NULL,
    after_snapshot JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_team_application_revision (application_id, revision),
    FOREIGN KEY (application_id) REFERENCES team_applications(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
    CHECK ((actor_player_id IS NOT NULL) + (actor_admin_id IS NOT NULL) = 1)
  )`,
  `CREATE TABLE IF NOT EXISTS team_return_replacements (
    application_id INT NOT NULL,
    return_revision INT UNSIGNED NOT NULL,
    member_id INT NOT NULL,
    replacement_player_id INT DEFAULT NULL,
    PRIMARY KEY (application_id, return_revision, member_id),
    FOREIGN KEY (member_id, application_id) REFERENCES team_application_members(id, application_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, return_revision) REFERENCES team_application_events(application_id, revision) ON DELETE RESTRICT,
    FOREIGN KEY (replacement_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS team_role_change_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    team_id INT NOT NULL,
    role ENUM('manager','captain') NOT NULL,
    old_player_id INT NOT NULL,
    new_player_id INT NOT NULL,
    requested_by_player_id INT NOT NULL,
    status ENUM('pending','approved','returned','withdrawn') NOT NULL DEFAULT 'pending',
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    reason VARCHAR(500) DEFAULT NULL,
    reviewed_by_admin_id INT DEFAULT NULL,
    reviewed_at DATETIME(3) DEFAULT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (team_id) REFERENCES team(id) ON DELETE RESTRICT,
    FOREIGN KEY (old_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (new_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (requested_by_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS player_notifications (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    player_id INT NOT NULL,
    event_key VARCHAR(150) NOT NULL,
    kind VARCHAR(40) NOT NULL,
    message VARCHAR(500) NOT NULL,
    related_team_id INT DEFAULT NULL,
    read_at DATETIME(3) DEFAULT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_player_notice_event (player_id, event_key),
    KEY idx_player_notice_unread (player_id, read_at, id),
    FOREIGN KEY (player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (related_team_id) REFERENCES team(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS match_publications (
    report_id INT PRIMARY KEY,
    source_history_id BIGINT UNSIGNED DEFAULT NULL,
    version_no INT UNSIGNED NOT NULL,
    result_snapshot JSON NOT NULL,
    published_at DATETIME(3) NOT NULL,
    FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE RESTRICT,
    FOREIGN KEY (source_history_id) REFERENCES report_section_history(id) ON DELETE RESTRICT
  )`
].map(sql => sql + suffix);

// 旧数据的归属/标签保持未知(NULL)，不把姓名相同当作同一人，不补造审核结论。
const columns = [
  ['team', 'manager_player_id', 'INT DEFAULT NULL'],
  ['team', 'captain_player_id', 'INT DEFAULT NULL'],
  ['team', 'shirt_color', 'VARCHAR(50) DEFAULT NULL'],
  ['team', 'shorts_color', 'VARCHAR(50) DEFAULT NULL'],
  ['team', 'socks_color', 'VARCHAR(50) DEFAULT NULL'],
  ['team_roster_batches', 'source_type', "ENUM('legacy','online','admin_import') NOT NULL DEFAULT 'legacy'"],
  ['team_roster_batches', 'application_id', 'INT DEFAULT NULL'],
  ['team_roster_batches', 'effective_from', 'DATE DEFAULT NULL'],
  ['team_roster_batches', 'approved_at', 'DATETIME(3) DEFAULT NULL'],
  ['team_player', 'player_account_id', 'INT DEFAULT NULL'],
  ['team_player', 'is_captain', 'TINYINT DEFAULT NULL'],
  ['team_player', 'is_goalkeeper', 'TINYINT DEFAULT NULL'],
  ['team_player', 'is_foreign', 'TINYINT DEFAULT NULL'],
  ['team_player', 'is_sports_training', 'TINYINT DEFAULT NULL'],
  ['team_player', 'profile_snapshot', 'JSON DEFAULT NULL']
];
const constraints = [
  ['team', 'fk_team_manager_player', 'FOREIGN KEY (manager_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT'],
  ['team', 'fk_team_captain_player', 'FOREIGN KEY (captain_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT'],
  ['team_roster_batches', 'fk_batch_application', 'FOREIGN KEY (application_id) REFERENCES team_applications(id) ON DELETE RESTRICT'],
  ['team_player', 'fk_roster_player_account', 'FOREIGN KEY (player_account_id) REFERENCES player_accounts(id) ON DELETE RESTRICT']
];
const indexes = [
  ['team_roster_batches', 'uq_batch_application', 'UNIQUE INDEX uq_batch_application (application_id)'],
  ['team_roster_batches', 'idx_roster_effective', 'INDEX idx_roster_effective (team_id, effective_from, version_no)'],
  ['team_player', 'uq_roster_account', 'UNIQUE INDEX uq_roster_account (roster_batch_id, player_account_id)']
];
const securityAlter = `ALTER TABLE security_events
  MODIFY actor_role ENUM('admin','referee','anonymous','system','player') NOT NULL,
  MODIFY target_role ENUM('admin','referee','player') NOT NULL`;

module.exports = {
  version: '0013', name: 'player_foundation',
  description: '新增独立球员账号、申请/窗口/名单版本/发布基础，旧记录不自动关联；扩展球员登录审计角色',
  rollback: '先停止业务写入并配套备份数据库及上传目录。DDL不能整体事务回滚；优先前向修复。保留新账号与审计，禁止为回退旧代码删表或重置账号。若迁移中断，按结构核对后重试本迁移。',
  tables, columns, constraints, indexes, securityAlter,
  async up(c) {
    for (const sql of tables) await c.query(sql);
    for (const [table, column, definition] of columns) {
      const [[row]] = await c.execute('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, column]);
      if (!row.n) await c.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    for (const [table, name, definition] of constraints) {
      const [[row]] = await c.execute('SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?', [table, name]);
      if (!row.n) await c.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
    }
    for (const [table, name, definition] of indexes) {
      const [[row]] = await c.execute('SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?', [table, name]);
      if (!row.n) await c.query(`ALTER TABLE ${table} ADD ${definition}`);
    }
    await c.query(securityAlter);
  }
};
