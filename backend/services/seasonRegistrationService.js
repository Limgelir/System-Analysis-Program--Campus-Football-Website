const pool = require('../db');
const listQuery = require('../utils/listQuery');
const { requireCollege } = require('../utils/collegeIdentity');

const REGISTRATION_STATUSES = new Set(['pending', 'approved', 'rejected', 'returned']);
const REVIEW_ACTIONS = new Set(['approve', 'reject', 'return']);
const { REFEREE_GRADES } = require('../utils/refereeProfileRules');
const GRADE_OPTIONS = new Set(REFEREE_GRADES);
const MATCH_TYPE_OPTIONS = new Set(['院内赛', '足协杯', '大联赛', '新生杯', '区级及以上比赛']);
const MATCH_TYPE_ALIASES = new Map([
  ['校足协杯', '足协杯'],
  ['校大联赛', '大联赛'],
  ['校新生杯', '新生杯']
]);

class SeasonRegistrationError extends Error {
  constructor(message, statusCode = 400, code = 'SEASON_REGISTRATION_ERROR') {
    super(message);
    this.name = 'SeasonRegistrationError';
    this.statusCode = statusCode;
    this.code = code;
    this.isBusinessError = true;
  }
}

function createError(message, statusCode, code) {
  return new SeasonRegistrationError(message, statusCode, code);
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createError(`${label}必须是正整数`, 400, 'INVALID_ID');
  }
  return parsed;
}

function normalizeText(value, label, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw createError(`${label}不能为空`, 400, 'REGISTRATION_FIELD_REQUIRED');
  }
  if (normalized.length > maxLength) {
    throw createError(`${label}不能超过 ${maxLength} 字`, 400, 'REGISTRATION_TEXT_TOO_LONG');
  }
  return normalized;
}

function normalizeOptionalReason(value, options = {}) {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  if (options.required && !normalized) {
    throw createError(`${options.label || '原因'}不能为空`, 400, 'REVIEW_REASON_REQUIRED');
  }
  if (normalized.length > 500) {
    throw createError('审核意见或原因不能超过 500 字', 400, 'REVIEW_REASON_TOO_LONG');
  }
  return normalized || null;
}

function normalizeMatchTypes(value) {
  let values = value;
  if (typeof values === 'string') {
    const trimmed = values.trim();
    if (trimmed.startsWith('[')) {
      try {
        values = JSON.parse(trimmed);
      } catch {
        values = trimmed.split(',');
      }
    } else {
      values = trimmed.split(',');
    }
  }
  if (!Array.isArray(values)) {
    throw createError('执法过的比赛类型必须是数组', 400, 'MATCH_TYPES_INVALID');
  }

  const normalized = [...new Set(values
    .map(item => String(item).trim())
    .filter(Boolean)
    .map(item => MATCH_TYPE_ALIASES.get(item) || item))];
  if (normalized.length === 0) {
    throw createError('请至少选择一种执法过的比赛类型', 400, 'MATCH_TYPES_REQUIRED');
  }
  const invalid = normalized.filter(item => !MATCH_TYPE_OPTIONS.has(item));
  if (invalid.length > 0) {
    throw createError(`存在不支持的比赛类型：${invalid.join('、')}`, 400, 'MATCH_TYPES_INVALID');
  }
  return normalized;
}

