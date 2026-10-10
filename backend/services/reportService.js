const pool = require('../db');
const scheduleService = require('./scheduleService');
const { createBusinessError, isBusinessError } = require('../utils/scheduleValidator');
const { ensureViewerCanReadReport, resolveAssignedRoleCode } = require('../utils/reportAccess');
const { buildFourthOfficialImagePath, removeManagedReportUpload } = require('../utils/reportUpload');
const history = require('../utils/reportHistory');
const {
  buildTeamContext,
  collectSelectedPlayerIds,
  normalizeMainReportState,
  validateCardTeams,
  validateGoalRecordLimit,
  validateGoalTeams,
  validateGoalCountAgainstScore,
  validateSelectedPlayers
} = require('../utils/reportValidator');

function buildInClausePlaceholders(values = []) {
  return values.map(() => '?').join(', ');
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const INTEGER_STAT_FIELDS = new Set([
  'running_distance_m',
  'max_heart_rate',
  'sprint_count',
  'high_intensity_distance_m',
  'avg_heart_rate',
  'red_card_count',
  'yellow_card_count',
  'penalty_count',
  'offside_flag_count',
  'assist_count'
]);

const ACCURACY_STAT_FIELDS = new Set([
  'red_card_accuracy',
  'yellow_card_accuracy',
  'penalty_accuracy'
]);

function normalizeStatValue(stat, field) {
  const value = toNullableNumber(stat?.[field]);
  if (value === null) {
    return null;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw createBusinessError(`${field} 必须是大于等于 0 的数字`, {
      code: 'REFEREE_STAT_INVALID'
    });
  }

  if (INTEGER_STAT_FIELDS.has(field) && !Number.isInteger(value)) {
    throw createBusinessError(`${field} 必须是整数`, {
      code: 'REFEREE_STAT_INVALID'
    });
  }

  if (ACCURACY_STAT_FIELDS.has(field) && value > 100) {
    throw createBusinessError(`${field} 必须在 0 到 100 之间`, {
      code: 'REFEREE_STAT_INVALID'
    });
  }

  return value;
}

class ReportService {
  attachViewerContextToSchedule(schedule, viewerContext) {
    if (!schedule || !viewerContext) {
      return schedule;
    }

    return {
      ...schedule,
      my_role: viewerContext.viewer_role,
      my_role_code: viewerContext.viewer_role_code,
      my_role_key: viewerContext.viewer_role_key,
      my_assignment: viewerContext.viewer_assignment,
      viewer_permissions: viewerContext.viewer_permissions
    };
  }

  async getReportCollections(connection, reportId) {
    const [stats] = await connection.execute(
      `SELECT id, report_id, referee_id, assignment_id, role, running_distance_m, max_heart_rate, sprint_count, high_intensity_distance_m,
              avg_heart_rate, avg_speed_mps, red_card_count, red_card_accuracy, yellow_card_count, yellow_card_accuracy,
              penalty_count, penalty_accuracy, offside_flag_count, assist_count
       FROM match_referee_stats
       WHERE report_id = ?`,
      [reportId]
    );

    const [reviews] = await connection.execute(
      `SELECT id, report_id, reviewer_referee_id, target_referee_id, target_assignment_id, reviewer_assignment_id, target_role, score, advice
       FROM match_referee_reviews
       WHERE report_id = ?`,
      [reportId]
    );

    const [cards] = await connection.execute(
      `SELECT c.id, c.report_id, c.team_id, c.team_player_id, c.card_type,
              c.minute_base, c.minute_extra, c.minute_label, c.description,
              p.jersey_number AS player_jersey_number,
              p.player_name,
              p.remark AS player_remark,
              p.roster_batch_id
       FROM match_cards c
       INNER JOIN team_player p ON p.id = c.team_player_id AND p.team_id = c.team_id
       WHERE c.report_id = ?
       ORDER BY c.minute_base ASC, c.minute_extra ASC, c.id ASC`,
      [reportId]
    );

    const [goals] = await connection.execute(
      `SELECT g.id, g.report_id, g.player_team_id, g.credited_team_id, g.team_player_id,
              g.goal_type, g.minute_base, g.minute_extra, g.minute_label, g.description,
              p.jersey_number AS player_jersey_number,
              p.player_name,
              p.remark AS player_remark,
              p.roster_batch_id
       FROM match_goals g
       INNER JOIN team_player p ON p.id = g.team_player_id AND p.team_id = g.player_team_id
       WHERE g.report_id = ?
       ORDER BY g.minute_base ASC, g.minute_extra ASC, g.id ASC`,
      [reportId]
    );

    return { stats, reviews, cards, goals };
  }

  async getReportByScheduleId(scheduleId, viewer = {}, transaction = null) {
    const connection = transaction || await pool.getConnection();
    try {
      // 内容与并发版本必须来自同一个数据库快照，不能把旧表单配上新版本号。
      if (!transaction) await connection.beginTransaction();
      const schedule = await scheduleService.queryScheduleDetail(connection, scheduleId);
      if (!schedule) {
        throw createBusinessError('赛程不存在', { statusCode: 404, code: 'SCHEDULE_NOT_FOUND' });
      }

      const viewerContext = ensureViewerCanReadReport(schedule, viewer);

      const reportId = schedule.report?.id;
      if (!reportId) {
        throw createBusinessError('报告不存在', { statusCode: 404, code: 'REPORT_NOT_FOUND' });
      }

      const { stats, reviews, cards, goals } = await this.getReportCollections(connection, reportId);
      const sections = {};
      for (const section of ['main','supervisor']) sections[section] = await history.readSectionState(connection,reportId,section);
      const [actorEvents] = await connection.execute(`SELECT id, operation, source_type, actor_name_snapshot, created_at, owner_assignment_id
        FROM report_actor_events WHERE report_id = ? ORDER BY id DESC LIMIT 200`, [reportId]);
      const scheduleWithViewer = this.attachViewerContextToSchedule(schedule, viewerContext);
      const visibleReviews = viewerContext.viewer_permissions.can_read_all_reviews
        ? reviews
        : reviews.filter(review => viewerContext.viewer_role_codes.includes(review.target_role));

      const response = {
        schedule: scheduleWithViewer,
        report: scheduleWithViewer.report,
        stats,
        reviews: visibleReviews,
        cards,
        goals,
        actor_events: actorEvents,
        match_rosters: await require('./matchRosterService').read(connection, schedule),
        sections,
        viewer_role: viewerContext.viewer_role,
        viewer_role_codes: viewerContext.viewer_role_codes,
        viewer_role_code: viewerContext.viewer_role_code,
        viewer_role_key: viewerContext.viewer_role_key,
        viewer_assignment: viewerContext.viewer_assignment,
        viewer_permissions: viewerContext.viewer_permissions
      };
      if (!transaction) await connection.commit();
      return response;
    } catch (error) {
      if (!transaction) await connection.rollback();
      throw error;
    } finally {
      if (!transaction) connection.release();
    }
  }

  async getSectionHistory(scheduleId,section,viewer,query = {}) {
    history.sectionPrefix(section);
    const page = query.page === undefined ? 1 : Number(query.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw createBusinessError('历史页码必须是有效正整数');
    const report = await this.getReportByScheduleId(scheduleId,viewer);
    const [rows] = await pool.query(`SELECT id,report_id,section,revision,version_no,operation,source_type,actor_admin_id,actor_referee_id,actor_name_snapshot,reason,created_at
      FROM report_section_history WHERE report_id=? AND section=? ORDER BY revision DESC LIMIT 20 OFFSET ?`,[report.report.id,section,(page-1)*20]);
    const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM report_section_history WHERE report_id=? AND section=?',[report.report.id,section]);
    return {items:rows,page,page_size:20,total:Number(count.total)};
  }

  async getHistoryDetail(scheduleId,historyId,viewer) {
    if (!Number.isSafeInteger(historyId) || historyId <= 0) throw createBusinessError('历史记录 ID 无效');
    const report = await this.getReportByScheduleId(scheduleId,viewer);
    const [[entry]] = await pool.execute('SELECT * FROM report_section_history WHERE id=? AND report_id=?',[historyId,report.report.id]);
    if (!entry) throw createBusinessError('历史记录不存在',{statusCode:404});
    const visibleRoles=report.viewer_permissions.can_read_all_reviews?'supervisor':report.viewer_role_codes;
    return {...entry,before_snapshot:history.filterSnapshot(entry.before_snapshot,visibleRoles),after_snapshot:history.filterSnapshot(entry.after_snapshot,visibleRoles)};
  }

  getRoleForUser(schedule, userId) {
    return resolveAssignedRoleCode(schedule, userId);
  }

  async getExistingReportPlayerIds(connection, reportId) {
    const [rows] = await connection.execute(
      `SELECT DISTINCT team_player_id
       FROM (
         SELECT team_player_id FROM match_cards WHERE report_id = ?
         UNION
         SELECT team_player_id FROM match_goals WHERE report_id = ?
       ) AS selected_players`,
      [reportId, reportId]
    );

    return new Set(
      rows
        .map(row => Number(row.team_player_id))
        .filter(value => Number.isInteger(value) && value > 0)
    );
  }

  async getMatchRosterBatchByTeam(connection, schedule) {
    const rows = await require('./matchRosterService').read(connection, schedule);
    return new Map(rows.map(row => [row.team_id, row.roster_batch_id]));
  }

  async getTeamPlayerLookup(connection, playerIds = []) {
    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return new Map();
    }

    const placeholders = buildInClausePlaceholders(playerIds);
    const [rows] = await connection.execute(
      `SELECT id, team_id, roster_batch_id, jersey_number, player_name
       FROM team_player
       WHERE id IN (${placeholders})`,
      playerIds
    );

    return new Map(
      rows.map(row => [
        Number(row.id),
        {
          id: Number(row.id),
          team_id: Number(row.team_id),
          roster_batch_id: Number(row.roster_batch_id),
          jersey_number: row.jersey_number || null,
          player_name: row.player_name || null
        }
      ])
    );
  }

  async loadPersistedMainReportState(connection, reportId) {
    const [reportRows] = await connection.execute(
      `SELECT id, home_score, away_score, home_penalty_score, away_penalty_score
       FROM match_reports
       WHERE id = ?
       LIMIT 1`,
      [reportId]
    );

    if (reportRows.length === 0) {
      throw createBusinessError('报告不存在', { statusCode: 404, code: 'REPORT_NOT_FOUND' });
    }

    const [cards] = await connection.execute(
      `SELECT team_id, team_player_id, card_type, minute_base, minute_extra, minute_label, description
       FROM match_cards
       WHERE report_id = ?
       ORDER BY minute_base ASC, minute_extra ASC, id ASC`,
      [reportId]
    );

    const [goals] = await connection.execute(
      `SELECT player_team_id, credited_team_id, team_player_id, goal_type, minute_base, minute_extra, minute_label, description
       FROM match_goals
       WHERE report_id = ?
       ORDER BY minute_base ASC, minute_extra ASC, id ASC`,
      [reportId]
    );

    return {
      ...reportRows[0],
      cards,
      goals
    };
  }


  async validateMainReportState(connection, schedule, reportId, body = {}) {
    const existingState = await this.loadPersistedMainReportState(connection, reportId);
    const normalizedState = normalizeMainReportState(body, existingState);
    const teamContext = buildTeamContext(schedule);

    validateCardTeams(normalizedState.cards, teamContext);
    validateGoalTeams(normalizedState.goals, teamContext);
    validateGoalRecordLimit(normalizedState.goals, teamContext);
    validateGoalCountAgainstScore(
      normalizedState.goals,
      teamContext,
      normalizedState.home_score,
      normalizedState.away_score
    );

    const selectedPlayerIds = Array.from(collectSelectedPlayerIds(normalizedState.cards, normalizedState.goals));
    const grandfatheredPlayerIds = await this.getExistingReportPlayerIds(connection, reportId);
    const latestRosterBatchByTeam = await this.getMatchRosterBatchByTeam(connection, schedule);
    const playerLookup = await this.getTeamPlayerLookup(connection, selectedPlayerIds);

    validateSelectedPlayers({
      cards: normalizedState.cards,
      goals: normalizedState.goals,
      teamContext,
      playerLookup,
      latestRosterBatchByTeam,
      grandfatheredPlayerIds
    });

    return normalizedState;
  }

}

Object.assign(ReportService.prototype, require('./reportWrites'));
module.exports = new ReportService();
