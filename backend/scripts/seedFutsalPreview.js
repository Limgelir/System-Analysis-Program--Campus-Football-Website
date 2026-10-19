const fs=require('fs'),path=require('path'),bcrypt=require('bcryptjs');
module.exports=async({api,refs,season,comp,teams,password,cache,base,playerPort,connection:c})=>{
 const day=n=>new Date(Date.now()+8*3600000+n*86400000).toISOString().slice(0,10);
 await c.execute("INSERT INTO referee(student_id,name,password_hash,grade,target_level,level_promoted_at,match_types,must_change_password,is_active) VALUES ('LOCAL-REF-3','验收计时员',?,'一级','预备国家级','2025-01-01','足协杯',0,1)",[await bcrypt.hash(password,4)]);
 const timer=await api('/referee/login',{student_id:'LOCAL-REF-3',password});
 const reg=await api('/season-registration/current/submit',{name:'验收计时员',college:'土木工程学院',height_cm:175,weight_kg:65,grade:'一级',match_types:['足协杯']},'POST',timer.token);
 await api('/season-registration/admin/'+reg.id+'/approve',{reason:'五人制本地验收'});
 const matches=[];
 async function create(order,options={}){
  const m=await api('/schedule',{match_type:comp.league_type,team_a_id:teams[0],team_b_id:teams[1],match_date:day(1),match_time:'17:35',field_order:order,venue:'樱花人草',futsal:true,fourth_required:false,supervisor_required:false,...options});
  matches.push({id:m.id,field_order:order});return m;
 }
 const assignments={main_referee_id:refs[0].id,second_referee_id:refs[1].id,timekeeper_id:timer.id};
 await create('F1',{...assignments,supervisor_required:true,supervisor_id:refs[1].id});
 await create('F2');
 const ordinary=await create('切换示例',{futsal:false,fourth_required:true,main_referee_id:refs[0].id,assistant1_id:refs[1].id,assistant2_id:timer.id,fourth_official_id:refs[0].id});
 for(const [ref,intentions]of [[refs[1],['assistant']],[timer,['main','assistant']]])await api('/match-signups/'+ordinary.id,{action:'save',intentions,revision:0,schedule_revision:ordinary.schedule_revision},'PUT',ref.token);
 const started=await create('已开始报告',{...assignments});
 await api('/report/schedule/'+started.id+'/main',{home_score:0,away_score:0,stats:[{role:'second',running_distance_m:2500,max_heart_rate:175}]},'POST',refs[0].token);
 const file=path.join(cache,'futsal-local-acceptance.md');
 fs.writeFileSync(file,`# 五人制本地验收\n\n仅本次独立临时MySQL中的虚构数据，不连接日常数据库或服务器。\n\n管理/裁判入口：${base}\n\n管理员：competition-admin\n裁判员：LOCAL-REF-1\n第二裁判员/监督：LOCAL-REF-2\n计时员：LOCAL-REF-3\n\n以上虚构账号的临时密码：${password}\n\n- F1：已选派三人，第二裁判员兼任监督，可填写报告和三岗评分。\n- F2：无监督、未选派，可测试报名和选派。\n- 切换示例：普通安排，已有助理意向；切换后核对自动撤回及保留的裁判员意向。\n- 已开始报告：第二裁判员已有2500米数据，类型和岗位已锁定。\n\n新建赛程可勾选五人制，再保留或取消裁判监督。五人制没有助理越位/协助数据，附件为比赛记录单。\n`);
 fs.writeFileSync(path.join(cache,'futsal-preview.seed'),JSON.stringify({admin_url:base,player_url:`http://127.0.0.1:${playerPort}`,admin:{username:'competition-admin',password},season,competition:comp,matches},null,2));
 console.log(`五人制本地验收已就绪：${base}；账号见 .cache/futsal-local-acceptance.md`);
};
