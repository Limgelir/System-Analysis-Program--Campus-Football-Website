const pool = require('../db');

function isValidDateString(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false;
  }
  const [year, month, day] = trimmed.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeSeasonPayload(payload = {}) {
  return {
    season_code: typeof payload.season_code === 'string' ? payload.season_code.trim() : '',
    season_name: typeof payload.season_name === 'string' ? payload.season_name.trim() : '',
    start_date: typeof payload.start_date === 'string' ? payload.start_date.trim() : '',
    end_date: typeof payload.end_date === 'string' ? payload.end_date.trim() : '',
    is_active:
      payload.is_active === true ||
      payload.is_active === 1 ||
      payload.is_active === '1' ||
      payload.is_active === 'true'
  };
}

class SeasonService {
  async getAllSeasons() {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        `
          SELECT
            id,
            season_code,
            season_name,
            start_date,
            end_date,
            is_active,
            created_at,
            updated_at
          FROM seasons
          ORDER BY start_date DESC, id DESC
        `
      );

      return rows;
    } finally {
      connection.release();
    }
  }

  async getCurrentSeason() {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        `
          SELECT
            id,
            season_code,
            season_name,
            start_date,
            end_date,
            is_active,
            created_at,
            updated_at
          FROM seasons
          WHERE is_active = 1
          LIMIT 1
        `
      );

      return rows.length > 0 ? rows[0] : null;
    } finally {
      connection.release();
    }
  }

  async createSeason(payload) {
    const data = normalizeSeasonPayload(payload);

    if (!data.season_code || !data.season_name || !data.start_date || !data.end_date) {
      throw new Error('赛季编码、赛季名称、开始日期、结束日期均为必填项');
    }

    if ([...data.season_code].length > 20) throw new Error('赛季编码不能超过20个字符');
    if ([...data.season_name].length > 20) throw new Error('赛季名称不能超过20个字符');

    if (!isValidDateString(data.start_date) || !isValidDateString(data.end_date)) {
      throw new Error('日期格式不正确，请使用 YYYY-MM-DD');
    }

    if (data.start_date > data.end_date) {
      throw new Error('赛季开始日期不能晚于结束日期');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [duplicateRows] = await connection.execute(
        `
          SELECT id, season_code, season_name
          FROM seasons
          WHERE season_code = ? OR season_name = ?
          LIMIT 1
        `,
        [data.season_code, data.season_name]
      );

      if (duplicateRows.length > 0) {
        throw new Error('赛季编码或赛季名称已存在');
      }

      if (data.is_active) {
        await connection.execute(
          `UPDATE seasons SET is_active = 0 WHERE is_active = 1`
        );
      }

      const [result] = await connection.execute(
        `
          INSERT INTO seasons (
            season_code,
            season_name,
            start_date,
            end_date,
            is_active
          ) VALUES (?, ?, ?, ?, ?)
        `,
        [
          data.season_code,
          data.season_name,
          data.start_date,
          data.end_date,
          data.is_active ? 1 : 0
        ]
      );

      const [rows] = await connection.execute(
        `
          SELECT
            id,
            season_code,
            season_name,
            start_date,
            end_date,
            is_active,
            created_at,
            updated_at
          FROM seasons
          WHERE id = ?
          LIMIT 1
        `,
        [result.insertId]
      );

      await connection.commit();
      return rows[0];
    } catch (error) {
      await connection.rollback();

      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('赛季编码或赛季名称已存在');
      }

      throw error;
    } finally {
      connection.release();
    }
  }

  async activateSeason(seasonId) {
    const id = Number(seasonId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('无效的赛季ID');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [existingRows] = await connection.execute(
        `
          SELECT id, season_code, season_name, is_active
          FROM seasons
          WHERE id = ?
          LIMIT 1
        `,
        [id]
      );

      if (existingRows.length === 0) {
        throw new Error('赛季不存在');
      }

      await connection.execute(`UPDATE seasons SET is_active = 0 WHERE is_active = 1`);
      await connection.execute(`UPDATE seasons SET is_active = 1 WHERE id = ?`, [id]);

      const [rows] = await connection.execute(
        `
          SELECT
            id,
            season_code,
            season_name,
            start_date,
            end_date,
            is_active,
            created_at,
            updated_at
          FROM seasons
          WHERE id = ?
          LIMIT 1
        `,
        [id]
      );

      await connection.commit();
      return rows[0];
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deactivateSeason(seasonId) {
    const id = Number(seasonId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('无效的赛季ID');
    }

    const connection = await pool.getConnection();
    try {
      const [existingRows] = await connection.execute(
        `
          SELECT
            id,
            season_code,
            season_name,
            start_date,
            end_date,
            is_active,
            created_at,
            updated_at
          FROM seasons
          WHERE id = ?
          LIMIT 1
        `,
        [id]
      );

      if (existingRows.length === 0) {
        throw new Error('赛季不存在');
      }

      await connection.execute(`UPDATE seasons SET is_active = 0 WHERE id = ?`, [id]);

      return {
        ...existingRows[0],
        is_active: 0
      };
    } finally {
      connection.release();
    }
  }
}

module.exports = new SeasonService();
