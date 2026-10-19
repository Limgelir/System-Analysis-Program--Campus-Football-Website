const crypto = require('node:crypto');
const w = require('../utils/playerWorkflow');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZz0AAAAASUVORK5CYII=','base64');
module.exports = async function seed({base,username,password,suffix='LOCAL'}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || !process.env.DB_NAME?.endsWith('_test')) throw Error('只允许本机隔离验收库');
  let admin;
  async function api(path,body,token=admin,method=body===undefined?'GET':'POST',revision) {
    const headers = {'Idempotency-Key':crypto.randomUUID()};
    if (token) headers.Authorization='Bearer '+token;
    if (revision!==undefined) headers['If-Match']=String(revision);
    if (body!==undefined && !(body instanceof FormData)) {headers['Content-Type']='application/json';body=JSON.stringify(body)}
    const response=await fetch(base+'/api'+path,{method,headers,body}), result=await response.json();
    if (!response.ok) throw Error(path+': '+result.message);
    return result.data;
  }
  admin=(await api('/admin/login',{username,password},null)).token;
  const season=await api('/season',{season_code:'ADMIN-TEAM-'+suffix,season_name:'管理员球队功能验收 '+suffix,start_date:'2026-01-01',end_date:'2099-12-31',is_active:true});
  const iso=delta=>w.chinaIso(w.chinaSql(new Date(Date.now()+delta)));
  let config=await api('/player-admin/season-settings/'+season.id,{registration_opens_at:iso(-86400000),registration_closes_at:iso(86400000),competitions:[{league_type:'球队管理验收赛',is_enabled:true,rules_text:'虚构数据：1至6人，全部须学籍通过，号码不能重复。',registration_opens_at:iso(-86400000),registration_closes_at:iso(86400000),change_windows:[],min_players:1,max_players:6,max_foreign_players:2,enable_sports_training:true,enable_football_specialty:true,yellow_threshold:3,yellow_suspension:1,red_threshold:1,red_suspension:1}]},admin,'PUT',0);
  const players=[];
  for(let i=0;i<7;i++) {
    const student_id=`ADM-${suffix}-${i}`,name=['原负责人','队长甲','队员乙','新负责人丙','候补丁','跨院队员戊','跨院队员己'][i];
    const college=['土木工程学院','土木工程学院','建筑与城市规划学院','土木工程学院','交通学院（铁道与城市轨道交通研究院）','电子与信息工程学院','航空航天与力学学院'][i];
    await api('/player/register',{student_id,name,college,gender:'male',password,password_confirm:password},null);
    const p=await api('/player/login',{student_id,password},null);players.push({...p,student_id,name});
    if(!i)continue;
    const form=new FormData();form.append('season_id',String(season.id));form.append('account_revision',String(p.revision));form.append('academic_image',new Blob([png],{type:'image/png'}),'虚构学籍.png');
    const reg=await api('/player/season-registration/submit',form,p.token,'POST',0);
    await api(`/player-admin/season-registrations/${reg.registration.id}/approve`,{account_revision:p.revision},admin,'POST',reg.revision);
  }
  const applications=[];
  for(const [name,status] of [['可编辑示例队','approved'],['赛程对手队','approved'],['可撤销退回队','returned'],['可恢复通过队','revoked'],['四学院超限验收队','approved']]) {
    let a=await api('/player/team-applications',{season_id:season.id,competition_id:config.competitions[0].id,team_name:name},players[0].token);
    a=await api('/player/team-applications/'+a.application.id,{team_name:name,shirt_color:'蓝',shorts_color:'黑',socks_color:'白',members:(name==='四学院超限验收队'?[1,2,5,6]:[1,2]).map(i=>({player_id:players[i].id,jersey_number:String(i),is_captain:i===1,is_goalkeeper:i===2,is_foreign:false,is_sports_training:false,is_football_specialty:false}))},players[0].token,'PUT',a.application.revision);
    a=await api(`/player/team-applications/${a.application.id}/submit`,{},players[0].token,'POST',a.application.revision);
    a=await api('/player-admin/team-applications/'+a.application.id);
    const op=status==='returned'?'return':'approve';
    a=await api(`/player-admin/team-applications/${a.application.id}/${op}`,{review_token:a.review_token,reason:'本地验收操作',...(op==='return'?{replaceable_member_ids:[a.members[1].id],member_comments:{}}:{})},admin,'POST',a.application.revision);
    if(status==='revoked') a=await api(`/player-admin/team-applications/${a.application.id}/revoke`,{review_token:a.review_token,reason:'模拟误撤销，可恢复'},admin,'POST',a.application.revision);
    applications.push(a.application);
  }
  const day=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10);
  const match=await api('/schedule',{team_a_id:applications[0].team_id,team_b_id:applications[1].team_id,match_type:'球队管理验收赛',match_date:day,match_time:'16:00',field_order:'LOCAL-1',venue:'樱花人草',supervisor_required:false});
  // 关闭窗口并收紧赛事规则；4学院名单复现截图条件，原负责人未通过学籍，候补账号停用。
  const candidate=await api('/player-admin/'+players[4].id);
  await api('/player-admin/'+players[4].id+'/status',{is_active:false,reason:'本地验收：管理员允许添加停用球员'},admin,'PUT',candidate.player.revision);
  config=await api('/player-admin/season-settings/'+season.id,{registration_opens_at:iso(-86400000),registration_closes_at:iso(-1000),competitions:config.competitions.map(({id,rules_locked,...c})=>({...c,rules_text:'本地豁免验收：最多1人、最多2个学院、外援/运训/足球特长生及合并人数上限0。',max_players:1,max_colleges:2,max_foreign_players:0,max_sports_training_players:0,max_football_specialty_players:0,combined_player_limits:[{tags:['sports_training','football_specialty'],max:0}],registration_closes_at:iso(-1000)}))},admin,'PUT',config.revision);
  return {season,applications,match,admin:{username,password},players:players.map(({id,name,student_id})=>({id,name,student_id,password}))};
};
