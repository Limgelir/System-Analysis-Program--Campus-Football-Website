SET NAMES utf8mb4;

-- ============================================================
-- 说明：
-- 1. 统一使用 utf8mb4，避免中文乱码
-- 2. 本文件按“赛季 -> 队伍/名单 -> 赛程 -> 报告”新业务中心重建
-- 3. 可直接执行完成数据库与表初始化
-- 4. 旧版 matches / rating 已废弃，不再作为主业务表
-- 5. 依赖 MySQL 8.0+（使用 CHECK / 生成列 / 触发器）
-- ============================================================

CREATE DATABASE IF NOT EXISTS referee_system
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE referee_system;

SET FOREIGN_KEY_CHECKS = 0;

-- 先删触发器
DROP TRIGGER IF EXISTS trg_match_schedule_after_insert_create_report;

-- 再删表（按依赖逆序）
-- schema_migrations 由 backend 的迁移命令重新建立和登记基线
DROP TABLE IF EXISTS referee_match_signup_events;
DROP TABLE IF EXISTS referee_match_signups;
DROP TABLE IF EXISTS match_roster_selection_events;
DROP TABLE IF EXISTS match_roster_selections;
DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS team_role_change_events;
DROP TABLE IF EXISTS player_registration_requests;
DROP TABLE IF EXISTS player_season_setting_events;
DROP TABLE IF EXISTS player_material_cleanup_events;
DROP TABLE IF EXISTS match_publications;
DROP TABLE IF EXISTS player_notifications;
DROP TABLE IF EXISTS team_role_change_requests;
DROP TABLE IF EXISTS team_return_replacements;
DROP TABLE IF EXISTS team_application_events;
DROP TABLE IF EXISTS team_application_members;
DROP TABLE IF EXISTS team_applications;
DROP TABLE IF EXISTS player_registration_events;
DROP TABLE IF EXISTS player_registration_files;
DROP TABLE IF EXISTS player_season_registrations;
DROP TABLE IF EXISTS roster_change_windows;
DROP TABLE IF EXISTS season_competitions;
DROP TABLE IF EXISTS player_season_settings;
DROP TABLE IF EXISTS account_college_standardizations;
DROP TABLE IF EXISTS account_college_normalizations;
DROP TABLE IF EXISTS player_college_change_events;
DROP TABLE IF EXISTS player_college_changes;
DROP TABLE IF EXISTS player_account_events;
DROP TABLE IF EXISTS player_accounts;
DROP TABLE IF EXISTS report_section_history;
DROP TABLE IF EXISTS report_section_states;
DROP TABLE IF EXISTS report_actor_events;
DROP TABLE IF EXISTS match_goals;
DROP TABLE IF EXISTS competition_discipline_events;
DROP TABLE IF EXISTS match_cards;
DROP TABLE IF EXISTS match_referee_reviews;
DROP TABLE IF EXISTS match_referee_stats;
DROP TABLE IF EXISTS match_reports;
DROP TABLE IF EXISTS match_official_assignments;
DROP TABLE IF EXISTS external_referees;
DROP TABLE IF EXISTS match_schedules;
DROP TABLE IF EXISTS team_player;
DROP TABLE IF EXISTS team_roster_batches;
DROP TABLE IF EXISTS team;
DROP TABLE IF EXISTS referee_season_registration_events;
DROP TABLE IF EXISTS referee_season_registrations;
DROP TABLE IF EXISTS referee_profile;
DROP TABLE IF EXISTS referee;
DROP TABLE IF EXISTS seasons;
DROP TABLE IF EXISTS admin;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 管理员表
-- ============================================================
CREATE TABLE admin (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '管理员ID',
  username VARCHAR(50) NOT NULL COMMENT '管理员用户名',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
  must_change_password TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否必须在继续使用管理功能前修改密码',
  password_changed_at DATETIME DEFAULT NULL COMMENT '最近一次安全设置密码的时间',
  token_version INT NOT NULL DEFAULT 0 COMMENT '递增后使旧 JWT 失效',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uq_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员表';

-- ============================================================
-- 赛季表
-- 规则：任意时刻最多只能有一个启用中的赛季
-- ============================================================
CREATE TABLE seasons (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '赛季ID',
  season_code VARCHAR(20) NOT NULL COMMENT '内部编码，如 2025-fall / 2026-spring',
  season_name VARCHAR(20) NOT NULL COMMENT '展示名称，如 2025秋 / 2026春',
  start_date DATE NOT NULL COMMENT '赛季开始日期',
  end_date DATE NOT NULL COMMENT '赛季结束日期',
  is_active TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为当前启用赛季',
  active_singleton TINYINT GENERATED ALWAYS AS (CASE WHEN is_active = 1 THEN 1 ELSE NULL END) STORED COMMENT '用于保证最多一个激活赛季',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uq_season_code (season_code),
  UNIQUE KEY uq_season_name (season_name),
  UNIQUE KEY uq_active_singleton (active_singleton),
  CONSTRAINT chk_season_date_range CHECK (start_date <= end_date),
  CONSTRAINT chk_season_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='赛季表';

-- ============================================================
-- 裁判基础表
-- 升入当前级别时间：裁判学员可不填，其他级别由业务层校验必填
-- ============================================================
CREATE TABLE referee (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '裁判ID',
  student_id VARCHAR(50) NOT NULL COMMENT '学号',
  name VARCHAR(100) NOT NULL COMMENT '姓名',
  grade ENUM('裁判学员', '三级', '二级', '一级', '预备国家级', '国家级') NOT NULL COMMENT '当前级别',
  target_level ENUM('裁判学员', '三级', '二级', '一级', '预备国家级', '国家级') NOT NULL COMMENT '目标级别',
  shanghai_fa_registered TINYINT(1) NOT NULL DEFAULT 0 COMMENT '本人填报是否在上海足协注册，与本站赛季注册无关',
  level_promoted_at DATE NULL COMMENT '升入当前级别的时间，裁判学员可不填',
  match_types VARCHAR(255) DEFAULT NULL COMMENT '可执法比赛种类，逗号分隔',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
  must_change_password TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否必须在继续使用裁判功能前修改密码',
  password_changed_at DATETIME DEFAULT NULL COMMENT '最近一次安全设置密码的时间',
  token_version INT NOT NULL DEFAULT 0 COMMENT '递增后使旧 JWT 失效',
  is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '账号是否允许登录和使用裁判功能',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uq_referee_student_id (student_id),
  KEY idx_referee_name (name),
  KEY idx_referee_grade (grade),
  KEY idx_referee_is_active (is_active),
  CONSTRAINT chk_referee_shanghai_fa_registered CHECK (shanghai_fa_registered IN (0, 1)),
  CONSTRAINT chk_referee_must_change_password CHECK (must_change_password IN (0, 1)),
  CONSTRAINT chk_referee_is_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='裁判基础表';

-- ============================================================
-- 裁判扩展信息表
-- ============================================================
CREATE TABLE referee_profile (
  referee_id INT PRIMARY KEY COMMENT '裁判ID，与 referee 一对一',
  gender VARCHAR(20) DEFAULT NULL COMMENT '性别',
  college VARCHAR(100) DEFAULT NULL COMMENT '学院',
  height_cm INT DEFAULT NULL COMMENT '身高(cm)',
  weight_kg DECIMAL(5,2) DEFAULT NULL COMMENT '体重(kg)',
  id_photo_path VARCHAR(255) DEFAULT NULL COMMENT '证件照路径',
  officiated_count_base INT NOT NULL DEFAULT 0 COMMENT '人工录入的执法场次基数',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  CONSTRAINT fk_referee_profile_referee
    FOREIGN KEY (referee_id) REFERENCES referee(id) ON DELETE CASCADE,
  CONSTRAINT chk_referee_profile_height CHECK (height_cm IS NULL OR height_cm > 0),
  CONSTRAINT chk_referee_profile_weight CHECK (weight_kg IS NULL OR weight_kg > 0),
  CONSTRAINT chk_referee_profile_count CHECK (officiated_count_base >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='裁判扩展资料表';

-- ============================================================
-- 裁判赛季注册当前申请
-- 规则：同一账号同一赛季只有一份当前申请；未提交由不存在记录表示
-- ============================================================
CREATE TABLE referee_season_registrations (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '赛季注册申请ID',
  season_id INT NOT NULL COMMENT '申请赛季ID',
  referee_id INT NOT NULL COMMENT '裁判账号ID',
  name_snapshot VARCHAR(100) NOT NULL COMMENT '当季姓名快照',
  height_cm_snapshot INT NOT NULL COMMENT '当季身高快照(cm)',
  weight_kg_snapshot DECIMAL(5,2) NOT NULL COMMENT '当季体重快照(kg)',
  college_snapshot VARCHAR(100) NOT NULL COMMENT '当季学院快照',
  grade_snapshot ENUM('裁判学员', '三级', '二级', '一级', '预备国家级', '国家级') NOT NULL COMMENT '当季当前级别快照',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='裁判赛季注册当前申请';

-- ============================================================
-- 裁判赛季注册追加式事件历史
-- 规则：业务接口只追加，不修改或删除历史事件
-- ============================================================
CREATE TABLE referee_season_registration_events (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='裁判赛季注册追加式审核历史';

-- ============================================================
-- 队伍表
-- 规则：team 不再跨赛季存在；同名队伍跨赛季视为不同队伍
-- ============================================================
CREATE TABLE team (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '队伍ID',
  season_id INT NOT NULL COMMENT '所属赛季ID',
  team_name VARCHAR(100) NOT NULL COMMENT '队伍名称',
  league_type VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL COMMENT '赛事类型',
  description TEXT DEFAULT NULL COMMENT '队伍描述（可选）',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uq_team_season_name_league (season_id, team_name, league_type),
  UNIQUE KEY uq_team_id_season (id, season_id),
  KEY idx_team_season (season_id),
  KEY idx_team_league_type (league_type),
  KEY idx_team_name (team_name),
  CONSTRAINT fk_team_season
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='队伍表（按赛季独立）';

-- ============================================================
-- 名单导入批次表
-- 规则：每次导入 Excel 生成一个新批次；历史批次永不物理删除
-- ============================================================
CREATE TABLE team_roster_batches (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '名单批次ID',
  team_id INT NOT NULL COMMENT '队伍ID',
  season_id INT NOT NULL COMMENT '赛季ID（与 team.season_id 保持一致）',
  version_no INT NOT NULL COMMENT '同一队伍同一赛季的第几次导入，从 1 开始',
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '导入时间',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY uq_roster_batch_team_season_version (team_id, season_id, version_no),
  UNIQUE KEY uq_roster_batch_id_team (id, team_id),
  KEY idx_roster_batch_team (team_id),
  KEY idx_roster_batch_season (season_id),
  CONSTRAINT fk_roster_batch_team_season
    FOREIGN KEY (team_id, season_id) REFERENCES team(id, season_id) ON DELETE CASCADE,
  CONSTRAINT chk_roster_batch_version CHECK (version_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='队伍名单导入批次表';

-- ============================================================
-- 球员表
-- 规则：每个球员记录归属于某次名单批次；历史引用必须稳定
-- ============================================================
CREATE TABLE team_player (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '球员记录ID',
  roster_batch_id INT NOT NULL COMMENT '所属名单批次ID',
  team_id INT NOT NULL COMMENT '所属队伍ID',
  jersey_number VARCHAR(20) NOT NULL COMMENT '号码（Excel A 列）',
  player_name VARCHAR(100) NOT NULL COMMENT '姓名（Excel B 列）',
  remark VARCHAR(255) DEFAULT NULL COMMENT '备注（Excel C 列）',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY uq_team_player_batch_jersey (roster_batch_id, jersey_number),
  UNIQUE KEY uq_team_player_id_team (id, team_id),
  KEY idx_team_player_batch (roster_batch_id),
  KEY idx_team_player_team (team_id),
  KEY idx_team_player_name (player_name),
  CONSTRAINT fk_team_player_batch_team
    FOREIGN KEY (roster_batch_id, team_id) REFERENCES team_roster_batches(id, team_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='名单批次内的球员项表';

-- ============================================================
-- 赛程表
-- 规则：
-- 1. 新建赛程默认使用当前启用赛季（由应用层决定）
-- 2. 比赛使用 match_date + match_time，并记录场地；不使用旧 start_time / end_time
-- 3. 场序在同一赛季内同一比赛类型唯一
-- 4. 五位裁判可后填；未选派时允许为空
-- ============================================================
CREATE TABLE match_schedules (
  schedule_revision INT UNSIGNED NOT NULL DEFAULT 0,
  venue VARCHAR(20) DEFAULT NULL,
  venue_detail VARCHAR(120) DEFAULT NULL,
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '赛程ID',
  season_id INT NOT NULL COMMENT '所属赛季ID',
  match_type VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL COMMENT '比赛类型',
  team_a_id INT NOT NULL COMMENT '主队ID',
  team_b_id INT NOT NULL COMMENT '客队ID',
  team_a_name_snapshot VARCHAR(100) DEFAULT NULL COMMENT '主队名称快照',
  team_b_name_snapshot VARCHAR(100) DEFAULT NULL COMMENT '客队名称快照',
  match_date DATE NOT NULL COMMENT '比赛日期',
  match_time TIME DEFAULT NULL COMMENT '中国标准时间开球时刻，精确到分钟；旧比赛可待定',
  match_end_time TIME DEFAULT NULL COMMENT '可选同日结束时间，仅供展示',
  field_order VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL COMMENT '同一赛事内精确唯一的文本场序',
  field_order_sort VARCHAR(800) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT '',
  main_referee_id INT DEFAULT NULL COMMENT '主裁ID',
  assistant1_id INT DEFAULT NULL COMMENT '边裁1 ID',
  assistant2_id INT DEFAULT NULL COMMENT '边裁2 ID',
  fourth_official_id INT DEFAULT NULL COMMENT '第四官员ID',
  supervisor_id INT DEFAULT NULL COMMENT '比赛监督ID',
  main_referee_name_snapshot VARCHAR(100) DEFAULT NULL COMMENT '主裁姓名快照',
  assistant1_name_snapshot VARCHAR(100) DEFAULT NULL COMMENT '助理裁判1姓名快照',
  assistant2_name_snapshot VARCHAR(100) DEFAULT NULL COMMENT '助理裁判2姓名快照',
  fourth_official_name_snapshot VARCHAR(100) DEFAULT NULL COMMENT '第四官员姓名快照',
  supervisor_name_snapshot VARCHAR(100) DEFAULT NULL COMMENT '比赛监督姓名快照',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uq_schedule_season_type_field_order (season_id, match_type, field_order),
  KEY idx_schedule_match_type (match_type),
  KEY idx_schedule_match_date (match_date),
  KEY idx_schedule_team_a (team_a_id),
  KEY idx_schedule_team_b (team_b_id),
  KEY idx_schedule_main_referee (main_referee_id),
  KEY idx_schedule_assistant1 (assistant1_id),
  KEY idx_schedule_assistant2 (assistant2_id),
  KEY idx_schedule_fourth (fourth_official_id),
  KEY idx_schedule_supervisor (supervisor_id),
  CONSTRAINT fk_schedule_team_a_season
    FOREIGN KEY (team_a_id, season_id) REFERENCES team(id, season_id) ON DELETE RESTRICT,
  CONSTRAINT fk_schedule_team_b_season
    FOREIGN KEY (team_b_id, season_id) REFERENCES team(id, season_id) ON DELETE RESTRICT,
  CONSTRAINT fk_schedule_main_referee
    FOREIGN KEY (main_referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
  CONSTRAINT fk_schedule_assistant1
    FOREIGN KEY (assistant1_id) REFERENCES referee(id) ON DELETE RESTRICT,
  CONSTRAINT fk_schedule_assistant2
    FOREIGN KEY (assistant2_id) REFERENCES referee(id) ON DELETE RESTRICT,
  CONSTRAINT fk_schedule_fourth
    FOREIGN KEY (fourth_official_id) REFERENCES referee(id) ON DELETE RESTRICT,
  CONSTRAINT fk_schedule_supervisor
    FOREIGN KEY (supervisor_id) REFERENCES referee(id) ON DELETE RESTRICT,
  CONSTRAINT chk_schedule_match_end_time CHECK (match_end_time IS NULL OR (match_time IS NOT NULL AND match_end_time > match_time AND match_end_time < '24:00:00' AND SECOND(match_end_time)=0)),
  CONSTRAINT chk_schedule_match_time CHECK (match_time IS NULL OR (match_time >= '00:00:00' AND match_time < '24:00:00' AND SECOND(match_time)=0)),
  CONSTRAINT chk_schedule_team_diff CHECK (team_a_id <> team_b_id),
  CONSTRAINT chk_schedule_referee_distinct CHECK (
    (main_referee_id IS NULL OR assistant1_id IS NULL OR main_referee_id <> assistant1_id) AND
    (main_referee_id IS NULL OR assistant2_id IS NULL OR main_referee_id <> assistant2_id) AND
    (main_referee_id IS NULL OR fourth_official_id IS NULL OR main_referee_id <> fourth_official_id) AND
    (main_referee_id IS NULL OR supervisor_id IS NULL OR main_referee_id <> supervisor_id) AND
    (assistant1_id IS NULL OR assistant2_id IS NULL OR assistant1_id <> assistant2_id) AND
    (assistant1_id IS NULL OR fourth_official_id IS NULL OR assistant1_id <> fourth_official_id) AND
    (assistant1_id IS NULL OR supervisor_id IS NULL OR assistant1_id <> supervisor_id) AND
    (assistant2_id IS NULL OR fourth_official_id IS NULL OR assistant2_id <> fourth_official_id) AND
    (assistant2_id IS NULL OR supervisor_id IS NULL OR assistant2_id <> supervisor_id) AND
    (fourth_official_id IS NULL OR supervisor_id IS NULL OR fourth_official_id <> supervisor_id)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='赛程主表';

-- ============================================================
-- 裁判报告主表
-- 规则：
-- 1. 一条赛程唯一对应一份报告
-- 2. 主裁与监督使用并行状态，不使用单一线性状态
-- 3. home_score / away_score 为主裁手填的比赛阶段比分（不含点球大战）
-- 4. main_report_started_at / supervisor_review_started_at 用于锁定更换主裁/监督
-- ============================================================
CREATE TABLE match_reports (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '报告ID',
  schedule_id INT NOT NULL COMMENT '赛程ID，一对一',
  forfeit_side ENUM('none','home','away','both') NOT NULL DEFAULT 'none' COMMENT '弃权方；none表示正常比赛',
  home_score INT NOT NULL DEFAULT 0 COMMENT '主队比赛阶段得分（手填，不含点球大战）',
  away_score INT NOT NULL DEFAULT 0 COMMENT '客队比赛阶段得分（手填，不含点球大战）',
  home_penalty_score INT NOT NULL DEFAULT 0 COMMENT '主队点球大战得分',
  away_penalty_score INT NOT NULL DEFAULT 0 COMMENT '客队点球大战得分',
  fourth_official_image_path VARCHAR(255) DEFAULT NULL COMMENT '比赛四官单图片路径',
  main_report_started_at DATETIME DEFAULT NULL COMMENT '主裁部分首次落库时间；任一分区开始后整场赛程锁定',
  supervisor_review_started_at DATETIME DEFAULT NULL COMMENT '监督部分首次落库时间；任一分区开始后整场赛程锁定',
  main_report_status ENUM('draft', 'submitted', 'returned') NOT NULL DEFAULT 'draft' COMMENT '主裁部分状态',
  supervisor_review_status ENUM('draft', 'submitted', 'returned') NOT NULL DEFAULT 'draft' COMMENT '监督部分状态',
  main_report_submitted_at DATETIME DEFAULT NULL COMMENT '主裁提交时间',
  supervisor_review_submitted_at DATETIME DEFAULT NULL COMMENT '监督提交时间',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uq_match_report_schedule (schedule_id),
  CONSTRAINT fk_match_report_schedule
    FOREIGN KEY (schedule_id) REFERENCES match_schedules(id) ON DELETE CASCADE,
  CONSTRAINT chk_match_report_score_non_negative CHECK (
    home_score >= 0 AND away_score >= 0 AND
    home_penalty_score >= 0 AND away_penalty_score >= 0
  ),
  CONSTRAINT chk_match_report_score_maximum CHECK (
    home_score <= 30 AND away_score <= 30 AND
    home_penalty_score <= 30 AND away_penalty_score <= 30
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='裁判报告主表';

-- ============================================================
-- 裁判执法数据表
-- 说明：
-- 1. 采用“按角色一条记录”的方式存储
-- 2. 当前模板只需要 main / assistant1 / assistant2 三类
-- 3. 主裁相关统计与助理裁判统计共用此表，不同角色填不同字段
-- ============================================================
CREATE TABLE external_referees (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      note VARCHAR(255) DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by_admin_id INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_external_name (name),
      FOREIGN KEY (created_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
      CONSTRAINT chk_external_active CHECK (is_active IN (0,1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE match_official_assignments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      schedule_id INT NOT NULL,
      role ENUM('main','assistant1','assistant2','fourth','supervisor') NOT NULL,
      source_type ENUM('system','external') NOT NULL,
      referee_id INT DEFAULT NULL,
      external_referee_id INT DEFAULT NULL,
      name_snapshot VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_official_schedule_role (schedule_id, role),
      UNIQUE KEY uq_official_system_person (schedule_id, referee_id),
      UNIQUE KEY uq_official_external_person (schedule_id, external_referee_id),
      FOREIGN KEY (schedule_id) REFERENCES match_schedules(id) ON DELETE CASCADE,
      FOREIGN KEY (referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
      FOREIGN KEY (external_referee_id) REFERENCES external_referees(id) ON DELETE RESTRICT,
      CONSTRAINT chk_official_source CHECK (
        (source_type = 'system' AND referee_id IS NOT NULL AND external_referee_id IS NULL) OR
        (source_type = 'external' AND referee_id IS NULL AND external_referee_id IS NOT NULL)),
      CONSTRAINT chk_official_supervisor CHECK (role <> 'supervisor' OR source_type = 'system')
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE report_actor_events (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE match_referee_stats (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '执法数据记录ID',
  report_id INT NOT NULL COMMENT '报告ID',
  referee_id INT DEFAULT NULL COMMENT '系统裁判账号；非系统裁判为空',
  assignment_id INT NOT NULL COMMENT '统一岗位ID',
  role ENUM('main', 'assistant1', 'assistant2') NOT NULL COMMENT '裁判角色',
  running_distance_m INT DEFAULT NULL COMMENT '跑动距离（m）',
  max_heart_rate INT DEFAULT NULL COMMENT '最大心率',
  sprint_count INT DEFAULT NULL COMMENT '冲刺次数',
  high_intensity_distance_m INT DEFAULT NULL COMMENT '高强度跑动距离（m）',
  avg_heart_rate INT DEFAULT NULL COMMENT '平均心率',
  avg_speed_mps DECIMAL(6,2) DEFAULT NULL COMMENT '平均跑动速度（m/s）',
  red_card_count INT DEFAULT NULL COMMENT '红牌张数（主裁）',
  red_card_accuracy DECIMAL(5,2) DEFAULT NULL COMMENT '红牌准确率（%）',
  yellow_card_count INT DEFAULT NULL COMMENT '黄牌张数（主裁）',
  yellow_card_accuracy DECIMAL(5,2) DEFAULT NULL COMMENT '黄牌准确率（%）',
  penalty_count INT DEFAULT NULL COMMENT '点球判罚次数（主裁）',
  penalty_accuracy DECIMAL(5,2) DEFAULT NULL COMMENT '点球判罚准确率（%）',
  offside_flag_count INT DEFAULT NULL COMMENT '越位举旗次数（助理裁判）',
  assist_count INT DEFAULT NULL COMMENT '协助次数（助理裁判）',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uq_referee_stats_report_role (report_id, role),
  KEY idx_referee_stats_referee (referee_id),
  CONSTRAINT fk_stats_assignment FOREIGN KEY (assignment_id) REFERENCES match_official_assignments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_referee_stats_report
    FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_referee_stats_referee
    FOREIGN KEY (referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
  CONSTRAINT chk_referee_stats_non_negative CHECK (
    (running_distance_m IS NULL OR running_distance_m >= 0) AND
    (max_heart_rate IS NULL OR max_heart_rate >= 0) AND
    (sprint_count IS NULL OR sprint_count >= 0) AND
    (high_intensity_distance_m IS NULL OR high_intensity_distance_m >= 0) AND
    (avg_heart_rate IS NULL OR avg_heart_rate >= 0) AND
    (avg_speed_mps IS NULL OR avg_speed_mps >= 0) AND
    (red_card_count IS NULL OR red_card_count >= 0) AND
    (red_card_accuracy IS NULL OR (red_card_accuracy >= 0 AND red_card_accuracy <= 100)) AND
    (yellow_card_count IS NULL OR yellow_card_count >= 0) AND
    (yellow_card_accuracy IS NULL OR (yellow_card_accuracy >= 0 AND yellow_card_accuracy <= 100)) AND
    (penalty_count IS NULL OR penalty_count >= 0) AND
    (penalty_accuracy IS NULL OR (penalty_accuracy >= 0 AND penalty_accuracy <= 100)) AND
    (offside_flag_count IS NULL OR offside_flag_count >= 0) AND
    (assist_count IS NULL OR assist_count >= 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='裁判执法数据表';

-- ============================================================
-- 比赛监督评分与建议表
-- 说明：监督对另外四位裁判分别填写评分与建议
-- ============================================================
CREATE TABLE match_referee_reviews (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '监督评价记录ID',
  report_id INT NOT NULL COMMENT '报告ID',
  reviewer_referee_id INT NOT NULL COMMENT '监督裁判ID',
  target_referee_id INT DEFAULT NULL COMMENT '系统被评价裁判账号；非系统裁判为空',
  target_assignment_id INT NOT NULL,
  reviewer_assignment_id INT NOT NULL,
  target_role ENUM('main', 'assistant1', 'assistant2', 'fourth') NOT NULL COMMENT '被评价裁判角色',
  score DECIMAL(3,1) NOT NULL COMMENT '评分（1-10，保留1位小数）',
  advice VARCHAR(100) DEFAULT NULL COMMENT '建议（不超过100字）',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uq_review_report_target_role (report_id, target_role),
  KEY idx_review_reviewer (reviewer_referee_id),
  KEY idx_review_target_referee (target_referee_id),
  CONSTRAINT fk_reviews_target_assignment FOREIGN KEY (target_assignment_id) REFERENCES match_official_assignments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reviews_reviewer_assignment FOREIGN KEY (reviewer_assignment_id) REFERENCES match_official_assignments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_review_report
    FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_reviewer
    FOREIGN KEY (reviewer_referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
  CONSTRAINT fk_review_target_referee
    FOREIGN KEY (target_referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
  CONSTRAINT chk_review_score CHECK (score >= 1.0 AND score <= 10.0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='比赛监督评分与建议表';

-- ============================================================
-- 红黄牌明细表
-- 规则：球员只能从名单中选择，不保留手动兜底
-- ============================================================
CREATE TABLE match_cards (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '红黄牌事件ID',
  report_id INT NOT NULL COMMENT '报告ID',
  team_id INT NOT NULL COMMENT '吃牌球员所属队伍ID',
  team_player_id INT NOT NULL COMMENT '吃牌球员ID（必须来自名单）',
  card_type ENUM('yellow', 'red', 'second_yellow_red') NOT NULL COMMENT '牌类型',
  minute_base SMALLINT NOT NULL COMMENT '基础分钟，如 45',
  minute_extra SMALLINT NOT NULL DEFAULT 0 COMMENT '补时分钟，如 +2',
  minute_label VARCHAR(20) NOT NULL COMMENT '展示缓存，如 45+2',
  description VARCHAR(255) DEFAULT NULL COMMENT '出牌原因说明',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uq_match_card_id_team (id, team_id),
  KEY idx_match_cards_report (report_id),
  KEY idx_match_cards_team (team_id),
  KEY idx_match_cards_player (team_player_id),
  KEY idx_match_cards_timeline (report_id, minute_base, minute_extra, id),
  CONSTRAINT fk_match_cards_report
    FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_cards_team
    FOREIGN KEY (team_id) REFERENCES team(id) ON DELETE RESTRICT,
  CONSTRAINT fk_match_cards_player_team
    FOREIGN KEY (team_player_id, team_id) REFERENCES team_player(id, team_id) ON DELETE RESTRICT,
  CONSTRAINT chk_match_cards_minute CHECK (minute_base >= 0 AND minute_extra >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='红黄牌明细表';

-- ============================================================
-- 进球说明表
-- 规则：
-- 1. 球员只能从名单中选择，不保留手动兜底
-- 2. 普通比分由主裁手填，应用层需校验本表明细数量与比分保持一致
-- 3. 若为乌龙球，player_team_id 与 credited_team_id 可以不同
-- 4. 不记录点球大战逐次罚球，只记录比赛阶段进球说明
-- ============================================================
CREATE TABLE match_goals (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '进球事件ID',
  report_id INT NOT NULL COMMENT '报告ID',
  player_team_id INT NOT NULL COMMENT '进球队员所属队伍ID；乌龙球时可与记分归属队不同',
  credited_team_id INT NOT NULL COMMENT '记分归属队伍ID',
  team_player_id INT NOT NULL COMMENT '进球队员ID（必须来自名单）',
  goal_type ENUM('normal', 'penalty', 'own_goal') NOT NULL DEFAULT 'normal' COMMENT '进球类型',
  minute_base SMALLINT NOT NULL COMMENT '基础分钟，如 45',
  minute_extra SMALLINT NOT NULL DEFAULT 0 COMMENT '补时分钟，如 +2',
  minute_label VARCHAR(20) NOT NULL COMMENT '展示缓存，如 45+2',
  description VARCHAR(255) DEFAULT NULL COMMENT '进球说明',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  KEY idx_match_goals_report (report_id),
  KEY idx_match_goals_player_team (player_team_id),
  KEY idx_match_goals_credited_team (credited_team_id),
  KEY idx_match_goals_team_player (team_player_id),
  KEY idx_match_goals_timeline (report_id, minute_base, minute_extra, id),
  CONSTRAINT fk_match_goals_report
    FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_goals_player_team
    FOREIGN KEY (player_team_id) REFERENCES team(id) ON DELETE RESTRICT,
  CONSTRAINT fk_match_goals_credited_team
    FOREIGN KEY (credited_team_id) REFERENCES team(id) ON DELETE RESTRICT,
  CONSTRAINT fk_match_goals_player_ref
    FOREIGN KEY (team_player_id, player_team_id) REFERENCES team_player(id, team_id) ON DELETE RESTRICT,
  CONSTRAINT chk_match_goals_minute CHECK (minute_base >= 0 AND minute_extra >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='进球说明表';

-- ============================================================
-- 触发器：创建赛程时自动生成空报告
-- ============================================================
DELIMITER $$

CREATE TRIGGER trg_match_schedule_after_insert_create_report
AFTER INSERT ON match_schedules
FOR EACH ROW
BEGIN
  INSERT INTO match_reports (schedule_id)
  VALUES (NEW.id);
END$$

DELIMITER ;

-- ============================================================
CREATE TABLE report_section_states (
      report_id INT NOT NULL,
      section ENUM('main','supervisor') NOT NULL,
      revision INT UNSIGNED NOT NULL DEFAULT 0,
      version_no INT UNSIGNED NOT NULL DEFAULT 0,
      original_submission JSON DEFAULT NULL,
      last_submission JSON DEFAULT NULL,
      return_reason VARCHAR(500) DEFAULT NULL,
      returned_at DATETIME(3) DEFAULT NULL,
      returned_by_admin_id INT DEFAULT NULL,
      PRIMARY KEY (report_id,section),
      FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE RESTRICT,
      FOREIGN KEY (returned_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE report_section_history (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      report_id INT NOT NULL,
      section ENUM('main','supervisor') NOT NULL,
      revision INT UNSIGNED NOT NULL,
      version_no INT UNSIGNED NOT NULL,
      operation ENUM('baseline','save','submit','return','revise','upload_image','remove_image') NOT NULL,
      source_type ENUM('legacy','referee','admin_proxy','admin_revision') NOT NULL,
      actor_admin_id INT DEFAULT NULL,
      actor_referee_id INT DEFAULT NULL,
      actor_name_snapshot VARCHAR(100) DEFAULT NULL,
      reason VARCHAR(500) DEFAULT NULL,
      before_snapshot JSON DEFAULT NULL,
      after_snapshot JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_report_section_revision (report_id,section,revision),
      FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
      CONSTRAINT chk_history_actor CHECK (
        (source_type='legacy' AND actor_admin_id IS NULL AND actor_referee_id IS NULL) OR
        (source_type='referee' AND actor_referee_id IS NOT NULL AND actor_admin_id IS NULL) OR
        (source_type IN ('admin_proxy','admin_revision') AND actor_admin_id IS NOT NULL AND actor_referee_id IS NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_security_buckets (
      bucket_key CHAR(64) CHARACTER SET ascii PRIMARY KEY,
      failed_count INT UNSIGNED NOT NULL DEFAULT 0,
      window_started_at DATETIME(3) NOT NULL,
      blocked_until DATETIME(3) DEFAULT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_login_bucket_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS security_events (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 建议初始化说明（非约束，仅说明）
-- 1. 应用层创建赛程前必须先确认存在且仅存在一个 is_active = 1 的赛季
-- 2. 没有启用赛季时，不允许新建赛程 / 新建队伍 / 导入名单
-- 3. 应用层需在保存主裁相关任一字段时首次写入 main_report_started_at
-- 4. 应用层需在保存监督相关任一字段时首次写入 supervisor_review_started_at
-- 5. 应用层需校验：
--    - 新建赛程时主客队不同、五位裁判不重复
--    - 监督只能评价另外四位裁判，且 reviewer_referee_id 必须等于该场 supervisor_id
--    - 红黄牌与进球事件中的球员必须来自对应队伍的名单
--    - 进球说明条数及归属需与主裁手填比分保持一致
-- ============================================================

-- PLAYER_FOUNDATION_0013: only for full initialization; existing databases use migrations
CREATE TABLE IF NOT EXISTS player_accounts (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_account_events (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_season_settings (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS season_competitions (
    yellow_threshold INT UNSIGNED DEFAULT NULL,
    yellow_suspension INT UNSIGNED DEFAULT NULL,
    red_threshold INT UNSIGNED DEFAULT NULL,
    red_suspension INT UNSIGNED DEFAULT NULL,
    discipline_revision INT UNSIGNED NOT NULL DEFAULT 0,
    id INT PRIMARY KEY AUTO_INCREMENT,
    season_id INT NOT NULL,
    league_type VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roster_change_windows (
    id INT PRIMARY KEY AUTO_INCREMENT,
    competition_id INT NOT NULL,
    opens_at DATETIME(3) NOT NULL,
    closes_at DATETIME(3) NOT NULL,
    created_by_admin_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (competition_id) REFERENCES season_competitions(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
    CHECK (opens_at < closes_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_season_registrations (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_registration_files (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_registration_events (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_applications (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_application_members (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_application_events (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_return_replacements (
    application_id INT NOT NULL,
    return_revision INT UNSIGNED NOT NULL,
    member_id INT NOT NULL,
    replacement_player_id INT DEFAULT NULL,
    PRIMARY KEY (application_id, return_revision, member_id),
    FOREIGN KEY (member_id, application_id) REFERENCES team_application_members(id, application_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, return_revision) REFERENCES team_application_events(application_id, revision) ON DELETE RESTRICT,
    FOREIGN KEY (replacement_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_role_change_requests (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_notifications (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_publications (
    report_id INT PRIMARY KEY,
    source_history_id BIGINT UNSIGNED DEFAULT NULL,
    version_no INT UNSIGNED NOT NULL,
    result_snapshot JSON NOT NULL,
    published_at DATETIME(3) NOT NULL,
    FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE RESTRICT,
    FOREIGN KEY (source_history_id) REFERENCES report_section_history(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE team ADD COLUMN manager_player_id INT DEFAULT NULL;

ALTER TABLE team ADD COLUMN captain_player_id INT DEFAULT NULL;

ALTER TABLE team ADD COLUMN shirt_color VARCHAR(50) DEFAULT NULL;

ALTER TABLE team ADD COLUMN shorts_color VARCHAR(50) DEFAULT NULL;

ALTER TABLE team ADD COLUMN socks_color VARCHAR(50) DEFAULT NULL;

ALTER TABLE team_roster_batches ADD COLUMN source_type ENUM('legacy','online','admin_import') NOT NULL DEFAULT 'legacy';

ALTER TABLE team_roster_batches ADD COLUMN application_id INT DEFAULT NULL;

ALTER TABLE team_roster_batches ADD COLUMN effective_from DATE DEFAULT NULL;

ALTER TABLE team_roster_batches ADD COLUMN approved_at DATETIME(3) DEFAULT NULL;

ALTER TABLE team_player ADD COLUMN player_account_id INT DEFAULT NULL;

ALTER TABLE team_player ADD COLUMN is_captain TINYINT DEFAULT NULL;

ALTER TABLE team_player ADD COLUMN is_goalkeeper TINYINT DEFAULT NULL;

ALTER TABLE team_player ADD COLUMN is_foreign TINYINT DEFAULT NULL;

ALTER TABLE team_player ADD COLUMN is_sports_training TINYINT DEFAULT NULL;

ALTER TABLE team_player ADD COLUMN profile_snapshot JSON DEFAULT NULL;

ALTER TABLE team ADD CONSTRAINT fk_team_manager_player FOREIGN KEY (manager_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT;

ALTER TABLE team ADD CONSTRAINT fk_team_captain_player FOREIGN KEY (captain_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT;

ALTER TABLE team_roster_batches ADD CONSTRAINT fk_batch_application FOREIGN KEY (application_id) REFERENCES team_applications(id) ON DELETE RESTRICT;

ALTER TABLE team_player ADD CONSTRAINT fk_roster_player_account FOREIGN KEY (player_account_id) REFERENCES player_accounts(id) ON DELETE RESTRICT;

ALTER TABLE team_roster_batches ADD UNIQUE INDEX uq_batch_application (application_id);

ALTER TABLE team_roster_batches ADD INDEX idx_roster_effective (team_id, effective_from, version_no);

ALTER TABLE team_player ADD UNIQUE INDEX uq_roster_account (roster_batch_id, player_account_id);

ALTER TABLE security_events
  MODIFY actor_role ENUM('admin','referee','anonymous','system','player') NOT NULL,
  MODIFY target_role ENUM('admin','referee','player') NOT NULL;

-- PLAYER_REGISTRATION_WORKFLOW_0014: full initialization only
CREATE TABLE IF NOT EXISTS player_season_setting_events (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    season_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    actor_admin_id INT NOT NULL,
    before_snapshot JSON NOT NULL,
    after_snapshot JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_player_settings_event (season_id,revision),
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS player_registration_requests (
    player_id INT NOT NULL,
    request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    season_id INT NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii NOT NULL,
    registration_id INT NOT NULL,
    submission_revision INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (player_id,request_key),
    FOREIGN KEY (registration_id,player_id,season_id) REFERENCES player_season_registrations(id,player_id,season_id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE roster_change_windows ADD COLUMN is_cancelled TINYINT NOT NULL DEFAULT 0;
ALTER TABLE player_season_registrations ADD COLUMN review_profile_snapshot JSON DEFAULT NULL;
ALTER TABLE player_notifications ADD COLUMN season_id INT DEFAULT NULL;
ALTER TABLE player_notifications ADD CONSTRAINT fk_player_notification_season FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT;

-- TEAM_APPLICATION_WORKFLOW_0015: full initialization only
ALTER TABLE team ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE team_applications ADD COLUMN submitted_snapshot JSON DEFAULT NULL;
ALTER TABLE team_applications ADD COLUMN return_snapshot JSON DEFAULT NULL;
ALTER TABLE team_applications ADD COLUMN member_comments JSON DEFAULT NULL;
ALTER TABLE team_applications ADD COLUMN request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;
ALTER TABLE team_applications ADD COLUMN request_hash CHAR(64) CHARACTER SET ascii DEFAULT NULL;
ALTER TABLE team_application_members ADD COLUMN is_removed TINYINT NOT NULL DEFAULT 0;
ALTER TABLE team_application_members ADD COLUMN active_application_id INT GENERATED ALWAYS AS (CASE WHEN is_removed=0 THEN application_id ELSE NULL END) STORED;
ALTER TABLE team_role_change_requests ADD COLUMN team_revision INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE team_role_change_requests ADD COLUMN request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL;
ALTER TABLE team_role_change_requests ADD COLUMN request_hash CHAR(64) CHARACTER SET ascii DEFAULT NULL;
ALTER TABLE team_role_change_requests ADD COLUMN profile_snapshot JSON DEFAULT NULL;
ALTER TABLE team_application_members MODIFY jersey_number VARCHAR(20) DEFAULT NULL;
ALTER TABLE team_application_members ADD INDEX idx_member_application (application_id,is_removed,id);
ALTER TABLE team_applications ADD UNIQUE INDEX uq_team_draft_request (manager_player_id,request_key);
ALTER TABLE team_application_members ADD UNIQUE INDEX uq_team_active_member (active_application_id,player_id);
ALTER TABLE team_application_members ADD UNIQUE INDEX uq_team_active_number (active_application_id,jersey_number);
ALTER TABLE team_role_change_requests ADD UNIQUE INDEX uq_team_role_request (requested_by_player_id,request_key);
ALTER TABLE team_application_members DROP INDEX uq_application_player, DROP INDEX uq_application_number;
CREATE TABLE IF NOT EXISTS team_role_change_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  request_id INT NOT NULL,
  revision INT UNSIGNED NOT NULL,
  operation VARCHAR(40) NOT NULL,
  actor_player_id INT DEFAULT NULL,
  actor_admin_id INT DEFAULT NULL,
  reason VARCHAR(500) DEFAULT NULL,
  before_snapshot JSON DEFAULT NULL,
  after_snapshot JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_team_role_event (request_id,revision),
  FOREIGN KEY (request_id) REFERENCES team_role_change_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
  CHECK ((actor_player_id IS NOT NULL)+(actor_admin_id IS NOT NULL)=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ROSTER_CHANGES_0016: full initialization only
ALTER TABLE team_applications ADD COLUMN source_type ENUM('online','admin_import') NOT NULL DEFAULT 'online';
ALTER TABLE team_applications ADD COLUMN base_team_revision INT UNSIGNED DEFAULT NULL;
ALTER TABLE team_applications ADD COLUMN base_snapshot JSON DEFAULT NULL;
ALTER TABLE team_applications ADD COLUMN created_by_admin_id INT DEFAULT NULL;
ALTER TABLE team_applications ADD COLUMN import_file_name VARCHAR(255) DEFAULT NULL;
ALTER TABLE team_applications ADD COLUMN open_change_team_id INT GENERATED ALWAYS AS (CASE WHEN kind='roster_change' AND status IN ('draft','pending','returned') THEN team_id ELSE NULL END) STORED;
ALTER TABLE team_application_members ADD COLUMN remark VARCHAR(255) DEFAULT NULL;
ALTER TABLE team_roster_batches ADD COLUMN metadata_snapshot JSON DEFAULT NULL;
ALTER TABLE team_applications ADD UNIQUE INDEX uq_open_roster_change (open_change_team_id);
ALTER TABLE team_applications ADD UNIQUE INDEX uq_admin_import_request (created_by_admin_id,request_key);
CREATE TABLE IF NOT EXISTS match_roster_selections (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS match_roster_selection_events (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 第五批：赛季结束材料清理审计
CREATE TABLE IF NOT EXISTS player_material_cleanup_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  season_id INT NOT NULL, file_id BIGINT UNSIGNED DEFAULT NULL, actor_admin_id INT NOT NULL,
  operation VARCHAR(30) NOT NULL, message VARCHAR(500) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT,
  FOREIGN KEY (file_id) REFERENCES player_registration_files(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referee_match_signups (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS referee_match_signup_events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    signup_id INT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    operation ENUM('signup','update','withdraw','reapply') NOT NULL,
    before_snapshot JSON DEFAULT NULL,
    after_snapshot JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_signup_event_revision (signup_id,revision),
    FOREIGN KEY (signup_id) REFERENCES referee_match_signups(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS competition_discipline_events (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 学院目录匹配的原始值留档（账号资料变更不修改历史审核快照）
CREATE TABLE IF NOT EXISTS account_college_normalizations (
  account_role ENUM('player','referee') NOT NULL,
  account_id INT NOT NULL,
  original_college VARCHAR(100) NULL,
  matched_college VARCHAR(100) NULL,
  match_method VARCHAR(20) NOT NULL,
  changed TINYINT NOT NULL DEFAULT 0,
  account_revision_before INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(account_role,account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 球员学院变更审核：仅新增申请及审计表
CREATE TABLE IF NOT EXISTS player_college_changes (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS player_college_change_events (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time legacy account standardization audit (0027).
CREATE TABLE IF NOT EXISTS account_college_standardizations (
      account_role ENUM('player','referee') NOT NULL,
      account_id INT NOT NULL,
      original_college VARCHAR(100) NULL,
      matched_college VARCHAR(100) NULL,
      match_method VARCHAR(20) NOT NULL,
      changed TINYINT NOT NULL DEFAULT 0,
      account_revision_before INT UNSIGNED NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY(account_role,account_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player account gender and competition-specific roster tags (0030).
ALTER TABLE player_accounts ADD COLUMN gender ENUM('male','female') DEFAULT NULL;
ALTER TABLE season_competitions ADD COLUMN enable_sports_training TINYINT NOT NULL DEFAULT 1;
ALTER TABLE season_competitions ADD COLUMN enable_football_specialty TINYINT NOT NULL DEFAULT 0;
ALTER TABLE season_competitions ADD COLUMN max_football_specialty_players INT UNSIGNED DEFAULT NULL;
ALTER TABLE season_competitions ADD COLUMN combined_player_limits JSON DEFAULT NULL;
ALTER TABLE team_application_members ADD COLUMN is_football_specialty TINYINT NOT NULL DEFAULT 0;
ALTER TABLE team_player ADD COLUMN is_football_specialty TINYINT NOT NULL DEFAULT 0;
