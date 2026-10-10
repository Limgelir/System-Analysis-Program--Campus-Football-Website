const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),mysql=require('mysql2/promise');
const {loadTestConnectionEnvironment,executeSqlScript}=require('./runApiIntegrationTests');
const {runPendingMigrations,assertMigrationsCurrent}=require('../utils/migrationRunner');
const {matchCollege}=require('../utils/collegeIdentity');
async function main(){
  const {connection}=loadTestConnectionEnvironment(),c=await mysql.createConnection({...connection,dateStrings:true});
  const database=`refweb_college_upgrade_${crypto.randomBytes(6).toString('hex')}_test`;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'refweb-college-migrations-')),migrations=path.resolve(__dirname,'../../db/migrations');let owned=false;
  try{
    for(const name of fs.readdirSync(migrations).filter(n=>/^\d{4}_.*\.js$/.test(n)&&n.slice(0,4)<='0024'))fs.copyFileSync(path.join(migrations,name),path.join(directory,name));
    await c.query(`CREATE DATABASE \`${database}\``);owned=true;
    const schema=fs.readFileSync(path.resolve(__dirname,'../../db/final_schema.sql'),'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i,`CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i,`USE \`${database}\`;`);
    await executeSqlScript(c,schema);
    for(const table of ['player_college_change_events','player_college_changes','account_college_standardizations','account_college_normalizations'])await c.query('DROP TABLE '+table);
    await runPendingMigrations(c,{migrationsDir:directory});
    await c.query("INSERT INTO admin(username,password_hash,token_version) VALUES ('kept-admin','preserve-hash',5)");
    await c.query("INSERT INTO seasons(season_code,season_name,start_date,end_date,is_active) VALUES ('KEPT','学院迁移旧赛季','2026-01-01','2027-01-01',1)");
    const names=['土木学院','土木工程',' 土木工程学院 ','同济大学软件学院','计算机科学与技术学院 (软件学院)','计算机','体育教学部','国际足球学院','轨交院','汽车学院','中德','机能学院','机械与能源工程学院','工程学院','','上海自主智能无人系统科学中心'];
    for(const [i,college]of names.entries()){
      await c.execute("INSERT INTO player_accounts(student_id,name,college,password_hash,token_version,revision) VALUES (?, '旧球员',?,'preserve-player-hash',7,4)",['KEPT-P-'+i,college]);
      await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,token_version) VALUES (?,'旧裁判','preserve-ref-hash','一级','国家级','2024-01-01','足协杯',6)",['KEPT-R-'+i]);
      await c.execute("INSERT INTO referee_profile(referee_id,college,gender,height_cm,weight_kg,officiated_count_base,id_photo_path) VALUES (?,?,'男',175,65,12,'keep-photo.png')",[i+1,college]);
      await c.execute("INSERT INTO referee_season_registrations(season_id,referee_id,name_snapshot,height_cm_snapshot,weight_kg_snapshot,college_snapshot,grade_snapshot,match_types_snapshot,status,submitted_at) VALUES (1,?,'旧裁判',175,65,?,'一级','[\"足协杯\"]','approved',NOW())",[i+1,college]);
      await c.execute("INSERT INTO player_season_registrations(season_id,player_id,status,revision,profile_snapshot,submitted_at) VALUES (1,?,'approved',1,?,NOW(3))",[i+1,JSON.stringify({name:'旧球员',college})]);
    }
    const [tables]=await c.query("SELECT TABLE_NAME name FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME NOT IN ('schema_migrations','account_college_normalizations') ORDER BY TABLE_NAME");
    const snapshot=async()=>{const result={};for(const {name}of tables)result[name]=(await c.query('SELECT * FROM `'+name+'`'))[0];return result;};
    const before=await snapshot(),file='0025_account_college_catalog.js';fs.copyFileSync(path.join(migrations,file),path.join(directory,file));
    assert.deepEqual((await runPendingMigrations(c,{migrationsDir:directory})).executed.map(m=>m.version),['0025']);
    const after=await snapshot();
    const omit=({college,revision,updated_at,...rest})=>rest;
    for(const {name}of tables){
      if(['player_accounts','referee_profile'].includes(name))assert.deepEqual(after[name].map(omit),before[name].map(omit),name+'其他字段不变');
      else assert.deepEqual(after[name],before[name],name+'全部记录不变');
    }
    for(const [i,college]of names.entries())for(const role of ['player','referee']){
      const table=role==='player'?'player_accounts':'referee_profile',idField=role==='player'?'id':'referee_id';
      const row=after[table].find(r=>r[idField]===i+1),match=matchCollege(college);
      assert.equal(row.college,role==='player'?college:match.college||college);
      if(role==='player')assert.equal(row.revision,4);
      const [[log]]=await c.execute('SELECT * FROM account_college_normalizations WHERE account_role=? AND account_id=?',[role,i+1]);
      assert.equal(log.original_college,college);assert.equal(log.matched_college,match.college);assert.equal(log.match_method,match.method);
      if(role==='player')assert.equal(log.changed,0);
    }
    await c.query("UPDATE player_accounts SET college='环境科学与工程学院',revision=revision+1 WHERE id=1");
    const changed=await snapshot(),logs=(await c.query('SELECT * FROM account_college_normalizations ORDER BY account_role,account_id'))[0];
    await require(path.join(migrations,file)).up(c);
    assert.deepEqual(await snapshot(),changed,'重复运行不覆盖本人后来选择，也不重复调整版本');
    assert.deepEqual((await c.query('SELECT * FROM account_college_normalizations ORDER BY account_role,account_id'))[0],logs);
    const next='0026_player_college_change_reviews.js';fs.copyFileSync(path.join(migrations,next),path.join(directory,next));
    assert.deepEqual((await runPendingMigrations(c,{migrationsDir:directory})).executed.map(m=>m.version),['0026']);
    assert.deepEqual(await snapshot(),changed,'学院审核迁移不改所有已有业务行');
    await require(path.join(migrations,next)).up(c);assert.deepEqual(await snapshot(),changed,'学院审核迁移重复执行不改旧数据');
    const confirmed=['交通','体育部国际足球学院','国际足球学校','同济大学自主智能无人系统科学中心','上海自主智能无人科学中心','上线验收'];
    for(const [i,college]of confirmed.entries()){
      await c.execute("INSERT INTO player_accounts(student_id,name,college,password_hash,token_version,revision,is_active) VALUES (?,'待标准化球员',?,'preserve-player-hash',7,4,?)",['CONFIRMED-P-'+i,college,college==='上线验收'?0:1]);
      const [r]=await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,match_types,token_version,is_active) VALUES (?,'待标准化裁判','preserve-ref-hash','一级','国家级','足协杯',6,?)",['CONFIRMED-R-'+i,college==='上线验收'?0:1]);
      await c.execute('INSERT INTO referee_profile(referee_id,college) VALUES (?,?)',[r.insertId,college]);
    }
    const beforeStandardization=await snapshot(),legacyLogs=(await c.query('SELECT * FROM account_college_normalizations ORDER BY account_role,account_id'))[0];
    const standardization='0027_legacy_account_college_standardization.js';
    fs.copyFileSync(path.join(migrations,standardization),path.join(directory,standardization));
    await c.query("CREATE TRIGGER reject_standardization BEFORE UPDATE ON player_accounts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rollback'");
    await assert.rejects(runPendingMigrations(c,{migrationsDir:directory}),/test rollback/);
    assert.deepEqual(await snapshot(),beforeStandardization,'失败时所有业务行回滚');
    assert.equal((await c.query('SELECT COUNT(*) n FROM account_college_standardizations'))[0][0].n,0,'失败时不留下部分审计');
    await c.query('DROP TRIGGER reject_standardization');
    assert.deepEqual((await runPendingMigrations(c,{migrationsDir:directory})).executed.map(m=>m.version),['0027']);
    const standardized=await snapshot();
    for(const {name}of tables){
      if(['player_accounts','referee_profile'].includes(name))assert.deepEqual(standardized[name].map(omit),beforeStandardization[name].map(omit),name+'仅学院、球员版本和更新时间允许变化');
      else assert.deepEqual(standardized[name],beforeStandardization[name],name+'历史不变');
    }
    for(const role of ['player','referee']){
      const table=role==='player'?'player_accounts':'referee_profile',idField=role==='player'?'id':'referee_id';
      for(const old of beforeStandardization[table]){
        const row=standardized[table].find(r=>r[idField]===old[idField]);
        const match=matchCollege(old.college),target=match.college||old.college,changedCollege=target!==old.college;
        assert.equal(row.college,target);
        if(role==='player')assert.equal(row.revision,old.revision+(changedCollege?1:0),'仅实际标准化时增加资料版本');
        const [[log]]=await c.execute('SELECT * FROM account_college_standardizations WHERE account_role=? AND account_id=?',[role,old[idField]]);
        assert.equal(log.original_college,old.college);assert.equal(log.matched_college,match.college);assert.equal(log.changed,changedCollege?1:0);
      }
    }
    assert.deepEqual((await c.query('SELECT * FROM account_college_normalizations ORDER BY account_role,account_id'))[0],legacyLogs,'0025建议记录不覆写');
    await c.query("UPDATE player_accounts SET college='人文学院',revision=revision+1 WHERE id=1");
    const later=await snapshot(),standardLogs=(await c.query('SELECT * FROM account_college_standardizations ORDER BY account_role,account_id'))[0];
    await require(path.join(migrations,standardization)).up(c);
    assert.deepEqual(await snapshot(),later,'重复执行不覆盖后续学院修改');
    assert.deepEqual((await c.query('SELECT * FROM account_college_standardizations ORDER BY account_role,account_id'))[0],standardLogs,'重复执行不覆盖审计原值');
    await assertMigrationsCurrent(c,{migrationsDir:directory});
    console.log(`0024 → 0025 → 0026 → 0027通过：${(names.length+confirmed.length)*2}个旧账号，${tables.length}张旧业务表；仅本次球员和裁判可靠匹配直接更新，密码、状态、历史快照保留；失败回滚、重复运行及后续修改保留通过。`);
  }finally{if(owned)await c.query(`DROP DATABASE \`${database}\``);await c.end();if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('refweb-college-migrations-'))fs.rmSync(directory,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
