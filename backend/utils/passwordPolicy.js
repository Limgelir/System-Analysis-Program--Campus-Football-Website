const COMMON_PASSWORDS = new Set([
  '1234',
  '123456',
  '12345678',
  'password',
  'admin',
  'admin123',
  'qwerty123'
]);

function getPasswordCharacterClassCount(password) {
  return [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ].filter(Boolean).length;
}

function validateAdminPassword(password, username = '') {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('管理员密码长度不能少于12位');
  }
  if (password.length > 128) {
    throw new Error('管理员密码长度不能超过128位');
  }
  if (getPasswordCharacterClassCount(password) < 3) {
    throw new Error('管理员密码必须包含大小写字母、数字和特殊字符中的至少三类');
  }

  const normalizedPassword = password.toLowerCase();
  const normalizedUsername = String(username || '').trim().toLowerCase();
  if (COMMON_PASSWORDS.has(normalizedPassword)) {
    throw new Error('管理员密码过于简单');
  }
  if (normalizedUsername && normalizedPassword.includes(normalizedUsername)) {
    throw new Error('管理员密码不能包含管理员用户名');
  }

  return true;
}

function validateRefereePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('密码长度不能少于8位');
  }
  if (password.length > 128) {
    throw new Error('密码长度不能超过128位');
  }
  if (getPasswordCharacterClassCount(password) < 2) {
    throw new Error('密码必须至少包含字母、数字或特殊字符中的两类');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new Error('密码过于简单');
  }
  return true;
}

module.exports = {
  COMMON_PASSWORDS,
  getPasswordCharacterClassCount,
  validateAdminPassword,
  validateRefereePassword
};
