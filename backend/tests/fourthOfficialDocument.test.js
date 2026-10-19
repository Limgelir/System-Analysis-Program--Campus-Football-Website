const { test } = require('node:test');
const assert = require('node:assert/strict');
const { patchDetector } = require('docx');
const { buildFields, generateDocument } = require('../utils/fourthOfficialDocument');
const JSZip = require('jszip');
const { playerDisplayName, fitPlayerName } = require('../utils/fourthOfficialName');

function sample() {
  return { schedule: { field_order: 'A01', match_date: '2026-10-20', match_time: '15:00:00', match_end_time: '16:00:00', venue: '其它', venue_detail: '西区足球场', supervisor_required: 0,
    main_referee_name_snapshot: '张裁判', assistant1_name_snapshot: '李助理', assistant2_name_snapshot: '王助理', fourth_official_name_snapshot: '赵四官', supervisor_name_snapshot: '不应显示', home_score: 3 },
  teams: [{ name: '土木工程学院', shirt_color: '红', shorts_color: '白', socks_color: '黑', players: [
    { id: 10, team_id: 1, player_account_id: 7, player_name: '同名球员', jersey_number: '10' },
    { id: 2, team_id: 1, import_person_id: 8, player_name: '同名球员', jersey_number: '02' },
    { id: 8, team_id: 1, player_name: '王球员', jersey_number: '8' }] },
    { name: '机械学院', shirt_color: '蓝', shorts_color: '蓝', socks_color: '白', players: [{ id: 3, team_id: 2, player_account_id: 7, player_name: '另一队同名', jersey_number: '1' }] }],
  suspensions: [{ key: '1:i8' }, { key: '1:r8' }] };
}
test('仅填写指定数据，球场不含其它，按号码排序，停赛按球员身份区分同名者', () => {
  const fields = buildFields(sample());
  assert.equal(fields.venue, '西区足球场'); assert.equal(fields.time, '15:00-16:00'); assert.equal(fields.supervisor, '');
  assert.equal(fields.main, '张裁判'); assert.equal(fields.assistant1, '李助理'); assert.equal(fields.fourth, '赵四官');
  assert.equal(fields.a_number_1, '02'); assert.equal(fields.a_number_2, '8'); assert.equal(fields.a_number_3, '10');
  assert.equal(fields.a_suspended_1, '×'); assert.equal(fields.a_suspended_2, '×'); assert.equal(fields.a_suspended_3, ''); assert.equal(fields.b_suspended_1, '');
  assert.equal(fields.a_shirt, '红'); assert.equal(fields.a_shorts, '白'); assert.equal(fields.a_socks, '黑');
  assert.equal(fields.a_name_30, ''); assert.ok(!('home_score' in fields));
});
test('外部裁判选派快照与空名单，零号球衣和缺省时间', () => {
  const data = sample(); data.schedule.officials = [{ role: 'main', name_snapshot: '非系统裁判' }];
  data.schedule.venue = '樱花人草'; data.schedule.match_time = null;
  data.teams[0].players = []; data.teams[1].players[0].jersey_number = 0;
  const fields = buildFields(data);
  assert.equal(fields.main, '非系统裁判'); assert.equal(fields.a_name_1, ''); assert.equal(fields.b_number_1, '0');
  assert.equal(fields.time, ''); assert.equal(fields.venue, '樱花人草');
});
test('超过模板容量时明确拒绝，不能静默漏掉球员', () => {
  const data = sample(); data.teams[0].players = Array.from({ length: 31 }, (_, id) => ({ id, jersey_number: id }));
  assert.throws(() => buildFields(data), /超过30人/);
});
test('生成真实 DOCX，替换两页所有字段且不残留占位符', async () => {
  const data = sample(); const result = await generateDocument(data);
  assert.equal(result.buffer.subarray(0, 2).toString(), 'PK');
  assert.match(result.filename, /^四官单-11人制-A01-.+\.docx$/);
  assert.deepEqual(await patchDetector({ data: result.buffer }), []);
});

test('8人制包含日期和时间、斜杠球衣色、17行容量，空颜色不伪造数据', () => {
  const data = sample();
  const fields = buildFields(data, 'eight');
  assert.equal(fields.match_datetime, '2026-10-20 15:00-16:00');
  assert.equal(fields.a_kit, '红/白/黑'); assert.equal(fields.venue, '西区足球场');
  assert.equal(fields.a_number_1, '02'); assert.equal(fields.a_suspended_1, '×');
  assert.equal(fields.a_suspended_3, ''); assert.equal(fields.b_suspended_1, '');
  assert.equal(fields.a_name_17, ''); assert.ok(!('a_name_18' in fields));
  assert.ok(!('main' in fields)); assert.ok(!('supervisor' in fields));
  data.teams[0].shirt_color = null; data.teams[0].shorts_color = ''; data.teams[0].socks_color = undefined;
  data.teams[1].shorts_color = null; data.schedule.match_end_time = null;
  const blanks = buildFields(data, 'eight');
  assert.equal(blanks.a_kit, ''); assert.equal(blanks.b_kit, '蓝//白');
  assert.equal(blanks.match_datetime, '2026-10-20 15:00');
  data.teams[0].players = Array.from({ length: 18 }, (_, id) => ({ id, jersey_number: id }));
  assert.throws(() => buildFields(data, 'eight'), /超过17人.*8人制/);
  assert.throws(() => buildFields(data, 'unknown'), /请选择/);
  assert.throws(() => buildFields(data, 'toString'), /请选择/);
});

