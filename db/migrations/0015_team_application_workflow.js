const suffix=' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const columns=[
  ['team','revision','INT UNSIGNED NOT NULL DEFAULT 0'],
  ['team_applications','submitted_snapshot','JSON DEFAULT NULL'],
  ['team_applications','return_snapshot','JSON DEFAULT NULL'],
  ['team_applications','member_comments','JSON DEFAULT NULL'],
  ['team_applications','request_key','CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL'],
  ['team_applications','request_hash','CHAR(64) CHARACTER SET ascii DEFAULT NULL'],
  ['team_application_members','is_removed','TINYINT NOT NULL DEFAULT 0'],
  ['team_application_members','active_application_id','INT GENERATED ALWAYS AS (CASE WHEN is_removed=0 THEN application_id ELSE NULL END) STORED'],
  ['team_role_change_requests','team_revision','INT UNSIGNED NOT NULL DEFAULT 0'],
  ['team_role_change_requests','request_key','CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL'],
  ['team_role_change_requests','request_hash','CHAR(64) CHARACTER SET ascii DEFAULT NULL'],
  ['team_role_change_requests','profile_snapshot','JSON DEFAULT NULL']
];
const indexes=[
  ['team_application_members','idx_member_application','INDEX idx_member_application (application_id,is_removed,id)'],
  ['team_applications','uq_team_draft_request','UNIQUE INDEX uq_team_draft_request (manager_player_id,request_key)'],
  ['team_application_members','uq_team_active_member','UNIQUE INDEX uq_team_active_member (active_application_id,player_id)'],
  ['team_application_members','uq_team_active_number','UNIQUE INDEX uq_team_active_number (active_application_id,jersey_number)'],
  ['team_role_change_requests','uq_team_role_request','UNIQUE INDEX uq_team_role_request (requested_by_player_id,request_key)']
];
const tables=[`CREATE TABLE IF NOT EXISTS team_role_change_events (
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
)`+suffix];
const alterations=[
  'ALTER TABLE team_application_members MODIFY jersey_number VARCHAR(20) DEFAULT NULL'
];
module.exports={version:'0015',name:'team_application_workflow',description:'球队草稿与审核、受限补正、正式角色变更审计及并发版本',
  rollback:'增量保留旧数据，升级前配套备份。DDL失败核对后重试，优先前向修复；不得删除已提交申请或正式名单来回退。',columns,indexes,tables,alterations,
  async up(c){
    for(const [table,column,definition]of columns){const [[r]]=await c.execute('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);if(!r.n)await c.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);}
    for(const sql of alterations)await c.query(sql);
    for(const [table,name,definition]of indexes){const [[r]]=await c.execute('SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',[table,name]);if(!r.n)await c.query(`ALTER TABLE ${table} ADD ${definition}`);}
    for(const name of ['uq_application_player','uq_application_number']){const [[r]]=await c.execute("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='team_application_members' AND INDEX_NAME=?",[name]);if(r.n)await c.query(`ALTER TABLE team_application_members DROP INDEX ${name}`);}
    for(const sql of tables)await c.query(sql);
  }
};
