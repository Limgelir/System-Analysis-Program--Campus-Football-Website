module.exports = {
  version: '0010', name: 'report_actor_events',
  description: '报告真实操作人及代填来源追加记录，不伪造旧报告实际操作者',
  rollback: '迁移前备份；事件不可覆盖，保留此兼容表并前向修复；报告修订/退回属于后续阶段。',
  async up(c) {
    await c.query(`CREATE TABLE IF NOT EXISTS report_actor_events (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      report_id INT NOT NULL,
      owner_assignment_id INT NOT NULL,
      operation ENUM('save_main','submit_main','upload_image','remove_image','save_supervisor','submit_supervisor') NOT NULL,
      source_type ENUM('referee','admin_proxy') NOT NULL,
      actor_referee_id INT DEFAULT NULL,
      actor_admin_id INT DEFAULT NULL,
      actor_name_snapshot VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_actor_event_report (report_id, id),
      FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE RESTRICT,
      FOREIGN KEY (owner_assignment_id) REFERENCES match_official_assignments(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
      CONSTRAINT chk_report_actor CHECK (
        (source_type = 'referee' AND actor_referee_id IS NOT NULL AND actor_admin_id IS NULL) OR
        (source_type = 'admin_proxy' AND actor_referee_id IS NULL AND actor_admin_id IS NOT NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
};
