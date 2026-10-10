const fs=require('fs'),path=require('path'),bcrypt=require('bcryptjs');
module.exports=async({api,refs,season,comp,teams,password,cache,base,playerPort,connection:c})=>{
 const day=n=>new Date(Date.now()+8*3600000+n*86400000).toISOString().slice(0,10);
 const accounts=refs.map((r,i)=>({...r,student_id:'LOCAL-REF-'+(i+1),name:i?'验收乙':'验收甲'}));
 for(let i=0;i<2;i++)await c.execute('UPDATE referee SET name=? WHERE id=?',[accounts[i].name,accounts[i].id]);
 for(let i=3;i<=6;i++){
  const student_id='LOCAL-REF-'+i,name='验收裁判员'+i;
  await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,must_change_password,is_active) VALUES (?,?,?,'一级','预备国家级','2025-01-01','足协杯',0,1)",[student_id,name,await bcrypt.hash(password,4)]);
  const ref=await api('/referee/login',{student_id,password});accounts.push({...ref,student_id,name});
  const reg=await api('/season-registration/current/submit',{name,college:'土木工程学院',height_cm:175,weight_kg:65,grade:'一级',match_types:['足协杯']},'POST',ref.token);
  await api('/season-registration/admin/'+reg.id+'/approve',{reason:'本地选派验收'});
 }
 const extra=[];for(const name of ['验收C队','验收D队','验收E队','验收F队'])extra.push((await c.execute('INSERT INTO team(season_id,league_type,team_name) VALUES (?,?,?)',[season.id,comp.league_type,name]))[0].insertId);
 const matches=[],fields=['main_referee_id','assistant1_id','assistant2_id','fourth_official_id','supervisor_id'];
 async function create(order,offset,options={}){const m=await api('/schedule',{match_type:comp.league_type,team_a_id:teams[0],team_b_id:teams[1],match_date:day(offset),match_time:'17:35',field_order:order,venue:'樱花人草',fourth_required:true,supervisor_required:false,...options});matches.push({id:m.id,field_order:order,date:day(offset)});return m;}
 const first=await create('1',1,{fourth_required:false});
 const second=await create('2',1,{team_a_id:extra[0],team_b_id:extra[1]});
 const third=await create('3',1,{team_a_id:extra[2],team_b_id:extra[3],supervisor_required:true});
 await create('4',2,{fourth_required:false,supervisor_required:true});
 const complete=await create('5',3,{fourth_required:false,...Object.fromEntries(fields.slice(0,3).map((f,i)=>[f,accounts[i].id]))});
 await create('6',9);await create('历史1',-1);
 const otherComp=(await c.execute('SELECT id,league_type FROM season_competitions WHERE season_id=? AND id<>? ORDER BY id LIMIT 1',[season.id,comp.id]))[0][0];
 const otherTeams=[];for(const name of ['甲院队','乙院队'])otherTeams.push((await c.execute('INSERT INTO team(season_id,league_type,team_name) VALUES (?,?,?)',[season.id,otherComp.league_type,name]))[0].insertId);
 await create('A1',1,{match_type:otherComp.league_type,team_a_id:otherTeams[0],team_b_id:otherTeams[1]});
 await api('/match-signups/memberships/'+comp.id,{team_ids:extra.slice(1),revision:0},'PUT',accounts[0].token);
 await api('/match-signups/memberships/'+comp.id,{team_ids:[],revision:0},'PUT',accounts[1].token);
 for(const [index,match,intentions]of [[0,first,['main','assistant']],[0,third,['assistant','fourth']],[1,first,['assistant']],[1,second,['main','fourth']],[2,third,['supervisor']]])await api('/match-signups/'+match.id,{action:'save',intentions,revision:0,schedule_revision:match.schedule_revision},'PUT',accounts[index].token);
 const ext=await api('/officials/external',{name:'验收非系统裁判员',note:'可直接选派，无登录账号'});
 const credentials={admin_url:base,player_url:`http://127.0.0.1:${playerPort}`,admin:{username:'competition-admin',password},referees:accounts.map(r=>({student_id:r.student_id,name:r.name,password})),season,competition:comp,matches,complete_match:complete.id,external_id:ext.id};
 fs.writeFileSync(path.join(cache,'assignment-board-preview.seed'),JSON.stringify(credentials,null,2));
 fs.writeFileSync(path.join(cache,'assignment-board-local-acceptance.md'),`# 裁判报名与选派本地验收\n\n仅随机隔离测试库、虚构账号。\n\n入口：${base}\n\n管理员：competition-admin\n\n裁判员：LOCAL-REF-1（甲，已有多队记录）、LOCAL-REF-2（乙，未参加队伍）、LOCAL-REF-3（首次登记）\n\n本地账号统一密码：${password}\n\n管理员进入裁判选派：明日三个场次，上方按人汇总；场序5为已完成三人组；全部赛程包含九天后和历史比赛。\n\n新建赛程默认第四官员勾选、裁判监督不勾选。赛程编辑和详情仅改比赛信息，选派到独立模块。\n`);
 console.log(`本地验收已就绪：${base}；账号文件 .cache/assignment-board-local-acceptance.md`);
};
