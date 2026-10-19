const pool = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { recordSecurityEvent } = require('../utils/securityEvents');
const { validateRefereePassword } = require('../utils/passwordPolicy');
const { requireCollege } = require('../utils/collegeIdentity');
const { validateGrade, parseShanghaiFaRegistered, validateShanghaiFaUpdate } = require('../utils/refereeProfileRules');

const BCRYPT_ROUNDS = 10;
const ALLOWED_MATCH_TYPES = new Set([
  '院内赛',
  '足协杯',
  '大联赛',
  '新生杯',
  '区级及以上比赛'
]);
const MATCH_TYPE_ALIASES = new Map([
  ['校足协杯', '足协杯'],
  ['校大联赛', '大联赛'],
  ['校新生杯', '新生杯']
]);

function generateTemporaryPassword(length = 16) {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%*-_'
  ];
  const alphabet = groups.join('');
  const chars = groups.map(group => group[crypto.randomInt(group.length)]);
  while (chars.length < length) {
    chars.push(alphabet[crypto.randomInt(alphabet.length)]);
  }
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }
  return chars.join('');
}

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

function normalizeDateInput(value, label, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new Error(`${label}不能为空`);
    }
    return null;
  }

  const normalized = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${label}格式不正确`);
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${label}不是有效日期`);
  }
  return normalized;
}

function normalizePositiveNumber(value, label, { integer = false, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new Error(`${label}不能为空`);
    }
    return null;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0 || (integer && !Number.isInteger(normalized))) {
    throw new Error(`${label}必须是大于 0 的${integer ? '整数' : '数字'}`);
  }
  return normalized;
}

