// 自包含增量迁移。保留旧内容/时间；无法证明的历史提交人明确记为未知。
module.exports = {
  version: '0011',
  name: 'report_revision_history',
  description: '报告分区退回、修订、并发版本及追加式前后快照',
  rollback: '先备份数据库与上传文件并停止写入；历史只能追加，不回写旧迁移、不删除版本。失败后检查现场并前向修复。',
  async up(c) {
    await c.query("ALTER TABLE match_reports MODIFY main_report_status ENUM('draft','submitted','returned') NOT NULL DEFAULT 'draft', MODIFY supervisor_review_status ENUM('draft','submitted','returned') NOT NULL DEFAULT 'draft'");
    await c.query(`CREATE TABLE IF NOT EXISTS report_section_states (
      report_id INT NOT NULL,
      section ENUM('main','supervisor') NOT NULL,
      revision INT UNSIGNED NOT NULL DEFAULT 0,
      version_no INT UNSIGNED NOT NULL DEFAULT 0,
      original_submission JSON DEFAULT NULL,
      last_submission JSON DEFAULT NULL,
      return_reason VARCHAR(500) DEFAULT NULL,
      returned_at DATETIME(3) DEFAULT NULL,
      returned_by_admin_id INT DEFAULT NULL,
      PRIMARY KEY (report_id,section),
      FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE RESTRICT,
      FOREIGN KEY (returned_by_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS report_section_history (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      report_id INT NOT NULL,
      section ENUM('main','supervisor') NOT NULL,
      revision INT UNSIGNED NOT NULL,
      version_no INT UNSIGNED NOT NULL,
      operation ENUM('baseline','save','submit','return','revise','upload_image','remove_image') NOT NULL,
      source_type ENUM('legacy','referee','admin_proxy','admin_revision') NOT NULL,
      actor_admin_id INT DEFAULT NULL,
      actor_referee_id INT DEFAULT NULL,
      actor_name_snapshot VARCHAR(100) DEFAULT NULL,
      reason VARCHAR(500) DEFAULT NULL,
      before_snapshot JSON DEFAULT NULL,
      after_snapshot JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_report_section_revision (report_id,section,revision),
      FOREIGN KEY (report_id) REFERENCES match_reports(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_referee_id) REFERENCES referee(id) ON DELETE RESTRICT,
      CONSTRAINT chk_history_actor CHECK (
        (source_type='legacy' AND actor_admin_id IS NULL AND actor_referee_id IS NULL) OR
        (source_type='referee' AND actor_referee_id IS NOT NULL AND actor_admin_id IS NULL) OR
        (source_type IN ('admin_proxy','admin_revision') AND actor_admin_id IS NOT NULL AND actor_referee_id IS NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    // 每场提交基线在自己的事务内形成，重试不重复，不改变旧报告 updated_at。
    const [reports] = await c.query('SELECT * FROM match_reports ORDER BY id');
    for (const report of reports) {
      for (const section of ['main','supervisor']) {
        const [[exists]] = await c.execute('SELECT report_id FROM report_section_states WHERE report_id=? AND section=?', [report.id,section]);
        if (exists) continue;
        const prefix = section === 'main' ? 'main_report' : 'supervisor_review';
        const [officials] = await c.execute('SELECT id,role,source_type,referee_id,external_referee_id,name_snapshot FROM match_official_assignments WHERE schedule_id=? ORDER BY id', [report.schedule_id]);
        const owner = officials.find(a => a.role === section) || null;
        const [[match]] = await c.execute('SELECT id,season_id,match_type,match_date,field_order,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot FROM match_schedules WHERE id=?',[report.schedule_id]);
        let data;
        if (section === 'main') {
          const [stats] = await c.execute('SELECT * FROM match_referee_stats WHERE report_id=? ORDER BY id',[report.id]);
          const [cards] = await c.execute('SELECT c.*, p.player_name,p.jersey_number AS player_jersey_number FROM match_cards c JOIN team_player p ON p.id=c.team_player_id WHERE c.report_id=? ORDER BY c.id',[report.id]);
          const [goals] = await c.execute('SELECT g.*, p.player_name,p.jersey_number AS player_jersey_number FROM match_goals g JOIN team_player p ON p.id=g.team_player_id WHERE g.report_id=? ORDER BY g.id',[report.id]);
          data = {home_score:report.home_score,away_score:report.away_score,home_penalty_score:report.home_penalty_score,away_penalty_score:report.away_penalty_score,fourth_official_image_path:report.fourth_official_image_path,stats,cards,goals};
        } else {
          const [reviews] = await c.execute('SELECT * FROM match_referee_reviews WHERE report_id=? ORDER BY id',[report.id]);
          data = {reviews};
        }
        const snapshot = {section,status:report[`${prefix}_status`],started_at:report[`${prefix}_started_at`],submitted_at:report[`${prefix}_submitted_at`],owner,match,officials,data};
        const submitted = snapshot.status === 'submitted';
        let submission = null;
        if (submitted) {
          const [[event]] = await c.execute('SELECT actor_referee_id,actor_admin_id,actor_name_snapshot,source_type,created_at FROM report_actor_events WHERE report_id=? AND operation=? ORDER BY id LIMIT 1',[report.id,section === 'main' ? 'submit_main':'submit_supervisor']);
          submission = {owner,submitted_at:snapshot.submitted_at,actor:event || null,legacy_actor_unknown:!event};
        }
        const materialized = submitted || snapshot.started_at || snapshot.submitted_at ||
          (section === 'main' ? data.stats.length || data.cards.length || data.goals.length || data.fourth_official_image_path || data.home_score || data.away_score || data.home_penalty_score || data.away_penalty_score : data.reviews.length);
        await c.beginTransaction();
        try {
          await c.execute('INSERT INTO report_section_states (report_id,section,version_no,original_submission,last_submission) VALUES (?,?,?,?,?)',[report.id,section,submitted?1:0,submission?JSON.stringify(submission):null,submission?JSON.stringify(submission):null]);
          if (materialized) await c.execute(`INSERT INTO report_section_history (report_id,section,revision,version_no,operation,source_type,reason,after_snapshot)
            VALUES (?,?,0,?,'baseline','legacy',?,?)`,[report.id,section,submitted?1:0,'阶段 8 升级时保留的现存基线；不代表更早版本可恢复',JSON.stringify(snapshot)]);
          await c.commit();
        } catch (error) { await c.rollback(); throw error; }
      }
    }
  }
};
