module.exports = {
  version: '0033', name: 'futsal_officials',
  description: '五人制独立裁判岗位、报告数据和报名类型变更历史',
  rollback: '仅增量扩展并保留原有记录；旧应用不能识别五人制岗位，使用前向修复或恢复配套备份。',
  async up(c) {
    async function column(table, name, definition) {
      const [[row]] = await c.execute('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table,name]);
      if (!row.n) await c.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
    await column('match_schedules','futsal','TINYINT(1) NOT NULL DEFAULT 0 CHECK (futsal IN (0,1))');
    for (const role of ['second_referee','timekeeper']) {
      await column('match_schedules',role+'_id','INT NULL');
      await column('match_schedules',role+'_name_snapshot','VARCHAR(100) NULL');
      const [[fk]] = await c.execute('SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?', ['match_schedules','fk_schedule_'+role]);
      if (!fk.n) await c.query(`ALTER TABLE match_schedules ADD CONSTRAINT fk_schedule_${role} FOREIGN KEY (${role}_id) REFERENCES referee(id) ON DELETE RESTRICT`);
    }
    await c.query("ALTER TABLE match_official_assignments MODIFY role ENUM('main','assistant1','assistant2','fourth','supervisor','second','timekeeper') NOT NULL");
    await c.query("ALTER TABLE match_referee_stats MODIFY role ENUM('main','assistant1','assistant2','second') NOT NULL");
    await c.query("ALTER TABLE match_referee_reviews MODIFY target_role ENUM('main','assistant1','assistant2','fourth','second','timekeeper') NOT NULL");
    await c.query("ALTER TABLE referee_match_signup_events MODIFY operation ENUM('signup','update','withdraw','reapply','format_change') NOT NULL");
    for (const person of ['referee_id','external_referee_id']) {
      await c.query(`ALTER TABLE match_official_assignments MODIFY field_${person} INT GENERATED ALWAYS AS (CASE WHEN role IN ('main','assistant1','assistant2','second','timekeeper') THEN ${person} ELSE NULL END) STORED`);
    }
    const [[check]] = await c.query("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND CONSTRAINT_NAME='chk_schedule_futsal'");
    if (!check.n) await c.query(`ALTER TABLE match_schedules ADD CONSTRAINT chk_schedule_futsal CHECK (
      (futsal=0 AND second_referee_id IS NULL AND timekeeper_id IS NULL) OR
      (futsal=1 AND fourth_required=0 AND assistant1_id IS NULL AND assistant2_id IS NULL AND fourth_official_id IS NULL AND
       (main_referee_id IS NULL OR second_referee_id IS NULL OR main_referee_id<>second_referee_id) AND
       (main_referee_id IS NULL OR timekeeper_id IS NULL OR main_referee_id<>timekeeper_id) AND
       (second_referee_id IS NULL OR timekeeper_id IS NULL OR second_referee_id<>timekeeper_id)))`);
    // 撤回的报名允许意向为空；原有行及历史快照保持不变。
    const [checks] = await c.query("SELECT tc.CONSTRAINT_NAME,cc.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='referee_match_signups' AND tc.CONSTRAINT_TYPE='CHECK'");
    for (const row of checks) if (/json_length/i.test(row.CHECK_CLAUSE) && row.CONSTRAINT_NAME !== 'chk_signup_intentions') await c.query('ALTER TABLE referee_match_signups DROP CHECK `'+row.CONSTRAINT_NAME.replaceAll('`','``')+'`');
    if (!checks.some(r=>r.CONSTRAINT_NAME==='chk_signup_intentions')) await c.query("ALTER TABLE referee_match_signups ADD CONSTRAINT chk_signup_intentions CHECK (JSON_TYPE(intentions)='ARRAY' AND JSON_LENGTH(intentions)<=4 AND (status='withdrawn' OR JSON_LENGTH(intentions)>0))");
  }
};
