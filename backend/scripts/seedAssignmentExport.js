const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

// Only called by isolated preview/test runners; all people and matches are fictional.
module.exports = async function seed(c, { active = false } = {}) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const day = offset => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  if (active) await c.execute('UPDATE seasons SET is_active=0 WHERE is_active=1');
  const seasonId = (await c.execute('INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES (?,?,?,?,?)',
    ['CSV-' + suffix, '比赛日选派导出验收', '2026-01-01', '2099-12-31', Number(active)]))[0].insertId;
  const teams = {};
  for (const type of ['大联赛', '足协杯']) {
    await c.execute('INSERT INTO season_competitions(season_id,league_type) VALUES (?,?)', [seasonId, type]);
    teams[type] = [];
    for (const name of ['土木工程学院', '机械与能源工程学院']) teams[type].push((await c.execute('INSERT INTO team(season_id,league_type,team_name) VALUES (?,?,?)', [seasonId, type, name]))[0].insertId);
  }
  const password = 'Local!' + crypto.randomBytes(12).toString('hex'), hash = await bcrypt.hash(password, 4);
  const refs = [];
  for (const [i, name] of ['张裁判', '李助理', '王助理', '赵四官', '陈监督'].entries()) {
    const studentId = `CSV-${suffix}-${i}`;
    const id = (await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,must_change_password,password_changed_at) VALUES (?,?,?,'三级','二级',0,NOW())", [studentId, name, hash]))[0].insertId;
    await c.execute(`INSERT INTO referee_season_registrations(season_id,referee_id,name_snapshot,height_cm_snapshot,weight_kg_snapshot,college_snapshot,grade_snapshot,match_types_snapshot,status,submitted_at)
      VALUES (?,?,?,175,65,'土木工程学院','三级','["大联赛","足协杯"]','approved',NOW())`, [seasonId, id, name]);
    refs.push({ id, name, student_id: studentId });
  }
  const [[admin]] = await c.query('SELECT id FROM admin ORDER BY id LIMIT 1');
  const externalId = (await c.execute('INSERT INTO external_referees(name,created_by_admin_id) VALUES (?,?)', ['周外部裁判', admin.id]))[0].insertId;
  const matches = {};
  async function match(order, type, offset, time, fourth = 1, supervisor = 1, futsal = 0) {
    const id = (await c.execute(`INSERT INTO match_schedules(season_id,match_type,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot,
      match_date,match_time,match_end_time,field_order,venue,venue_detail,fourth_required,supervisor_required,futsal)
      VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?)`, [seasonId, type, ...teams[type], '土木工程学院', '机械与能源工程学院',
      day(offset), time, time === '00:01' ? '01:30' : null, order, '其它', '嘉定校区西侧足球场', fourth, supervisor, futsal]))[0].insertId;
    matches[order] = id;
    return id;
  }
  async function assign(id, role, index) {
    await c.execute('INSERT INTO match_official_assignments(schedule_id,role,source_type,referee_id,external_referee_id,name_snapshot) VALUES (?,?,?,?,?,?)',
      [id, role, index === 'external' ? 'external' : 'system', index === 'external' ? null : refs[index].id, index === 'external' ? externalId : null, index === 'external' ? '周外部裁判' : refs[index].name]);
  }
  const first = await match('A01', '大联赛', 0, '00:01');
  for (const [i, role] of ['main', 'assistant1', 'assistant2', 'fourth', 'supervisor'].entries()) await assign(first, role, i);
  const second = await match('A02', '大联赛', 0, '23:50');
  await assign(second, 'main', 'external'); await assign(second, 'assistant1', 1);
  await match('A03', '大联赛', 0, '23:55', 0, 0);
  const futsal = await match('A04', '大联赛', 0, null, 0, 1, 1);
  await assign(futsal, 'main', 0); await assign(futsal, 'timekeeper', 3);
  await match('A05', '大联赛', 1, '15:00');
  await match('B01', '足协杯', 0, '23:50');
  return { seasonId, date: day(0), nextDate: day(1), matches, refs, password, externalId };
};
