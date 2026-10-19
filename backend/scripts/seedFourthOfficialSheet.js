// Synthetic fixtures shared by the isolated acceptance server and API tests.
module.exports = async function seed(c, { active = false } = {}) {
  const seasonId = (await c.execute('INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES (?,?,?,?,?)', ['FOURTH-SHEET', '四官单本地验收', '2026-01-01', '2099-12-31', Number(active)]))[0].insertId;
  const eleven = await seedCompetition(c, seasonId, { league: '大联赛', names: ['土木工程学院', '机械与能源工程学院'], count: 30, prefix: 'A' });
  const eight = await seedCompetition(c, seasonId, { league: '足协杯', names: ['建筑与城市规划学院', '电子与信息工程学院'], count: 17, prefix: 'B' });
  return { seasonId, ...eleven, eight };
};

async function seedCompetition(c, seasonId, { league, names, count, prefix }) {
  const competitionId = (await c.execute('INSERT INTO season_competitions(season_id,league_type,yellow_threshold,yellow_suspension,red_threshold,red_suspension,enable_sports_training,enable_football_specialty) VALUES (?,?,3,1,1,1,1,1)', [seasonId, league]))[0].insertId;
  const teams = [], batches = [], players = [];
  for (const [index, name] of names.entries()) {
    const colors = index ? ['蓝', '白', '蓝'] : ['红', '白', '红'];
    const team = (await c.execute('INSERT INTO team(season_id,team_name,league_type,shirt_color,shorts_color,socks_color) VALUES (?,?,?,?,?,?)', [seasonId, name, league, ...colors]))[0].insertId;
    const batch = (await c.execute('INSERT INTO team_roster_batches(team_id,season_id,version_no,effective_from,metadata_snapshot) VALUES (?,?,1,?,?)', [team, seasonId, '2026-01-01', JSON.stringify({ shirt_color: colors[0], shorts_color: colors[1], socks_color: colors[2] })]))[0].insertId;
    teams.push(team); batches.push(batch); players.push([]);
    for (let n = count; n >= 1; n--) {
      const name = n === 1 && index === 0 ? '阿卜杜热合曼·买买提江'
        : n === 7 ? 'Christopher Alexander Montgomery'
          : n === 8 ? '欧阳慕容司马长明'
            : ['张', '李', '王', '赵', '陈'][(n - 1) % 5] + ['一', '二', '三', '四', '五', '六'][Math.floor((n - 1) / 5)] + '明';
      const p = (await c.execute(`INSERT INTO team_player(roster_batch_id,team_id,jersey_number,player_name,is_captain,is_goalkeeper,is_foreign,is_sports_training,is_football_specialty)
        VALUES (?,?,?,?,?,?,?,?,?)`, [batch, team, String(n), name, Number(n === 1), Number([1,3].includes(n)), Number([1,2,4,7,8].includes(n)), Number([1,5,6,7].includes(n)), Number([1,2,6].includes(n))]))[0].insertId;
      players[index].push({ id: p, number: n, name });
    }
  }
  const day = offset => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  const matches = [];
  for (const [index, order] of [prefix + '01', prefix + '02'].entries()) {
    const m = (await c.execute(`INSERT INTO match_schedules(season_id,match_type,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot,
      match_date,match_time,match_end_time,field_order,venue,venue_detail,supervisor_required,
      main_referee_name_snapshot,assistant1_name_snapshot,assistant2_name_snapshot,fourth_official_name_snapshot,supervisor_name_snapshot)
      VALUES (?,?,?,?,?, ?,?,'15:00','16:30',?,?,?,?,'张裁判','李助理','王助理','赵四官',?)`,
    [seasonId, league, ...teams, ...names, day(index + 1), order, index ? '樱花人草' : '其它', index ? null : '嘉定校区西侧足球场', Number(!index), index ? null : '陈监督']))[0].insertId;
    matches.push(m);
  }
  const banned = [players[0].find(p => p.number === 2), players[1].find(p => p.number === 10)];
  const cards = banned.map((p, i) => ({ key: `${teams[i]}:r${p.id}`, team_id: teams[i], player_name: p.name, jersey_number: String(p.number), card_type: 'red' }));
  await c.execute("INSERT INTO competition_discipline_events(competition_id,operation,payload,created_at) VALUES (?,'report',?,NOW(3))", [competitionId,
    JSON.stringify({ schedule_id: 0, kickoff: day(-1) + ' 15:00', team_ids: teams, cards, served: [] })]);
  return { competitionId, teams, batches, players, matches, bannedKeys: cards.map(p => p.key) };
}
