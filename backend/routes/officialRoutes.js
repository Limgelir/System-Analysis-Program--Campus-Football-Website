const router = require('express').Router();
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { createBusinessError } = require('../utils/scheduleValidator');
const { publicErrorMessage } = require('../utils/publicError');
const { ROLES } = require('../utils/officialAssignments');
router.use(requireAdmin);
const positive = (v, fallback) => {
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw createBusinessError('页码或编号必须是正整数');
  return n;
};
const text = (v, max, required = false) => {
  if (v !== undefined && v !== null && typeof v !== 'string') throw createBusinessError('姓名、备注和搜索条件必须是文字');
  const value = String(v || '').trim();
  if ((required && !value) || value.length > max) throw createBusinessError(`文字不能为空且不能超过 ${max} 字`);
  return value;
};
const fail = (res, e) => res.status(e.statusCode || 400).json({ success: false, code: e.code, message: publicErrorMessage(e, '非系统裁判操作失败', e.statusCode || 400) });
router.get('/candidates', async (req, res) => {
  try {
    const season = positive(req.query.season_id), page = positive(req.query.page, 1), size = Math.min(positive(req.query.page_size, 20), 50);
    const role = req.query.role;
    if (!ROLES.some(r => r.code === role)) throw createBusinessError('岗位无效');
    const [[exists]] = await pool.execute('SELECT id FROM seasons WHERE id = ?', [season]);
    if (!exists) throw createBusinessError('赛季不存在', { statusCode: 404 });
    const scheduleId = req.query.schedule_id === undefined ? null : positive(req.query.schedule_id);
    if (scheduleId) {
      const [[schedule]]=await pool.execute('SELECT season_id FROM match_schedules WHERE id=?',[scheduleId]);
      if(!schedule || schedule.season_id!==season) throw createBusinessError('比赛与赛季不匹配',{code:'CANDIDATE_SCHEDULE_MISMATCH'});
    }
    const intention=role==='assistant1'||role==='assistant2'?'assistant':role;
    const q = text(req.query.query, 100), pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    let source = `SELECT r.id AS referee_id, NULL AS external_referee_id, 'system' AS source_type,
      rsr.name_snapshot, r.student_id, rsr.grade_snapshot, rsr.match_types_snapshot, NULL AS note,
      IF(ms.status='active',1,0) AS signed_up, IF(ms.status='active',ms.intentions,NULL) AS signup_intentions,
      CASE WHEN ms.status='active' AND JSON_CONTAINS(ms.intentions,JSON_QUOTE(?)) THEN 0 WHEN ms.status='active' THEN 1 ELSE 2 END AS signup_rank,
      IF(ms.status='active',NOT(ms.match_date_snapshot<=>s.match_date AND ms.match_time_snapshot<=>s.match_time),0) AS signup_time_changed,
      IF(ms.status='active',NOT(ms.venue_snapshot<=>s.venue AND ms.venue_detail_snapshot<=>s.venue_detail),0) AS signup_venue_changed
      FROM referee r JOIN referee_season_registrations rsr ON rsr.referee_id = r.id
      LEFT JOIN match_schedules s ON s.id=?
      LEFT JOIN referee_match_signups ms ON ms.schedule_id=s.id AND ms.referee_id=r.id
      WHERE rsr.season_id = ? AND rsr.status = 'approved' AND r.is_active = 1
      AND (rsr.name_snapshot LIKE ? OR r.student_id LIKE ?)`;
    const params = [intention, scheduleId, season, pattern, pattern];
    {
      source += ` UNION ALL SELECT NULL, id, 'external', name, NULL, NULL, NULL, note,0,NULL,2,0,0
        FROM external_referees WHERE is_active = 1 AND name LIKE ?`;
      params.push(pattern);
    }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM (${source}) candidates`, params);
    const [items] = await pool.query(`SELECT * FROM (${source}) candidates ORDER BY signup_rank, name_snapshot, source_type, referee_id, external_referee_id LIMIT ? OFFSET ?`, [...params, size, (page - 1) * size]);
    for(const item of items) item.signup_intentions=require('../utils/matchSignup').json(item.signup_intentions)||[];
    res.json({ success: true, data: { items, pagination: { page, total: Number(count.total), total_pages: Math.ceil(count.total / size) } } });
  } catch (e) { fail(res, e); }
});
router.get('/external', async (req, res) => {
  try {
    const page = positive(req.query.page, 1), size = 20, q = text(req.query.query, 100);
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM external_referees WHERE name LIKE ?', [pattern]);
    const [items] = await pool.query('SELECT * FROM external_referees WHERE name LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?', [pattern, size, (page - 1) * size]);
    res.json({ success: true, data: { items, pagination: { page, total: Number(count.total), total_pages: Math.ceil(count.total / size) } } });
  } catch (e) { fail(res, e); }
});
async function save(req, res, editing) {
  const c = await pool.getConnection();
  try {
    if (!req.body || Array.isArray(req.body) || Object.keys(req.body).some(k => !['name', 'note', 'is_active', 'confirm_duplicate'].includes(k))) throw createBusinessError('只允许维护非系统裁判姓名、备注和启用状态');
    const name = text(req.body.name, 100, true), note = text(req.body.note, 255) || null;
    if (req.body.is_active !== undefined && typeof req.body.is_active !== 'boolean') throw createBusinessError('启用状态必须为布尔值');
    const id = editing ? positive(req.params.id) : null;
    await c.beginTransaction();
    const [[existing]] = editing ? await c.execute('SELECT * FROM external_referees WHERE id = ? FOR UPDATE', [id]) : [[]];
    if (editing && !existing) throw createBusinessError('非系统裁判不存在', { statusCode: 404 });
    if (!existing || existing.name !== name) {
      const [duplicates] = await c.execute('SELECT id FROM external_referees WHERE name = ? AND (? IS NULL OR id <> ?) FOR UPDATE', [name, id, id]);
      const [[account]] = await c.execute('SELECT id FROM referee WHERE name = ? LIMIT 1', [name]);
      if ((duplicates.length || account) && req.body.confirm_duplicate !== true) throw createBusinessError('已有同名裁判，请核对已有名单；仅确认为不同人员时另建记录', { statusCode: 409, code: 'DUPLICATE_NAME_CONFIRMATION_REQUIRED' });
    }
    let savedId = id;
    if (editing) await c.execute('UPDATE external_referees SET name = ?, note = ?, is_active = ? WHERE id = ?', [name, note, req.body.is_active === undefined ? existing.is_active : Number(req.body.is_active), id]);
    else {
      const [result] = await c.execute('INSERT INTO external_referees (name,note,is_active,created_by_admin_id) VALUES (?,?,?,?)', [name,note,req.body.is_active === false ? 0 : 1,req.user.id]);
      savedId = result.insertId;
    }
    const [[data]] = await c.execute('SELECT * FROM external_referees WHERE id = ?', [savedId]);
    await c.commit();
    res.status(editing ? 200 : 201).json({ success: true, data });
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
}
router.post('/external', (req, res, next) => save(req, res, false).catch(next));
router.put('/external/:id', (req, res, next) => save(req, res, true).catch(next));
module.exports = router;
