async function column(c,table,name,type){
  const [[row]]=await c.query('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,name]);
  if(!row.n)await c.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
async function index(c,name,columns){
  const [[row]]=await c.query("SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_official_assignments' AND INDEX_NAME=?",[name]);
  if(!row.n)await c.query(`ALTER TABLE match_official_assignments ADD UNIQUE KEY ${name} (${columns})`);
}
module.exports={version:'0022',name:'optional_supervisors',description:'逐场选择监督需求，监督兼任场上岗位与非系统监督代填；旧比赛保留需要监督',
  rollback:'备份后增量升级。保留原账号、岗位ID和报告历史；出现问题先前向修复，不能删除历史或清空数据库。',
  async up(c){
    await column(c,'match_schedules','supervisor_required','TINYINT(1) NOT NULL DEFAULT 1');
    const [[check]]=await c.query("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND CONSTRAINT_NAME='chk_supervisor_required'");
    if(!check.n)await c.query('ALTER TABLE match_schedules ADD CONSTRAINT chk_supervisor_required CHECK (supervisor_required IN (0,1))');
    const [[fieldCheck]]=await c.query("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND CONSTRAINT_NAME='chk_schedule_field_referees_distinct'");
    if(!fieldCheck.n)await c.query(`ALTER TABLE match_schedules ADD CONSTRAINT chk_schedule_field_referees_distinct CHECK (
      (main_referee_id IS NULL OR assistant1_id IS NULL OR main_referee_id<>assistant1_id) AND
      (main_referee_id IS NULL OR assistant2_id IS NULL OR main_referee_id<>assistant2_id) AND
      (main_referee_id IS NULL OR fourth_official_id IS NULL OR main_referee_id<>fourth_official_id) AND
      (assistant1_id IS NULL OR assistant2_id IS NULL OR assistant1_id<>assistant2_id) AND
      (assistant1_id IS NULL OR fourth_official_id IS NULL OR assistant1_id<>fourth_official_id) AND
      (assistant2_id IS NULL OR fourth_official_id IS NULL OR assistant2_id<>fourth_official_id))`);
    const [[distinct]]=await c.query("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND CONSTRAINT_NAME='chk_schedule_referee_distinct'");
    if(distinct.n)await c.query('ALTER TABLE match_schedules DROP CHECK chk_schedule_referee_distinct');
    await column(c,'match_official_assignments','field_referee_id',"INT GENERATED ALWAYS AS (CASE WHEN role <> 'supervisor' THEN referee_id ELSE NULL END) STORED");
    await column(c,'match_official_assignments','field_external_referee_id',"INT GENERATED ALWAYS AS (CASE WHEN role <> 'supervisor' THEN external_referee_id ELSE NULL END) STORED");
    await index(c,'uq_official_field_system','schedule_id,field_referee_id');
    await index(c,'uq_official_field_external','schedule_id,field_external_referee_id');
    for(const name of ['uq_official_system_person','uq_official_external_person']){
      const [[row]]=await c.query("SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_official_assignments' AND INDEX_NAME=?",[name]);
      if(row.n)await c.query(`ALTER TABLE match_official_assignments DROP INDEX ${name}`);
    }
    const [[old]]=await c.query("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='match_official_assignments' AND CONSTRAINT_NAME='chk_official_supervisor'");
    if(old.n)await c.query('ALTER TABLE match_official_assignments DROP CHECK chk_official_supervisor');
    await c.query('ALTER TABLE match_referee_reviews MODIFY reviewer_referee_id INT NULL');
  }
};
