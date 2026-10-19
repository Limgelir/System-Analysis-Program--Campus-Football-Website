const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { HEADERS, parseScheduleImport, similarName } = require('../utils/scheduleImportParser');
function book(rows, mutate = () => {}) {
  const wb = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  XLSX.utils.book_append_sheet(wb, sheet, '赛程'); mutate(sheet, wb);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const row = ['001', '2026-10-20', '17:35', '土木学院', '机械学院', '樱花人草', ''];
test('赛程文件支持Excel日期时间、文本场序、空行和原始行号', () => {
  const parsed = parseScheduleImport(book([[], row, ['A2', 46315, 0, ...row.slice(3)]]), 'schedule.xlsx');
  assert.equal(parsed.rows[0].row_number, 3); assert.equal(parsed.rows[0].field_order, '001');
  assert.equal(parsed.rows[1].match_date, '2026-10-20'); assert.equal(parsed.rows[1].match_time, '00:00');
  assert.deepEqual(parsed.errors, []);
});
test('CSV保留中文、带逗号/换行/双引号的名称及前导零', () => {
  const values = [HEADERS, ['001', '2026-10-20', '17:35', '土木,"学院"', '机械\n学院', '其它', '西区,球场']];
  const csv = '\uFEFF' + values.map(r => r.map(v => '"' + v.replaceAll('"', '""') + '"').join(',')).join('\r\n');
  const parsed = parseScheduleImport(Buffer.from(csv), 'schedule.csv');
  assert.equal(parsed.rows[0].home_name, values[1][3]); assert.equal(parsed.rows[0].away_name, values[1][4]);
  assert.equal(parsed.rows[0].field_order, '001');
});
test('拒绝公式、错误表头、空表和超过200场，错误定位到源行', () => {
  const parsed = parseScheduleImport(book([row], s => { s.B2.f = 'TODAY()'; }), 'a.xlsx');
  assert.equal(parsed.errors[0].row_number, 2); assert.match(parsed.errors[0].message, /公式/);
  assert.throws(() => parseScheduleImport(book([]), 'a.xlsx'), /还没有赛程/);
  assert.throws(() => parseScheduleImport(book([row], s => { s.A1.v = '错误表头'; }), 'a.xlsx'), /表头/);
  assert.throws(() => parseScheduleImport(book(Array(201).fill(row)), 'a.xlsx'), /最多导入200/);
  assert.throws(() => parseScheduleImport(Buffer.from('bad'), 'a.txt'), /请上传/);
});
test('数字时间不接受秒和整天；1904日期工作簿正确转换', () => {
  const parsed = parseScheduleImport(book([[...row.slice(0, 2), 1 / 86400, ...row.slice(3)]]), 'a.xlsx');
  assert.match(parsed.errors[0].message, /精确到分钟/);
  const date = parseScheduleImport(book([['A', 1, 0.5, ...row.slice(3)]], (_, wb) => { wb.Workbook = { WBProps: { date1904: true } }; }), 'a.xlsx');
  assert.equal(date.rows[0].match_date, '1904-01-02'); assert.equal(date.rows[0].match_time, '12:00');
});
test('相似队名只是候选：空格、后缀、单字误写可推荐，无关队名不推荐', () => {
  for (const name of ['土木 学院', '土木学院队', '土术学院']) assert.equal(similarName(name, '土木学院'), true);
  assert.equal(similarName('土木学院', '建筑设计研究院'), false);
});
test('新比赛时间表头支持时间段，旧开球时间表头继续兼容', () => {
  const rangeRow=[...row];rangeRow[2]='15:00-16:00';
  assert.equal(parseScheduleImport(book([rangeRow]),'a.xlsx').rows[0].match_time,'15:00-16:00');
  assert.equal(parseScheduleImport(book([rangeRow],s=>{s.C1.v='开球时间';}),'a.xlsx').rows[0].match_time,'15:00-16:00');
  assert.throws(()=>parseScheduleImport(book([rangeRow],s=>{s.D1.v='开球时间';}),'a.xlsx'),/表头/);
});
