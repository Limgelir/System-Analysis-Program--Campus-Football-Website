const fs = require('node:fs');
const path = require('node:path');
const { patchDocument, PatchType, TextRun } = require('docx');
const { displayMatchTime } = require('./matchTime');
const { playerKey } = require('./disciplineEngine');
const { businessError } = require('./playerRules');
const { playerDisplayName, nameParagraph } = require('./fourthOfficialName');

const TEMPLATES = Object.freeze({ eleven: { number: 11, capacity: 30 }, eight: { number: 8, capacity: 17 } });
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const templates = Object.fromEntries(Object.entries(TEMPLATES).map(([key, value]) => [key,
  fs.readFileSync(path.join(__dirname, `../templates/fourth-official-${value.number}.docx`))]));
const text = value => value == null ? '' : String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();

function templateOptions(template) {
  if (!Object.hasOwn(TEMPLATES, template)) throw businessError('请选择11人制（大联赛）或8人制（足协杯）四官单模板', 400);
  return TEMPLATES[template];
}

function buildFields({ schedule, teams, suspensions = [] }, template = 'eleven') {
  const options = templateOptions(template);
  const names = Object.fromEntries(['main', 'assistant1', 'assistant2', 'fourth', 'supervisor'].map(role => {
    const field = { main: 'main_referee', fourth: 'fourth_official' }[role] || role;
    const assignment = schedule.officials?.find(item => item.role === role);
    return [role, text(assignment?.name_snapshot ?? schedule[field + '_name_snapshot'] ?? schedule[field + '_name'])];
  }));
  if (schedule.supervisor_required === false || schedule.supervisor_required === 0) names.supervisor = '';
  const fields = {
    ...names,
    field_order: text(schedule.field_order), date: text(schedule.match_date),
    time: schedule.match_time ? displayMatchTime(schedule.match_time, schedule.match_end_time) : '',
    venue: text(['其它', '其他'].includes(schedule.venue) ? schedule.venue_detail : schedule.venue),
  };
  if (template === 'eight') {
    fields.match_datetime = [fields.date, fields.time].filter(Boolean).join(' ');
    for (const key of [...Object.keys(names), 'date', 'time']) delete fields[key];
  }
  const suspended = new Set(suspensions.map(item => item.key));
  for (const [index, side] of ['a', 'b'].entries()) {
    const team = teams[index];
    const players = [...team.players].sort((a, b) => String(a.jersey_number).localeCompare(String(b.jersey_number), 'zh-CN', { numeric: true }) || a.id - b.id);
    if (players.length > options.capacity) throw businessError(`${team.name}的球员超过${options.capacity}人，无法放入${options.number}人制四官单，请先核对比赛名单`, 409);
    fields['team_' + side] = text(team.name);
    if (template === 'eight') {
      const colors = ['shirt_color', 'shorts_color', 'socks_color'].map(field => text(team[field]));
      fields[side + '_kit'] = colors.some(Boolean) ? colors.join('/') : '';
    } else {
      for (const [part, field] of [['shirt', 'shirt_color'], ['shorts', 'shorts_color'], ['socks', 'socks_color']]) fields[side + '_' + part] = text(team[field]);
    }
    for (let i = 0; i < options.capacity; i++) {
      const p = players[i];
      fields[`${side}_name_${i + 1}`] = playerDisplayName(p);
      fields[`${side}_number_${i + 1}`] = text(p?.jersey_number);
      fields[`${side}_suspended_${i + 1}`] = p && suspended.has(playerKey(p.team_id, p.player_account_id, p.id, p.import_person_id)) ? '×' : '';
    }
  }
  return fields;
}

async function generateDocument(data, template = 'eleven') {
  const options = templateOptions(template);
  const fields = buildFields(data, template);
  const patches = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
    /^[ab]_name_\d+$/.test(key)
      // Replace only the name paragraph, including its end-mark font and line
      // height, so smaller text cannot inherit the old oversized paragraph.
      ? { type: PatchType.DOCUMENT, children: [nameParagraph(value, template, key[0])] }
      : { type: PatchType.PARAGRAPH, children: [new TextRun(value)] }
  ]));
  // Only explicitly named fields are patched; the remaining score/stat/signature
  // cells stay blank even when the match already has a submitted report.
  const buffer = await patchDocument({ outputType: 'nodebuffer', data: templates[template], patches, keepOriginalStyles: true, recursive: false });
  const safe = value => text(value).replace(/[<>:"/\\|?*\r\n]/g, '_').slice(0, 60);
  return { buffer, filename: `四官单-${options.number}人制-${safe(data.schedule.field_order)}-${safe(data.teams[0].name)}vs${safe(data.teams[1].name)}.docx` };
}
module.exports = { MIME, templateOptions, buildFields, generateDocument };
