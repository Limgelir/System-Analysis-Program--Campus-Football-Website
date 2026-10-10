// Local acceptance environment: a new random database, synthetic people, loopback only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const mysql=require('mysql2/promise'),bcrypt=require('bcryptjs'),XLSX=require('xlsx');
const {loadTestConnectionEnvironment,executeSqlScript}=require('./runApiIntegrationTests');
const {runPendingMigrations}=require('../utils/migrationRunner');
const root=path.resolve(__dirname,'../..'),cache=path.join(root,'.cache');
const collegeReviewPreview=process.argv.includes('--college-reviews');
const collegePreview=collegeReviewPreview||process.argv.includes('--colleges');
const autoReview=collegePreview||process.argv.includes('--team-auto-review');
const supervision=process.argv.includes('--supervision');
const assignmentBoard=process.argv.includes('--assignment-board');
const deletion=process.argv.includes('--schedule-deletion');
const visibility=process.argv.includes('--visibility'),backfill=process.argv.includes('--backfill'),imports=process.argv.includes('--imports')||backfill,adminPort=assignmentBoard?5222:collegeReviewPreview?5220:collegePreview?5218:autoReview?5214:deletion?5212:supervision?5210:backfill?5208:imports?5206:visibility?5204:5202,playerPort=assignmentBoard?5223:collegeReviewPreview?5221:collegePreview?5219:autoReview?5215:deletion?5213:supervision?5211:backfill?5209:imports?5207:visibility?5205:5203;
const day=n=>new Date(Date.now()+8*3600000+n*86400000).toISOString().slice(0,10);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=','base64');
async function main(){
  const options=loadTestConnectionEnvironment();
  for(const site of ['frontend','player-frontend'])if(!fs.existsSync(path.join(root,site,'dist/index.html')))throw Error('请先构建两个前端');
  fs.mkdirSync(cache,{recursive:true});
  const database=`refweb_competition_preview_${crypto.randomBytes(6).toString('hex')}_test`;
  const uploads=fs.mkdtempSync(path.join(os.tmpdir(),'refweb-competition-preview-'));
  const c=await mysql.createConnection(options.connection);let owned=false,server,playerServer,pool,closing=false;
  const close=async()=>{
    if(closing)return;closing=true;
    for(const s of [server,playerServer])if(s){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}
    if(pool)await pool.end();
    if(owned)await c.query(`DROP DATABASE \`${database}\``);
    await c.end();
    if(path.dirname(uploads)===os.tmpdir()&&path.basename(uploads).startsWith('refweb-competition-preview-'))fs.rmSync(uploads,{recursive:true,force:true});
  };
  try{
    await c.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);owned=true;
    const schema=fs.readFileSync(path.join(root,'db/final_schema.sql'),'utf8').replace(/CREATE DATABASE IF NOT EXISTS\s+referee_system/i,`CREATE DATABASE IF NOT EXISTS \`${database}\``).replace(/USE\s+referee_system\s*;/i,`USE \`${database}\`;`);
    await executeSqlScript(c,schema);await runPendingMigrations(c);
    Object.assign(process.env,{NODE_ENV:'test',HOST:'127.0.0.1',DB_NAME:database,UPLOAD_DIR:uploads,CORS_ORIGIN:'',TRUST_PROXY:'false',JWT_SECRET:crypto.randomBytes(48).toString('base64url'),API_RATE_LIMIT_MAX:'5000',LOGIN_RATE_LIMIT_MAX:'300',REGISTRATION_RATE_LIMIT_MAX:'300'});
    const password='Local!'+crypto.randomBytes(12).toString('base64url'),hash=await bcrypt.hash(password,10);
    await c.execute('INSERT INTO admin(username,password_hash,must_change_password,password_changed_at) VALUES (?,?,0,NOW())',['competition-admin',hash]);
    for(let i=1;i<=2;i++)await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,must_change_password,is_active) VALUES (?,?,?,'一级','预备国家级','2025-01-01','足协杯',0,1)",['LOCAL-REF-'+i,i===1?'验收裁判员':'验收裁判监督',hash]);
    const app=require('../server'),express=require('express');pool=require('../db');require('../utils/uploadPaths').ensureUploadDirectories();
    const previewSite=require('../utils/previewSite');
    const listen=(app,port)=>new Promise((resolve,reject)=>{const s=app.listen(port,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
    server=await listen(previewSite(app,path.join(root,'frontend/dist')),adminPort);const base=`http://127.0.0.1:${adminPort}`;
    const playerApp=express();playerApp.use((req,res,next)=>req.path==='/api'||req.path.startsWith('/api/')?app(req,res,next):next());
    playerApp.use(express.static(path.join(root,'player-frontend/dist')));playerApp.get(/^(?!\/api(?:\/|$)).*/,(_req,res)=>res.sendFile(path.join(root,'player-frontend/dist/index.html')));
    playerServer=await listen(playerApp,playerPort);
    let adminToken;
    async function api(url,body,method=body===undefined?'GET':'POST',token=adminToken,revision){
      const headers={};if(token)headers.Authorization='Bearer '+token;
      if(method==='POST')headers['Idempotency-Key']=crypto.randomUUID();
      const report=/^\/report\/(?:admin\/)?schedule\/(\d+)\//.exec(url);
      if(report&&method!=='GET'&&revision===undefined){const detail=await api('/report/schedule/'+report[1],undefined,'GET',token);revision=detail.sections[url.includes('supervisor')?'supervisor':'main'].revision;}
      if(revision!==undefined)headers['If-Match']=String(revision);
      if(body instanceof FormData)headers['Idempotency-Key']=crypto.randomUUID();
      else if(body!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(body);}
      const res=await fetch(base+'/api'+url,{method,body,headers});const data=await res.json();
      if(!res.ok)throw Error(`${method} ${url}: ${data.message||res.status}`);return data.data;
    }
    adminToken=(await api('/admin/login',{username:'competition-admin',password})).token;
    const season=await api('/season',{season_code:'LOCAL-COMPETITIONS',season_name:autoReview?'球队自动审核本地验收':deletion?'开球前删除本地验收':supervision?'裁判监督功能本地验收':backfill?'历史比赛名单补录验收':imports?'特殊导入本地验收':visibility?'赛事选项本地验收':'赛事与停赛本地验收',start_date:day(-60),end_date:day(180),is_active:true});
    let emptySeason;
    if(visibility){
      emptySeason=await api('/season',{season_code:'LEGACY-EMPTY',season_name:'旧版空赛事验收',start_date:day(-60),end_date:day(180),is_active:false});
      for(const id of [season.id,emptySeason.id])for(const name of ['大联赛','足协杯','新生杯'])await c.execute('INSERT INTO season_competitions(season_id,league_type,revision) VALUES (?,?,5)',[id,name]);
    }
    const iso=d=>new Date(Date.now()+d+8*3600000).toISOString().replace('Z','+08:00');
    const names=autoReview?['报名自动审核验收赛','跨赛事参队验收赛']:imports?['特殊导入验收赛']:visibility?['四平足协杯']:[...require('../utils/competitionRules').PRESETS,'研究生邀请赛'];
    const config=await api('/player-admin/season-settings/'+season.id,{registration_opens_at:iso(-86400000),registration_closes_at:iso(30*86400000),competitions:names.map(league_type=>({league_type,is_enabled:!imports,rules_text:'本地虚构验收数据',registration_opens_at:imports?null:iso(-86400000),registration_closes_at:imports?null:iso(30*86400000),change_windows:[],yellow_threshold:3,yellow_suspension:2,red_threshold:1,red_suspension:1}))},'PUT',adminToken,0);
    const comp=config.competitions.find(v=>v.league_type===(autoReview?names[0]:imports?'特殊导入验收赛':visibility?'四平足协杯':'研究生邀请赛')),refs=[];
    if(autoReview){
      await require('./seedTeamAutoReviewPreview')({api,season,config,password,cache,base,playerPort,collegePreview,collegeReviewPreview,connection:c});
      const stopFile=path.join(cache,collegeReviewPreview?'college-review-preview.stop':collegePreview?'college-preview.stop':'team-auto-review-preview.stop');
      if(fs.existsSync(stopFile))fs.unlinkSync(stopFile);
      await new Promise(resolve=>{const done=()=>{clearInterval(timer);resolve();};const timer=setInterval(()=>{if(fs.existsSync(stopFile)){fs.unlinkSync(stopFile);done();}},1000);process.once('SIGINT',done);process.once('SIGTERM',done);});return;
    }
    if(imports){
      await require(backfill?'./seedRosterBackfillPreview':'./seedImportPreview')({api,season,comp,password,cache,base,playerPort});
      await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});return;
    }
    for(let i=1;i<=2;i++){
      const ref=await api('/referee/login',{student_id:'LOCAL-REF-'+i,password});refs.push(ref);
      const registration=await api('/season-registration/current/submit',{name:i===1?'验收裁判员':'验收裁判监督',college:'土木工程学院',height_cm:175,weight_kg:65,grade:'一级',match_types:['足协杯']},'POST',ref.token);
      await api('/season-registration/admin/'+registration.id+'/approve',{reason:'本地验收样例'});
    }
    const players=[];
    for(const [i,name] of ['主队七号','主队九号','客队八号','客队十号'].entries()){
      const student_id='LOCAL-PLAYER-'+(i+1);await api('/player/register',{student_id,name,college:'土木工程学院',password,gender:'male',password_confirm:password});
      const p=await api('/player/login',{student_id,password});players.push({...p,student_id,name});
      const body=new FormData();body.append('season_id',String(season.id));body.append('account_revision',String(p.revision));body.append('academic_image',new Blob([png],{type:'image/png'}),'synthetic.png');
      const reg=await api('/player/season-registration/submit',body,'POST',p.token,0);
      await api('/player-admin/season-registrations/'+reg.registration.id+'/approve',{account_revision:p.revision},'POST',adminToken,reg.revision);
    }
    const teams=[];
    for(let i=0;i<2;i++){
      const members=players.slice(i*2,i*2+2),book=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['学号','姓名','号码','场上队长','守门员','外援','运训','备注'],...members.map((p,n)=>[p.student_id,p.name,String([7,9,8,10][i*2+n]),n?'否':'是',n?'否':'是','否','否','虚构数据'])]),'名单');
      const body=new FormData();for(const [k,v] of Object.entries({season_id:season.id,team_name:i?'验收客队':'验收主队',league_type:comp.league_type,manager_student_id:members[0].student_id,manager_name:members[0].name,shirt_color:i?'白':'蓝',shorts_color:i?'白':'蓝',socks_color:i?'白':'蓝'}))body.append(k,String(v));
      body.append('roster_file',new Blob([XLSX.write(book,{type:'buffer',bookType:'xlsx'})]),'roster.xlsx');
      const preview=await api('/team/import-preview',body);if(!preview.can_confirm)throw Error('验收名单预览未通过');
      const result=await api('/team/import-confirm',{preview:preview.preview,preview_token:preview.preview_token});teams.push(result.team_id);
    }
    // Synthetic earlier roster dates make the preloaded past reports historically consistent.
    await c.execute('UPDATE team_roster_batches SET effective_from=? WHERE team_id IN (?,?)',[day(-10),...teams]);
    if(assignmentBoard){
      await require('./seedAssignmentBoardPreview')({api,refs,season,comp,teams,password,cache,base,playerPort,connection:c});
      await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});return;
    }
    if(deletion){
      await require('./seedScheduleDeletionPreview')({api,refs,season,comp,teams,password,cache,base,playerPort,connection:c});
      await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});return;
    }
    if(supervision){
      await require('./seedSupervisionPreview')({api,refs,season,comp,teams,password,cache,base,playerPort});
      await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});return;
    }
    const matches=[];
    const create=async(order,date,time='00:00')=>{const m=await api('/schedule',{match_type:comp.league_type,team_a_id:teams[0],team_b_id:teams[1],match_date:date,match_time:time,field_order:order,venue:'樱花人草',main_referee_id:refs[0].id,supervisor_id:refs[1].id});matches.push({id:m.id,field_order:order,date});return m;};
    for(let i=0;i<3;i++){
      const m=await create('Y'+(i+1),day(i-3)),report=await api('/report/schedule/'+m.id),cards=[];
      const card=(teamId,number,card_type)=>{const p=report.match_rosters.find(r=>r.team_id===teamId).players.find(p=>p.jersey_number===String(number));return {team_id:teamId,team_player_id:p.id,card_type,minute_base:30};};
      cards.push(card(teams[0],7,'yellow'));if(i<2)cards.push(card(teams[0],9,'yellow'));else cards.push(card(teams[1],8,'red'));
      await api('/report/schedule/'+m.id+'/main',{home_score:0,away_score:0,goals:[],cards},'POST',refs[0].token);
      await api('/report/schedule/'+m.id+'/main/submit',{},'POST',refs[0].token);
    }
    for(const [i,order] of ['S1','S2','T1','T2'].entries())await create(order,day(0),'00:0'+i);
    await create('J1',day(2),'17:35');
    const credentials={warning:'仅限本次随机测试库；账号和材料均为虚构。关闭脚本即清理本次数据，重新运行会生成新密码。',admin:{username:'competition-admin',password,url:base+'/admin-login'},referees:refs.map((r,i)=>({student_id:'LOCAL-REF-'+(i+1),name:i?'验收裁判监督':'验收裁判员',password,url:base+'/referee-login'})),players:players.map(p=>({student_id:p.student_id,name:p.name,password,url:`http://127.0.0.1:${playerPort}/login`})),competition:{id:comp.id,name:comp.league_type},season,empty_season:emptySeason,matches,teams,admin_url:base,player_url:`http://127.0.0.1:${playerPort}`};
    const file=path.join(cache,visibility?'competition-visibility-preview.seed':'competition-preview.seed');fs.writeFileSync(file,JSON.stringify(credentials,null,2),{mode:0o600});
    console.log(`验收环境已就绪：管理/裁判 ${base}，球员 http://127.0.0.1:${playerPort}；凭据保存在 ${file}。按 Ctrl+C 结束并清理本次随机数据库。`);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }finally{await close();}
}
main().catch(e=>{console.error('验收环境启动失败：'+e.message);process.exitCode=1;});
