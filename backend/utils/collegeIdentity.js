const catalog = require('../../shared-data/colleges.json');
const COLLEGE_RULE_VERSION = 'account-college-catalog-v1';
const COLLEGES = Object.freeze(catalog.map(item => item.name));
const choices = new Set(COLLEGES);
const matchKey = value => collegeName(value).replace(/^同济大学\s*/, '').replace(/\s/g, '').replace(/\(/g, '（').replace(/\)/g, '）');
const matches = new Map();
for (const item of catalog) for (const name of [item.name, ...item.aliases]) {
  const key = matchKey(name);
  if (matches.has(key) && matches.get(key) !== item.name) throw Error('学院别名存在歧义：' + name);
  matches.set(key, item.name);
}

function collegeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Similar spelling alone cannot establish affiliation after reorganizations.
function matchCollege(value) {
  const name = collegeName(value), college = matches.get(matchKey(value)) || null;
  return { college, method: !college ? 'unmatched' : value === college ? 'exact' : matchKey(name) === matchKey(college) ? 'normalized' : 'alias' };
}
function requireCollege(value) {
  if (typeof value !== 'string' || !choices.has(value)) {
    throw require('./playerRules').businessError('请从学院列表中选择学院', 400, 'COLLEGE_SELECTION_REQUIRED');
  }
  return value;
}
// Unresolved legacy values retain their identity until the owner makes a choice.
const resolveCollege = collegeName;
module.exports = { COLLEGE_RULE_VERSION, COLLEGES, collegeName, resolveCollege, matchCollege, requireCollege, matchKey };
