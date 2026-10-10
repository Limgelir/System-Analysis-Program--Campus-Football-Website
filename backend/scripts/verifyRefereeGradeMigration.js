const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), mysql = require('mysql2/promise');
const { loadTestConnectionEnvironment, executeSqlScript } = require('./runApiIntegrationTests');
const { runPendingMigrations, assertMigrationsCurrent } = require('../utils/migrationRunner');
async function main() {
  const { connection } = loadTestConnectionEnvironment();
  const c = await mysql.createConnection({ ...connection, dateStrings: true });
  const database = `refweb_grade_upgrade_${crypto.randomBytes(6).toString('hex')}_test`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'refweb-grade-migrations-'));
  const migrations = path.resolve(__dirname, '../../db/migrations');
  let owned = false;
  try {
    for (const name of fs.readdirSync(migrations).filter(n => /^\d{4}_.*\.js$/.test(n) && n.slice(0, 4) <= '0023')) fs.copyFileSync(path.join(migrations, name), path.join(directory, name));
    await c.query(`CREATE DATABASE \`${database}\``); owned = true;
    const schema = fs.readFileSync(path.resolve(__dirname, '../../db/final_schema.sql'), 'utf8')
      .replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i, `CREATE DATABASE IF NOT EXISTS \`${database}\``)
      .replace(/USE\s+referee_system\s*;/i, `USE \`${database}\`;`)
      .replaceAll("ENUM('裁判学员', '三级'", "ENUM('三级'")
      .replace('level_promoted_at DATE NULL', 'level_promoted_at DATE NOT NULL');
    await executeSqlScript(c, schema);
    await runPendingMigrations(c, { migrationsDir: directory });
    await c.query("INSERT INTO admin(username,password_hash,token_version) VALUES ('kept-admin','preserve-password-hash',4)");
    await c.query("INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES ('KEPT','旧赛季','2026-01-01','2027-01-01',1)");
    for (const [i, grade] of ['三级', '二级', '一级', '预备国家级', '国家级'].entries()) {
      await c.execute(`INSERT INTO referee(student_id,name,grade,target_level,level_promoted_at,password_hash,match_types,token_version)
        VALUES (?, ?, ?, ?, '2025-01-01', 'preserve-password-hash', '足协杯', 3)`, ['KEPT-' + i, '旧裁判' + i, grade, grade]);
      await c.execute(`INSERT INTO referee_season_registrations(season_id,referee_id,name_snapshot,height_cm_snapshot,weight_kg_snapshot,college_snapshot,grade_snapshot,match_types_snapshot,status,submitted_at)
        VALUES (1,?,'旧资料',175,65,'旧学院',?,'["足协杯"]','approved',NOW())`, [i + 1, grade]);
      await c.execute(`INSERT INTO referee_season_registration_events(registration_id,season_id,referee_id,event_type,to_status,application_version,actor_type,actor_referee_id,after_snapshot)
        VALUES (?,1,?,'submitted','pending',1,'referee',?,?)`, [i + 1, i + 1, i + 1, JSON.stringify({ grade_snapshot: grade })]);
    }
    const [tables] = await c.query("SELECT TABLE_NAME name FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'schema_migrations' ORDER BY TABLE_NAME");
    const snapshot = async () => {
      const rows = {};
      for (const { name } of tables) rows[name] = (await c.query('SELECT * FROM `' + name + '`'))[0].map(row => JSON.stringify(row)).sort();
      return rows;
    };
    const before = await snapshot();
    const file = '0024_referee_trainee_grade.js';
    fs.copyFileSync(path.join(migrations, file), path.join(directory, file));
    assert.deepEqual((await runPendingMigrations(c, { migrationsDir: directory })).executed.map(m => m.version), ['0024']);
    assert.deepEqual(await snapshot(), before, '全部旧业务行及密码、日期、级别与审核快照保持不变');
    await c.query("INSERT INTO referee(student_id,name,grade,target_level,level_promoted_at,password_hash,match_types) VALUES ('NEW','新学员','裁判学员','裁判学员',NULL,'synthetic','足协杯')");
    await c.query("UPDATE referee_season_registrations SET grade_snapshot='裁判学员' WHERE id=1");
    const withTrainee = await snapshot();
    await require(path.join(migrations, file)).up(c);
    assert.equal((await runPendingMigrations(c, { migrationsDir: directory })).executed.length, 0);
    await assertMigrationsCurrent(c, { migrationsDir: directory });
    assert.deepEqual(await snapshot(), withTrainee, '重复执行保留新学员及空日期');
    assert.deepEqual((await c.query('SELECT DISTINCT grade FROM referee ORDER BY grade'))[0].map(row => row.grade), ['裁判学员', '三级', '二级', '一级', '预备国家级', '国家级']);
    console.log(`0023 → 0024通过：${tables.length}张旧业务表逐行不变；六级顺序、学员空日期、重复迁移通过。`);
  } finally {
    if (owned) await c.query(`DROP DATABASE \`${database}\``);
    await c.end();
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('refweb-grade-migrations-')) fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
