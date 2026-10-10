const bcrypt = require('bcryptjs');
const pool = require('../db');
const { recordSecurityEvent } = require('../utils/securityEvents');
const { validateAdminPassword } = require('../utils/passwordPolicy');

const BCRYPT_ROUNDS = 12;

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

async function verifyPasswordAndUpgradeIfNeeded(connection, admin, inputPassword) {
  const storedPassword = admin.password_hash;

  if (isBcryptHash(storedPassword)) {
    return bcrypt.compare(inputPassword, storedPassword);
  }

  const matched = storedPassword === inputPassword;
  if (!matched) return false;

  const hashedPassword = await bcrypt.hash(inputPassword, BCRYPT_ROUNDS);
  await connection.execute(
    `UPDATE admin
        SET password_hash = ?,
            must_change_password = 1,
            token_version = token_version + 1
      WHERE id = ?`,
    [hashedPassword, admin.id]
  );
  return true;
}

const adminService = {
  async login(username, password, suppliedConnection) {
    const connection = suppliedConnection || await pool.getConnection();
    try {
      if (!username || !password) {
        throw new Error('管理员账号或密码错误');
      }

      const [admins] = await connection.execute(
        `SELECT id, username, password_hash, must_change_password, token_version
           FROM admin
          WHERE username = ?
          LIMIT 1 FOR UPDATE`,
        [username]
      );

      if (admins.length === 0) {
        throw new Error('管理员账号或密码错误');
      }

      const admin = admins[0];
      const matched = await verifyPasswordAndUpgradeIfNeeded(connection, admin, password);
      if (!matched) {
        throw new Error('管理员账号或密码错误');
      }

      // 明文旧密码在上方升级时同时递增了版本并强制改密，重新读取实际状态。
      const [currentRows] = await connection.execute(
        `SELECT id, username, must_change_password, token_version
           FROM admin
          WHERE id = ?`,
        [admin.id]
      );
      return {
        id: currentRows[0].id,
        username: currentRows[0].username,
        must_change_password: Boolean(currentRows[0].must_change_password),
        token_version: Number(currentRows[0].token_version)
      };
    } finally {
      if (!suppliedConnection) connection.release();
    }
  },

  async getSecurityState(adminId) {
    const [rows] = await pool.execute(
      `SELECT id, username, must_change_password, token_version
         FROM admin
        WHERE id = ?
        LIMIT 1`,
      [adminId]
    );
    return rows[0] || null;
  },

  async updatePassword(adminId, oldPassword, newPassword, actor = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (!adminId || !oldPassword || !newPassword) {
        throw new Error('当前密码和新密码不能为空');
      }

      const [admins] = await connection.execute(
        `SELECT id, username, password_hash
           FROM admin
          WHERE id = ?
          LIMIT 1 FOR UPDATE`,
        [adminId]
      );
      if (admins.length === 0) {
        throw new Error('当前密码错误');
      }

      const admin = admins[0];
      const matched = await verifyPasswordAndUpgradeIfNeeded(connection, admin, oldPassword);
      if (!matched) {
        throw new Error('当前密码错误');
      }

      validateAdminPassword(newPassword, admin.username);
      if (oldPassword === newPassword) {
        throw new Error('新密码不能与当前密码相同');
      }

      const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await connection.execute(
        `UPDATE admin
            SET password_hash = ?,
                must_change_password = 0,
                password_changed_at = NOW(),
                token_version = token_version + 1
          WHERE id = ?`,
        [hashedPassword, admin.id]
      );

      await recordSecurityEvent(connection,'password_changed','admin',admin.id,actor);
      await connection.commit();
      return { success: true, message: '密码修改成功，请重新登录' };
    } catch (error) { await connection.rollback(); throw error;
    } finally {
      connection.release();
    }
  },

  async bootstrap(username, password) {
    const normalizedUsername = String(username || '').trim();
    if (!/^[A-Za-z0-9_.-]{3,50}$/.test(normalizedUsername)) {
      throw new Error('管理员用户名必须为3至50位，只能包含字母、数字、点、下划线或连字符');
    }
    validateAdminPassword(password, normalizedUsername);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [admins] = await connection.query(
        'SELECT id, username FROM admin ORDER BY id ASC FOR UPDATE'
      );
      const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
      let adminId;

      if (admins.length === 0) {
        const [result] = await connection.execute(
          `INSERT INTO admin
             (username, password_hash, must_change_password, password_changed_at, token_version)
           VALUES (?, ?, 0, NOW(), 1)`,
          [normalizedUsername, hashedPassword]
        );
        adminId = result.insertId;
      } else if (admins.length === 1) {
        adminId = admins[0].id;
        await connection.execute(
          `UPDATE admin
              SET username = ?,
                  password_hash = ?,
                  must_change_password = 0,
                  password_changed_at = NOW(),
                  token_version = token_version + 1
            WHERE id = ?`,
          [normalizedUsername, hashedPassword, adminId]
        );
      } else {
        const matched = admins.find(admin => admin.username === normalizedUsername);
        if (!matched) {
          throw new Error('数据库中已有多个管理员；为避免误改，请使用其中一个现有用户名执行安全重置');
        }
        adminId = matched.id;
        await connection.execute(
          `UPDATE admin
              SET password_hash = ?,
                  must_change_password = 0,
                  password_changed_at = NOW(),
                  token_version = token_version + 1
            WHERE id = ?`,
          [hashedPassword, adminId]
        );
      }

      await connection.commit();
      return { id: adminId, username: normalizedUsername };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
};

module.exports = adminService;
