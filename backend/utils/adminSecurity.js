const bcrypt = require('bcryptjs');

const KNOWN_WEAK_PASSWORDS = ['1234', '123456', '12345678', 'password', 'admin123'];

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

async function assertSecureProductionAdmins(connection) {
  const [admins] = await connection.query(`
    SELECT id, username, password_hash, must_change_password
      FROM admin
     ORDER BY id ASC
  `);

  if (admins.length === 0) {
    throw new Error('尚未创建管理员，请先运行 npm run admin:bootstrap');
  }

  for (const admin of admins) {
    if (!isBcryptHash(admin.password_hash)) {
      throw new Error(`管理员 ${admin.username} 仍使用旧式密码，请先运行 npm run admin:bootstrap`);
    }
    if (admin.must_change_password) {
      throw new Error(`管理员 ${admin.username} 尚未完成安全密码设置，请先运行 npm run admin:bootstrap`);
    }

    const candidates = [...KNOWN_WEAK_PASSWORDS, admin.username];
    for (const candidate of new Set(candidates)) {
      if (await bcrypt.compare(candidate, admin.password_hash)) {
        throw new Error(`管理员 ${admin.username} 使用已知弱密码，请先运行 npm run admin:bootstrap`);
      }
    }
  }
}

module.exports = {
  KNOWN_WEAK_PASSWORDS,
  isBcryptHash,
  assertSecureProductionAdmins
};
