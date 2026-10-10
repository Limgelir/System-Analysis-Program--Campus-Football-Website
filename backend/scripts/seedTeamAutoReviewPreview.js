const fs=require('node:fs'),path=require('node:path');
module.exports=async({api,season,config,password,cache,base,playerPort,collegePreview=false,collegeReviewPreview=false,connection})=>{
  const players=[],png=fs.readFileSync(path.join(__dirname,'../tests/fixtures/team-auto-review-academic.png'));
  for(let i=0;i<5;i++){
    const student_id='AUTO-DEMO-'+i,name=['报名验收负责人','工程队长','建筑队员','工程队员甲','工程队员乙'][i],college=i===2?'建筑与城市规划学院':'土木工程学院';
    await api('/player/register',{student_id,name,college,password,gender:'male',password_confirm:password});
    const p=await api('/player/login',{student_id,password});players.push({...p,student_id,name});
    if(!i)continue;
    const form=new FormData();form.append('season_id',String(season.id));form.append('account_revision',String(p.revision));form.append('academic_image',new Blob([png],{type:'image/png'}),'虚构学籍材料.png');
    const r=await api('/player/season-registration/submit',form,'POST',p.token,0);
    await api('/player-admin/season-registrations/'+r.registration.id+'/approve',{account_revision:p.revision},'POST',undefined,r.revision);
  }
  async function team(name,competition,indexes,flags=false,submit=false,approve=false){
    let d=await api('/player/team-applications',{season_id:season.id,competition_id:competition.id,team_name:name},'POST',players[0].token);
    d=await api('/player/team-applications/'+d.application.id,{team_name:name,members:indexes.map((i,n)=>({player_id:players[i].id,jersey_number:String(n+1),is_captain:n===0,is_goalkeeper:n===0,is_foreign:flags&&i===2,is_sports_training:flags&&i===2}))},'PUT',players[0].token,d.application.revision);
    if(submit)d=await api('/player/team-applications/'+d.application.id+'/submit',{},'POST',players[0].token,d.application.revision);
    if(approve){const r=await api('/player-admin/team-applications/'+d.application.id);d=await api('/player-admin/team-applications/'+d.application.id+'/approve',{review_token:r.review_token},'POST',undefined,r.application.revision)}
    return {id:d.application.id,name,status:d.application.status,team_id:d.application.team_id};
  }
  const other=await team('跨赛事已通过示例队',config.competitions[1],[1],false,true,true);
  const limits={min_players:3,max_players:5,max_colleges:1,max_foreign_players:0,max_sports_training_players:0};
  const next={registration_opens_at:config.registration_opens_at,registration_closes_at:config.registration_closes_at,competitions:config.competitions.map(({id,rules_locked,...c},i)=>({...c,...(i?{}:limits),change_windows:[{opens_at:config.registration_opens_at,closes_at:config.registration_closes_at}]}))};
  config=await api('/player-admin/season-settings/'+season.id,next,'PUT',undefined,config.revision);
  const applications=[other,
    await team('自动失败示例队',config.competitions[0],[1,2],true,true),
    await team('待人工审核示例队',config.competitions[0],[1,3,4],false,true),
    await team('可提交草稿示例队',config.competitions[0],[1,3,4]),
    await team('可人工特批示例队',config.competitions[0],[1,2],true,true)
  ];
  const credentials={warning:'仅用于本机随机隔离测试库，所有人物和材料均为虚构；停止本次预览后清理本次测试库。',admin:{username:'competition-admin',password,url:base+'/admin-login'},players:players.map(p=>({student_id:p.student_id,name:p.name,password,url:`http://127.0.0.1:${playerPort}/login`})),season,applications,limits,admin_url:base,player_url:`http://127.0.0.1:${playerPort}`};
  if(collegePreview){
    async function changeCollege(index,college){const p=await api('/player/me',undefined,'GET',players[index].token);const f=new FormData();f.append('new_college',college);f.append('account_revision',String(p.revision));f.append('academic_image',new Blob([png],{type:'image/png'}),'虚构学院修改截图.png');return api('/player/college-changes',f,'POST',players[index].token);}
    const approved=await changeCollege(2,'土木工程学院');
    await api('/player-admin/college-changes/'+approved.change.id+'/approve',{account_revision:approved.account.revision},'POST',undefined,approved.change.revision);
    applications.push(await team('最新学院一致待审示例队',config.competitions[0],[1,2,4],false,true));
    // Synthetic legacy values exercise the real migration, without touching another database.
    await connection.execute("UPDATE player_accounts SET college='中德' WHERE id=?",[players[0].id]);
    await connection.execute("UPDATE player_accounts SET college='土木学院' WHERE id=?",[players[3].id]);
    for(const [i,college]of ['土木学院','中德'].entries())await connection.execute('INSERT INTO referee_profile(referee_id,college) VALUES (?,?)',[i+1,college]);
    await require('../../db/migrations/0025_account_college_catalog').up(connection);
    const pending=await changeCollege(3,'土木工程学院'),returned=await changeCollege(4,'上海自主智能无人系统科学中心');
    await api('/player-admin/college-changes/'+returned.change.id+'/return',{reason:'验收示例：请补充包含姓名和学院的完整截图'},'POST',undefined,returned.change.revision);
    credentials.college_change_requests={pending:pending.change.id,returned:returned.change.id,approved:approved.change.id};
    credentials.referees=[{student_id:'LOCAL-REF-1',name:'旧学院自动匹配裁判'},{student_id:'LOCAL-REF-2',name:'旧学院未匹配裁判'}].map(r=>({...r,password,url:base+'/referee-login'}));
    credentials.cases=['AUTO-DEMO-0：学院中德保留，可在设置上传截图申请修改，学籍上传页使用相同截图示例','AUTO-DEMO-3：旧土木学院保留，有待审学院修改申请，可撤回重提或管理员通过','AUTO-DEMO-4：学院修改已退回，查看理由并重新上传截图','AUTO-DEMO-2：学院修改已经人工通过；学籍历史为建筑学院，账号为土木工程学院','LOCAL-REF-2：裁判学院中德未匹配，设置中可随时重新选择'];
  }
  const file=path.join(cache,collegeReviewPreview?'college-review-preview.seed':collegePreview?'college-preview.seed':'team-auto-review-preview.seed');fs.writeFileSync(file,JSON.stringify(credentials,null,2),{mode:0o600});
  console.log(`自动审核本地验收已就绪：管理员 ${base}，球员 http://127.0.0.1:${playerPort}；测试账号见 ${file}。`);
};
