const tables=[`CREATE TABLE IF NOT EXISTS player_material_cleanup_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  season_id INT NOT NULL, file_id BIGINT UNSIGNED DEFAULT NULL, actor_admin_id INT NOT NULL,
  operation VARCHAR(30) NOT NULL, message VARCHAR(500) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT,
  FOREIGN KEY (file_id) REFERENCES player_registration_files(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_admin_id) REFERENCES admin(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`];
module.exports={version:'0017',name:'public_results_and_cleanup',description:'公开正式结果与赛季学籍材料清理审计',rollback:'保留发布和清理审计，优先前向修复；清理后的文件仅能从既有备份恢复。',tables,
  async up(c){
    for(const sql of tables)await c.query(sql);
    // 历史只采用已正式提交/管理员内容修订快照，不能读取退回后正在填写的当前报告。
    const [rows]=await c.query(`SELECT h.* FROM report_section_history h LEFT JOIN match_publications p ON p.report_id=h.report_id
      WHERE h.section='main' AND (h.operation='submit' OR (h.operation='revise' AND h.source_type='admin_revision') OR (h.operation='baseline' AND JSON_UNQUOTE(JSON_EXTRACT(h.after_snapshot,'$.status'))='submitted')) AND p.report_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM report_section_history n WHERE n.report_id=h.report_id AND n.section='main' AND n.revision>h.revision AND (n.operation='submit' OR (n.operation='revise' AND n.source_type='admin_revision') OR (n.operation='baseline' AND JSON_UNQUOTE(JSON_EXTRACT(n.after_snapshot,'$.status'))='submitted')))
      ORDER BY h.report_id`);
    for(const row of rows){
      const snapshot=typeof row.after_snapshot==='string'?JSON.parse(row.after_snapshot):row.after_snapshot,data=snapshot.data,goals=[];
      for(const g of data.goals||[]){const [[p]]=await c.execute('SELECT player_account_id FROM team_player WHERE id=?',[g.team_player_id]);goals.push({player_id:p?.player_account_id||null,team_id:g.player_team_id,credited_team_id:g.credited_team_id,player_name:g.player_name,jersey_number:g.player_jersey_number,goal_type:g.goal_type,minute_label:g.minute_label});}
      const result={home_score:data.home_score,away_score:data.away_score,home_penalty_score:data.home_penalty_score,away_penalty_score:data.away_penalty_score,goals};
      await c.execute('INSERT INTO match_publications (report_id,source_history_id,version_no,result_snapshot,published_at) VALUES (?,?,?,?,NOW(3)) ON DUPLICATE KEY UPDATE source_history_id=VALUES(source_history_id),version_no=VALUES(version_no),result_snapshot=VALUES(result_snapshot)',[row.report_id,row.id,row.version_no,JSON.stringify(result)]);
    }
  }
};
