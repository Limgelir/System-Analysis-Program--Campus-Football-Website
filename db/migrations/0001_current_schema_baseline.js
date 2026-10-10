/**
 * 当前完整业务结构的非破坏性基线。
 *
 * 此文件不会创建或修改业务表。迁移运行器会先检查现有数据库是否包含
 * 这里冻结的表、字段、关键索引和触发器，全部匹配后才登记 0001。
 * 后续不得修改本文件；数据库变化必须新增 0002、0003……迁移。
 */
module.exports = {
  version: '0001',
  name: 'current_schema_baseline',
  description: '确认现有业务数据库符合当前完整结构，并登记为迁移基线',
  rollback: '此迁移只登记基线，不修改业务数据；如误登记，可在确认无后续迁移后删除对应的 schema_migrations 记录。',
  baseline: true,
  requirements: {
    tables: {
      admin: {
        columns: ['id', 'username', 'password_hash', 'created_at', 'updated_at'],
        indexes: ['PRIMARY', 'uq_admin_username']
      },
      seasons: {
        columns: [
          'id', 'season_code', 'season_name', 'start_date', 'end_date',
          'is_active', 'active_singleton', 'created_at', 'updated_at'
        ],
        indexes: ['PRIMARY', 'uq_season_code', 'uq_season_name', 'uq_active_singleton']
      },
      referee: {
        columns: [
          'id', 'student_id', 'name', 'grade', 'target_level', 'level_promoted_at',
          'match_types', 'password_hash', 'created_at', 'updated_at'
        ],
        indexes: ['PRIMARY', 'uq_referee_student_id', 'idx_referee_name', 'idx_referee_grade']
      },
      referee_profile: {
        columns: [
          'referee_id', 'gender', 'college', 'height_cm', 'weight_kg',
          'id_photo_path', 'officiated_count_base', 'created_at', 'updated_at'
        ],
        indexes: ['PRIMARY']
      },
      team: {
        columns: [
          'id', 'season_id', 'team_name', 'league_type', 'description',
          'created_at', 'updated_at'
        ],
        indexes: [
          'PRIMARY', 'uq_team_id_season', 'uq_team_season_name_league',
          'idx_team_season', 'idx_team_league_type', 'idx_team_name'
        ]
      },
      team_roster_batches: {
        columns: ['id', 'team_id', 'season_id', 'version_no', 'uploaded_at', 'created_at'],
        indexes: [
          'PRIMARY', 'uq_roster_batch_id_team', 'uq_roster_batch_team_season_version',
          'idx_roster_batch_team', 'idx_roster_batch_season'
        ]
      },
      team_player: {
        columns: [
          'id', 'roster_batch_id', 'team_id', 'jersey_number',
          'player_name', 'remark', 'created_at'
        ],
        indexes: [
          'PRIMARY', 'uq_team_player_id_team', 'uq_team_player_batch_jersey',
          'idx_team_player_batch', 'idx_team_player_team', 'idx_team_player_name'
        ]
      },
      match_schedules: {
        columns: [
          'id', 'season_id', 'match_type', 'team_a_id', 'team_b_id',
          'team_a_name_snapshot', 'team_b_name_snapshot', 'match_date', 'field_order',
          'main_referee_id', 'assistant1_id', 'assistant2_id', 'fourth_official_id',
          'supervisor_id', 'created_at', 'updated_at'
        ],
        indexes: [
          'PRIMARY', 'uq_schedule_season_type_field_order', 'idx_schedule_match_type',
          'idx_schedule_match_date', 'idx_schedule_team_a', 'idx_schedule_team_b',
          'idx_schedule_main_referee', 'idx_schedule_assistant1',
          'idx_schedule_assistant2', 'idx_schedule_fourth', 'idx_schedule_supervisor'
        ]
      },
      match_reports: {
        columns: [
          'id', 'schedule_id', 'home_score', 'away_score', 'home_penalty_score',
          'away_penalty_score', 'fourth_official_image_path', 'main_report_started_at',
          'supervisor_review_started_at', 'main_report_status', 'supervisor_review_status',
          'main_report_submitted_at', 'supervisor_review_submitted_at',
          'created_at', 'updated_at'
        ],
        indexes: ['PRIMARY', 'uq_match_report_schedule']
      },
      match_referee_stats: {
        columns: [
          'id', 'report_id', 'referee_id', 'role', 'running_distance_m',
          'max_heart_rate', 'sprint_count', 'high_intensity_distance_m',
          'avg_heart_rate', 'avg_speed_mps', 'red_card_count', 'red_card_accuracy',
          'yellow_card_count', 'yellow_card_accuracy', 'penalty_count',
          'penalty_accuracy', 'offside_flag_count', 'assist_count',
          'created_at', 'updated_at'
        ],
        indexes: ['PRIMARY', 'uq_referee_stats_report_role', 'idx_referee_stats_referee']
      },
      match_referee_reviews: {
        columns: [
          'id', 'report_id', 'reviewer_referee_id', 'target_referee_id',
          'target_role', 'score', 'advice', 'created_at', 'updated_at'
        ],
        indexes: [
          'PRIMARY', 'uq_review_report_target_role',
          'idx_review_reviewer', 'idx_review_target_referee'
        ]
      },
      match_cards: {
        columns: [
          'id', 'report_id', 'team_id', 'team_player_id', 'card_type',
          'minute_base', 'minute_extra', 'minute_label', 'description',
          'created_at', 'updated_at'
        ],
        indexes: [
          'PRIMARY', 'uq_match_card_id_team', 'idx_match_cards_report',
          'idx_match_cards_team', 'idx_match_cards_player', 'idx_match_cards_timeline'
        ]
      },
      match_goals: {
        columns: [
          'id', 'report_id', 'player_team_id', 'credited_team_id', 'team_player_id',
          'goal_type', 'minute_base', 'minute_extra', 'minute_label', 'description',
          'created_at', 'updated_at'
        ],
        indexes: [
          'PRIMARY', 'idx_match_goals_report', 'idx_match_goals_player_team',
          'idx_match_goals_credited_team', 'idx_match_goals_team_player',
          'idx_match_goals_timeline'
        ]
      }
    },
    triggers: ['trg_match_schedule_after_insert_create_report']
  },
  async up() {
    // 基线验证由迁移运行器完成；这里故意不修改任何业务表或数据。
  }
};
