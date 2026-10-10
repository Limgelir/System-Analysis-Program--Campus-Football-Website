const { validateRefereePassword } = require('./passwordPolicy');
const crypto = require('node:crypto');

function businessError(message, statusCode = 400, code = 'PLAYER_VALIDATION') {
  return Object.assign(new Error(message), { statusCode, code, isBusinessError: true });
}
function requiredText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw businessError(`${label}不能为空且不能超过${max}字`);
  }
  return value.trim();
}
function studentId(value) {
  const id = requiredText(value, '学号', 50);
  if (/\s/.test(id)) throw businessError('学号不能包含空格');
  return id;
}
function password(value) {
  try { validateRefereePassword(value); } catch (error) { throw businessError(error.message); }
  // bcrypt只处理前72字节，不允许静默截断长密码。
  if (Buffer.byteLength(value, 'utf8') > 72) throw businessError('密码不能超过72字节（中文字符占用多个字节）');
  return value;
}
function revision(header) {
  if (typeof header !== 'string' || !/^(0|[1-9]\d*)$/.test(header) || !Number.isSafeInteger(Number(header))) {
    throw businessError('请刷新账号资料后重试', 409, 'PLAYER_REVISION_REQUIRED');
  }
  return Number(header);
}
function id(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw businessError('账号编号不正确');
  return Number(value);
}
function onlyKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    throw businessError('请求包含不支持的字段');
  }
}
function temporaryPassword() {
  return `Aa!7${crypto.randomBytes(12).toString('base64url')}`;
}
function gender(value) { if (!['male','female'].includes(value)) throw businessError('请选择性别（男或女）'); return value; }
module.exports = { gender, businessError, requiredText, studentId, password, revision, id, onlyKeys, temporaryPassword };
