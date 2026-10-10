module.exports = {
  version: '0012', name: 'login_security_events',
  description: '持久化账号与来源组合登录保护、脱敏安全事件；不修改已有账号或密码',
  rollback: '停止写入并备份；保留安全事件，优先前向修复，不删除已有业务数据。',
  async up(c) {
    await c.query(`CREATE TABLE IF NOT EXISTS login_security_buckets (
      bucket_key CHAR(64) CHARACTER SET ascii PRIMARY KEY,
      failed_count INT UNSIGNED NOT NULL DEFAULT 0,
      window_started_at DATETIME(3) NOT NULL,
      blocked_until DATETIME(3) DEFAULT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_login_bucket_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS security_events (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      event_type VARCHAR(40) NOT NULL,
      actor_role ENUM('admin','referee','anonymous','system') NOT NULL,
      actor_id INT DEFAULT NULL,
      target_role ENUM('admin','referee') NOT NULL,
      target_id INT DEFAULT NULL,
      account_key CHAR(64) CHARACTER SET ascii DEFAULT NULL,
      ip_key CHAR(64) CHARACTER SET ascii DEFAULT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_security_target (target_role,target_id,created_at),
      INDEX idx_security_login (account_key,event_type,ip_key),
      INDEX idx_security_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
};
