module.exports = {
  version: '0029', name: 'main_fourth_dual_role',
  description: '允许裁判员兼任第四官员，保留助理裁判员岗位互斥约束',
  rollback: '增量升级，保留岗位和报告记录；已存在兼任选派时不可直接恢复旧约束，应前向修复。',
  async up(c) {
    const [[check]] = await c.query("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='match_schedules' AND CONSTRAINT_NAME='chk_schedule_field_referees_distinct'");
    await c.query(`ALTER TABLE match_schedules ${check.n ? 'DROP CHECK chk_schedule_field_referees_distinct,' : ''}
      ADD CONSTRAINT chk_schedule_field_referees_distinct CHECK (
        (main_referee_id IS NULL OR assistant1_id IS NULL OR main_referee_id<>assistant1_id) AND
        (main_referee_id IS NULL OR assistant2_id IS NULL OR main_referee_id<>assistant2_id) AND
        (assistant1_id IS NULL OR assistant2_id IS NULL OR assistant1_id<>assistant2_id) AND
        (assistant1_id IS NULL OR fourth_official_id IS NULL OR assistant1_id<>fourth_official_id) AND
        (assistant2_id IS NULL OR fourth_official_id IS NULL OR assistant2_id<>fourth_official_id))`);
    // Two overlapping groups keep both assistants exclusive while main and fourth may share a person.
    for (const [source, person] of [['system','referee_id'],['external','external_referee_id']]) {
      const column = 'fourth_group_' + person, index = 'uq_official_fourth_' + source;
      const [[existingColumn]] = await c.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_official_assignments' AND COLUMN_NAME=?",[column]);
      if (!existingColumn.n) await c.query(`ALTER TABLE match_official_assignments ADD COLUMN ${column} INT GENERATED ALWAYS AS (CASE WHEN role IN ('assistant1','assistant2','fourth') THEN ${person} ELSE NULL END) STORED`);
      const [[existingIndex]] = await c.query("SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_official_assignments' AND INDEX_NAME=?",[index]);
      if (!existingIndex.n) await c.query(`ALTER TABLE match_official_assignments ADD UNIQUE KEY ${index} (schedule_id,${column})`);
      await c.query(`ALTER TABLE match_official_assignments MODIFY field_${person} INT GENERATED ALWAYS AS (CASE WHEN role IN ('main','assistant1','assistant2') THEN ${person} ELSE NULL END) STORED`);
    }
  }
};
