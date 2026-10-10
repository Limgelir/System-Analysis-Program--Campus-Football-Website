const fs=require('node:fs'),path=require('node:path'),XLSX=require('xlsx');
module.exports=async({api,season,comp,password,cache,base})=>{
  const referee=await api('/referee/login',{student_id:'LOCAL-REF-1',password});
  const registration=await api('/season-registration/current/submit',{name:'验收裁判员',college:'土木工程学院',height_cm:175,weight_kg:65,grade:'一级',match_types:['足协杯']},'POST',referee.token);
  await api('/season-registration/admin/'+registration.id+'/approve',{reason:'本地虚构补录验收'});
  const teams=[];
  for(const [n,name]of ['补录主队','补录客队'].entries()){
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([require('../utils/rosterExcelParser').HEADERS,['BACKFILL-'+n,name+'队长','7','是','否','否','否','虚构验收']]),'名单');
    const body=new FormData();for(const [key,value]of Object.entries({season_id:season.id,league_type:comp.league_type,team_name:name,manager_student_id:'BACKFILL-'+n,manager_name:name+'队长'}))body.append(key,String(value));
    body.append('roster_file',new Blob([XLSX.write(book,{type:'buffer',bookType:'xlsx'})]),'补录名单.xlsx');const preview=await api('/team/import-preview',body);
    teams.push(await api('/team/import-confirm',{preview:preview.preview,preview_token:preview.preview_token}));
  }
  const date=n=>new Date(Date.now()+8*3600000+n*86400000).toISOString().slice(0,10),matches=[];
  for(const [field_order,day,label]of [['补录A1',-1,'报告未开始，两队缺名单'],['补录A2',-1,'已保存空报告，两队可补齐'],['补录A3',-1,'主队已有进球黄牌，只可补齐客队'],['未来J1',1,'未来比赛，自动按日期读取']]){
    const match=await api('/schedule',{match_type:comp.league_type,team_a_id:teams[0].team_id,team_b_id:teams[1].team_id,match_date:date(day),match_time:'16:00',venue:'嘉定人草',field_order,main_referee_id:referee.id});
    if(field_order==='补录A2')await api(`/report/schedule/${match.id}/main`,{home_score:0,away_score:0,goals:[],cards:[]},'POST',referee.token);
    if(field_order==='补录A3'){
      const d=await api(`/report/admin/schedule/${match.id}/rosters`);
      await api(`/report/admin/schedule/${match.id}/rosters`,{team_id:teams[0].team_id,roster_batch_id:teams[0].batch_id,reason:'预设已核对主队名单',review_token:d.review_token},'PUT');
      const report=await api('/report/schedule/'+match.id),p=report.match_rosters[0].players[0];
      await api(`/report/schedule/${match.id}/main`,{home_score:1,away_score:0,goals:[{player_team_id:teams[0].team_id,credited_team_id:teams[0].team_id,team_player_id:p.id,goal_type:'normal',minute_base:10}],cards:[{team_id:teams[0].team_id,team_player_id:p.id,card_type:'yellow',minute_base:20}]},'POST',referee.token);
    }
    matches.push({id:match.id,field_order,label,match_date:date(day),admin_url:base+'/admin-schedule/'+match.id,referee_url:base+'/referee-report/'+match.id});
  }
  const file=path.join(cache,'roster-backfill-preview.seed');
  fs.writeFileSync(file,JSON.stringify({warning:'独立本地虚构数据，不影响原数据库或网站。名单今天上传，三场比赛日期为昨天。',admin:{username:'competition-admin',password,url:base+'/admin-login'},referee:{student_id:'LOCAL-REF-1',password,url:base+'/referee-login'},season,competition:comp,matches},null,2),{mode:0o600});
  console.log(`历史比赛名单补录验收已就绪：${base}；账号与各场入口见 ${file}。`);
};
