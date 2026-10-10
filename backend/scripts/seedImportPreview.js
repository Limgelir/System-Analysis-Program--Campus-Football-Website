const fs=require('node:fs'),path=require('node:path'),XLSX=require('xlsx');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=','base64');
module.exports=async({api,season,comp,password,cache,base,playerPort})=>{
  const accounts=[];
  for(const [student_id,name]of [['IMPORT-MANAGER','待关联负责人'],['IMPORT-CAPTAIN','待关联队长']]){
    await api('/player/register',{student_id,name,college:'土木工程学院',password,gender:'male',password_confirm:password});
    const p=await api('/player/login',{student_id,password});
    const body=new FormData();body.append('season_id',season.id);body.append('account_revision',p.revision);body.append('academic_image',new Blob([png],{type:'image/png'}),'synthetic.png');
    const registration=await api('/player/season-registration/submit',body,'POST',p.token,0);
    accounts.push({student_id,name,password,registration_id:registration.registration.id,url:`http://127.0.0.1:${playerPort}/login`});
  }
  const workbook=rows=>{const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([require('../utils/rosterExcelParser').HEADERS,...rows]),'名单');return XLSX.write(b,{type:'buffer',bookType:'xlsx'});};
  const initial=workbook([['IMPORT-CAPTAIN','待关联队长','7','是','否','否','否','虚构验收'],['IMPORT-MEMBER','未注册队员','9','否','否','否','否','虚构验收']]);
  const body=new FormData();for(const [key,value]of Object.entries({season_id:season.id,league_type:comp.league_type,team_name:'待关联示例队',manager_student_id:'IMPORT-MANAGER',manager_name:'待关联负责人',shirt_color:'',shorts_color:'',socks_color:''}))body.append(key,String(value));
  body.append('roster_file',new Blob([initial]),'待关联示例.xlsx');
  const preview=await api('/team/import-preview',body);if(!preview.can_confirm)throw Error('特殊导入预览失败');
  const team=await api('/team/import-confirm',{preview:preview.preview,preview_token:preview.preview_token});
  const file=path.join(cache,'admin-import-roster.xlsx');
  fs.writeFileSync(file,workbook([['NEW-IMPORT-CAPTAIN','新导入队长','1','是','是','否','否','虚构验收'],['NEW-IMPORT-MEMBER','新导入队员','2','否','否','否','否','虚构验收']]));
  const proof=path.join(cache,'admin-import-academic.png');fs.writeFileSync(proof,png);
  const credentials={warning:'独立本地虚构数据。团队报名及名单修改窗口关闭，个人学籍窗口开放。原网站及日常数据库不受影响。',
    admin:{username:'competition-admin',password,url:base+'/admin-login'},players:accounts,
    admin_url:base,player_url:`http://127.0.0.1:${playerPort}`,season,competition:comp,example_team:team,
    import_sample:{file,team_name:'新导入验收队',manager_student_id:'NEW-IMPORT-MANAGER',manager_name:'新导入负责人'},academic_sample:proof};
  const credentialsFile=path.join(cache,'admin-import-preview.seed');fs.writeFileSync(credentialsFile,JSON.stringify(credentials,null,2),{mode:0o600});
  console.log(`名单导入验收环境已就绪：管理/裁判 ${base}，球员 http://127.0.0.1:${playerPort}；账号见 ${credentialsFile}，名单样例见 ${file}。`);
};
