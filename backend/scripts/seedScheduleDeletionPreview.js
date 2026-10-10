const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ api, refs, season, comp, teams, password, cache, base, playerPort, connection }) => {
  const day = n => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
  const external = [];
  for (let i = 1; i <= 2; i++) external.push(await api('/officials/external', { name: '删除验收助理裁判员' + i }));
  const common = { match_type: comp.league_type, team_a_id: teams[0], team_b_id: teams[1], match_date: day(2), match_time: '17:35', venue: '嘉定人草' };
  const assigned = { main_referee_id: refs[0].id, assistant1_id: 'external:' + external[0].id, assistant2_id: 'external:' + external[1].id, fourth_official_id: refs[1].id, supervisor_id: refs[0].id };
  const matches = [];
  async function create(field_order, label, extra = {}) {
    const match = await api('/schedule', { ...common, field_order, ...extra });
    matches.push({ id: match.id, field_order, label, url: base + '/admin-schedule/' + match.id });
    return match;
  }
  async function signup(match) {
    await api('/match-signups/' + match.id, { action: 'save', intentions: ['main'], revision: 0, schedule_revision: match.schedule_revision }, 'PUT', refs[0].token);
  }
  await create('D1', '未报名、未选派，可以删除');
  await signup(await create('D2', '已有裁判报名，可以删除'));
  await create('D3', '完整选派、裁判员兼任裁判监督，可以删除', assigned);
  const reported = await create('D4', '已有报名、裁判员草稿、已提交裁判监督报告，可以一起删除', assigned);
  await signup(reported);
  await api('/report/schedule/' + reported.id + '/main', { home_score: 0, away_score: 0, stats: [{ role: 'main', running_distance_m: 5000 }] }, 'POST', refs[0].token);
  await api('/report/schedule/' + reported.id + '/supervisor', { reviews: ['main', 'assistant1', 'assistant2', 'fourth'].map(target_role => ({ target_role, score: 8, advice: '本地删除验收' })) }, 'POST', refs[0].token);
  await api('/report/schedule/' + reported.id + '/supervisor/submit', {}, 'POST', refs[0].token);
  await create('P1', '已过开球时间，不能删除', { match_date: day(-1), ...assigned });
  const unknown = await create('U1', '开球时间待定，补齐未来时间后才能删除');
  // Only this synthetic fixture emulates a legacy schedule with no kickoff time.
  await connection.execute('UPDATE match_schedules SET match_time=NULL WHERE id=?', [unknown.id]);
  await signup(await create('QA1', '浏览器自动验收专用，验收后删除', assigned));
  const credentials = {
    warning: '仅本地随机数据库，全部为虚构资料。',
    admin: { username: 'competition-admin', password, url: base + '/admin-login' },
    referees: refs.map((r, i) => ({ student_id: 'LOCAL-REF-' + (i + 1), password, url: base + '/referee-login' })),
    season, matches, admin_url: base, player_url: `http://127.0.0.1:${playerPort}`
  };
  const file = path.join(cache, 'schedule-deletion-preview.seed');
  fs.writeFileSync(file, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  console.log('开球前删除验收环境已就绪：' + base + '；本地凭据：' + file);
};
