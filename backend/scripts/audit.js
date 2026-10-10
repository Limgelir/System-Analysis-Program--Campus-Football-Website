const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { UPLOAD_ROOT } = require('../utils/uploadPaths');

const checks = [
  {name:'裁判报名当前状态与追加历史一致',sql:`SELECT COUNT(*) issue_count FROM referee_match_signups ms LEFT JOIN referee_match_signup_events e ON e.signup_id=ms.id AND e.revision=ms.revision WHERE e.id IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(e.after_snapshot,'$.status'))<>ms.status OR NOT(JSON_EXTRACT(e.after_snapshot,'$.intentions')<=>ms.intentions) OR ms.revision<>(SELECT COUNT(*) FROM referee_match_signup_events h WHERE h.signup_id=ms.id)`},
  {name:'裁判报名意向合法且不重复',sql:`SELECT COUNT(*) issue_count FROM referee_match_signups WHERE JSON_TYPE(intentions)<>'ARRAY' OR JSON_LENGTH(intentions) NOT BETWEEN 1 AND 4 OR NOT JSON_CONTAINS(JSON_ARRAY('main','assistant','fourth','supervisor'),intentions) OR JSON_LENGTH(intentions)<>(JSON_CONTAINS(intentions,JSON_QUOTE('main'))+JSON_CONTAINS(intentions,JSON_QUOTE('assistant'))+JSON_CONTAINS(intentions,JSON_QUOTE('fourth'))+JSON_CONTAINS(intentions,JSON_QUOTE('supervisor')))`},
  {name:'新正式名单的永久身份与审核快照一致',sql:`SELECT COUNT(*) AS issue_count FROM team_player p JOIN team_roster_batches b ON b.id=p.roster_batch_id LEFT JOIN imported_player_identities i ON i.id=p.import_person_id WHERE b.source_type IN ('online','admin_import') AND IF(p.import_person_id IS NOT NULL,
    i.id IS NULL OR i.season_id<>b.season_id OR NOT(p.player_account_id<=>i.player_id) OR NOT(i.student_id<=>JSON_UNQUOTE(JSON_EXTRACT(p.profile_snapshot,'$.student_id'))) OR NOT(i.name<=>JSON_UNQUOTE(JSON_EXTRACT(p.profile_snapshot,'$.name'))),
    p.player_account_id IS NULL OR JSON_EXTRACT(p.profile_snapshot,'$.id') IS NULL OR CAST(JSON_UNQUOTE(JSON_EXTRACT(p.profile_snapshot,'$.id')) AS UNSIGNED)<>p.player_account_id)`},
  {name:'导入身份关联有相符的当季学籍审核依据',sql:`SELECT COUNT(*) AS issue_count FROM imported_player_identities i LEFT JOIN player_season_registrations r ON r.id=i.linked_registration_id WHERE i.player_id IS NOT NULL AND (r.id IS NULL OR r.player_id<>i.player_id OR r.season_id<>i.season_id OR i.linked_at IS NULL OR i.linked_by_admin_id IS NULL)`},
  {name:'正式球队场上队长属于当前有效名单',sql:`SELECT COUNT(*) AS issue_count FROM team t WHERE t.captain_player_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM team_player p WHERE p.player_account_id=t.captain_player_id AND p.roster_batch_id=(SELECT b.id FROM team_roster_batches b WHERE b.team_id=t.id AND (b.effective_from IS NULL OR b.effective_from<=DATE(UTC_TIMESTAMP()+INTERVAL 8 HOUR)) ORDER BY b.effective_from DESC,b.version_no DESC,b.id DESC LIMIT 1))`},
  {name:'公开结果引用正确裁判员正式历史版本',sql:`SELECT COUNT(*) AS issue_count FROM match_publications p LEFT JOIN report_section_history h ON h.id=p.source_history_id WHERE h.id IS NULL OR h.report_id<>p.report_id OR h.section<>'main' OR h.version_no<>p.version_no OR h.operation NOT IN ('baseline','submit','revise')`},
  {name:'已清理学籍材料无在线路径且仅属于已结束赛季',sql:`SELECT COUNT(*) AS issue_count FROM player_registration_files f JOIN player_season_registrations r ON r.id=f.registration_id LEFT JOIN player_season_settings s ON s.season_id=r.season_id WHERE f.cleaned_at IS NOT NULL AND (f.file_path IS NOT NULL OR s.ended_at IS NULL)`},
  {name:'清理完成赛季没有遗留在线学籍材料',sql:`SELECT COUNT(*) AS issue_count FROM player_season_settings s WHERE s.cleanup_status='complete' AND EXISTS(SELECT 1 FROM player_registration_files f JOIN player_season_registrations r ON r.id=f.registration_id WHERE r.season_id=s.season_id AND f.cleaned_at IS NULL)`},
  {
    name: '比赛名单选择属于本场球队和对应名单批次',
    sql: `SELECT COUNT(*) AS issue_count FROM match_roster_selections r
      JOIN match_schedules s ON s.id=r.schedule_id LEFT JOIN team_roster_batches b ON b.id=r.roster_batch_id
      WHERE r.team_id NOT IN (s.team_a_id,s.team_b_id) OR (r.roster_batch_id IS NOT NULL AND (b.id IS NULL OR b.team_id<>r.team_id OR b.season_id<>s.season_id))`
  },
  {
    name: '比赛名单选择版本、理由与追加历史一致',
    sql: `SELECT COUNT(*) AS issue_count FROM match_roster_selections r
      LEFT JOIN match_roster_selection_events e ON e.schedule_id=r.schedule_id AND e.team_id=r.team_id AND e.revision=r.revision
      WHERE e.id IS NULL OR NULLIF(TRIM(r.selection_reason),'') IS NULL
        OR NOT (r.roster_batch_id <=> CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.after_snapshot,'$.roster_batch_id')),'null') AS UNSIGNED))
        OR r.revision<>(SELECT MAX(h.revision) FROM match_roster_selection_events h WHERE h.schedule_id=r.schedule_id AND h.team_id=r.team_id)`
  },
  {
    name: '球队报名状态和修订号与追加事件一致',
    sql: `SELECT COUNT(*) AS issue_count FROM team_applications a
      LEFT JOIN team_application_events e ON e.application_id=a.id AND e.revision=a.revision
      WHERE e.id IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(e.after_snapshot,'$.status'))<>a.status
      OR a.revision<>(SELECT MAX(h.revision) FROM team_application_events h WHERE h.application_id=a.id)`
  },
  {
    name: '审核通过申请对应正式名单及通过事件且赛季赛事一致',
    sql: `SELECT COUNT(*) AS issue_count FROM team_applications a
      JOIN season_competitions c ON c.id=a.competition_id LEFT JOIN team t ON t.id=a.team_id
      WHERE a.kind IN ('initial','roster_change') AND a.status='approved' AND
      (t.id IS NULL OR t.season_id<>a.season_id OR t.league_type<>c.league_type
       OR (SELECT COUNT(*) FROM team_roster_batches b WHERE b.application_id=a.id AND b.team_id=a.team_id AND b.source_type=a.source_type)<>(SELECT COUNT(*) FROM team_application_events e WHERE e.application_id=a.id AND e.operation='approved'))`
  },
  {
    name: '球队报名撤销有原因、审计事件并保留球队',
    sql: `SELECT
      (SELECT COUNT(*) FROM team_application_events WHERE operation='revoked' AND NULLIF(TRIM(reason),'') IS NULL)
      +(SELECT COUNT(*) FROM team_applications a LEFT JOIN team t ON t.id=a.team_id
        WHERE a.status='revoked' AND (t.id IS NULL OR t.registration_revoked<>1 OR a.kind<>'initial' OR a.source_type<>'online' OR NULLIF(TRIM(a.revoke_reason),'') IS NULL))
      +(SELECT COUNT(*) FROM team t WHERE t.registration_revoked=1 AND NOT EXISTS
        (SELECT 1 FROM team_applications a WHERE a.team_id=t.id AND a.kind='initial' AND a.source_type='online' AND a.status<>'approved'
          AND EXISTS (SELECT 1 FROM team_application_events e WHERE e.application_id=a.id AND e.operation='revoked'))) AS issue_count`
  },
  {
    name: '球队退回事件均有理由且指定替换行属于同一申请',
    sql: `SELECT
      (SELECT COUNT(*) FROM team_application_events WHERE operation='returned' AND NULLIF(TRIM(reason),'') IS NULL)
      +(SELECT COUNT(*) FROM team_return_replacements r JOIN team_application_members m ON m.id=r.member_id
        WHERE m.application_id<>r.application_id OR NOT EXISTS
        (SELECT 1 FROM team_application_events e WHERE e.application_id=r.application_id AND e.revision=r.return_revision AND e.operation='returned')) AS issue_count`
  },
  {
    name: '球队角色变更状态与历史一致且退回有理由',
    sql: `SELECT COUNT(*) AS issue_count FROM team_role_change_requests r
      LEFT JOIN team_role_change_events e ON e.request_id=r.id AND e.revision=r.revision
      WHERE e.id IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(e.after_snapshot,'$.status'))<>r.status
      OR r.revision<>(SELECT MAX(h.revision) FROM team_role_change_events h WHERE h.request_id=r.id)
      OR (r.status='returned' AND NULLIF(TRIM(r.reason),'') IS NULL)`
  },
  {
    name: '球员学籍状态和修订号与追加审核历史一致',
    sql: `SELECT COUNT(*) AS issue_count FROM player_season_registrations r
      LEFT JOIN player_registration_events e ON e.registration_id=r.id AND e.revision=r.revision
      WHERE e.id IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(e.after_snapshot,'$.status'))<>r.status
      OR r.revision<>(SELECT MAX(h.revision) FROM player_registration_events h WHERE h.registration_id=r.id)`
  },
  {
    name: '球员退回及撤销有原因，每次提交均有对应截图记录',
    sql: `SELECT COUNT(*) AS issue_count FROM player_registration_events e
      WHERE (e.operation IN ('returned','revoked') AND NULLIF(TRIM(e.reason),'') IS NULL)
      OR (e.operation='submitted' AND NOT EXISTS (SELECT 1 FROM player_registration_files f WHERE f.registration_id=e.registration_id AND f.revision=e.revision))`
  },
  {
    name: '启用赛季不超过一个',
    sql: 'SELECT GREATEST(COUNT(*) - 1, 0) AS issue_count FROM seasons WHERE is_active = 1'
  },
  {
    name: '每个赛程都有报告主表',
    sql: 'SELECT COUNT(*) AS issue_count FROM match_schedules s LEFT JOIN match_reports r ON r.schedule_id = s.id WHERE r.id IS NULL'
  },
  {
    name: '没有脱离赛程的报告',
    sql: 'SELECT COUNT(*) AS issue_count FROM match_reports r LEFT JOIN match_schedules s ON s.id = r.schedule_id WHERE s.id IS NULL'
  },
  {
    name: '每名裁判都有资料表',
    sql: 'SELECT COUNT(*) AS issue_count FROM referee r LEFT JOIN referee_profile p ON p.referee_id = r.id WHERE p.referee_id IS NULL'
  },
  {
    name: '裁判账号安全状态合法',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM referee
      WHERE is_active NOT IN (0, 1)
         OR must_change_password NOT IN (0, 1)
         OR token_version < 0
    `
  },
  {
    name: '每份赛季注册申请都有追加式事件历史',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM referee_season_registrations rsr
      LEFT JOIN referee_season_registration_events e ON e.registration_id = rsr.id
      WHERE e.id IS NULL
    `
  },
  {
    name: '赛季注册最新事件状态与当前申请一致',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM referee_season_registrations rsr
      INNER JOIN referee_season_registration_events e ON e.id = (
        SELECT e2.id
        FROM referee_season_registration_events e2
        WHERE e2.registration_id = rsr.id
        ORDER BY e2.id DESC
        LIMIT 1
      )
      WHERE e.to_status <> rsr.status
         OR e.application_version <> rsr.application_version
    `
  },
  {
    name: '赛程主客队赛事类型一致',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_schedules s
      INNER JOIN team a ON a.id = s.team_a_id
      INNER JOIN team b ON b.id = s.team_b_id
      WHERE a.league_type <> s.match_type OR b.league_type <> s.match_type
    `
  },
  {
    name: '裁判员可兼任第四官员、裁判监督可兼任，其余场上岗位不重复',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_schedules
      WHERE
        (main_referee_id IS NOT NULL AND main_referee_id IN (assistant1_id, assistant2_id))
        OR (assistant1_id IS NOT NULL AND assistant1_id IN (assistant2_id, fourth_official_id))
        OR (assistant2_id IS NOT NULL AND assistant2_id = fourth_official_id)
    `
  },
  {
    name: '已有裁判岗位都保留选派姓名快照',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_schedules
      WHERE (main_referee_id IS NOT NULL AND NULLIF(TRIM(main_referee_name_snapshot), '') IS NULL)
         OR (assistant1_id IS NOT NULL AND NULLIF(TRIM(assistant1_name_snapshot), '') IS NULL)
         OR (assistant2_id IS NOT NULL AND NULLIF(TRIM(assistant2_name_snapshot), '') IS NULL)
         OR (fourth_official_id IS NOT NULL AND NULLIF(TRIM(fourth_official_name_snapshot), '') IS NULL)
         OR (supervisor_id IS NOT NULL AND NULLIF(TRIM(supervisor_name_snapshot), '') IS NULL)
    `
  },
  {
    name: '比赛与点球比分在 0 到 30 之间',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_reports
      WHERE home_score NOT BETWEEN 0 AND 30
         OR away_score NOT BETWEEN 0 AND 30
         OR home_penalty_score NOT BETWEEN 0 AND 30
         OR away_penalty_score NOT BETWEEN 0 AND 30
    `
  },
  {
    name: '报告比分与进球归属数量一致',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_reports r
      INNER JOIN match_schedules s ON s.id = r.schedule_id
      LEFT JOIN (
        SELECT report_id, credited_team_id, COUNT(*) AS goal_count
        FROM match_goals
        GROUP BY report_id, credited_team_id
      ) hg ON hg.report_id = r.id AND hg.credited_team_id = s.team_a_id
      LEFT JOIN (
        SELECT report_id, credited_team_id, COUNT(*) AS goal_count
        FROM match_goals
        GROUP BY report_id, credited_team_id
      ) ag ON ag.report_id = r.id AND ag.credited_team_id = s.team_b_id
      WHERE r.home_score <> COALESCE(hg.goal_count, 0)
         OR r.away_score <> COALESCE(ag.goal_count, 0)
    `
  },
  {
    name: '红黄牌球员属于记录中的队伍',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_cards c
      INNER JOIN team_player p ON p.id = c.team_player_id
      WHERE p.team_id <> c.team_id
    `
  },
  {
    name: '进球球员属于记录中的球员队伍',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_goals g
      INNER JOIN team_player p ON p.id = g.team_player_id
      WHERE p.team_id <> g.player_team_id
    `
  },
  {
    name: '裁判统计归属当前赛程对应岗位',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_referee_stats st
      INNER JOIN match_reports r ON r.id = st.report_id
      LEFT JOIN match_official_assignments a ON a.id = st.assignment_id
      WHERE a.id IS NULL OR a.schedule_id <> r.schedule_id OR a.role <> st.role
        OR NOT (st.referee_id <=> a.referee_id)
    `
  },
  {
    name: '裁判监督评分归属当前被评分岗位',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_referee_reviews rv
      INNER JOIN match_reports r ON r.id = rv.report_id
      LEFT JOIN match_official_assignments a ON a.id = rv.target_assignment_id
      LEFT JOIN match_official_assignments sup ON sup.id = rv.reviewer_assignment_id
      WHERE a.id IS NULL OR sup.id IS NULL OR a.schedule_id <> r.schedule_id OR sup.schedule_id <> r.schedule_id
        OR a.role <> rv.target_role OR sup.role <> 'supervisor'
        OR NOT (rv.target_referee_id <=> a.referee_id) OR NOT (rv.reviewer_referee_id <=> sup.referee_id)
    `
  },
  {
    name: '正式名单批次至少包含一名球员（人数上限人工审核）',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM team_roster_batches rb
      LEFT JOIN team_player p ON p.roster_batch_id = rb.id
      GROUP BY rb.id
      HAVING COUNT(p.id) < 1
    `,
    countRows: true
  },
  {
    name: '已提交状态都有提交时间',
    sql: `
      SELECT COUNT(*) AS issue_count
      FROM match_reports
      WHERE (main_report_status = 'submitted' AND main_report_submitted_at IS NULL)
         OR (supervisor_review_status = 'submitted' AND supervisor_review_submitted_at IS NULL)
    `
  }, {
    name: '旧账号岗位均已迁移为统一选派',
    sql: `SELECT COUNT(*) AS issue_count FROM match_schedules s WHERE
      (main_referee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM match_official_assignments a WHERE a.schedule_id=s.id AND a.role='main')) OR
      (assistant1_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM match_official_assignments a WHERE a.schedule_id=s.id AND a.role='assistant1')) OR
      (assistant2_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM match_official_assignments a WHERE a.schedule_id=s.id AND a.role='assistant2')) OR
      (fourth_official_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM match_official_assignments a WHERE a.schedule_id=s.id AND a.role='fourth')) OR
      (supervisor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM match_official_assignments a WHERE a.schedule_id=s.id AND a.role='supervisor'))`
  }, {
    name: '统一岗位与旧系统账号兼容列一致',
    sql: `SELECT COUNT(*) AS issue_count FROM match_official_assignments a JOIN match_schedules s ON s.id=a.schedule_id
      WHERE NOT (a.referee_id <=> CASE a.role WHEN 'main' THEN s.main_referee_id WHEN 'assistant1' THEN s.assistant1_id WHEN 'assistant2' THEN s.assistant2_id WHEN 'fourth' THEN s.fourth_official_id WHEN 'supervisor' THEN s.supervisor_id END)
      OR NOT (a.name_snapshot <=> CASE a.role WHEN 'main' THEN s.main_referee_name_snapshot WHEN 'assistant1' THEN s.assistant1_name_snapshot WHEN 'assistant2' THEN s.assistant2_name_snapshot WHEN 'fourth' THEN s.fourth_official_name_snapshot WHEN 'supervisor' THEN s.supervisor_name_snapshot END)`
  }, {
    name: '不需要裁判监督的比赛没有裁判监督岗位且岗位姓名非空',
    sql: `SELECT COUNT(*) AS issue_count FROM match_official_assignments a JOIN match_schedules s ON s.id=a.schedule_id WHERE (a.role='supervisor' AND s.supervisor_required=0) OR (a.role='fourth' AND s.fourth_required=0) OR NULLIF(TRIM(a.name_snapshot),'') IS NULL`
  }, {
    name: '报告操作事件归属正确负责人和分区',
    sql: `SELECT COUNT(*) AS issue_count FROM report_actor_events e JOIN match_reports r ON r.id=e.report_id JOIN match_official_assignments a ON a.id=e.owner_assignment_id
      WHERE a.schedule_id<>r.schedule_id OR a.role<>IF(e.operation IN ('save_supervisor','submit_supervisor'),'supervisor','main')
      OR (e.source_type='admin_proxy' AND (a.role<>'main' OR a.source_type<>'external'))
      OR (e.source_type='referee' AND NOT (e.actor_referee_id <=> a.referee_id))`
  }, {
    name: '报告分区修订号与追加历史一致',
    sql: `SELECT COUNT(*) AS issue_count FROM report_section_states s
      WHERE s.revision <> COALESCE((SELECT MAX(h.revision) FROM report_section_history h WHERE h.report_id=s.report_id AND h.section=s.section),0)
      OR s.version_no <> COALESCE((SELECT MAX(h.version_no) FROM report_section_history h WHERE h.report_id=s.report_id AND h.section=s.section),0)`
  }, {
    name: '管理员退回与修订均有原因',
    sql: `SELECT COUNT(*) AS issue_count FROM report_section_history WHERE source_type='admin_revision' AND NULLIF(TRIM(reason),'') IS NULL`
  }, {
    name: '退回分区有原因且不解除岗位锁定',
    sql: `SELECT COUNT(*) AS issue_count FROM match_reports r
      LEFT JOIN report_section_states m ON m.report_id=r.id AND m.section='main'
      LEFT JOIN report_section_states s ON s.report_id=r.id AND s.section='supervisor'
      WHERE (r.main_report_status='returned' AND (NULLIF(TRIM(m.return_reason),'') IS NULL OR r.main_report_started_at IS NULL))
      OR (r.supervisor_review_status='returned' AND (NULLIF(TRIM(s.return_reason),'') IS NULL OR r.supervisor_review_started_at IS NULL))`
  }, {
    name: '最新历史状态与当前分区一致',
    sql: `SELECT COUNT(*) AS issue_count FROM report_section_states s JOIN report_section_history h ON h.report_id=s.report_id AND h.section=s.section AND h.revision=s.revision
      JOIN match_reports r ON r.id=s.report_id
      WHERE JSON_UNQUOTE(JSON_EXTRACT(h.after_snapshot,'$.status')) <> IF(s.section='main',r.main_report_status,r.supervisor_review_status)`
  }
];

function collectUploadFiles() {
  const files = new Set();
  for (const folder of ['referees', 'reports', 'player-academic']) {
    const folderPath = path.join(UPLOAD_ROOT, folder);
    if (!fs.existsSync(folderPath)) continue;
    for (const name of fs.readdirSync(folderPath)) {
      const fullPath = path.join(folderPath, name);
      if (fs.statSync(fullPath).isFile()) {
        files.add(`${folder}/${name}`);
      }
    }
  }
  return files;
}

function normalizeUploadReference(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return normalized.startsWith('/uploads/') ? normalized.slice('/uploads/'.length) : normalized;
}

async function main() {
  const results = [];
  for (const check of checks) {
    const [rows] = await pool.query(check.sql);
    const issueCount = check.countRows ? rows.length : Number(rows[0]?.issue_count || 0);
    results.push({ name: check.name, issue_count: issueCount });
  }

  const [referenceRows] = await pool.query(`
    SELECT id_photo_path AS upload_path
    FROM referee_profile
    WHERE id_photo_path IS NOT NULL
    UNION
    SELECT fourth_official_image_path AS upload_path
    FROM match_reports
    WHERE fourth_official_image_path IS NOT NULL
    UNION
    SELECT file_path AS upload_path FROM player_registration_files
    WHERE file_path IS NOT NULL AND cleaned_at IS NULL
    UNION
    SELECT file_path AS upload_path FROM player_college_changes
    UNION
    SELECT JSON_UNQUOTE(JSON_EXTRACT(before_snapshot,'$.data.fourth_official_image_path')) FROM report_section_history
    WHERE JSON_TYPE(JSON_EXTRACT(before_snapshot,'$.data.fourth_official_image_path'))='STRING'
    UNION
    SELECT JSON_UNQUOTE(JSON_EXTRACT(after_snapshot,'$.data.fourth_official_image_path')) FROM report_section_history
    WHERE JSON_TYPE(JSON_EXTRACT(after_snapshot,'$.data.fourth_official_image_path'))='STRING'
  `);
  const uploadFiles = collectUploadFiles();
  const uploadReferences = new Set(referenceRows.map(row => normalizeUploadReference(row.upload_path)));
  const missingFiles = [...uploadReferences].filter(reference => !uploadFiles.has(reference));
  const orphanFiles = [...uploadFiles].filter(file => !uploadReferences.has(file));

  results.push({ name: '数据库引用的上传文件均存在', issue_count: missingFiles.length });

  console.table(results);
  console.log(JSON.stringify({
    upload_reference_count: uploadReferences.size,
    upload_file_count: uploadFiles.size,
    missing_upload_count: missingFiles.length,
    orphan_upload_count: orphanFiles.length
  }));

  if (results.some(result => result.issue_count > 0)) {
    process.exitCode = 1;
  }
}

if (require.main === module) main()
  .catch(error => {
    console.error('审计失败:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

module.exports = { checks };