function normalizePayload(payload = {}) {
  const height = Number(payload.height_cm ?? payload.height_cm_snapshot);
  const weight = Number(payload.weight_kg ?? payload.weight_kg_snapshot);
  const grade = typeof (payload.grade ?? payload.grade_snapshot) === 'string'
    ? String(payload.grade ?? payload.grade_snapshot).trim()
    : '';

  if (!Number.isInteger(height) || height <= 0 || height > 300) {
    throw createError('身高必须是 1 到 300 之间的整数', 400, 'HEIGHT_INVALID');
  }
  if (!Number.isFinite(weight) || weight <= 0 || weight > 500) {
    throw createError('体重必须是 0 到 500 之间的数字', 400, 'WEIGHT_INVALID');
  }
  if (!GRADE_OPTIONS.has(grade)) {
    throw createError(`当前级别必须是${REFEREE_GRADES.join('、')}`, 400, 'GRADE_INVALID');
  }

  return {
    name_snapshot: normalizeText(payload.name ?? payload.name_snapshot, '姓名', 100),
    height_cm_snapshot: height,
    weight_kg_snapshot: weight,
    college_snapshot: requireCollege(payload.college ?? payload.college_snapshot),
    grade_snapshot: grade,
    match_types_snapshot: normalizeMatchTypes(payload.match_types ?? payload.match_types_snapshot)
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatRegistration(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    season_id: Number(row.season_id),
    referee_id: Number(row.referee_id),
    height_cm_snapshot: Number(row.height_cm_snapshot),
    weight_kg_snapshot: Number(row.weight_kg_snapshot),
    application_version: Number(row.application_version),
    match_types_snapshot: parseJsonArray(row.match_types_snapshot),
    is_eligible: row.status === 'approved' && (row.account_is_active === undefined || Boolean(row.account_is_active))
  };
}

function eventSnapshot(row) {
  if (!row) return null;
  const formatted = formatRegistration(row);
  return {
    id: formatted.id,
    season_id: formatted.season_id,
    referee_id: formatted.referee_id,
    name_snapshot: formatted.name_snapshot,
    height_cm_snapshot: formatted.height_cm_snapshot,
    weight_kg_snapshot: formatted.weight_kg_snapshot,
    college_snapshot: formatted.college_snapshot,
    grade_snapshot: formatted.grade_snapshot,
    match_types_snapshot: formatted.match_types_snapshot,
    status: formatted.status,
    submitted_at: formatted.submitted_at,
    reviewed_at: formatted.reviewed_at,
    reviewed_by_admin_id: formatted.reviewed_by_admin_id,
    review_reason: formatted.review_reason,
    application_version: formatted.application_version
  };
}

async function getActiveSeason(connection, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT id, season_code, season_name, start_date, end_date, is_active
       FROM seasons
      WHERE is_active = 1
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`
  );
  return rows[0] || null;
}

async function getRegistrationRow(connection, registrationId, { forUpdate = false } = {}) {
  const [rows] = await connection.execute(
    `SELECT rsr.*,
            s.season_code, s.season_name, s.start_date, s.end_date, s.is_active AS season_is_active,
            r.student_id, r.name AS account_name, r.grade AS account_grade,
            r.match_types AS account_match_types, r.is_active AS account_is_active,
            rp.college AS account_college, rp.height_cm AS account_height_cm,
            rp.weight_kg AS account_weight_kg,
            a.username AS reviewed_by_admin_username
       FROM referee_season_registrations rsr
       INNER JOIN seasons s ON s.id = rsr.season_id
       INNER JOIN referee r ON r.id = rsr.referee_id
       LEFT JOIN referee_profile rp ON rp.referee_id = r.id
       LEFT JOIN admin a ON a.id = rsr.reviewed_by_admin_id
      WHERE rsr.id = ?
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [registrationId]
  );
  return rows[0] || null;
}

