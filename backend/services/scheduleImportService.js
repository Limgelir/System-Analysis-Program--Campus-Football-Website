const crypto = require('node:crypto');
const pool = require('../db');
const schedules = require('./scheduleService');
const { createBusinessError: invalid, validateScheduleMutationPayload } = require('../utils/scheduleValidator');
const { similarName } = require('../utils/scheduleImportParser');
const replacements = require('./scheduleReplacementService');

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sign = value => crypto.createHmac('sha256', process.env.JWT_SECRET).update('schedule-import:' + JSON.stringify(value)).digest('hex');
function flag(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw invalid('裁判安排选项必须为是或否');
}

async function inspect(c, input, lock = false) {
  const [[season]] = await c.execute('SELECT id,season_name FROM seasons WHERE is_active=1' + (lock ? ' FOR UPDATE' : ''));
  if (!season || Number(season.id) !== input.season_id) throw invalid('当前启用赛季已变化，请刷新页面后重新预览', { statusCode: 409 });
  const competition = await require('./competitionService').requireCompetition(c, season.id, input.match_type);
  if (lock) await c.execute('SELECT id FROM season_competitions WHERE id=? FOR UPDATE', [competition.id]);
  const [teams] = await c.execute('SELECT id,team_name FROM team WHERE season_id=? AND league_type=? AND registration_revoked=0 ORDER BY id' + (lock ? ' FOR UPDATE' : ''), [season.id, input.match_type]);
  const names = [...new Set(input.rows.flatMap(row => [row.home_name, row.away_name]).filter(Boolean))];
  const matches = names.map(name => {
    const exact = teams.find(t => t.team_name === name);
    const chosen = Object.hasOwn(input.team_mappings, name) ? teams.find(t => t.id === Number(input.team_mappings[name])) : null;
    const selected = exact || chosen;
    return { name, team_id: selected?.id ?? null, team_name: selected?.team_name ?? null, status: exact ? 'exact' : chosen ? 'confirmed' : 'unresolved', candidates: teams.filter(t => similarName(name, t.team_name)) };
  });
  const byName = new Map(matches.map(m => [m.name, m]));
  const errors = [...input.errors], orders = new Map(), rows = [];
  for (const row of input.rows) {
    let replacement = null, normalizedTime = {};
    const home = byName.get(row.home_name), away = byName.get(row.away_name);
    const data = { ...row, match_type: input.match_type, futsal: input.futsal, fourth_required: input.fourth_required, supervisor_required: input.supervisor_required, team_a_id: home?.team_id || 1, team_b_id: away?.team_id || 2 };
    try {
      if (!row.home_name || !row.away_name) throw invalid('请填写主队和客队名称');
      if (row.home_name.length > 100 || row.away_name.length > 100) throw invalid('队伍名称最多100字');
      if (row.home_name === row.away_name || (home?.team_id && home.team_id === away?.team_id)) throw invalid('主客队不能相同');
      // 未匹配时也检查日期、时间、场地和场序，不用占位ID判断对阵。
      const payload = validateScheduleMutationPayload({ ...data, team_a_id: 1, team_b_id: 2 });
      normalizedTime = { match_time: payload.match_time, match_end_time: payload.match_end_time };
      const orderKey = payload.field_order.normalize('NFKC').toLowerCase();
      if (orders.has(orderKey)) throw invalid(`场序与第 ${orders.get(orderKey)} 行重复`);
      orders.set(orderKey, row.row_number);
      replacement = await replacements.inspect(c, season.id, input.match_type, payload, lock);
    } catch (e) {
      if (!e.isBusinessError) throw e;
      errors.push({ row_number: row.row_number, message: e.message });
    }
    rows.push({ ...row, ...normalizedTime, replacement, team_a_id: home?.team_id ?? null, team_b_id: away?.team_id ?? null, team_a_name: home?.team_name ?? null, team_b_name: away?.team_name ?? null });
  }
  return { season_id: season.id, season_name: season.season_name, competition_id: competition.id, match_type: input.match_type, futsal: input.futsal, fourth_required: input.fourth_required, supervisor_required: input.supervisor_required, rows, name_matches: matches, teams, errors, can_confirm: !errors.length && !matches.some(m => !m.team_id) && rows.length > 0 };
}

