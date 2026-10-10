// Counts and identity/college resolution are supplied by the caller. This pure
// evaluator does not change an application or grant permission to submit it.
const { COLLEGE_RULE_VERSION, collegeName, resolveCollege } = require('./collegeIdentity');
const tags = require('./teamTags');
const LIMIT_FIELDS = Object.freeze([
  'min_players',
  'max_players',
  'max_colleges',
  'max_foreign_players',
  'max_sports_training_players',
  'max_football_specialty_players'
]);

function normalize(body) {
  const result = {};
  for (const field of LIMIT_FIELDS) {
    const value = body[field];
    if (value == null || value === '') { result[field] = null; continue; }
    if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) {
      throw require('./playerRules').businessError('报名人数和学院限制须为非负整数，留空表示不限');
    }
    result[field] = value;
  }
  if (result.min_players != null && result.max_players != null && result.min_players > result.max_players) {
    throw require('./playerRules').businessError('大名单最低人数不能大于最高人数');
  }
  return result;
}

function fromMembers(limits, members) {
  members = tags.visibleMembers(limits, members);
  const groups = new Map();
  for (const member of members) {
    const name = resolveCollege(member.college);
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, new Set());
    groups.get(name).add(collegeName(member.college));
  }
  const colleges = [...groups.keys()].sort();
  const college_groups = colleges.map(name => ({ name, account_names: [...groups.get(name)].sort() }));
  const counts = { total: members.length, colleges: colleges.length, ...Object.fromEntries(tags.TAGS.map(t => [t.key, members.filter(m => m[t.flag]).length])) };
  const result = evaluate(limits, counts);
  for (const group of limits.combined_player_limits || []) {
    if (group.tags.some(key => !tags.enabled(limits, key))) continue;
    const actual = members.filter(m => group.tags.some(key => m[tags.TAGS.find(t => t.key === key).flag])).length;
    const check = { rule: 'combined:' + group.tags.join('+'), tags: group.tags, actual, limit: group.max, passed: actual <= group.max, message: `${group.tags.map(key => tags.TAGS.find(t => t.key === key).label).join('＋')}合计（去重）为${actual}人，要求不多于${group.max}人` };
    result.checks.push(check);
    if (!check.passed) { result.failures.push(check); result.passed = false; }
  }
  if (limits.max_colleges != null) {
    const missing = members.filter(m => !collegeName(m.college));
    if (missing.length) {
      const check = { rule: 'account_college_missing', actual: missing.length, limit: null, passed: false, message: `${missing.length}名球员的账号最新资料缺少学院，请补齐账号学院后重提` };
      result.checks.push(check); result.failures.push(check); result.passed = false;
    }
  }
  return { ...result, counts, colleges, college_groups, college_source: 'account_profile', college_rule_version: COLLEGE_RULE_VERSION, limits: Object.fromEntries([...LIMIT_FIELDS, ...tags.CONFIG_FIELDS].map(k => [k, limits[k] ?? null])) };
}

function evaluate(limits, counts) {
  const checks = [];
  const compare = (field, actual, label, minimum = false) => {
    const limit = limits[field];
    if (limit == null) return;
    const passed = minimum ? actual >= limit : actual <= limit;
    checks.push({
      rule: field,
      actual,
      limit,
      passed,
      message: `${label}为${actual}，要求${minimum ? '不少于' : '不多于'}${limit}`
    });
  };
  compare('min_players', counts.total, '大名单人数', true);
  compare('max_players', counts.total, '大名单人数');
  compare('max_colleges', counts.colleges, '学院数量');
  compare('max_foreign_players', counts.foreign, '外援人数');
  if (tags.enabled(limits, 'sports_training')) compare('max_sports_training_players', counts.sports_training, '运训人数');
  if (tags.enabled(limits, 'football_specialty')) compare('max_football_specialty_players', counts.football_specialty, '足球特长生人数');
  return { passed: checks.every(check => check.passed), checks, failures: checks.filter(check => !check.passed) };
}

module.exports = { LIMIT_FIELDS, normalize, evaluate, fromMembers };
