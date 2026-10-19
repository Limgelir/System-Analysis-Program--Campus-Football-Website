module.exports = {
  version: '0036', name: 'assignment_report_handover',
  description: '选派变更保留报告操作人的原岗位快照，并记录分区交接历史',
  rollback: '保留历史快照与新增枚举，使用前向修复；发布前备份数据库。',
  async up(c) {
    const [columns] = await c.query("SHOW COLUMNS FROM report_actor_events LIKE 'owner_assignment_snapshot'");
    if (!columns.length) await c.query('ALTER TABLE report_actor_events ADD owner_assignment_snapshot JSON DEFAULT NULL');
    await c.query(`UPDATE report_actor_events e JOIN match_official_assignments a ON a.id=e.owner_assignment_id
      SET e.owner_assignment_snapshot=JSON_OBJECT('id',a.id,'role',a.role,'source_type',a.source_type,
      'referee_id',a.referee_id,'external_referee_id',a.external_referee_id,'name_snapshot',a.name_snapshot)
      WHERE e.owner_assignment_snapshot IS NULL`);
    const [keys] = await c.query(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='report_actor_events' AND COLUMN_NAME='owner_assignment_id' AND REFERENCED_TABLE_NAME IS NOT NULL`);
    for (const key of keys) await c.query('ALTER TABLE report_actor_events DROP FOREIGN KEY `' + key.CONSTRAINT_NAME.replace(/`/g,'``') + '`');
    await c.query('ALTER TABLE report_actor_events MODIFY owner_assignment_id INT DEFAULT NULL');
    await c.query('ALTER TABLE report_actor_events ADD CONSTRAINT fk_actor_assignment_history FOREIGN KEY (owner_assignment_id) REFERENCES match_official_assignments(id) ON DELETE SET NULL');
    await c.query("ALTER TABLE report_section_history MODIFY operation ENUM('baseline','save','submit','return','revise','upload_image','remove_image','reassign') NOT NULL, MODIFY source_type ENUM('legacy','referee','admin_proxy','admin_revision','admin_assignment') NOT NULL");
    const [checks] = await c.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='report_section_history' AND CONSTRAINT_NAME='chk_history_actor'");
    if (checks.length) await c.query('ALTER TABLE report_section_history DROP CHECK chk_history_actor');
    await c.query(`ALTER TABLE report_section_history ADD CONSTRAINT chk_history_actor CHECK (
      (source_type='legacy' AND actor_admin_id IS NULL AND actor_referee_id IS NULL) OR
      (source_type='referee' AND actor_referee_id IS NOT NULL AND actor_admin_id IS NULL) OR
      (source_type IN ('admin_proxy','admin_revision','admin_assignment') AND actor_admin_id IS NOT NULL AND actor_referee_id IS NULL))`);
  }
};
