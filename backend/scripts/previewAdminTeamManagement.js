// 本机独立验收环境；停止时仅清理本进程创建的随机数据库和临时上传。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const mysql=require('mysql2/promise'),bcrypt=require('bcryptjs');
const {loadTestConnectionEnvironment,executeSqlScript}=require('./runApiIntegrationTests');
const {runPendingMigrations}=require('../utils/migrationRunner');
const root=path.resolve(__dirname,'../..'),cache=path.join(root,'.cache');
async function main(){
  const options=loadTestConnectionEnvironment(),database=`refweb_admin_team_${crypto.randomBytes(6).toString('hex')}_test`;
  const uploads=fs.mkdtempSync(path.join(os.tmpdir(),'refweb-admin-team-')),c=await mysql.createConnection(options.connection),servers=[];
  let owned=false,pool;
  try{
    for(const site of ['frontend','player-frontend'])if(!fs.existsSync(path.join(root,site,'dist/index.html')))throw Error('请先构建两个前端');
    await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);owned=true;
    await executeSqlScript(c,fs.readFileSync(path.join(root,'db/final_schema.sql'),'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i,`CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i,`USE \`${database}\`;`));
    await runPendingMigrations(c);
    Object.assign(process.env,{NODE_ENV:'test',HOST:'127.0.0.1',DB_NAME:database,UPLOAD_DIR:uploads,CORS_ORIGIN:'',TRUST_PROXY:'false',JWT_SECRET:crypto.randomBytes(48).toString('base64url'),API_RATE_LIMIT_MAX:'5000',LOGIN_RATE_LIMIT_MAX:'300',REGISTRATION_RATE_LIMIT_MAX:'300'});
    const password='Local!'+crypto.randomBytes(12).toString('base64url'),username='team-admin';
    await c.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())',[username,await bcrypt.hash(password,10)]);
    const app=require('../server');pool=require('../db');require('../utils/uploadPaths').ensureUploadDirectories();
    for(const [directory,port] of [['frontend',5228],['player-frontend',5229]]){
      const site=require('../utils/previewSite')(app,path.join(root,directory,'dist'));
      servers.push(await new Promise((resolve,reject)=>{const s=site.listen(port,'127.0.0.1',()=>resolve(s));s.once('error',reject)}));
    }
    const credentials=await require('./seedAdminTeamManagement')({base:'http://127.0.0.1:5228',username,password});
    await c.execute('UPDATE player_accounts SET gender=NULL WHERE id=?',[credentials.players[4].id]);
    fs.mkdirSync(cache,{recursive:true});
    fs.writeFileSync(path.join(cache,'admin-team-preview.seed'),JSON.stringify({...credentials,database,admin_url:'http://127.0.0.1:5228',player_url:'http://127.0.0.1:5229'},null,2),{mode:0o600});
    fs.writeFileSync(path.join(cache,'admin-team-local-acceptance.txt'),`管理员：http://127.0.0.1:5228/admin-login\n账号：${username}\n密码：${password}\n\n球员：http://127.0.0.1:5229/login\n负责人：ADM-LOCAL-0\n球员密码同上。\n\n本轮验收：\n1. 正式球队与名单 → 四学院超限验收队 → 管理员修改球队 → 打开编辑。名单有4个学院，赛事上限2个；修改颜色或号码后保存应成功。\n2. 添加 ADM-LOCAL-0（学籍未通过），填写未重复号码，勾选外援、运训及足球特长生，保存应成功。\n3. 添加 ADM-LOCAL-4（账号已停用且未填性别），填写未重复号码后保存应成功；也可将其设为负责人。\n4. 尝试重复号码或移除唯一队长，保存仍会提示基本规则错误。\n5. 保存后重新载入，确认名单、标记及新负责人保持。\n\n赛事最多1人、最多2学院，外援/运训/足球特长生及合并人数上限0；报名及名单窗口已关闭。另有“可编辑示例队”“可撤销退回队”“可恢复通过队”供已有流程回归。\n\n全部数据均为虚构，使用随机隔离库。停止：在 .cache 下创建 admin-team-preview.stop 文件。\n`,{mode:0o600});
    console.log('本地验收就绪：http://127.0.0.1:5228/admin-login；账号见 .cache/admin-team-local-acceptance.txt');
    const stop=path.join(cache,'admin-team-preview.stop');if(fs.existsSync(stop))fs.unlinkSync(stop);
    await new Promise(resolve=>{const done=()=>{clearInterval(timer);resolve()};const timer=setInterval(()=>{if(fs.existsSync(stop)){fs.unlinkSync(stop);done()}},1000);process.once('SIGINT',done);process.once('SIGTERM',done)});
  }finally{
    for(const s of servers){s.closeAllConnections();await new Promise(resolve=>s.close(resolve))}
    if(pool)await pool.end();if(owned)await c.query(`DROP DATABASE \`${database}\``);await c.end();
    if(path.dirname(uploads)===os.tmpdir()&&path.basename(uploads).startsWith('refweb-admin-team-'))fs.rmSync(uploads,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
