module.exports = {
  version: '0005',
  name: 'referee_season_registrations',
  description: '新增裁判赛季注册当前申请和不可覆盖的追加式审核事件历史',
  rollback: '执行前备份数据库；如尚无赛季注册数据，可先删除 referee_season_registration_events，再删除 referee_season_registrations。已有申请时不得直接回退，应保留表或从备份恢复。',
  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS referee_season_registrations (
        id INT PRIMARY KEY AUTO_INCREMENT COMMENT '赛季注册申请ID',
        season_id INT NOT NULL COMMENT '申请赛季ID',
        referee_id INT NOT NULL COMMENT '裁判账号ID',
        name_snapshot VARCHAR(100) NOT NULL COMMENT '当季姓名快照',
        height_cm_snapshot INT NOT NULL COMMENT '当季身高快照(cm)',
        weight_kg_snapshot DECIMAL(5,2) NOT NULL COMMENT '当季体重快照(kg)',
        college_snapshot VARCHAR(100) NOT NULL COMMENT '当季学院快照',
        grade_snapshot ENUM('三级', '二级', '一级', '国家级') NOT NULL COMMENT '当季当前级别快照',
        match_types_snapshot JSON NOT NULL COMMENT '当季执法过的比赛类型快照',
        status ENUM('pending', 'approved', 'rejected', 'returned') NOT NULL DEFAULT 'pending' COMMENT '当前审核状态',
        submitted_at DATETIME NOT NULL COMMENT '本版本提交时间',
        reviewed_at DATETIME DEFAULT NULL COMMENT '最近审核时间',
        reviewed_by_admin_id INT DEFAULT NULL COMMENT '最近审核管理员ID',
        review_reason VARCHAR(500) DEFAULT NULL COMMENT '最近审核意见、驳回或退回原因',
        application_version INT NOT NULL DEFAULT 1 COMMENT '申请版本号；每次重新提交递增',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        UNIQUE KEY uq_referee_season_registration (season_id, referee_id),
        KEY idx_season_registration_status (season_id, status),
        KEY idx_season_registration_referee (referee_id),
        KEY idx_season_registration_admin (reviewed_by_admin_id),
        CONSTRAINT fk_season_registration_season
          FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT,
        CONSTRAINT fk_season_registration_referee
          FOREIGN KEY (referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
        CONSTRAINT fk_season_registration_admin
          FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin(id) ON DELETE SET NULL,
        CONSTRAINT chk_season_registration_height CHECK (height_cm_snapshot > 0),
        CONSTRAINT chk_season_registration_weight CHECK (weight_kg_snapshot > 0),
        CONSTRAINT chk_season_registration_version CHECK (application_version > 0),
        CONSTRAINT chk_season_registration_match_types_json CHECK (JSON_TYPE(match_types_snapshot) = 'ARRAY')
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='裁判赛季注册当前申请'
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS referee_season_registration_events (
        id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '注册事件ID',
        registration_id INT NOT NULL COMMENT '当前申请ID',
        season_id INT NOT NULL COMMENT '赛季ID冗余引用，便于历史审计',
        referee_id INT NOT NULL COMMENT '裁判账号ID冗余引用，便于历史审计',
        event_type ENUM('submitted', 'resubmitted', 'approved', 'rejected', 'returned') NOT NULL COMMENT '事件类型',
        from_status ENUM('pending', 'approved', 'rejected', 'returned') DEFAULT NULL COMMENT '变化前状态；首次提交为空',
        to_status ENUM('pending', 'approved', 'rejected', 'returned') NOT NULL COMMENT '变化后状态',
        application_version INT NOT NULL COMMENT '事件对应申请版本',
        actor_type ENUM('referee', 'admin') NOT NULL COMMENT '操作者类型',
        actor_referee_id INT DEFAULT NULL COMMENT '裁判操作者ID',
        actor_admin_id INT DEFAULT NULL COMMENT '管理员操作者ID',
        reason VARCHAR(500) DEFAULT NULL COMMENT '审核意见、驳回或退回原因',
        before_snapshot JSON DEFAULT NULL COMMENT '变化前完整快照',
        after_snapshot JSON NOT NULL COMMENT '变化后完整快照',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '事件时间',
        KEY idx_registration_event_registration (registration_id, id),
        KEY idx_registration_event_season (season_id, created_at),
        KEY idx_registration_event_referee (referee_id, created_at),
        CONSTRAINT fk_registration_event_registration
          FOREIGN KEY (registration_id) REFERENCES referee_season_registrations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_registration_event_season
          FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT,
        CONSTRAINT fk_registration_event_referee
          FOREIGN KEY (referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
        CONSTRAINT fk_registration_event_actor_referee
          FOREIGN KEY (actor_referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
        CONSTRAINT fk_registration_event_actor_admin
          FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
        CONSTRAINT chk_registration_event_version CHECK (application_version > 0),
        CONSTRAINT chk_registration_event_actor CHECK (
          (actor_type = 'referee' AND actor_referee_id IS NOT NULL AND actor_admin_id IS NULL) OR
          (actor_type = 'admin' AND actor_referee_id IS NULL AND actor_admin_id IS NOT NULL)
        )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='裁判赛季注册追加式审核历史'
    `);
  }
};