async function insertEvent(connection, options) {
  await connection.execute(
    `INSERT INTO referee_season_registration_events
       (registration_id, season_id, referee_id, event_type, from_status, to_status,
        application_version, actor_type, actor_referee_id, actor_admin_id, reason,
        before_snapshot, after_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      options.after.id,
      options.after.season_id,
      options.after.referee_id,
      options.eventType,
      options.before?.status || null,
      options.after.status,
      options.after.application_version,
      options.actorType,
      options.actorType === 'referee' ? options.actorId : null,
      options.actorType === 'admin' ? options.actorId : null,
      options.reason || null,
      options.before ? JSON.stringify(eventSnapshot(options.before)) : null,
      JSON.stringify(eventSnapshot(options.after))
    ]
  );
}

class SeasonRegistrationService {
  async getCurrentForReferee(refereeId) {
    const normalizedRefereeId = parsePositiveInteger(refereeId, '裁判 ID');
    const connection = await pool.getConnection();
    try {
      const currentSeason = await getActiveSeason(connection);
      const [accountRows] = await connection.execute(
        `SELECT r.id, r.student_id, r.name, r.grade, r.match_types, r.is_active,
                rp.college, rp.height_cm, rp.weight_kg
           FROM referee r
           LEFT JOIN referee_profile rp ON rp.referee_id = r.id
          WHERE r.id = ?
          LIMIT 1`,
        [normalizedRefereeId]
      );
      const account = accountRows[0];
      if (!account || !account.is_active) {
        throw createError('裁判账号不存在或已停用', 403, 'REFEREE_INACTIVE');
      }

      let registration = null;
      if (currentSeason) {
        const [rows] = await connection.execute(
          `SELECT rsr.*, s.season_code, s.season_name
             FROM referee_season_registrations rsr
             INNER JOIN seasons s ON s.id = rsr.season_id
            WHERE rsr.season_id = ? AND rsr.referee_id = ?
            LIMIT 1`,
          [currentSeason.id, normalizedRefereeId]
        );
        registration = formatRegistration(rows[0]);
      }

      return {
        current_season: currentSeason,
        registration_status: currentSeason ? (registration?.status || 'unsubmitted') : 'unavailable',
        registration,
        account_prefill: {
          referee_id: Number(account.id),
          student_id: account.student_id,
          name: account.name,
          height_cm: account.height_cm === null ? null : Number(account.height_cm),
          weight_kg: account.weight_kg === null ? null : Number(account.weight_kg),
          college: account.college,
          grade: account.grade,
          match_types: String(account.match_types || '').split(',').map(item => item.trim()).filter(Boolean)
        }
      };
    } finally {
      connection.release();
    }
  }

  async submitCurrent(refereeId, payload) {
    const normalizedRefereeId = parsePositiveInteger(refereeId, '裁判 ID');
    const data = normalizePayload(payload);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const currentSeason = await getActiveSeason(connection, { forUpdate: true });
      if (!currentSeason) {
        throw createError('当前没有启用中的赛季，不能提交赛季注册', 400, 'ACTIVE_SEASON_REQUIRED');
      }

      const [accountRows] = await connection.execute(
        'SELECT id, is_active FROM referee WHERE id = ? LIMIT 1 FOR UPDATE',
        [normalizedRefereeId]
      );
      if (!accountRows[0] || !accountRows[0].is_active) {
        throw createError('裁判账号不存在或已停用', 403, 'REFEREE_INACTIVE');
      }

      const [existingRows] = await connection.execute(
        `SELECT * FROM referee_season_registrations
          WHERE season_id = ? AND referee_id = ?
          LIMIT 1 FOR UPDATE`,
        [currentSeason.id, normalizedRefereeId]
      );
      const before = existingRows[0] || null;
      if (before && !['rejected', 'returned'].includes(before.status)) {
        const message = before.status === 'approved'
          ? '本赛季注册已经通过；如需修改，请先联系管理员退回申请'
          : '本赛季注册正在审核中，不能重复提交';
        throw createError(message, 409, 'REGISTRATION_STATE_CONFLICT');
      }

      let registrationId;
      if (!before) {
        const [result] = await connection.execute(
          `INSERT INTO referee_season_registrations
             (season_id, referee_id, name_snapshot, height_cm_snapshot, weight_kg_snapshot,
              college_snapshot, grade_snapshot, match_types_snapshot, status, submitted_at,
              application_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), 1)`,
          [
            currentSeason.id,
            normalizedRefereeId,
            data.name_snapshot,
            data.height_cm_snapshot,
            data.weight_kg_snapshot,
            data.college_snapshot,
            data.grade_snapshot,
            JSON.stringify(data.match_types_snapshot)
          ]
        );
        registrationId = result.insertId;
      } else {
        registrationId = before.id;
        await connection.execute(
          `UPDATE referee_season_registrations
              SET name_snapshot = ?, height_cm_snapshot = ?, weight_kg_snapshot = ?,
                  college_snapshot = ?, grade_snapshot = ?, match_types_snapshot = ?,
                  status = 'pending', submitted_at = NOW(), reviewed_at = NULL,
                  reviewed_by_admin_id = NULL, review_reason = NULL,
                  application_version = application_version + 1
            WHERE id = ?`,
          [
            data.name_snapshot,
            data.height_cm_snapshot,
            data.weight_kg_snapshot,
            data.college_snapshot,
            data.grade_snapshot,
            JSON.stringify(data.match_types_snapshot),
            registrationId
          ]
        );
      }

      const [afterRows] = await connection.execute(
        'SELECT * FROM referee_season_registrations WHERE id = ? LIMIT 1',
        [registrationId]
      );
      const after = afterRows[0];
      await insertEvent(connection, {
        before,
        after,
        eventType: before ? 'resubmitted' : 'submitted',
        actorType: 'referee',
        actorId: normalizedRefereeId
      });

      await connection.commit();
      return formatRegistration(after);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listForAdmin(options = {}) {
    const {page,pageSize} = listQuery.pagination({page:options.page,page_size:options.pageSize});
    const status = listQuery.text(options.status,'审核状态');
    if (status && !REGISTRATION_STATUSES.has(status)) {
      throw createError('审核状态不合法', 400, 'REGISTRATION_STATUS_INVALID');
    }
    const grade = listQuery.text(options.grade,'级别');
    if (grade && !GRADE_OPTIONS.has(grade)) {
      throw createError('级别筛选不合法', 400, 'GRADE_INVALID');
    }
    const matchType = options.matchType
      ? normalizeMatchTypes([listQuery.text(options.matchType,'比赛类型')])[0]
      : '';

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [accountCountRows] = await connection.query(
        `SELECT COUNT(*) AS total_accounts,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_accounts,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_accounts
           FROM referee`
      );
      const accountCounts = accountCountRows[0] || {};
      const [[externalCounts]] = await connection.query('SELECT COUNT(*) AS total FROM external_referees');
      const emptySummary = {
        total_accounts: Number(accountCounts.total_accounts || 0),
        active_accounts: Number(accountCounts.active_accounts || 0),
        inactive_accounts: Number(accountCounts.inactive_accounts || 0),
        unsubmitted_accounts: Number(accountCounts.total_accounts || 0),
        pending: 0,
        approved: 0,
        rejected: 0,
        returned: 0,
        eligible_system_referees: 0,
        external_referees: Number(externalCounts.total)
      };
      const [seasons] = await connection.query('SELECT id,season_code,season_name,start_date,end_date,is_active FROM seasons ORDER BY start_date DESC,id DESC');
      const currentSeason = seasons.find(s=>s.is_active) || null;
      const seasonId = options.seasonId
        ? listQuery.integer(options.seasonId,null,2147483647,'赛季 ID')
        : (currentSeason ? Number(currentSeason.id) : null);
      if (!seasonId) {
        await connection.commit();
        return {
          season: null, seasons, current_season:currentSeason,
          summary: emptySummary,
          items: [],
          pagination: { page, page_size: pageSize, total: 0, total_pages: 0 }
        };
      }
      const [seasonRows] = await connection.execute(
        'SELECT id, season_code, season_name, start_date, end_date, is_active FROM seasons WHERE id = ? LIMIT 1',
        [seasonId]
      );
      if (!seasonRows[0]) {
        throw createError('赛季不存在', 404, 'SEASON_NOT_FOUND');
      }

      const where = ['rsr.season_id = ?'];
      const params = [seasonId];
      if (status) {
        where.push('rsr.status = ?');
        params.push(status);
      }
      const query = listQuery.text(options.query,'姓名或学号');
      if (query) {
        where.push("(rsr.name_snapshot LIKE ? ESCAPE '!' OR r.student_id LIKE ? ESCAPE '!')");
        params.push(listQuery.like(query),listQuery.like(query));
      }
      if (grade) {
        where.push('rsr.grade_snapshot = ?');
        params.push(grade);
      }
      if (matchType) {
        where.push('JSON_CONTAINS(rsr.match_types_snapshot, JSON_QUOTE(?))');
        params.push(matchType);
      }

      const [registrationCountRows] = await connection.execute(
        `SELECT COUNT(*) AS submitted_accounts,
                SUM(CASE WHEN rsr.status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN rsr.status = 'approved' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN rsr.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN rsr.status = 'returned' THEN 1 ELSE 0 END) AS returned,
                SUM(CASE WHEN rsr.status = 'approved' AND r.is_active = 1 THEN 1 ELSE 0 END) AS eligible_system_referees
           FROM referee_season_registrations rsr
           INNER JOIN referee r ON r.id = rsr.referee_id
          WHERE rsr.season_id = ?`,
        [seasonId]
      );
      const registrationCounts = registrationCountRows[0] || {};
      const submittedAccounts = Number(registrationCounts.submitted_accounts || 0);
      const summary = {
        ...emptySummary,
        unsubmitted_accounts: Math.max(0, emptySummary.total_accounts - submittedAccounts),
        pending: Number(registrationCounts.pending || 0),
        approved: Number(registrationCounts.approved || 0),
        rejected: Number(registrationCounts.rejected || 0),
        returned: Number(registrationCounts.returned || 0),
        eligible_system_referees: Number(registrationCounts.eligible_system_referees || 0)
      };

      const whereSql = where.join(' AND ');
      const [countRows] = await connection.execute(
        `SELECT COUNT(*) AS total
           FROM referee_season_registrations rsr
           INNER JOIN referee r ON r.id = rsr.referee_id
          WHERE ${whereSql}`,
        params
      );
      const total = Number(countRows[0].total);
      if(options.exporting)listQuery.guardExport(total);
      const [rows] = await connection.execute(
        `SELECT rsr.*, r.student_id, r.is_active AS account_is_active,
                a.username AS reviewed_by_admin_username
           FROM referee_season_registrations rsr
           INNER JOIN referee r ON r.id = rsr.referee_id
           LEFT JOIN admin a ON a.id = rsr.reviewed_by_admin_id
          WHERE ${whereSql}
          ORDER BY CASE WHEN rsr.status = 'pending' THEN 0 ELSE 1 END,
                   rsr.submitted_at ASC, rsr.id ASC
          LIMIT ${options.exporting?5000:pageSize} OFFSET ${options.exporting?0:(page - 1) * pageSize}`,
        params
      );

      await connection.commit();
      return {
        season: seasonRows[0], seasons, current_season:currentSeason,
        summary,
        items: rows.map(formatRegistration),
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: total === 0 ? 0 : Math.ceil(total / pageSize)
        }
      };
    } catch(error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getDetailForAdmin(registrationId) {
    const id = parsePositiveInteger(registrationId, '申请 ID');
    const connection = await pool.getConnection();
    try {
      const registrationRow = await getRegistrationRow(connection, id);
      if (!registrationRow) {
        throw createError('赛季注册申请不存在', 404, 'REGISTRATION_NOT_FOUND');
      }
      const [eventRows] = await connection.execute(
        `SELECT e.*, a.username AS actor_admin_username,
                r.student_id AS actor_referee_student_id, r.name AS actor_referee_name
           FROM referee_season_registration_events e
           LEFT JOIN admin a ON a.id = e.actor_admin_id
           LEFT JOIN referee r ON r.id = e.actor_referee_id
          WHERE e.registration_id = ?
          ORDER BY e.id ASC`,
        [id]
      );
      const registration = formatRegistration(registrationRow);
      return {
        registration,
        account: {
          referee_id: registration.referee_id,
          student_id: registrationRow.student_id,
          name: registrationRow.account_name,
          grade: registrationRow.account_grade,
          match_types: String(registrationRow.account_match_types || '').split(',').map(item => item.trim()).filter(Boolean),
          college: registrationRow.account_college,
          height_cm: registrationRow.account_height_cm === null ? null : Number(registrationRow.account_height_cm),
          weight_kg: registrationRow.account_weight_kg === null ? null : Number(registrationRow.account_weight_kg),
          is_active: Boolean(registrationRow.account_is_active)
        },
        events: eventRows.map(row => ({
          ...row,
          id: Number(row.id),
          registration_id: Number(row.registration_id),
          season_id: Number(row.season_id),
          referee_id: Number(row.referee_id),
          application_version: Number(row.application_version),
          before_snapshot: parseJsonObject(row.before_snapshot),
          after_snapshot: parseJsonObject(row.after_snapshot)
        }))
      };
    } finally {
      connection.release();
    }
  }

  async review(registrationId, adminId, action, reasonValue) {
    const id = parsePositiveInteger(registrationId, '申请 ID');
    const normalizedAdminId = parsePositiveInteger(adminId, '管理员 ID');
    if (!REVIEW_ACTIONS.has(action)) {
      throw createError('审核操作不合法', 400, 'REVIEW_ACTION_INVALID');
    }
    const normalizedReason = normalizeOptionalReason(reasonValue, {
      required: action === 'reject' || action === 'return',
      label: action === 'reject' ? '驳回原因' : '退回原因'
    });
    const reason = action === 'approve' && !normalizedReason ? '审核通过' : normalizedReason;

    const transition = {
      approve: { from: 'pending', to: 'approved', eventType: 'approved' },
      reject: { from: 'pending', to: 'rejected', eventType: 'rejected' },
      return: { from: 'approved', to: 'returned', eventType: 'returned' }
    }[action];

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const currentSeason = await getActiveSeason(connection, { forUpdate: true });
      if (!currentSeason) {
        throw createError('当前没有启用中的赛季，不能审核申请', 400, 'ACTIVE_SEASON_REQUIRED');
      }
      const before = await getRegistrationRow(connection, id, { forUpdate: true });
      if (!before) {
        throw createError('赛季注册申请不存在', 404, 'REGISTRATION_NOT_FOUND');
      }
      if (Number(before.season_id) !== Number(currentSeason.id)) {
        throw createError('只能审核当前启用赛季的申请', 409, 'REGISTRATION_SEASON_NOT_CURRENT');
      }
      if (!before.account_is_active) {
        throw createError('裁判账号已停用，不能变更赛季注册状态', 409, 'REFEREE_INACTIVE');
      }
      if (before.status !== transition.from) {
        throw createError(
          `当前状态为 ${before.status}，不能执行 ${action}`,
          409,
          'REGISTRATION_STATE_CONFLICT'
        );
      }

      await connection.execute(
        `UPDATE referee_season_registrations
            SET status = ?, reviewed_at = NOW(), reviewed_by_admin_id = ?, review_reason = ?
          WHERE id = ?`,
        [transition.to, normalizedAdminId, reason, id]
      );
      const after = await getRegistrationRow(connection, id);
      await insertEvent(connection, {
        before,
        after,
        eventType: transition.eventType,
        actorType: 'admin',
        actorId: normalizedAdminId,
        reason
      });

      await connection.commit();
      return formatRegistration(after);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listEligible(options = {}) {
    const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(options.pageSize, 10) || 20));
    const connection = await pool.getConnection();
    try {
      const currentSeason = await getActiveSeason(connection);
      const seasonId = options.seasonId
        ? parsePositiveInteger(options.seasonId, '赛季 ID')
        : (currentSeason ? Number(currentSeason.id) : null);
      if (!seasonId) {
        return { season: null, items: [], pagination: { page, page_size: pageSize, total: 0, total_pages: 0 } };
      }
      const [seasonRows] = await connection.execute(
        'SELECT id, season_code, season_name, start_date, end_date, is_active FROM seasons WHERE id = ? LIMIT 1',
        [seasonId]
      );
      if (!seasonRows[0]) throw createError('赛季不存在', 404, 'SEASON_NOT_FOUND');

      const where = ["rsr.season_id = ?", "rsr.status = 'approved'", 'r.is_active = 1'];
      const params = [seasonId];
      const query = String(options.query || '').trim();
      if (query) {
        where.push('(rsr.name_snapshot LIKE ? OR r.student_id LIKE ?)');
        params.push(`%${query}%`, `%${query}%`);
      }
      if (options.matchType) {
        const [matchType] = normalizeMatchTypes([options.matchType]);
        where.push('JSON_CONTAINS(rsr.match_types_snapshot, JSON_QUOTE(?))');
        params.push(matchType);
      }
      const whereSql = where.join(' AND ');
      const [countRows] = await connection.execute(
        `SELECT COUNT(*) AS total
           FROM referee_season_registrations rsr
           INNER JOIN referee r ON r.id = rsr.referee_id
          WHERE ${whereSql}`,
        params
      );
      const total = Number(countRows[0].total);
      const [rows] = await connection.execute(
        `SELECT rsr.*, r.student_id, r.is_active AS account_is_active
           FROM referee_season_registrations rsr
           INNER JOIN referee r ON r.id = rsr.referee_id
          WHERE ${whereSql}
          ORDER BY rsr.name_snapshot ASC, r.student_id ASC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params
      );
      return {
        season: seasonRows[0],
        items: rows.map(formatRegistration),
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: total === 0 ? 0 : Math.ceil(total / pageSize)
        }
      };
    } finally {
      connection.release();
    }
  }
}

module.exports = new SeasonRegistrationService();
module.exports.SeasonRegistrationError = SeasonRegistrationError;
module.exports.REGISTRATION_STATUSES = REGISTRATION_STATUSES;
module.exports.MATCH_TYPE_OPTIONS = MATCH_TYPE_OPTIONS;
module.exports.normalizePayload = normalizePayload;
