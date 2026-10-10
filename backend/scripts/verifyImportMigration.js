const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const mysql=require('mysql2/promise'),bcrypt=require('bcryptjs');
const {loadTestConnectionEnvironment,executeSqlScript}=require('./runApiIntegrationTests');
const {runPendingMigrations}=require('../utils/migrationRunner');
async function main(){
  const {connection}=loadTestConnectionEnvironment(),c=await mysql.createConnection({...connection,dateStrings:true});
  const database=`refweb_import_upgrade_${crypto.randomBytes(6).toString('hex')}_test`,directory=fs.mkdtempSync(path.join(os.tmpdir(),'refweb-import-migrations-'));
  let owned=false;
  try{
    for(const name of fs.readdirSync(path.resolve(__dirname,'../../db/migrations')).filter(n=>/^\d{4}_.*\.js$/.test(n)&&n.slice(0,4)<='0020'))fs.copyFileSync(path.resolve(__dirname,'../../db/migrations',name),path.join(directory,name));
    await c.query(`CREATE DATABASE \`${database}\``);owned=true;
    const sql=fs.readFileSync(path.resolve(__dirname,'../../db/final_schema.sql'),'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i,`CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i,`USE \`${database}\`;`);
    await executeSqlScript(c,sql);await runPendingMigrations(c,{migrationsDir:directory});
    const hash=await bcrypt.hash(crypto.randomBytes(20).toString('hex'),4);
    await c.execute('INSERT INTO admin(username,password_hash,token_version) VALUES (?,?,4)',['preserved-admin',hash]);
    for(let i=1;i<=2;i++)await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,token_version) VALUES (?, ?,?,'三级','二级','2025-01-01','足协杯',?)",['KEEP-'+i,'原裁判'+i,hash,i]);
    await c.execute("INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES ('KEEP','原赛季','2026-01-01','2027-01-01',1)");
    await c.execute("INSERT INTO player_accounts(student_id,name,college,password_hash,token_version) VALUES ('KEEP-PLAYER','原球员','测试学院',?,3)",[hash]);
    await c.execute("INSERT INTO season_competitions(season_id,league_type,is_enabled,yellow_threshold,yellow_suspension,red_threshold,red_suspension) VALUES (1,'原赛事',1,3,1,1,1)");
    await c.execute("INSERT INTO team(season_id,league_type,team_name,manager_player_id,captain_player_id) VALUES (1,'原赛事','原球队',1,1)");
    await c.execute("INSERT INTO team_applications(season_id,competition_id,manager_player_id,kind,team_name) VALUES (1,1,1,'initial','原报名')");
    const profile=JSON.stringify({id:1,student_id:'KEEP-PLAYER',name:'原球员',college:'测试学院'});
    await c.execute("INSERT INTO team_application_members(application_id,player_id,jersey_number,is_captain,profile_snapshot) VALUES (1,1,'7',1,?)",[profile]);
    await c.execute("INSERT INTO team_roster_batches(team_id,season_id,version_no) VALUES (1,1,1)");
    await c.execute("INSERT INTO team_player(team_id,roster_batch_id,player_account_id,player_name,jersey_number,profile_snapshot) VALUES (1,1,1,'原球员','7',?)",[profile]);
    const [tables]=await c.query("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'schema_migrations' ORDER BY TABLE_NAME");
    const snapshot={};for(const {name}of tables){const [rows]=await c.query('SELECT * FROM `'+name+'`');snapshot[name]=rows;}
    fs.copyFileSync(path.resolve(__dirname,'../../db/migrations/0021_imported_player_identities.js'),path.join(directory,'0021_imported_player_identities.js'));
    assert.deepEqual((await runPendingMigrations(c,{migrationsDir:directory})).executed.map(m=>m.version),['0021']);
    for(const {name}of tables){const columns=(await c.query('SHOW COLUMNS FROM `'+name+'`'))[0].map(v=>v.Field).filter(v=>!['import_person_id','manager_import_person_id'].includes(v));assert.deepEqual((await c.query('SELECT '+columns.map(n=>'`'+n+'`').join(',')+' FROM `'+name+'`'))[0],snapshot[name],name);}
    assert.equal((await runPendingMigrations(c,{migrationsDir:directory})).executed.length,0);await require('../../db/migrations/0021_imported_player_identities').up(c);
    assert.deepEqual((await c.query('SELECT * FROM admin'))[0],snapshot.admin);assert.deepEqual((await c.query('SELECT * FROM referee'))[0],snapshot.referee);
    console.log('0020 → 0021 升级通过：全部旧表原字段、管理员和两个裁判密码/会话、已有球员和名单不变；重复迁移安全。');
  }finally{
    if(owned)await c.query(`DROP DATABASE \`${database}\``);await c.end();
    if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('refweb-import-migrations-'))fs.rmSync(directory,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
