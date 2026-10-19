const assert = require('node:assert/strict');
const { runPendingMigrations, assertMigrationsCurrent } = require('../../utils/migrationRunner');
module.exports = async ({ t, pool, state, request, expectStatus }) => {
  if (process.env.REFWEB_INTEGRATION_TEST !== '1' || !process.env.DB_NAME.endsWith('_test')) throw Error('仅隔离测试库');
  const admin = state.tokens.admin;
  const call = async (url, body, method='GET', status=200, token=admin) => {
    const r=await request(url,{body,method,token});expectStatus(r,status,url);return r.data?.data;
  };
  await t.test('0018旧库升级保留全部旧字段、空时间与历史快照，重复迁移无变化', async () => {
    const c=await pool.getConnection();
    const tables=['admin','referee','match_schedules','match_reports','match_official_assignments','match_roster_selections','report_section_history'];
    const snapshot=async()=>{
      const result={};for(const table of tables)result[table]=(await c.query(`SELECT * FROM ${table}`))[0].map(row=>{
        if(table==='match_schedules')delete row.match_time;return JSON.stringify(row);
      }).sort();return result;
    };
    try {
      const before=await snapshot();
      await c.query('ALTER TABLE match_schedules DROP CHECK chk_schedule_match_end_time, DROP CHECK chk_schedule_match_time, DROP COLUMN match_time');
      await c.query("DELETE FROM schema_migrations WHERE version>='0018'");
      const upgraded=await runPendingMigrations(c);assert.deepEqual(upgraded.executed.map(m=>m.version),['0018','0019','0020','0021','0022','0023','0024','0025','0026','0027','0028','0029','0030','0031','0032','0033','0034','0035','0036']);
      assert.deepEqual(await snapshot(),before);
      const [[count]]=await c.query('SELECT COUNT(*) AS n FROM match_schedules WHERE match_time IS NOT NULL');assert.equal(count.n,0);
      await runPendingMigrations(c);await assertMigrationsCurrent(c);assert.deepEqual(await snapshot(),before);
    } finally {c.release();}
  });
  let home,away,season,base,known,legacy;
  await t.test('新赛程时间必填、格式严格，00:00与17:35准确存取并同步契约和预填', async () => {
    season=await call('/api/season',{season_code:'TIME-01',season_name:'开球时间验收',start_date:'2026-01-01',end_date:'2028-12-31',is_active:true},'POST',201);
    await pool.execute("INSERT INTO season_competitions(season_id,league_type) VALUES (?,'足协杯')",[season.id]);
    // Match fixtures belong only to this isolated database.
    [home]=await pool.execute("INSERT INTO team(season_id,team_name,league_type) VALUES (?,'时间主队','足协杯')",[season.id]);
    [away]=await pool.execute("INSERT INTO team(season_id,team_name,league_type) VALUES (?,'时间客队','足协杯')",[season.id]);
    base={match_type:'足协杯',team_a_id:home.insertId,team_b_id:away.insertId,match_date:'2026-12-31',field_order:900};
    for(const value of [undefined,null,'','24:00','17:60','7:35','17:35:00',1735,['17:35']]) await call('/api/schedule',{...base,match_time:value},'POST',400);
    known=await call('/api/schedule',{...base,match_time:'17:35'},'POST');
    assert.equal(known.match_time,'17:35');assert.equal(known.match.match_time,'17:35');assert.equal(known.template_prefill.match_time,'17:35');
    const midnight=await call('/api/schedule',{...base,field_order:901,match_time:'00:00'},'POST');assert.equal(midnight.match_time,'00:00');
    await call('/api/schedule',{...base,field_order:902,match_time:'18:00'},'POST');
    const [old]=await pool.execute(`INSERT INTO match_schedules(season_id,match_type,team_a_id,team_b_id,match_date,field_order,team_a_name_snapshot,team_b_name_snapshot)
      VALUES (?,'足协杯',?,?,'2026-12-31',899,'时间主队','时间客队')`,[season.id,home.insertId,away.insertId]);legacy=old.insertId;
    assert.equal((await call('/api/schedule/'+legacy)).match_time,null);
  });
  await t.test('管理员/公开/球员赛程按同日时间排序，待定最后；CSV跨页含时间', async () => {
    const expected=['00:00','17:35','18:00',null];
    const list=await call('/api/schedule?season_id='+season.id);assert.deepEqual(list.map(r=>r.match_time),expected);
    const pub=await call('/api/public/teams/'+home.insertId,undefined,'GET',200,null);assert.deepEqual(pub.matches.map(r=>r.match_time),expected);
    const [[player]]=await pool.query('SELECT id,token_version FROM player_accounts WHERE is_active=1 AND must_change_password=0 LIMIT 1');
    const token=require('jsonwebtoken').sign({id:player.id,role:'player',tokenVersion:player.token_version},process.env.JWT_SECRET);
    const results=await call('/api/player/team-results/'+home.insertId,undefined,'GET',200,token);assert.deepEqual(results.matches.map(r=>r.match_time),expected);
    const csv=await request('/api/schedule/export?season_id='+season.id+'&page_size=1',{token:admin});expectStatus(csv,200,'导出');
    for(const value of ['比赛时间','17:35','18:00','00:00','时间待定'])assert.ok(csv.data.includes(value));
  });
  await t.test('旧比赛可保留待定或补时间，已知时间不可清空；省略时间不覆盖现值', async () => {
    let old=await call('/api/schedule/'+legacy,{...base,field_order:899},'PUT');assert.equal(old.match_time,null);
    old=await call('/api/schedule/'+legacy,{...base,field_order:899,match_time:'16:20'},'PUT');assert.equal(old.match_time,'16:20');
    for(const value of [null,''])await call('/api/schedule/'+legacy,{...base,field_order:899,match_time:value},'PUT',400);
    old=await call('/api/schedule/'+legacy,{...base,field_order:899},'PUT');assert.equal(old.match_time,'16:20');
    known=await call('/api/schedule/'+known.id,{...base,match_time:'18:00'},'PUT');assert.equal(known.match_time,'18:00');
  });
  await t.test('报告开始后时间锁定，报告快照包含时间，改时间不改变比赛名单', async () => {
    const before=(await pool.query('SELECT * FROM match_roster_selections WHERE schedule_id=?',[known.id]))[0];
    await call('/api/schedule/'+known.id,{...base,match_time:'17:35'},'PUT');
    assert.deepEqual((await pool.query('SELECT * FROM match_roster_selections WHERE schedule_id=?',[known.id]))[0],before);
    await pool.execute('UPDATE match_reports SET main_report_started_at=NOW() WHERE schedule_id=?',[known.id]);
    const r=await request('/api/schedule/'+known.id,{token:admin,method:'PUT',body:{...base,match_time:'18:00'}});
    expectStatus(r,400,'时间锁定');assert.equal(r.data.code,'SCHEDULE_CORE_LOCKED');
    const [[report]]=await pool.query('SELECT id FROM match_reports WHERE schedule_id=?',[known.id]);
    const snapshot=await require('../../utils/reportHistory').captureSnapshot(pool,report.id,'main');assert.equal(snapshot.match.match_time,'17:35');
    for(const time of ['24:00:00','-01:00:00','17:35:01'])await assert.rejects(pool.execute('UPDATE match_schedules SET match_time=? WHERE id=?',[time,legacy]));
    assert.equal((await call('/api/schedule/'+known.id)).match_time,'17:35');
  });
};
