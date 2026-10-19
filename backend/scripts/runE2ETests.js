// 唯一随机数据库、随机监听端口和临时上传目录；从不清空已有库，也不访问云端。
const fs=require('fs');const path=require('path');const os=require('os');const crypto=require('crypto');
const mysql=require('mysql2/promise');const bcrypt=require('bcryptjs');const {spawn}=require('child_process');
const {loadTestConnectionEnvironment,executeSqlScript}=require('./runApiIntegrationTests');
const {runPendingMigrations,assertMigrationsCurrent}=require('../utils/migrationRunner');
const root=path.resolve(__dirname,'../..');
const playerMode=process.argv.includes('--player');
async function main(){
  const options=loadTestConnectionEnvironment();
  fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
  if(!fs.existsSync(path.join(root,'frontend/dist/index.html')))throw Error('请先在 frontend 执行 npm run build');
  if(playerMode&&!fs.existsSync(path.join(root,'player-frontend/dist/index.html')))throw Error('请先在 player-frontend 执行 npm run build');
  const database=`tj_refweb_e2e_${crypto.randomBytes(6).toString('hex')}_test`;
  const uploads=fs.mkdtempSync(path.join(os.tmpdir(),'tj-refweb-e2e-'));
  const c=await mysql.createConnection(options.connection);
  let owned=false,server,playerServer,pool,child;
  try{
    await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);owned=true;
    const schema=fs.readFileSync(path.join(root,'db/final_schema.sql'),'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i,`CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i,`USE \`${database}\`;`);
    await executeSqlScript(c,schema);await runPendingMigrations(c);await assertMigrationsCurrent(c);
    const password='E2e!'+crypto.randomBytes(12).toString('base64url');
    const hash=await bcrypt.hash(password,4);
    await c.execute('INSERT INTO admin (username,password_hash,must_change_password,token_version,password_changed_at) VALUES (?,?,0,0,NOW())',['e2e-admin',hash]);
    for(let i=1;i<=20;i++){
      const [r]=await c.execute(`INSERT INTO referee (student_id,name,grade,target_level,level_promoted_at,match_types,password_hash,must_change_password,token_version,is_active,password_changed_at) VALUES (?,?,'三级','二级','2025-01-01','足协杯',?,0,0,1,NOW())`,[`E2E-${i}`,`浏览器裁判${i}`,hash]);
      await c.execute("INSERT INTO referee_profile (referee_id,gender,college,height_cm,weight_kg,officiated_count_base) VALUES (?,'男','测试学院',175,65,0)",[r.insertId]);
    }
    for(const [id,college]of [['COLLEGE-LEGACY','中德'],['COLLEGE-MATCHED','土木学院']])await c.execute("INSERT INTO player_accounts(student_id,name,college,password_hash) VALUES (?,'旧学院验收球员',?,?)",[id,college,hash]);
    for (const [id,name] of [['GENDER-LEGACY','旧性别账号'],['GENDER-MEMBER','未补填队员']]) await c.execute("INSERT INTO player_accounts(student_id,name,college,password_hash) VALUES (?,?,'土木工程学院',?)",[id,name,hash]);
    await require('../../db/migrations/0025_account_college_catalog').up(c);
    Object.assign(process.env,{NODE_ENV:'test',HOST:'127.0.0.1',DB_NAME:database,UPLOAD_DIR:uploads,CORS_ORIGIN:'',TRUST_PROXY:'false',JWT_SECRET:crypto.randomBytes(48).toString('base64url'),API_RATE_LIMIT_MAX:'5000',LOGIN_RATE_LIMIT_MAX:'200',REGISTRATION_RATE_LIMIT_MAX:'200'});
    // dotenv 不覆盖以上隔离参数；应用真正连接的是新建的随机测试库。
    const app=require('../server');pool=require('../db');require('../utils/uploadPaths').ensureUploadDirectories();
    const site=require('../utils/previewSite')(app,path.join(root,'frontend/dist'));
    server=await new Promise(resolve=>{const s=site.listen(0,'127.0.0.1',()=>resolve(s))});
    const url=`http://127.0.0.1:${server.address().port}`;
    let playerUrl;
    if(playerMode){
      const express=require('express'),playerApp=express();
      playerApp.use((req,res,next)=>req.path==='/api'||req.path.startsWith('/api/')?app(req,res,next):next());
      playerApp.use(express.static(path.join(root,'player-frontend/dist')));
      playerApp.get(/^(?!\/api(?:\/|$)).*/, (req,res)=>res.sendFile(path.join(root,'player-frontend/dist/index.html')));
      playerServer=await new Promise(resolve=>{const s=playerApp.listen(0,'127.0.0.1',()=>resolve(s))});
      playerUrl=`http://127.0.0.1:${playerServer.address().port}`;
    }
    console.log(`✓ E2E 隔离服务 ${url}；随机库 ${database}；不使用日常账号`);
    const code=await new Promise((resolve,reject)=>{
      const frontendDir=playerMode?'player-frontend':'frontend';
      child=spawn(process.execPath,[path.join(root,frontendDir,'node_modules/@playwright/test/cli.js'),'test','--config=playwright.config.js',...(process.argv.includes('--assignment-changes')?['tests/e2e/assignmentChanges.spec.js']:process.argv.includes('--assignment-export')?['tests/e2e/assignmentExport.spec.js']:process.argv.includes('--fourth-sheet')?['tests/e2e/fourthOfficialSheet.spec.js']:process.argv.includes('--admin-teams')?['tests/e2e/adminTeamManagement.spec.js']:process.argv.includes('--schedule-imports')?['tests/e2e/scheduleImports.spec.js']:process.argv.includes('--futsal')?['tests/e2e/futsal.spec.js']:process.argv.includes('--forfeits')?['tests/e2e/reportForfeits.spec.js']:process.argv.includes('--player-tags')?['tests/e2e/playerGenderTags.spec.js']:process.argv.includes('--colleges')?['tests/e2e/colleges.spec.js','tests/e2e/collegeChanges.spec.js']:process.argv.includes('--referee-grades')?['tests/e2e/refereeGrades.spec.js']:process.argv.includes('--team-auto-review')?['tests/e2e/teamAutoReview.spec.js']:[])],{cwd:path.join(root,frontendDir),windowsHide:true,stdio:'inherit',env:{...process.env,REFWEB_E2E:'1',E2E_MOBILE:process.argv.includes('--mobile')?'1':'0',E2E_BASE_URL:playerUrl||url,E2E_ADMIN_URL:url,E2E_PASSWORD:password}});
      child.once('error',reject);child.once('exit',code=>resolve(code??1));
    });process.exitCode=code;
  }finally{
    if(child&&child.exitCode===null)child.kill();
    if(server)await new Promise(resolve=>server.close(resolve));
    if(playerServer)await new Promise(resolve=>playerServer.close(resolve));
    if(pool)await pool.end();
    if(owned)await c.query(`DROP DATABASE \`${database}\``);
    await c.end();fs.rmSync(uploads,{recursive:true,force:true});console.log('✓ 已清理本次 E2E 隔离数据库和临时上传目录');
  }
}
main().catch(e=>{console.error('E2E 失败:',e.message);process.exitCode=1});