async function preview(body, parsed, user) {
  let mappings;
  try { mappings = body.team_mappings ? JSON.parse(body.team_mappings) : {}; } catch { throw invalid('队伍确认信息格式不正确'); }
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) throw invalid('队伍确认信息格式不正确');
  const input = {
    season_id: Number(body.season_id), match_type: require('../utils/competitionRules').competitionName(body.match_type),
    futsal: flag(body.futsal, false), fourth_required: flag(body.fourth_required, true), supervisor_required: flag(body.supervisor_required, false),
    team_mappings: mappings, rows: parsed.rows, errors: parsed.errors
  };
  if (input.futsal) input.fourth_required = false;
  const c = await pool.getConnection();
  try {
    const data = await inspect(c, input);
    const envelope = { input, admin_id: user.id, expires_at: Date.now() + 30 * 60 * 1000, state_hash: digest(data) };
    return { ...data, preview: envelope, preview_token: sign(envelope) };
  } finally { c.release(); }
}

async function confirm(body, user) {
  if (!body.preview || typeof body.preview_token !== 'string' || !/^[a-f0-9]{64}$/.test(body.preview_token) || !crypto.timingSafeEqual(Buffer.from(sign(body.preview)), Buffer.from(body.preview_token))) throw invalid('预览凭据无效，请重新预览', { statusCode: 409 });
  const envelope = body.preview;
  if (envelope.admin_id !== user.id) throw invalid('请使用当前管理员重新预览', { statusCode: 403 });
  if (envelope.expires_at < Date.now()) throw invalid('预览已过期，请重新预览', { statusCode: 409 });
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const data = await inspect(c, envelope.input, true);
    if (!data.can_confirm || digest(data) !== envelope.state_hash) throw invalid('队伍、赛季或场序已变化，或仍有未确认的队名；请重新预览', { statusCode: 409 });
    const replacementIds = data.rows.filter(row => row.replacement).map(row => row.replacement.id).sort((a,b)=>a-b);
    const confirmedIds = body.confirm_replacements ?? [];
    if (!Array.isArray(confirmedIds) || JSON.stringify([...confirmedIds].sort((a,b)=>a-b)) !== JSON.stringify(replacementIds)) throw invalid('请先确认是否替换全部同场序赛程', { statusCode: 409 });
    const ids = [];
    for (const row of data.rows) {
      try {
        const schedule = row.replacement
          ? await replacements.replace(c, data.season_id, data.match_type, row)
          : await schedules.createScheduleInTransaction(c, { ...row, match_type: data.match_type, futsal: data.futsal, fourth_required: data.fourth_required, supervisor_required: data.supervisor_required });
        ids.push(schedule.id);
      } catch (error) {
        const mapped = schedules.mapPersistenceError(error, '赛程创建失败');
        throw invalid(`第 ${row.row_number} 行：${mapped.message}；整批未保存`, { statusCode: mapped.statusCode, code: mapped.code });
      }
    }
    await c.commit();
    return { count: ids.length, created_count: ids.length - replacementIds.length, replaced_count: replacementIds.length, schedule_ids: ids, season_id: data.season_id, match_type: data.match_type };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally { c.release(); }
}
async function previewSingle(data, user) {
  const [[season]] = await pool.execute('SELECT id FROM seasons WHERE is_active=1');
  if (!season) throw invalid('请先启用赛季');
  const [teams] = await pool.execute('SELECT id,team_name FROM team WHERE season_id=? AND league_type=? AND id IN (?,?)', [season.id,data.match_type,data.team_a_id,data.team_b_id]);
  const byId = new Map(teams.map(t=>[t.id,t.team_name]));
  const result = await preview({ season_id: season.id, match_type: data.match_type, futsal: data.futsal, fourth_required: data.fourth_required, supervisor_required: data.supervisor_required },
    { rows: [{ ...data, row_number: 1, home_name: byId.get(data.team_a_id), away_name: byId.get(data.team_b_id) }], errors: [] }, user);
  if (!result.can_confirm) throw invalid(result.errors[0]?.message || '球队信息已变化，请刷新后重试');
  if (!result.rows[0].replacement) throw invalid('原赛程已变化，请刷新后重新添加', { statusCode: 409 });
  return result;
}
module.exports = { preview, confirm, previewSingle };
