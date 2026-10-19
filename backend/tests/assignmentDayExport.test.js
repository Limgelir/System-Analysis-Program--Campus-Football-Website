const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dayFilters, assignmentDayTable } = require('../utils/assignmentDayExport');
const { csvCell } = require('../utils/listQuery');

test('比赛日导出必须明确赛季、赛事、合法日期，不沿用分页或选派完成状态', () => {
  const scope = { season_id: '3', match_type: '大联赛', match_date: '2026-10-15' };
  assert.deepEqual(dayFilters({ ...scope, page: '2', view: 'week', report_status: 'submitted' }),
    { seasonId: 3, matchType: '大联赛', date_from: '2026-10-15', date_to: '2026-10-15', exporting: true });
  for (const key of Object.keys(scope)) assert.throws(() => dayFilters({ ...scope, [key]: undefined }), /请选择/);
  assert.throws(() => dayFilters({ ...scope, match_date: '2026-02-30' }), /比赛日不合法/);
  assert.throws(() => dayFilters({ ...scope, season_id: ['3'] }), /赛季/);
});

test('比赛日表格包含全部比赛，区分未选派、无需和不适用，兼容外部裁判及五人制', () => {
  const normal = { season_name: '秋季', match_type: '大联赛', match_date: '2026-10-15', match_time: '15:00', match_end_time: '16:30',
    field_order: 'A01', venue: '其它', venue_detail: '西侧球场', team_a_name_snapshot: '甲队', team_b_name_snapshot: '乙队',
    fourth_required: false, supervisor_required: false, officials: [{ role: 'main', source_type: 'external', name_snapshot: '外部裁判' }] };
  const five = { ...normal, futsal: true, match_time: null, match_end_time: null, supervisor_required: true, officials: [{ role: 'timekeeper', name_snapshot: '计时裁判' }] };
  const { headers, rows } = assignmentDayTable([normal, five]);
  const value = (i, label) => rows[i][headers.indexOf(label)];
  assert.equal(rows.length, 2); assert.equal(value(0, '裁判员'), '外部裁判');
  assert.equal(value(0, '第一助理裁判员'), '未选派'); assert.equal(value(0, '第四官员'), '无需第四官员');
  assert.equal(value(0, '裁判监督'), '无需监督'); assert.equal(value(0, '第二裁判员'), '不适用');
  assert.equal(value(0, '比赛时间'), '15:00-16:30'); assert.equal(value(0, '场地'), '西侧球场');
  assert.equal(value(1, '裁判监督'), '未选派'); assert.equal(value(1, '第四官员'), '不适用');
  assert.equal(value(1, '第二裁判员'), '未选派'); assert.equal(value(1, '计时员'), '计时裁判');
  assert.equal(value(1, '比赛时间'), '时间待定');
  assert.ok(!assignmentDayTable([normal]).headers.includes('计时员'));
  assert.ok(!assignmentDayTable([five]).headers.includes('第四官员'));
});

test('姓名与队名含逗号、引号或换行时不串列，公式前缀按文本导出', () => {
  const xlsx = require('xlsx');
  const names = ['张,三', '李"四', '王\n五', '=1+1', '+外部裁判'];
  const csv = '\uFEFF' + ['姓名', ...names].map(csvCell).join('\r\n');
  const wb = xlsx.read(csv.replace(/^\uFEFF/, ''), { type: 'string', raw: true });
  assert.deepEqual(xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }).flat(), ['姓名', ...names.slice(0, 3), "'=1+1", "'+外部裁判"]);
});
