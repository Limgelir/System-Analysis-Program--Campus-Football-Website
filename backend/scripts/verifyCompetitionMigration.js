// Exercise the 0019 -> 0020 upgrade in a database owned only by this process.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const mysql=require('mysql2/promise'),bcrypt=require('bcryptjs');
const {loadTestConnectionEnvironment,executeSqlScript}=require('./runApiIntegrationTests');
const {runPendingMigrations}=require('../utils/migrationRunner');
async function main(){
  const {connection}=loadTestConnectionEnvironment();const c=await mysql.createConnection({...connection,dateStrings:['DATE']});
  const name=`refweb_competition_migration_${crypto.randomBytes(6).toString('hex')}_test`;let owned=false;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'refweb-competition-migrations-'));
  const migrate=()=>runPendingMigrations(c,{migrationsDir:directory});
  try{
    // Keep this historical upgrade proof independent of migrations after 0020.
    for(const file of fs.readdirSync(path.resolve(__dirname,'../../db/migrations')).filter(n=>/^\d{4}_.*\.js$/.test(n)&&n.slice(0,4)<='0020'))fs.copyFileSync(path.resolve(__dirname,'../../db/migrations',file),path.join(directory,file));
    await c.query(`CREATE DATABASE \`${name}\``);owned=true;
    const schema=fs.readFileSync(path.resolve(__dirname,'../../db/final_schema.sql'),'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i,`CREATE DATABASE IF NOT EXISTS \`${name}\``).replace(/USE\s+referee_system\s*;/i,`USE \`${name}\`;`);
    await executeSqlScript(c,schema);await migrate();
    // Restore precisely the columns that existed before this feature, while empty.
    await c.query('DROP TABLE competition_discipline_events');
    for(const [table,column] of [['team','league_type'],['match_schedules','match_type'],['season_competitions','league_type']])await c.query(`ALTER TABLE ${table} MODIFY ${column} ENUM('足协杯','大联赛','新生杯') NOT NULL`);
    await c.query('ALTER TABLE match_schedules DROP COLUMN field_order_sort, MODIFY field_order INT NOT NULL, ADD CONSTRAINT chk_schedule_field_order CHECK(field_order>0)');
    await c.query("ALTER TABLE match_cards MODIFY card_type ENUM('yellow','red') NOT NULL");
    await c.query('ALTER TABLE season_competitions '+['yellow_threshold','yellow_suspension','red_threshold','red_suspension','discipline_revision'].map(k=>'DROP COLUMN '+k).join(','));
    await c.query("DELETE FROM schema_migrations WHERE version='0020'");
    const hash=await bcrypt.hash(crypto.randomBytes(20).toString('hex'),4);
    await c.execute('INSERT INTO admin(username,password_hash) VALUES (?,?)',['migration-admin',hash]);
    for(let i=1;i<=2;i++)await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,is_active,token_version) VALUES (?, ?,?,'三级','二级','2025-01-01','足协杯',1,?)",['MIGRATE-'+i,'保留裁判'+i,hash,i]);
    const [empty]=await c.execute("INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES ('empty','空赛季','2026-01-01','2026-12-31',1)");
    const [old]=await c.execute("INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES ('old','历史赛季','2025-01-01','2025-12-31',0)");
    const teams=[];for(const n of ['历史主队','历史客队']){const [t]=await c.execute("INSERT INTO team(season_id,team_name,league_type) VALUES (?,?,'足协杯')",[old.insertId,n]);teams.push(t.insertId);}
    const [m]=await c.execute("INSERT INTO match_schedules(season_id,match_type,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot,match_date,match_time,field_order) VALUES (?,'足协杯',?,?,'历史主队','历史客队','2025-09-01','17:35',12)",[old.insertId,...teams]);
    const refs=(await c.query('SELECT * FROM referee ORDER BY id'))[0];
    const admins=(await c.query('SELECT * FROM admin ORDER BY id'))[0];
    const upgraded=await migrate();assert.deepEqual(upgraded.executed.map(m=>m.version),['0020']);
    assert.deepEqual((await c.query('SELECT * FROM referee ORDER BY id'))[0],refs);
    assert.deepEqual((await c.query('SELECT * FROM admin ORDER BY id'))[0],admins);
    assert.equal((await c.execute('SELECT * FROM season_competitions WHERE season_id=?',[empty.insertId]))[0].length,0);
    assert.deepEqual((await c.execute('SELECT league_type FROM season_competitions WHERE season_id=?',[old.insertId]))[0].map(r=>r.league_type),['足协杯']);
    const [[match]]=await c.execute('SELECT field_order,field_order_sort,match_type FROM match_schedules WHERE id=?',[m.insertId]);
    assert.equal(match.field_order,'12');assert.equal(match.field_order_sort,'#02:12');assert.equal(match.match_type,'足协杯');
    assert.equal((await migrate()).executed.length,0);
    const migration=require('../../db/migrations/0020_competitions_and_discipline');await migration.up(c);
    assert.deepEqual((await c.query('SELECT * FROM referee ORDER BY id'))[0],refs);
    assert.deepEqual((await c.query('SELECT * FROM admin ORDER BY id'))[0],admins);
    console.log('通过：管理员和两个裁判账号、密码哈希及会话版本保留；空赛季不建默认赛事；历史足协杯保留；数字场序转文本；重复迁移安全。');
  }finally{if(owned)await c.query(`DROP DATABASE \`${name}\``);await c.end();if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('refweb-competition-migrations-'))fs.rmSync(directory,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
