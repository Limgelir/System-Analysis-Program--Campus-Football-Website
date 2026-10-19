const { ParagraphProperties, ImportedXmlComponent, TextRun, AlignmentType, LineRuleType } = require('docx');

// Measurements from the shipped templates, in twips (1/20 pt). Keep the table
// geometry unchanged; the fit calculation reserves space inside each name cell.
const NAME_CELLS = {
  eleven: { widths: { a: 1020, b: 1122 }, horizontalMargins: 24, height: 345, size: 18 },
  eight: { widths: { a: 1916, b: 1915 }, horizontalMargins: 216, height: 340, size: 20 },
};
const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
const tagPattern = /^\((?:C|GK|F|S)\)$/;
const flag = value => value === true || value === 1 || value === '1';

function playerDisplayName(player) {
  if (!player) return '';
  const name = String(player.player_name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!name) return '';
  return name + [
    [flag(player.is_captain), 'C'],
    [flag(player.is_goalkeeper), 'GK'],
    [flag(player.is_foreign), 'F'],
    [flag(player.is_sports_training) || flag(player.is_football_specialty), 'S'],
  ].filter(([enabled]) => enabled).map(([, tag]) => `(${tag})`).join('');
}

function tokensOf(value) {
  // Keep each marker and each Unicode grapheme intact across line breaks.
  return value.split(/(\((?:C|GK|F|S)\))/).filter(Boolean).flatMap(part =>
    tagPattern.test(part) ? [part] : Array.from(graphemes.segment(part), item => item.segment));
}
function widthUnits(value) {
  // The template uses SimSun: ASCII is half-width; reserve a full em for all
  // other graphemes (including accented names) rather than underestimating.
  return Array.from(graphemes.segment(value), ({ segment }) => /^[\x20-\x7e]$/.test(segment) ? .5 : 1).reduce((sum, width) => sum + width, 0);
}

function fitPlayerName(value, template, side) {
  const cell = NAME_CELLS[template];
  const width = (cell.widths[side] - cell.horizontalMargins) / 20 - 1.5;
  const height = cell.height / 20 - 1.5;
  const candidates = [{ lines: [value], preference: 0 }];
  const tokens = tokensOf(value);
  for (let i = 1; i < tokens.length; i++) {
    if (/^\s+$/.test(tokens[i])) continue;
    // Prefer splitting before all markers, or at a word boundary when this
    // gives the same readable size. Otherwise Chinese names may split too.
    const preference = tagPattern.test(tokens[i]) && !tagPattern.test(tokens[i - 1]) ? 2
      : /\s/.test(tokens[i - 1]) || /\s/.test(tokens[i]) ? 1 : 0;
    candidates.push({ lines: [tokens.slice(0, i).join(''), tokens.slice(i).join('')], preference });
  }
  for (const candidate of candidates) {
    const widest = Math.max(...candidate.lines.map(line => widthUnits(line.trim())), 1);
    const maxPoints = Math.min(cell.size / 2, width / widest, height / candidate.lines.length / 1.18);
    candidate.size = Math.max(1, Math.floor(maxPoints * 2)); // Word uses half-points.
    candidate.line = Math.ceil(candidate.size / 2 * 1.18 * 20);
    candidate.balance = Math.abs(widthUnits(candidate.lines[0]) - widthUnits(candidate.lines[1] || ''));
  }
  candidates.sort((a, b) => b.size - a.size || a.lines.length - b.lines.length || b.preference - a.preference || a.balance - b.balance);
  return candidates[0];
}

function nameParagraph(value, template, side) {
  const fit = fitPlayerName(value, template, side);
  const run = { font: { name: '宋体', eastAsia: '宋体' }, size: fit.size, sizeComplexScript: fit.size, bold: false, snapToGrid: false };
  const paragraph = new ImportedXmlComponent('w:p');
  const properties = new ParagraphProperties({
    alignment: AlignmentType.CENTER, widowControl: false, keepLines: true,
    autoSpaceEastAsianText: false, run,
    spacing: { before: 0, after: 0, line: fit.line, lineRule: LineRuleType.EXACT },
  });
  // The 8-player template's Normal style indents the first line by two
  // characters. Override both units; a twip-only override leaves firstLineChars
  // inherited and can create an unexpected extra line in Word.
  properties.push(new ImportedXmlComponent('w:ind', { 'w:left': 0, 'w:right': 0, 'w:firstLine': 0, 'w:firstLineChars': 0 }));
  properties.push(new ImportedXmlComponent('w:autoSpaceDE', { 'w:val': 0 }));
  properties.push(new ImportedXmlComponent('w:snapToGrid', { 'w:val': 0 }));
  paragraph.push(properties);
  for (const [index, line] of fit.lines.entries()) {
    paragraph.push(new TextRun({ ...run, text: line, ...(index ? { break: 1 } : {}) }));
  }
  return paragraph;
}

module.exports = { playerDisplayName, fitPlayerName, nameParagraph, NAME_CELLS };
