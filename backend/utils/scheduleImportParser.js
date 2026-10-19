const path = require('node:path');
const XLSX = require('xlsx');
const { createBusinessError: invalid } = require('./scheduleValidator');

const HEADERS = ['场序', '比赛日期', '比赛时间', '主队', '客队', '比赛场地', '其它场地说明'];
const FIELDS = ['field_order', 'match_date', 'match_time', 'home_name', 'away_name', 'venue', 'venue_detail'];
const MAX_ROWS = 200;

function cellText(cell, field, date1904) {
  if (cell?.f) throw invalid('不能使用公式，请粘贴为值');
  if (cell?.t === 'e') throw invalid('存在错误单元格，请修正后上传');
  const value = cell?.v ?? '';
  if (typeof value === 'number' && field === 'match_date') {
    const date = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!date || date.H || date.M || date.S) throw invalid('比赛日期必须为有效日期，不含时间');
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && field === 'match_time') {
    const minutes = Math.round(value * 1440);
    if (value < 0 || value >= 1 || minutes >= 1440 || Math.abs(value * 1440 - minutes) > 0.00001) throw invalid('比赛时间必须精确到分钟');
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const text = String(value).trim();
  if (text.length > 120) throw invalid('单元格内容过长（最多120字）');
  return text;
}

function parseScheduleImport(buffer, name) {
  const ext = path.extname(name || '').toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) throw invalid('请上传 .xlsx、.xls 或 UTF-8 CSV 赛程文件');
  let book;
  try {
    book = XLSX.read(ext === '.csv' ? buffer.toString('utf8').replace(/^\uFEFF/, '') : buffer, { type: ext === '.csv' ? 'string' : 'buffer', raw: true, cellDates: false });
  } catch { throw invalid('文件无法读取，请使用赛程导入模板'); }
  const sheet = book.Sheets?.[book.SheetNames?.[0]];
  if (!sheet?.['!ref']) throw invalid('首个工作表没有赛程数据');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.r > 2000 || range.e.c > 30) throw invalid('表格范围过大，请删除多余行列，每批最多200场');
  const cell = (row, col) => sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  const headers = Array.from({ length: range.e.c + 1 }, (_, col) => String(cell(0, col)?.v ?? '').trim()).map(h => h === '开球时间' ? '比赛时间' : h);
  while (headers.at(-1) === '') headers.pop();
  if (headers.length !== HEADERS.length || HEADERS.some(h => !headers.includes(h))) throw invalid('表头不匹配，请保留模板的全部7列表头');
  const columns = HEADERS.map(h => headers.indexOf(h));
  const rows = [], errors = [];
  for (let r = 1; r <= range.e.r; r++) {
    if (columns.every(c => !cell(r, c)?.f && String(cell(r, c)?.v ?? '').trim() === '')) continue;
    if (rows.length + errors.length >= MAX_ROWS) throw invalid('每批最多导入200场比赛，请拆分文件');
    try {
      const row = { row_number: r + 1 };
      FIELDS.forEach((field, i) => { row[field] = cellText(cell(r, columns[i]), field, Boolean(book.Workbook?.WBProps?.date1904)); });
      rows.push(row);
    } catch (e) { errors.push({ row_number: r + 1, message: e.message }); }
  }
  if (!rows.length && !errors.length) throw invalid('模板中还没有赛程，请从第2行开始填写');
  return { rows, errors };
}

// 仅推荐候选；任何非完全相同的队名都必须由管理员明确选择。
function similarName(a, b) {
  const normalize = s => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  a = normalize(a); b = normalize(b);
  if (!a || !b) return false;
  if (a === b || (Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a)))) return true;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return prev[b.length] <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.25));
}
module.exports = { HEADERS, MAX_ROWS, parseScheduleImport, similarName };
