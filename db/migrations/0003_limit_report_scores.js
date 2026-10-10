module.exports = {
  version: '0003',
  name: 'limit_report_scores',
  description: '将正常比分和点球大战比分限制为 0 到 30，避免异常大比分造成报告页面资源耗尽',
  rollback: '执行 ALTER TABLE match_reports DROP CHECK chk_match_report_score_maximum 可移除上限；应用层仍会继续拒绝超限比分。',
  async up(connection) {
    const [invalidRows] = await connection.query(`
      SELECT id
        FROM match_reports
       WHERE home_score > 30
          OR away_score > 30
          OR home_penalty_score > 30
          OR away_penalty_score > 30
       LIMIT 1
    `);

    if (invalidRows.length > 0) {
      throw new Error(`match_reports 存在超过 30 的比分（示例报告 ID: ${invalidRows[0].id}），请先人工核对并修正`);
    }

    const [constraints] = await connection.query(`
      SELECT constraint_name AS constraintName
        FROM information_schema.table_constraints
       WHERE constraint_schema = DATABASE()
         AND table_name = 'match_reports'
         AND constraint_type = 'CHECK'
         AND constraint_name = 'chk_match_report_score_maximum'
    `);

    if (constraints.length === 0) {
      await connection.query(`
        ALTER TABLE match_reports
        ADD CONSTRAINT chk_match_report_score_maximum CHECK (
          home_score <= 30 AND away_score <= 30 AND
          home_penalty_score <= 30 AND away_penalty_score <= 30
        )
      `);
    }
  }
};
