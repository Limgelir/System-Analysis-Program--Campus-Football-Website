const test = require('node:test');
const assert = require('node:assert/strict');
const { validateScheduleMutationPayload: validate } = require('../utils/scheduleValidator');
const { readMatchTime } = require('../utils/matchTime');
const base = { venue:'樱花人草', match_type: '足协杯', team_a_id: 1, team_b_id: 2, match_date: '2026-12-31', field_order: 1 };

test('开球时间严格为24小时制分钟，午夜与待定不同', () => {
  for (const value of ['00:00', '17:35', '18:00', '23:59']) assert.equal(validate({ ...base, match_time: value }).match_time, value);
  for (const value of ['24:00','17:60','7:35','17:35:00',' 17:35','17:35 ','17:35\n','2026-12-31T17:35:00Z',1735,{},['17:35']]) {
    assert.throws(() => validate({ ...base, match_time: value }), { code: 'MATCH_TIME_INVALID' });
  }
  for (const value of [undefined, null, '']) assert.throws(() => validate({ ...base, match_time: value }), { code: 'MATCH_TIME_REQUIRED' });
  assert.equal(validate(base, { allowUnknownTime: true }).match_time, null);
  assert.equal(readMatchTime('00:00:00'), '00:00');
  assert.equal(readMatchTime(null), null);
  assert.equal(readMatchTime('17:35:00'), '17:35');
});

test('不同时区保留业务日期和开球分钟，不隐式跨日', () => {
  const { execFileSync } = require('node:child_process');
  for (const TZ of ['UTC','Asia/Shanghai','America/Los_Angeles']) {
    const code = `const v=require('./utils/scheduleValidator').validateScheduleMutationPayload;process.stdout.write(JSON.stringify(v(${JSON.stringify({ ...base, match_time: '00:00' })})))`;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, TZ }, encoding: 'utf8' }));
    assert.equal(result.match_date, '2026-12-31');
    assert.equal(result.match_time, '00:00');
  }
});
