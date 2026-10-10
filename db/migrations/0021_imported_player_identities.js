const suffix=' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const tables=[`CREATE TABLE IF NOT EXISTS imported_player_identities (
  id INT PRIMARY KEY AUTO_INCREMENT,
  season_id INT NOT NULL,
  student_id VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  player_id INT DEFAULT NULL,
  created_by_admin_id INT NOT NULL,
  linked_registration_id INT DEFAULT NULL,
  linked_by_admin_id INT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL,
  linked_at DATETIME(3) DEFAULT NULL,
  UNIQUE KEY uq_imported_identity (season_id,student_id,name),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT,
  FOREIGN KEY (player_id) REFERENCES player_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
  FOREIGN KEY (linked_registration_id) REFERENCES player_season_registrations(id) ON DELETE RESTRICT,
  FOREIGN KEY (linked_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
)`+suffix];
const columns=[
  ['team','manager_import_person_id'],['team_applications','manager_import_person_id'],
  ['team_application_members','import_person_id'],['team_player','import_person_id']
];
module.exports={version:'0021',name:'imported_player_identities',description:'管理员特殊导入可先录入身份，学籍审核通过后关联账号',
  rollback:'先备份再升级；保留原账号及名单。新导入允许未关联账号，回退必须使用配套数据备份，不得直接运行旧代码。',
  async up(c){
    for(const sql of tables)await c.query(sql);
    await c.query('ALTER TABLE team_applications MODIFY manager_player_id INT DEFAULT NULL');
    await c.query('ALTER TABLE team_application_members MODIFY player_id INT DEFAULT NULL');
    for(const [table,column]of columns){
      const [[exists]]=await c.execute('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
      if(!exists.n)await c.query(`ALTER TABLE ${table} ADD ${column} INT DEFAULT NULL`);
      const key=`fk_${table}_import_person`;
      const [[fk]]=await c.execute('SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?',[table,key]);
      if(!fk.n)await c.query(`ALTER TABLE ${table} ADD CONSTRAINT ${key} FOREIGN KEY (${column}) REFERENCES imported_player_identities(id) ON DELETE RESTRICT`);
    }
  }
};
