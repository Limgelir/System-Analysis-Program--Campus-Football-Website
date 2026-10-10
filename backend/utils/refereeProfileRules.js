const REFEREE_GRADES = Object.freeze(['裁判学员', '三级', '二级', '一级', '预备国家级', '国家级']);

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, isBusinessError: true });
}

function validateGrade(value, label = '当前级别') {
  if (!REFEREE_GRADES.includes(value)) {
    throw invalid(`${label}必须是${REFEREE_GRADES.join('、')}`);
  }
  return value;
}

// Multipart 表单使用字符串；不能用 Boolean('false') 解析。
function parseShanghaiFaRegistered(value, { allowMissing = false } = {}) {
  if (value === undefined && allowMissing) return false;
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  throw invalid('是否在上海足协注册必须明确选择是或否');
}

function validateShanghaiFaUpdate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).length !== 1
      || !Object.hasOwn(payload, 'shanghai_fa_registered')) {
    throw invalid('此接口只允许修改是否在上海足协注册');
  }
  return parseShanghaiFaRegistered(payload.shanghai_fa_registered);
}

module.exports = { REFEREE_GRADES, validateGrade, parseShanghaiFaRegistered, validateShanghaiFaUpdate };
