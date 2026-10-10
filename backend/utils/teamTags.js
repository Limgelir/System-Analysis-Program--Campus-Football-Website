const rules = require('./playerRules');
const TAGS = Object.freeze([
  { key: 'foreign', flag: 'is_foreign', label: '外援', limit: 'max_foreign_players' },
  { key: 'sports_training', flag: 'is_sports_training', label: '运训', limit: 'max_sports_training_players', enabled: 'enable_sports_training' },
  { key: 'football_specialty', flag: 'is_football_specialty', label: '足球特长生', limit: 'max_football_specialty_players', enabled: 'enable_football_specialty' }
]);
const CONFIG_FIELDS = ['enable_sports_training', 'enable_football_specialty', 'combined_player_limits'];
const enabled = (config, key) => key === 'foreign' || (key === 'sports_training' ? config.enable_sports_training == null || Boolean(config.enable_sports_training) : Boolean(config.enable_football_specialty));
function normalize(config) {
  const result = {};
  for (const [key, fallback] of [['enable_sports_training', true], ['enable_football_specialty', false]]) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') throw rules.businessError('赛事标签开关必须为是或否');
    result[key] = config[key] ?? fallback;
  }
  const limits = config.combined_player_limits ?? [];
  if (!Array.isArray(limits) || limits.length > 4) throw rules.businessError('合并人数限制格式不正确，最多4组');
  const seen = new Set();
  result.combined_player_limits = limits.map(item => {
    rules.onlyKeys(item, ['tags', 'max']);
    if (!Array.isArray(item.tags) || item.tags.length < 2 || item.tags.length > 3 || new Set(item.tags).size !== item.tags.length || item.tags.some(k => !TAGS.some(t => t.key === k) || !enabled(result, k))) throw rules.businessError('每组合并限制须选择至少两个已启用的标签，且不能重复');
    if (!Number.isSafeInteger(item.max) || item.max < 0 || item.max > 2147483647) throw rules.businessError('合并人数上限须为非负整数');
    const tags = TAGS.filter(t => item.tags.includes(t.key)).map(t => t.key), key = tags.join('+');
    if (seen.has(key)) throw rules.businessError('同一组标签不能重复设置合并限制');
    seen.add(key);
    return { tags, max: item.max };
  });
  return result;
}
function visibleMembers(config, members) {
  return members.map(m => ({ ...m, ...Object.fromEntries(TAGS.filter(t => !enabled(config, t.key)).map(t => [t.flag, false])) }));
}
// Hide disabled structured labels even in historical review DTOs, without rewriting evidence.
function present(config, value) {
  if (Array.isArray(value)) return value.map(v => present(config, v)).filter(v => v !== undefined);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  if (value.rule && TAGS.some(t => !enabled(config, t.key) && (value.rule === t.limit || value.tags?.includes(t.key)))) return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const tag = TAGS.find(t => key === t.flag || key === t.key || key === t.limit);
    if (tag && !enabled(config, tag.key)) continue;
    if (['changes','differences'].includes(key) && Array.isArray(item)) result[key] = item.filter(line => !TAGS.some(t => !enabled(config, t.key) && line.includes(t.label)));
    else if (key === 'reason' && value.operation === 'auto_failed') result[key] = present(config, value.after_snapshot?.auto_review)?.failures?.map(f => f.message).join('；') || '当次自动审核未通过';
    else result[key] = present(config, item);
  }
  return result;
}
async function projectRoster(c, team, players) {
  const [[config]] = await c.execute('SELECT enable_sports_training,enable_football_specialty FROM season_competitions WHERE season_id=? AND league_type=?', [team.season_id,team.league_type]);
  return present(config || {}, players);
}
module.exports = { projectRoster, TAGS, CONFIG_FIELDS, enabled, normalize, visibleMembers, present };
