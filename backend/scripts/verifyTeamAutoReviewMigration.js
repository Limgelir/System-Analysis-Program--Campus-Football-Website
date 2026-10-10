const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const mysql=require('mysql2/promise'),bcrypt=require('bcryptjs');
const {loadTestConnectionEnvironment,executeSqlScript}=require('./runApiIntegrationTests');
const {runPendingMigrations}=require('../utils/migrationRunner');
async function main(){
  const {connection}=loadTestConnectionEnvironment(),c=await mysql.createConnection({...connection,dateStrings:true});
  const database=`refweb_auto_upgrade_${crypto.randomBytes(6).toString('hex')}_test`,directory=fs.mkdtempSync(path.join(os.tmpdir(),'refweb-auto-migrations-'));
  let owned=false;
  try{
    for(const name of fs.readdirSync(path.resolve(__dirname,'../../db/migrations')).filter(n=>/^\d{4}_.*\.js$/.test(n)&&n.slice(0,4)<='0022'))fs.copyFileSync(path.resolve(__dirname,'../../db/migrations',name),path.join(directory,name));
    await c.query(`CREATE DATABASE \`${database}\``);owned=true;
    const sql=fs.readFileSync(path.resolve(__dirname,'../../db/final_schema.sql'),'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i,`CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i,`USE \`${database}\`;`);
    await executeSqlScript(c,sql);await runPendingMigrations(c,{migrationsDir:directory});
    const hash=await bcrypt.hash(crypto.randomBytes(20).toString('hex'),4);
    await c.execute('INSERT INTO admin(username,password_hash,token_version) VALUES (?,?,4)',['preserved-admin',hash]);
    await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,token_version) VALUES ('KEEP-REF','原裁判',?,'三级','二级','2025-01-01','足协杯',3)",[hash]);
    await c.execute("INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES ('KEEP','原赛季','2026-01-01','2027-01-01',1)");
    await c.execute("INSERT INTO player_accounts(student_id,name,college,password_hash,token_version) VALUES ('KEEP-PLAYER','原球员','测试学院',?,3)",[hash]);
    await c.execute("INSERT INTO season_competitions(season_id,league_type,is_enabled,yellow_threshold,yellow_suspension,red_threshold,red_suspension) VALUES (1,'原赛事',1,3,1,1,1)");
    for(const name of ['原主队','原客队'])await c.execute("INSERT INTO team(season_id,league_type,team_name,manager_player_id,captain_player_id) VALUES (1,'原赛事',?,1,1)",[name]);
    await c.execute("INSERT INTO team_applications(season_id,competition_id,manager_player_id,kind,status,team_name) VALUES (1,1,1,'initial','pending','原待审申请')");
    const profile=JSON.stringify({id:1,student_id:'KEEP-PLAYER',name:'原球员',college:'测试学院'});
    await c.execute("INSERT INTO team_application_members(application_id,player_id,jersey_number,is_captain,profile_snapshot) VALUES (1,1,'7',1,?)",[profile]);
    await c.execute("INSERT INTO team_roster_batches(team_id,season_id,version_no) VALUES (1,1,1)");
    await c.execute("INSERT INTO team_player(team_id,roster_batch_id,player_account_id,player_name,jersey_number,profile_snapshot) VALUES (1,1,1,'原球员','7',?)",[profile]);
    await c.execute("INSERT INTO match_schedules(season_id,match_type,team_a_id,team_b_id,match_date,match_time,field_order,venue) VALUES (1,'原赛事',1,2,'2026-09-27','12:00','A1','樱花人草')");
    const [tables]=await c.query("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'schema_migrations' ORDER BY TABLE_NAME");
    const snapshot={},columns={};for(const {name}of tables){columns[name]=(await c.query('SHOW COLUMNS FROM `'+name+'`'))[0].map(v=>v.Field);snapshot[name]=(await c.query('SELECT * FROM `'+name+'`'))[0];}
    const file='0023_team_automatic_review.js';fs.copyFileSync(path.resolve(__dirname,'../../db/migrations',file),path.join(directory,file));
    assert.deepEqual((await runPendingMigrations(c,{migrationsDir:directory})).executed.map(m=>m.version),['0023']);
    for(const {name}of tables)assert.deepEqual((await c.query('SELECT '+columns[name].map(n=>'`'+n+'`').join(',')+' FROM `'+name+'`'))[0],snapshot[name],name);
    const [[rules]]=await c.query('SELECT min_players,max_players,max_colleges,max_foreign_players,max_sports_training_players FROM season_competitions WHERE id=1');assert.ok(Object.values(rules).every(v=>v===null));
    assert.equal((await c.query('SELECT auto_review FROM team_applications WHERE id=1'))[0][0].auto_review,null);
    assert.equal((await runPendingMigrations(c,{migrationsDir:directory})).executed.length,0);
    console.log(`0022 → 0023通过：${tables.length}张旧表的全部原字段、账号密码、赛季赛事、球员、球队、待审名单与既有赛程保持；限制默认不限，重复迁移安全。`);
  }finally{
    if(owned)await c.query(`DROP DATABASE \`${database}\``);await c.end();
    if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('refweb-auto-migrations-'))fs.rmSync(directory,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