function normalizeNonNegativeInteger(value, label) {
  const normalized = Number(value ?? 0);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label}必须是大于等于 0 的整数`);
  }
  return normalized;
}

async function verifyPasswordAndUpgradeIfNeeded(connection, user, inputPassword) {
  const storedPassword = user.password_hash;

  // 已经是 bcrypt hash：正常 compare
  if (isBcryptHash(storedPassword)) {
    return bcrypt.compare(inputPassword, storedPassword);
  }

  // 旧明文密码：先按明文比对，成功后自动升级为 hash
  const matched = storedPassword === inputPassword;
  if (!matched) {
    return false;
  }

  const hashedPassword = await bcrypt.hash(inputPassword, BCRYPT_ROUNDS);
  await connection.execute(
    'UPDATE referee SET password_hash = ? WHERE id = ?',
    [hashedPassword, user.id]
  );

  return true;
}

class RefereeService {
  normalizeMatchTypes(matchTypes) {
    let normalized = [];
    if (Array.isArray(matchTypes)) {
      normalized = matchTypes;
    } else if (typeof matchTypes === 'string') {
      const trimmed = matchTypes.trim();
      if (!trimmed) {
        return [];
      }
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          normalized = Array.isArray(parsed) ? parsed : [trimmed];
        } catch (error) {
          normalized = trimmed.split(',');
        }
      } else {
        normalized = trimmed.split(',');
      }
    } else {
      return [];
    }

    return [...new Set(
      normalized
        .map(item => String(item).trim())
        .filter(Boolean)
        .map(item => MATCH_TYPE_ALIASES.get(item) || item)
    )];
  }

  validateMatchTypes(matchTypes) {
    const normalized = this.normalizeMatchTypes(matchTypes);
    if (normalized.length === 0) {
      throw new Error('请至少选择一种比赛种类');
    }

    const invalid = normalized.filter(item => !ALLOWED_MATCH_TYPES.has(item));
    if (invalid.length > 0) {
      throw new Error(`存在不支持的比赛种类：${invalid.join('、')}`);
    }

    return normalized;
  }

  // 裁判注册
  async register(registerData, actor = {}) {
    const {
      student_id,
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types,
      password,
      gender,
      college,
      height_cm,
      weight_kg,
      id_photo_path,
      officiated_count_base
    } = registerData;

    validateRefereePassword(password);
    requireCollege(college);
    validateGrade(grade);
    validateGrade(target_level, '目标级别');
    const shanghaiFaRegistered = parseShanghaiFaRegistered(registerData.shanghai_fa_registered, { allowMissing: true });

    const promotedAt = normalizeDateInput(level_promoted_at, '升入当前级别时间', { required: grade !== '裁判学员' });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 检查学号是否已存在
      const [existing] = await connection.execute(
        'SELECT id FROM referee WHERE student_id = ?',
        [student_id]
      );

      if (existing.length > 0) {
        throw new Error('学号已被注册');
      }

      // 获取比赛种类字符串（以逗号分隔）
      const normalizedMatchTypes = this.validateMatchTypes(match_types);
      const matchTypesStr = normalizedMatchTypes.length > 0 ? normalizedMatchTypes.join(',') : '';

      const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const normalizedHeight = normalizePositiveNumber(height_cm, '身高', { integer: true, required: true });
      const normalizedWeight = normalizePositiveNumber(weight_kg, '体重', { required: true });
      const normalizedBaseCount = normalizeNonNegativeInteger(officiated_count_base, '已执法场次基础值');

      // 插入新的裁判记录
      const [result] = await connection.execute(
        `INSERT INTO referee
           (student_id, name, grade, target_level, level_promoted_at, match_types, password_hash, password_changed_at, shanghai_fa_registered)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [student_id, name, grade, target_level, promotedAt, matchTypesStr, hashedPassword, shanghaiFaRegistered ? 1 : 0]
      );

      const refereeId = result.insertId;
      await connection.execute(
        `INSERT INTO referee_profile
         (referee_id, gender, college, height_cm, weight_kg, id_photo_path, officiated_count_base)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          refereeId,
          gender,
          college,
          normalizedHeight,
          normalizedWeight,
          id_photo_path || null,
          normalizedBaseCount
        ]
      );

      await recordSecurityEvent(connection, 'account_created', 'referee', refereeId, actor);
      await connection.commit();

      return {
        id: refereeId,
        student_id,
        name,
        shanghai_fa_registered: shanghaiFaRegistered
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // 裁判登录
  async login(student_id, password, suppliedConnection) {
    const connection = suppliedConnection || await pool.getConnection();
    try {
      const [users] = await connection.execute(
        `SELECT id, student_id, name, grade, target_level, match_types, password_hash,
                must_change_password, token_version, is_active, shanghai_fa_registered
           FROM referee
          WHERE student_id = ? FOR UPDATE`,
        [student_id]
      );

      if (users.length === 0) {
        throw new Error('学号或密码错误');
      }

      const user = users[0];
      if (!user.is_active) {
        throw new Error('账号已停用，请联系管理员');
      }
      const matched = await verifyPasswordAndUpgradeIfNeeded(connection, user, password);

      if (!matched) {
        throw new Error('学号或密码错误');
      }

      return {
        id: user.id,
        student_id: user.student_id,
        name: user.name,
        grade: user.grade,
        target_level: user.target_level,
        shanghai_fa_registered: Boolean(user.shanghai_fa_registered),
        match_types: this.normalizeMatchTypes(user.match_types),
        must_change_password: Boolean(user.must_change_password),
        token_version: Number(user.token_version)
      };
    } finally {
      if (!suppliedConnection) connection.release();
    }
  }

  // 获取裁判信息（含所有执法比赛列表）
  async getRefereeById(id) {
    const connection = await pool.getConnection();
    try {
      const [users] = await connection.execute(
        `SELECT r.id, r.student_id, r.name, r.grade, r.target_level, r.level_promoted_at, r.match_types,
                r.must_change_password, r.password_changed_at, r.token_version, r.is_active, r.shanghai_fa_registered,
                p.gender, p.college, p.height_cm, p.weight_kg, p.id_photo_path, p.officiated_count_base
         FROM referee r
         LEFT JOIN referee_profile p ON r.id = p.referee_id
         WHERE r.id = ?`,
        [id]
      );

      if (users.length === 0) {
        throw new Error('裁判不存在');
      }

      const user = users[0];
      if (user.match_types) {
        user.match_types = user.match_types.split(',');
      }
      user.shanghai_fa_registered = Boolean(user.shanghai_fa_registered);

      const [matchCount] = await connection.execute(
        `SELECT COUNT(*) as count
         FROM match_schedules m
         WHERE EXISTS (SELECT 1 FROM match_official_assignments a WHERE a.schedule_id=m.id AND a.referee_id=? AND a.source_type='system')`,
        [id]
      );

      const systemCount = matchCount[0]?.count || 0;
      const baseCount = user.officiated_count_base || 0;
      user.officiated_count_system = systemCount;
      user.officiated_count_total = baseCount + systemCount;

      // 查询该裁判的所有执法比赛
      const [matches] = await connection.execute(
        `SELECT m.id, m.match_type, m.match_date, TIME_FORMAT(m.match_time,'%H:%i') AS match_time,TIME_FORMAT(m.match_end_time,'%H:%i') AS match_end_time, m.field_order,
                m.team_a_name_snapshot, m.team_b_name_snapshot, m.supervisor_required,
                (SELECT GROUP_CONCAT(oa.role ORDER BY oa.id) FROM match_official_assignments oa WHERE oa.schedule_id=m.id AND oa.source_type='system' AND oa.referee_id=?) AS my_roles,
                CASE
                  WHEN m.main_referee_id = ? THEN 'main'
                  WHEN m.assistant1_id = ? THEN 'assistant1'
                  WHEN m.assistant2_id = ? THEN 'assistant2'
                  WHEN m.fourth_official_id = ? THEN 'fourth'
                  WHEN m.supervisor_id = ? THEN 'supervisor'
                END as my_role_code,
                mr.main_report_status, mr.supervisor_review_status
         FROM match_schedules m
         LEFT JOIN match_reports mr ON mr.schedule_id = m.id
         WHERE EXISTS (SELECT 1 FROM match_official_assignments a WHERE a.schedule_id=m.id AND a.referee_id=? AND a.source_type='system')
         ORDER BY m.match_date DESC, (m.match_time IS NULL) ASC, m.match_time ASC, m.field_order_sort ASC, m.field_order ASC, m.id ASC`,
        [id, id, id, id, id, id, id]
      );

      user.matches = matches.map(match => ({
        id: match.id,
        match_type: match.match_type,
        match_date: match.match_date,
        match_time: match.match_time,
        match_end_time: match.match_end_time,
        field_order: match.field_order,
        display_teams: `${match.team_a_name_snapshot} vs ${match.team_b_name_snapshot}`,
        my_role_code: match.my_role_code || (match.my_roles||'').split(',')[0],
        my_role_codes: (match.my_roles || '').split(',').filter(Boolean),
        supervisor_required: Boolean(match.supervisor_required),
        report_main_status: match.main_report_status,
        report_supervisor_status: match.supervisor_review_status
      }));

      return user;
    } finally {
      connection.release();
    }
  }

  // 获取所有裁判列表
  async getAllReferees({ includeAssociation = false } = {}) {
    const connection = await pool.getConnection();
    try {
      const [referees] = await connection.execute(
        `SELECT id, student_id, name, grade, match_types, is_active,
                must_change_password, password_changed_at, created_at
                ${includeAssociation ? ', shanghai_fa_registered' : ''}
           FROM referee
          ORDER BY created_at DESC`
      );
      return referees.map(referee => ({
        ...referee,
        ...(includeAssociation ? { shanghai_fa_registered: Boolean(referee.shanghai_fa_registered) } : {}),
        match_types: this.normalizeMatchTypes(referee.match_types)
      }));
    } finally {
      connection.release();
    }
  }

  async getSecurityState(id) {
    const [rows] = await pool.execute(
      `SELECT id, token_version, must_change_password, is_active
         FROM referee
        WHERE id = ?
        LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  // 裁判修改密码
  async updatePassword(id, oldPassword, newPassword, actor = {}) {
    validateRefereePassword(newPassword);
    if (oldPassword === newPassword) throw new Error('新密码不能与当前密码相同');

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute(
        'SELECT id, password_hash, is_active FROM referee WHERE id = ? FOR UPDATE',
        [id]
      );

      if (users.length === 0) {
        throw new Error('裁判不存在');
      }

      const user = users[0];
      if (!user.is_active) {
        throw new Error('账号已停用，请联系管理员');
      }
      const matched = await verifyPasswordAndUpgradeIfNeeded(connection, user, oldPassword);

      if (!matched) {
        throw new Error('旧密码错误');
      }

      const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

      await connection.execute(
        `UPDATE referee
            SET password_hash = ?,
                must_change_password = 0,
                password_changed_at = NOW(),
                token_version = token_version + 1
          WHERE id = ?`,
        [hashedPassword, id]
      );

      await recordSecurityEvent(connection, 'password_changed', 'referee', id, actor);
      await connection.commit();
      return { success: true, message: '密码修改成功' };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // 本人可独立维护的足协标记；不改变认证状态或赛季资料。
  async updateShanghaiFaRegistration(id, payload) {
    const registered = validateShanghaiFaUpdate(payload);
    const [result] = await pool.execute(
      'UPDATE referee SET shanghai_fa_registered = ? WHERE id = ?',
      [registered ? 1 : 0, id]
    );
    if (!result.affectedRows) throw new Error('裁判不存在');
    return { shanghai_fa_registered: registered };
  }

  async updateOwnGrade(id, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || !Object.hasOwn(payload, 'grade')
        || Object.keys(payload).some(key => !['grade', 'level_promoted_at'].includes(key))) {
      throw new Error('此接口只允许修改当前级别和升入当前级别时间');
    }
    const grade = validateGrade(payload.grade);
    if (payload.level_promoted_at !== undefined && payload.level_promoted_at !== null && payload.level_promoted_at !== ''
        && (typeof payload.level_promoted_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.level_promoted_at))) {
      throw new Error('升入当前级别时间格式不正确');
    }
    const promotedAt = normalizeDateInput(payload.level_promoted_at, '升入当前级别时间', { required: grade !== '裁判学员' });
    const [result] = await pool.execute('UPDATE referee SET grade = ?, level_promoted_at = ? WHERE id = ?', [grade, promotedAt, id]);
    if (!result.affectedRows) throw new Error('裁判不存在');
    return { grade, level_promoted_at: promotedAt };
  }

  async updateOwnCollege(id, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'college')) {
      throw new Error('此接口只允许修改学院');
    }
    const college = requireCollege(payload.college);
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [[account]] = await c.execute('SELECT id FROM referee WHERE id=? AND is_active=1 FOR UPDATE', [id]);
      if (!account) throw new Error('裁判账号不存在或已停用');
      await c.execute(`INSERT INTO referee_profile(referee_id,college) VALUES (?,?)
        ON DUPLICATE KEY UPDATE college=?`, [id,college,college]);
      await c.commit();
      return { college };
    } catch (error) { await c.rollback(); throw error; }
    finally { c.release(); }
  }

  async updateProfile(id, profileData) {
    validateGrade(profileData.grade);
    validateGrade(profileData.target_level, '目标级别');
    const {
      grade,
      target_level,
      level_promoted_at,
      match_types,
      gender,
      college,
      height_cm,
      weight_kg,
      id_photo_path
    } = profileData;
    const connection = await pool.getConnection();
    try {
      const normalizedMatchTypes = this.validateMatchTypes(match_types);
      const matchTypesStr = normalizedMatchTypes.length > 0 ? normalizedMatchTypes.join(',') : '';

      await connection.beginTransaction();

      const [[existing]] = await connection.execute('SELECT level_promoted_at FROM referee WHERE id = ? FOR UPDATE', [id]);
      if (!existing) throw new Error('裁判不存在');
      const promotedAt = normalizeDateInput(level_promoted_at === undefined ? existing.level_promoted_at : level_promoted_at,
        '升入当前级别时间', { required: grade !== '裁判学员' });

      await connection.execute(
        'UPDATE referee SET grade = ?, target_level = ?, level_promoted_at = ?, match_types = ? WHERE id = ?',
        [grade, target_level, promotedAt, matchTypesStr, id]
      );

      await connection.execute(
        `INSERT INTO referee_profile (referee_id, gender, college)
         VALUES (?, '其他', '未填写')
         ON DUPLICATE KEY UPDATE referee_id = referee_id`,
        [id]
      );

      const profileUpdates = [];
      const profileParams = [];

      if (gender !== undefined) {
        profileUpdates.push('gender = ?');
        profileParams.push(gender);
      }
      if (college !== undefined) {
        profileUpdates.push('college = ?');
        profileParams.push(college);
      }
      if (height_cm !== undefined) {
        profileUpdates.push('height_cm = ?');
        profileParams.push(normalizePositiveNumber(height_cm, '身高', { integer: true }));
      }
      if (weight_kg !== undefined) {
        profileUpdates.push('weight_kg = ?');
        profileParams.push(normalizePositiveNumber(weight_kg, '体重'));
      }
      if (id_photo_path !== undefined) {
        profileUpdates.push('id_photo_path = ?');
        profileParams.push(id_photo_path || null);
      }
      if (profileUpdates.length > 0) {
        profileParams.push(id);
        await connection.execute(
          `UPDATE referee_profile SET ${profileUpdates.join(', ')} WHERE referee_id = ?`,
          profileParams
        );
      }

      await connection.commit();

      return {
        success: true,
        message: '信息更新成功',
        data: { grade, target_level, level_promoted_at: promotedAt, match_types: normalizedMatchTypes }
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // 管理员手动添加裁判（字段与注册一致，不需要密码）
  async addRefereeByAdmin(refereeData, actor = {}) {
    validateGrade(refereeData.grade);
    validateGrade(refereeData.target_level, '目标级别');
    const {
      student_id,
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types,
      gender,
      college,
      height_cm,
      weight_kg,
      id_photo_path,
      officiated_count_base
    } = refereeData;

    if (!name || !student_id || !grade || !target_level) {
      throw new Error('学号、姓名、当前级别和目标级别为必填项');
    }
    const promotedAt = normalizeDateInput(level_promoted_at, '升入当前级别时间', { required: grade !== '裁判学员' });
    if (!Array.isArray(match_types) || match_types.length === 0) {
      throw new Error('请至少选择一种比赛种类');
    }

    const connection = await pool.getConnection();
    try {
      // 检查学号是否已存在
      const [existing] = await connection.execute(
        'SELECT id FROM referee WHERE student_id = ?',
        [student_id]
      );

      if (existing.length > 0) {
        throw new Error('学号已存在');
      }

      const normalizedMatchTypes = this.validateMatchTypes(match_types);
      const matchTypesStr = normalizedMatchTypes.length > 0 ? normalizedMatchTypes.join(',') : '';

      // 仅本次响应交付随机临时密码，不存明文，不再使用学号作为密码。
      const defaultPassword = generateTemporaryPassword();
      const hashedPassword = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);

      await connection.beginTransaction();

      const normalizedHeight = normalizePositiveNumber(height_cm, '身高', { integer: true });
      const normalizedWeight = normalizePositiveNumber(weight_kg, '体重');
      const normalizedBaseCount = normalizeNonNegativeInteger(officiated_count_base, '已执法场次基础值');
      const [result] = await connection.execute(
        `INSERT INTO referee
           (student_id, name, grade, target_level, level_promoted_at, match_types, password_hash, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [student_id, name, grade || null, target_level || null, promotedAt, matchTypesStr, hashedPassword]
      );

      const refereeId = result.insertId;
      await connection.execute(
        `INSERT INTO referee_profile
         (referee_id, gender, college, height_cm, weight_kg, id_photo_path, officiated_count_base)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          refereeId,
          gender || '其他',
          college || '未填写',
          normalizedHeight,
          normalizedWeight,
          id_photo_path || null,
          normalizedBaseCount
        ]
      );

      await recordSecurityEvent(connection, 'account_created', 'referee', refereeId, actor);
      await connection.commit();

      return {
        id: refereeId,
        student_id,
        temporary_password: defaultPassword,
        must_change_password: true,
        name,
        grade,
        target_level,
        match_types: normalizedMatchTypes
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // 管理员修改裁判信息
  async updateRefereeByAdmin(id, refereeData) {
    if (refereeData.grade !== undefined) validateGrade(refereeData.grade);
    if (refereeData.target_level !== undefined) validateGrade(refereeData.target_level, '目标级别');
    const {
      name,
      grade,
      target_level,
      level_promoted_at,
      match_types,
      gender,
      college,
      height_cm,
      weight_kg,
      id_photo_path,
      officiated_count_base
    } = refereeData;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [existing] = await connection.execute(
        'SELECT * FROM referee WHERE id = ? FOR UPDATE',
        [id]
      );

      if (existing.length === 0) {
        throw new Error('裁判不存在');
      }

      const promotedAt = normalizeDateInput(level_promoted_at === undefined ? existing[0].level_promoted_at : level_promoted_at,
        '升入当前级别时间', { required: (grade ?? existing[0].grade) !== '裁判学员' });

      const updates = [];
      const params = [];

      if (name) {
        updates.push('name = ?');
        params.push(name);
      }
      if (grade) {
        updates.push('grade = ?');
        params.push(grade);
      }
      if (target_level) {
        updates.push('target_level = ?');
        params.push(target_level);
      }
      if (level_promoted_at !== undefined) {
        updates.push('level_promoted_at = ?');
        params.push(promotedAt);
      }
      if (match_types) {
        const matchTypes = this.validateMatchTypes(match_types);
        const matchTypesStr = matchTypes.length > 0 ? matchTypes.join(',') : '';
        updates.push('match_types = ?');
        params.push(matchTypesStr);
      }

      if (updates.length > 0) {
        params.push(id);
        const sql = `UPDATE referee SET ${updates.join(', ')} WHERE id = ?`;
        await connection.execute(sql, params);
      }

      await connection.execute(
        `INSERT INTO referee_profile (referee_id, gender, college)
         VALUES (?, '其他', '未填写')
         ON DUPLICATE KEY UPDATE referee_id = referee_id`,
        [id]
      );

      const profileUpdates = [];
      const profileParams = [];

      if (gender !== undefined) {
        const normalizedGender = String(gender).trim();
        if (!normalizedGender) throw new Error('性别不能为空');
        profileUpdates.push('gender = ?');
        profileParams.push(normalizedGender);
      }
      if (college !== undefined) {
        const normalizedCollege = String(college).trim();
        if (!normalizedCollege) throw new Error('学院不能为空');
        profileUpdates.push('college = ?');
        profileParams.push(normalizedCollege);
      }
      if (height_cm !== undefined) {
        profileUpdates.push('height_cm = ?');
        profileParams.push(normalizePositiveNumber(height_cm, '身高', { integer: true, required: true }));
      }
      if (weight_kg !== undefined) {
        profileUpdates.push('weight_kg = ?');
        profileParams.push(normalizePositiveNumber(weight_kg, '体重', { required: true }));
      }
      if (profileUpdates.length > 0) {
        profileParams.push(id);
        await connection.execute(
          `UPDATE referee_profile SET ${profileUpdates.join(', ')} WHERE referee_id = ?`,
          profileParams
        );
      }

      if (id_photo_path !== undefined) {
        await connection.execute(
          'UPDATE referee_profile SET id_photo_path = ? WHERE referee_id = ?',
          [id_photo_path || null, id]
        );
      }

      if (officiated_count_base !== undefined) {
        const baseCount = normalizeNonNegativeInteger(officiated_count_base, '已执法场次基础值');
        await connection.execute(
          'UPDATE referee_profile SET officiated_count_base = ? WHERE referee_id = ?',
          [baseCount, id]
        );
      }

      await connection.commit();
      return await this.getRefereeById(id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async setActiveByAdmin(id, isActive, actor = {}) {
    const normalizedActive = isActive === true || isActive === 1 || isActive === '1';
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT id, is_active FROM referee WHERE id = ? FOR UPDATE',
        [id]
      );
      if (rows.length === 0) {
        throw new Error('裁判不存在');
      }

      if (Boolean(rows[0].is_active) !== normalizedActive) {
        await connection.execute(
          `UPDATE referee
              SET is_active = ?, token_version = token_version + 1
            WHERE id = ?`,
          [normalizedActive ? 1 : 0, id]
        );
        await recordSecurityEvent(connection, normalizedActive ? 'account_enabled' : 'account_disabled', 'referee', id, actor);
      }

      await connection.commit();
      return await this.getRefereeById(id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async resetPasswordByAdmin(id, actor = {}) {
    const temporaryPassword = generateTemporaryPassword();
    validateRefereePassword(temporaryPassword);
    const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    const connection = await pool.getConnection();
    try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE referee
          SET password_hash = ?,
              must_change_password = 1,
              password_changed_at = NULL,
              token_version = token_version + 1
        WHERE id = ?`,
      [hashedPassword, id]
    );
    if (result.affectedRows === 0) {
      throw new Error('裁判不存在');
    }
    await recordSecurityEvent(connection, 'password_reset', 'referee', id, actor);
    await connection.commit();
    return { temporary_password: temporaryPassword };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  // 管理员删除裁判
  async deleteRefereeByAdmin(id, actor = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [[account]] = await connection.execute('SELECT id FROM referee WHERE id=? FOR UPDATE',[id]);
      if (!account) throw new Error('裁判不存在');
      const [[history]] = await connection.execute(`SELECT
        (SELECT COUNT(*) FROM referee_season_registrations WHERE referee_id=?) +
        (SELECT COUNT(*) FROM match_official_assignments WHERE referee_id=?) +
        (SELECT COUNT(*) FROM report_section_history WHERE actor_referee_id=?) AS total`,[id,id,id]);
      if (Number(history.total)) throw new Error('该账号已有注册或比赛历史，请使用停用，不能删除');
      const [referenceRows] = await connection.execute(
        `SELECT
           (SELECT COUNT(*)
              FROM match_schedules
             WHERE main_referee_id = ?
                OR assistant1_id = ?
                OR assistant2_id = ?
                OR fourth_official_id = ?
                OR supervisor_id = ?) AS schedule_count,
           (SELECT COUNT(*) FROM match_referee_stats WHERE referee_id = ?) AS stats_count,
           (SELECT COUNT(*)
              FROM match_referee_reviews
             WHERE reviewer_referee_id = ? OR target_referee_id = ?) AS review_count`,
        [id, id, id, id, id, id, id, id]
      );

      const references = referenceRows[0] || {};
      const referenceCount =
        Number(references.schedule_count || 0) +
        Number(references.stats_count || 0) +
        Number(references.review_count || 0);

      if (referenceCount > 0) {
        throw new Error('该裁判已有赛程或报告历史记录，无法删除');
      }

      const [result] = await connection.execute(
        'DELETE FROM referee WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        throw new Error('裁判不存在');
      }

      await recordSecurityEvent(connection, 'account_deleted', 'referee', id, actor);
      await connection.commit();
      return { success: true, message: '裁判删除成功' };
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        throw new Error('该裁判已有赛程或报告历史记录，无法删除');
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = new RefereeService();
