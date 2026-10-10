const { businessError } = require('./playerRules');
const PRESETS = Object.freeze(['大联赛', '新生杯', '四平足协杯', '嘉定足协杯']);
const RULE_FIELDS = Object.freeze(['yellow_threshold', 'yellow_suspension', 'red_threshold', 'red_suspension']);
function competitionName(value) {
  if (typeof value !== 'string') throw businessError('请填写赛事名称');
  const name = value.trim();
  if (!name || [...name].length > 50 || /[\u0000-\u001f\u007f]/u.test(name) || name === '其它') throw businessError('赛事名称须为1—50个字符；选择其它时请填写具体名称');
  return name;
}
function disciplineRules(value) {
  const result = {};
  for (const field of RULE_FIELDS) {
    if (typeof value[field] !== 'number' || !Number.isSafeInteger(value[field]) || value[field] < 1 || value[field] > 100) throw businessError('红黄牌累计张数和停赛场数均须为1—100的整数');
    result[field] = value[field];
  }
  return result;
}
function fieldOrder(value) {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) return null;
  const result = String(value).trim();
  return result && [...result].length <= 50 && !/[\u0000-\u001f\u007f]/u.test(result) ? result : null;
}
// Numeric runs sort naturally without casting the field order to an integer.
function fieldOrderSortKey(value) {
  return String(value ?? '').replace(/\d+/g, part => {
    const digits = part.replace(/^0+(?=\d)/, '');
    return `#${String(digits.length).padStart(2, '0')}:${digits}`;
  });
}
module.exports = { PRESETS, RULE_FIELDS, competitionName, disciplineRules, fieldOrder, fieldOrderSortKey };
