const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const mysql=require('mysql2/promise'),bcrypt=require('bcryptjs');
const {loadTestConnectionEnvironment,executeSqlScript}=require('./runApiIntegrationTests');
const {runPendingMigrations}=require('../utils/migrationRunner');
async function main(){
  const {connection}=loadTestConnectionEnvironment(),c=await mysql.createConnection({...connection,dateStrings:true});
  const database=`refweb_supervision_upgrade_${crypto.randomBytes(6).toString('hex')}_test`,directory=fs.mkdtempSync(path.join(os.tmpdir(),'refweb-supervision-migrations-'));
  let owned=false;
  try{
    for(const name of fs.readdirSync(path.resolve(__dirname,'../../db/migrations')).filter(n=>/^\d{4}_.*\.js$/.test(n)&&n.slice(0,4)<='0021'))fs.copyFileSync(path.resolve(__dirname,'../../db/migrations',name),path.join(directory,name));
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
    await c.execute("INSERT INTO team(season_id,league_type,team_name) VALUES (1,'原赛事','原客队')");
    await c.execute("INSERT INTO match_schedules(season_id,match_type,team_a_id,team_b_id,team_a_name_snapshot,team_b_name_snapshot,match_date,match_time,field_order,main_referee_id,supervisor_id,main_referee_name_snapshot,supervisor_name_snapshot) VALUES (1,'原赛事',1,2,'原球队','原客队','2026-09-22','16:00','A1',1,2,'原裁判1','原裁判2'),(1,'原赛事',1,2,'原球队','原客队','2026-09-23','16:00','A2',NULL,NULL,NULL,NULL)");
    await c.execute("INSERT INTO match_official_assignments(schedule_id,role,source_type,referee_id,name_snapshot) VALUES (1,'main','system',1,'原裁判1'),(1,'supervisor','system',2,'原裁判2')");
    await c.execute("UPDATE match_reports SET main_report_started_at=NOW(),supervisor_review_started_at=NOW() WHERE schedule_id=1");
    await c.execute("INSERT INTO match_referee_stats(report_id,referee_id,assignment_id,role,running_distance_m) VALUES (1,1,1,'main',6000)");
    await c.execute("INSERT INTO match_referee_reviews(report_id,reviewer_referee_id,target_referee_id,target_assignment_id,reviewer_assignment_id,target_role,score,advice) VALUES (1,2,1,1,2,'main',8.5,'原裁判监督意见')");
    const [tables]=await c.query("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'schema_migrations' ORDER BY TABLE_NAME");
    const snapshot={};for(const {name}of tables){const [rows]=await c.query('SELECT * FROM `'+name+'`');snapshot[name]=rows;}
    fs.copyFileSync(path.resolve(__dirname,'../../db/migrations/0022_optional_supervisors.js'),path.join(directory,'0022_optional_supervisors.js'));
    assert.deepEqual((await runPendingMigrations(c,{migrationsDir:directory})).executed.map(m=>m.version),['0022']);
    for(const {name}of tables){const columns=(await c.query('SHOW COLUMNS FROM `'+name+'`'))[0].map(v=>v.Field).filter(v=>!['supervisor_required','field_referee_id','field_external_referee_id'].includes(v));assert.deepEqual((await c.query('SELECT '+columns.map(n=>'`'+n+'`').join(',')+' FROM `'+name+'`'))[0],snapshot[name],name);}
    assert.equal((await runPendingMigrations(c,{migrationsDir:directory})).executed.length,0);await require('../../db/migrations/0022_optional_supervisors').up(c);
    assert.deepEqual((await c.query('SELECT * FROM admin'))[0],snapshot.admin);assert.deepEqual((await c.query('SELECT * FROM referee'))[0],snapshot.referee);
    assert.ok((await c.query('SELECT supervisor_required FROM match_schedules'))[0].every(r=>r.supervisor_required===1));
    console.log('0021 → 0022 升级通过：所有旧表原字段、账号密码/会话、球队名单、已开始报告、选派ID和评分完整保留；已有比赛默认需要裁判监督，重复迁移安全。');
  }finally{
    if(owned)await c.query(`DROP DATABASE \`${database}\``);await c.end();
    if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('refweb-supervision-migrations-'))fs.rmSync(directory,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
