const suffix = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const tables = [
  `CREATE TABLE IF NOT EXISTS player_season_setting_events (
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
  )`,
  `CREATE TABLE IF NOT EXISTS player_registration_requests (
    player_id INT NOT NULL,
    request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    season_id INT NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii NOT NULL,
    registration_id INT NOT NULL,
    submission_revision INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (player_id,request_key),
    FOREIGN KEY (registration_id,player_id,season_id) REFERENCES player_season_registrations(id,player_id,season_id) ON DELETE RESTRICT
  )`
].map(sql=>sql+suffix);
const columns = [
  ['roster_change_windows','is_cancelled','TINYINT NOT NULL DEFAULT 0'],
  ['player_season_registrations','review_profile_snapshot','JSON DEFAULT NULL'],
  ['player_notifications','season_id','INT DEFAULT NULL']
];
module.exports = {
  version:'0014',name:'player_registration_workflow',
  description:'个人学籍注册与私有材料工作流：提交幂等、审核资料快照、赛季配置审计及窗口取消记录',
  rollback:'升级前配套备份数据库和上传目录；不修改0013，不重建旧数据。DDL不能整体回滚，失败后检查结构并重试。保留申请、材料和审核记录，优先前向修复。',
  tables,columns,
  async up(c) {
    for(const sql of tables)await c.query(sql);
    for(const [table,column,definition] of columns){
      const [[found]]=await c.execute('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
      if(!found.n)await c.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    const [[fk]]=await c.execute("SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='player_notifications' AND CONSTRAINT_NAME='fk_player_notification_season'");
    if(!fk.n)await c.query('ALTER TABLE player_notifications ADD CONSTRAINT fk_player_notification_season FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT');
  }
};
