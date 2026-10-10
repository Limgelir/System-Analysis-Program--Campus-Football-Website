const suffix = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const tables = [
  `CREATE TABLE IF NOT EXISTS player_college_changes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    player_id INT NOT NULL,
    old_college VARCHAR(100) NOT NULL,
    new_college VARCHAR(100) NOT NULL,
    status ENUM('pending','approved','returned','withdrawn') NOT NULL DEFAULT 'pending',
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    profile_snapshot JSON NOT NULL,
    review_profile_snapshot JSON DEFAULT NULL,
    request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    mime_type VARCHAR(40) NOT NULL,
    sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
    submitted_at DATETIME(3) NOT NULL,
    reviewed_at DATETIME(3) DEFAULT NULL,
    reviewed_by_admin_id INT DEFAULT NULL,
    review_reason VARCHAR(500) DEFAULT NULL,
    withdrawn_at DATETIME(3) DEFAULT NULL,
    pending_player_id INT GENERATED ALWAYS AS (CASE WHEN status='pending' THEN player_id ELSE NULL END) STORED,
    UNIQUE KEY uq_college_change_pending (pending_player_id),
    UNIQUE KEY uq_college_change_request (player_id,request_key),
    KEY idx_college_change_review (status,submitted_at,id),
    KEY idx_college_change_player (player_id,id),
    FOREIGN KEY (player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS player_college_change_events (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    change_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    operation VARCHAR(40) NOT NULL,
    actor_player_id INT DEFAULT NULL,
    actor_admin_id INT DEFAULT NULL,
    reason VARCHAR(500) DEFAULT NULL,
    after_snapshot JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_college_change_event (change_id,revision),
    FOREIGN KEY (change_id) REFERENCES player_college_changes(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
    CHECK ((actor_player_id IS NOT NULL) + (actor_admin_id IS NOT NULL) = 1)
  )`
].map(sql => sql + suffix);
module.exports = {
  version:'0026', name:'player_college_change_reviews', tables,
  description:'新增球员学院变更申请、私有截图引用和审核审计；保留所有已有账号、学籍、球队及赛程',
  rollback:'先备份数据库及上传目录。本迁移仅新增表，不修改已有业务记录；出现问题优先前向修复，不删除已有申请及截图。',
  async up(c) { for (const sql of tables) await c.query(sql); }
};