test('8人制只保留第一页，填写居中，保留空白记录和签名，不重复填名单队名', async () => {
  const result = await generateDocument(sample(), 'eight');
  assert.match(result.filename, /^四官单-8人制-A01-.+\.docx$/);
  assert.deepEqual(await patchDetector({ data: result.buffer }), []);
  const zip = await JSZip.loadAsync(result.buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const plain = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('');
  assert.match(plain, /2026年同济大学秋季足协杯比赛报告表/);
  assert.ok(!xml.includes('2025同济大学')); assert.ok(!xml.includes('张裁判'));
  assert.equal((xml.match(/土木工程学院/g) || []).length, 1);
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 2); // Main form + empty notes box.
  for (const label of ['队伍一：', '队伍二：', '纪律处罚', '第一助理：']) assert.ok(plain.includes(label));
  const rows = xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g);
  const cells = row => row.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g);
  const value = cell => [...cell.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('');
  assert.equal(value(cells(rows[5])[1]), '02'); assert.equal(value(cells(rows[5])[3]), '×');
  for (let i = 5; i <= 21; i++) {
    const cs = cells(rows[i]);
    for (const j of [1, 2, 3, 6, 7, 8]) {
      assert.match(cs[j], /<w:jc w:val="center"/);
      assert.match(cs[j], /<w:vAlign w:val="center"/);
    }
    for (const j of [0, 4, 5, 9]) assert.equal(value(cs[j]), '');
  }
});

test('姓名标记顺序固定，运训与特长生合并S，关闭/缺省标签不显示', () => {
  assert.equal(playerDisplayName({ player_name: '张三', is_captain: 1, is_goalkeeper: true, is_foreign: '1', is_sports_training: 1, is_football_specialty: true }), '张三(C)(GK)(F)(S)');
  assert.equal(playerDisplayName({ player_name: '李四', is_football_specialty: 1 }), '李四(S)');
  assert.equal(playerDisplayName({ player_name: '王五', is_captain: '0', is_goalkeeper: 0, is_foreign: false, is_sports_training: '0' }), '王五');
  assert.equal(playerDisplayName(undefined), '');
});

test('长姓名和多个标记缩小为至多两行，不截断姓名或拆开标记', () => {
  const long = '阿卜杜热合曼·买买提江(C)(GK)(F)(S)';
  for (const template of ['eleven', 'eight']) for (const side of ['a', 'b']) {
    const normal = fitPlayerName('张三', template, side);
    assert.equal(normal.size, template === 'eleven' ? 18 : 20); assert.equal(normal.lines.length, 1);
    for (const name of [long, 'Christopher Alexander Montgomery(F)(S)', 'José María Fernández(C)(GK)', '欧阳慕容司马长明(F)']) {
      const fit = fitPlayerName(name, template, side);
      assert.ok(fit.lines.length <= 2); assert.equal(fit.lines.join(''), name);
      assert.ok(fit.size > 0 && fit.size < normal.size);
      assert.ok(fit.lines.length * fit.line < 340, 'Paragraph must stay within existing roster row height');
      for (const line of fit.lines) assert.equal((line.match(/\(/g) || []).length, (line.match(/\)/g) || []).length);
    }
    assert.equal(fitPlayerName(long, template, side).lines.length, 2);
  }
});

test('两种Word长姓名均写入完整标记与缩小字号，沿用原表格及其他包部件', async () => {
  const fs = require('node:fs');
  for (const template of ['eleven', 'eight']) {
    const data = sample();
    Object.assign(data.teams[0].players[1], { player_name: '阿卜杜热合曼·买买提江', is_captain: 1, is_goalkeeper: 1, is_foreign: 1, is_sports_training: 1, is_football_specialty: 1 });
    const result = await generateDocument(data, template);
    const zip = await JSZip.loadAsync(result.buffer);
    const original = await JSZip.loadAsync(fs.readFileSync(require('node:path').join(__dirname, `../templates/fourth-official-${template === 'eleven' ? 11 : 8}.docx`)));
    for (const entry of Object.values(original.files)) if (!entry.dir && entry.name !== 'word/document.xml') {
      if (/\.(xml|rels)$/.test(entry.name)) {
        // The patcher normalizes XML declaration quotes in the 11-player source.
        const body = value => value.replace(/^<\?xml[^?]*\?>/, '');
        assert.equal(body(await zip.file(entry.name).async('string')), body(await entry.async('string')), entry.name);
      } else {
        assert.deepEqual(await zip.file(entry.name).async('nodebuffer'), await entry.async('nodebuffer'), entry.name);
      }
    }
    const xml = await zip.file('word/document.xml').async('string');
    const plain = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('');
    assert.ok(plain.includes('阿卜杜热合曼·买买提江(C)(GK)(F)(S)'));
    assert.ok(!plain.includes('(S)(S)'));
    const ps = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g);
    const name = ps.find(p => p.includes('阿卜杜'));
    assert.equal((name.match(/<w:br\s*\/>/g) || []).length, 1);
    assert.match(name, /w:lineRule="exact"/); assert.match(name, /w:jc w:val="center"/);
    assert.match(name, /w:firstLineChars="0"/); // Do not inherit the cup template's two-character indent.
    assert.ok(Number(name.match(/w:sz w:val="(\d+)"/)[1]) < (template === 'eleven' ? 18 : 20));
    assert.deepEqual(await patchDetector({ data: result.buffer }), []);
  }
});
