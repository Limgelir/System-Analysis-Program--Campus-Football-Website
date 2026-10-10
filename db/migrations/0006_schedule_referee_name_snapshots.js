const SNAPSHOT_COLUMNS = [
  ['main_referee_name_snapshot', '主裁姓名快照'],
  ['assistant1_name_snapshot', '助理裁判1姓名快照'],
  ['assistant2_name_snapshot', '助理裁判2姓名快照'],
  ['fourth_official_name_snapshot', '第四官员姓名快照'],
  ['supervisor_name_snapshot', '比赛监督姓名快照']
];

module.exports = {
  version: '0006',
  name: 'schedule_referee_name_snapshots',
  description: '为赛程五个裁判岗位保存选派时的赛季注册姓名快照，避免账号改名、停用或赛季切换改变历史显示',
  rollback: '执行前备份数据库。若必须回退且已确认无需保留历史姓名，可逐一删除 match_schedules 的五个 *_name_snapshot 字段；应用回退前不得删除。',
  async up(connection) {
    const [existingRows] = await connection.query(`
      SELECT column_name AS columnName
        FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'match_schedules'
    `);
    const existing = new Set(existingRows.map(row => row.columnName));

    for (const [columnName, comment] of SNAPSHOT_COLUMNS) {
      if (!existing.has(columnName)) {
        await connection.query(
          `ALTER TABLE match_schedules ADD COLUMN ${columnName} VARCHAR(100) DEFAULT NULL COMMENT '${comment}' AFTER supervisor_id`
        );
      }
    }

    await connection.query(`
      UPDATE match_schedules s
      LEFT JOIN referee main_ref ON main_ref.id = s.main_referee_id
      LEFT JOIN referee assistant1_ref ON assistant1_ref.id = s.assistant1_id
      LEFT JOIN referee assistant2_ref ON assistant2_ref.id = s.assistant2_id
      LEFT JOIN referee fourth_ref ON fourth_ref.id = s.fourth_official_id
      LEFT JOIN referee supervisor_ref ON supervisor_ref.id = s.supervisor_id
         SET s.main_referee_name_snapshot = COALESCE(s.main_referee_name_snapshot, main_ref.name),
             s.assistant1_name_snapshot = COALESCE(s.assistant1_name_snapshot, assistant1_ref.name),
             s.assistant2_name_snapshot = COALESCE(s.assistant2_name_snapshot, assistant2_ref.name),
             s.fourth_official_name_snapshot = COALESCE(s.fourth_official_name_snapshot, fourth_ref.name),
             s.supervisor_name_snapshot = COALESCE(s.supervisor_name_snapshot, supervisor_ref.name)
    `);
  }
};
