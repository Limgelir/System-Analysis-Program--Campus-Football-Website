// 自包含迁移；旧岗位列保留为系统账号兼容镜像，不删除历史记录。
const roles = [
  ['main', 'main_referee_id', 'main_referee_name_snapshot'],
  ['assistant1', 'assistant1_id', 'assistant1_name_snapshot'],
  ['assistant2', 'assistant2_id', 'assistant2_name_snapshot'],
  ['fourth', 'fourth_official_id', 'fourth_official_name_snapshot'],
  ['supervisor', 'supervisor_id', 'supervisor_name_snapshot']
];
async function addColumn(c, table, column, definition) {
  const [rows] = await c.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [table, column]);
  if (!rows.length) await c.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
async function addForeignKey(c, table, name, column) {
  const [rows] = await c.execute('SELECT CONSTRAINT_NAME FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?', [table, name]);
  if (!rows.length) await c.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${column}) REFERENCES match_official_assignments(id) ON DELETE RESTRICT`);
}
module.exports = {
  version: '0009', name: 'external_official_assignments',
  description: '独立非系统裁判名单、统一岗位及统计评分关联，保留旧列和历史姓名',
  rollback: '迁移前备份数据库与上传文件；停服迁移，保留旧列；出现问题先停止发布并前向修复，不删除历史岗位或评分。',
  async up(c) {
    await c.query(`CREATE TABLE IF NOT EXISTS external_referees (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS match_official_assignments (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    for (const [role, field, snapshot] of roles) {
      await c.query(`INSERT INTO match_official_assignments
        (schedule_id, role, source_type, referee_id, name_snapshot, created_at, updated_at)
        SELECT s.id, '${role}', 'system', s.${field}, COALESCE(s.${snapshot}, r.name), s.created_at, s.updated_at
        FROM match_schedules s INNER JOIN referee r ON r.id = s.${field}
        WHERE NOT EXISTS (SELECT 1 FROM match_official_assignments a WHERE a.schedule_id = s.id AND a.role = '${role}')`);
    }
    await addColumn(c, 'match_referee_stats', 'assignment_id', 'INT DEFAULT NULL');
    await addColumn(c, 'match_referee_reviews', 'target_assignment_id', 'INT DEFAULT NULL');
    await addColumn(c, 'match_referee_reviews', 'reviewer_assignment_id', 'INT DEFAULT NULL');
    await c.query('ALTER TABLE match_referee_stats MODIFY referee_id INT NULL');
    await c.query('ALTER TABLE match_referee_reviews MODIFY target_referee_id INT NULL');
    // 不将异常历史数据悄悄关联给其他人；发生不一致时拒绝继续。
    await c.query(`UPDATE match_referee_stats st JOIN match_reports r ON r.id = st.report_id
      JOIN match_official_assignments a ON a.schedule_id = r.schedule_id AND a.role = st.role AND a.referee_id = st.referee_id
      SET st.assignment_id = a.id, st.updated_at = st.updated_at WHERE st.assignment_id IS NULL`);
    await c.query(`UPDATE match_referee_reviews rv JOIN match_reports r ON r.id = rv.report_id
      JOIN match_official_assignments a ON a.schedule_id = r.schedule_id AND a.role = rv.target_role AND a.referee_id = rv.target_referee_id
      JOIN match_official_assignments sup ON sup.schedule_id = r.schedule_id AND sup.role = 'supervisor' AND sup.referee_id = rv.reviewer_referee_id
      SET rv.target_assignment_id = a.id, rv.reviewer_assignment_id = sup.id, rv.updated_at = rv.updated_at
      WHERE rv.target_assignment_id IS NULL OR rv.reviewer_assignment_id IS NULL`);
    const [[invalid]] = await c.query(`SELECT
      (SELECT COUNT(*) FROM match_referee_stats WHERE assignment_id IS NULL) +
      (SELECT COUNT(*) FROM match_referee_reviews WHERE target_assignment_id IS NULL OR reviewer_assignment_id IS NULL) AS total`);
    if (Number(invalid.total)) throw new Error('历史统计或评分与赛程岗位不一致，请检查备份和审计结果后再迁移');
    await addForeignKey(c, 'match_referee_stats', 'fk_stats_assignment', 'assignment_id');
    await addForeignKey(c, 'match_referee_reviews', 'fk_reviews_target_assignment', 'target_assignment_id');
    await addForeignKey(c, 'match_referee_reviews', 'fk_reviews_reviewer_assignment', 'reviewer_assignment_id');
    await c.query('ALTER TABLE match_referee_stats MODIFY assignment_id INT NOT NULL');
    await c.query('ALTER TABLE match_referee_reviews MODIFY target_assignment_id INT NOT NULL, MODIFY reviewer_assignment_id INT NOT NULL');
  }
};
