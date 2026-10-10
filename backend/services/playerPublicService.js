const pool=require('../db');
const w=require('../utils/playerWorkflow');
const rules=require('../utils/playerRules');
const rosters=require('./playerRosterService');
const {parseJson}=require('../utils/reportHistory');
async function seasons(){return (await w.sql(pool,'SELECT id,season_name,is_active FROM seasons ORDER BY start_date DESC,id DESC'))[0];}
async function teams(query={}){
  const filters=['t.registration_revoked=0'],args=[];
  if(query.season_id){filters.push('t.season_id=?');args.push(rules.id(query.season_id));}else filters.push('s.is_active=1');
  if(query.league_type){require('../utils/competitionRules').competitionName(query.league_type);filters.push('t.league_type=?');args.push(query.league_type);}
  return (await w.sql(pool,`SELECT t.id,t.team_name,t.league_type,t.season_id,s.season_name FROM team t JOIN seasons s ON s.id=t.season_id WHERE ${filters.join(' AND ')} ORDER BY t.league_type,t.team_name`,args))[0];
}
async function matches(teamId,c=pool,playerId=null){
  const [rows]=await w.sql(c,`SELECT m.id,m.match_date,TIME_FORMAT(m.match_time,'%H:%i') AS match_time,m.venue,m.venue_detail,m.field_order,m.match_type,m.team_a_id,m.team_b_id,
    COALESCE(m.team_a_name_snapshot,a.team_name) AS home_name,COALESCE(m.team_b_name_snapshot,b.team_name) AS away_name,
    r.main_report_status,p.result_snapshot,p.version_no,p.published_at FROM match_schedules m
    JOIN team a ON a.id=m.team_a_id JOIN team b ON b.id=m.team_b_id
    LEFT JOIN match_reports r ON r.schedule_id=m.id LEFT JOIN match_publications p ON p.report_id=r.id
    WHERE m.team_a_id=? OR m.team_b_id=? ORDER BY m.match_date DESC,(m.match_time IS NULL) ASC,m.match_time ASC,m.field_order_sort ASC,m.field_order ASC,m.id ASC`,[teamId,teamId]);
  const linked=new Set();
  if(playerId){const [people]=await c.execute('SELECT id FROM imported_player_identities WHERE player_id=?',[playerId]);for(const p of people)linked.add(p.id);}
  let goals=0;
  const items=rows.map(({result_snapshot,main_report_status,published_at,...m})=>{
    const data=result_snapshot?parseJson(result_snapshot):null;
    const own=playerId&&data?data.goals.filter(g=>(g.player_id===playerId||!g.player_id&&linked.has(g.import_person_id))&&g.team_id===teamId&&['normal','penalty'].includes(g.goal_type)).length:0;
    goals+=own;
    return {...m,status:data?(main_report_status==='returned'?'revising':'published'):'unpublished',published_at:w.chinaIso(published_at),
      result:data?{...data,goals:data.goals.map(({player_id,import_person_id,...g})=>g)}:null,...(playerId?{my_goals:own}:{})};
  });
  if(playerId){
    const projections=new Map();
    for(const item of items){
      const scope=item.match_type;
      if(!projections.has(scope)){
        const [[comp]]=await c.execute('SELECT c.id FROM season_competitions c JOIN team t ON t.season_id=c.season_id AND t.league_type=c.league_type WHERE t.id=?',[teamId]);
        projections.set(scope,comp?await require('./disciplineService').projections(comp.id,c):{configured:false,matches:[]});
      }
      const info=projections.get(scope);item.discipline={configured:info.configured,projected:true,suspensions:info.matches.find(m=>m.schedule_id===item.id)?.suspensions||[]};
    }
  }
  return {matches:items,...(playerId?{my_goals:goals}:{})};
}
async function detail(id){
  id=rules.id(id);
  return w.transaction(async c=>{
    const [[team]]=await w.sql(c,`SELECT t.id,t.team_name,t.season_id,t.league_type,t.shirt_color,t.shorts_color,t.socks_color,t.captain_player_id,t.registration_revoked,s.season_name,s.is_active,st.ended_at FROM team t JOIN seasons s ON s.id=t.season_id LEFT JOIN player_season_settings st ON st.season_id=s.id WHERE t.id=?`,[id]);
    if(!team)throw rules.businessError('球队不存在',404);
    const batch=await rosters.effectiveBatch(id,undefined,c);
    const roster=batch?await rosters.roster(batch.id,{connection:c,currentProfile:Boolean(team.is_active&&!team.ended_at)}):[];
    const players=roster.map(p=>({id:p.id,jersey_number:p.jersey_number,player_name:p.player_name,college:p.college,is_captain:p.player_account_id? p.player_account_id===team.captain_player_id:Boolean(p.is_captain),is_goalkeeper:p.is_goalkeeper,is_foreign:p.is_foreign,is_sports_training:p.is_sports_training,is_football_specialty:p.is_football_specialty}));
    const {captain_player_id,is_active,ended_at,...safeTeam}=team;
    return {team:safeTeam,players,...await matches(id,c)};
  });
}
async function matchDetail(id){
  return w.transaction(async c=>{
    const [[m]]=await w.sql(c,'SELECT id,match_date,team_a_id,team_b_id FROM match_schedules WHERE id=?',[rules.id(id)]);
    if(!m)throw rules.businessError('比赛不存在',404);
    const items=await require('./matchRosterService').read(c,m);
    return {id:m.id,rosters:items.map(t=>({team_id:t.team_id,players:t.players.map(p=>({id:p.id,player_name:p.player_name,jersey_number:p.jersey_number,college:p.college,is_captain:p.is_captain,is_goalkeeper:p.is_goalkeeper,is_foreign:p.is_foreign,is_sports_training:p.is_sports_training,is_football_specialty:p.is_football_specialty}))}))};
  });
}
async function mine(user,query={}){
  const filters=[],args=[user.id,user.id,user.id,require('../utils/competitionTime').businessDate(),user.id];
  if(query.season_id){filters.push('s.id=?');args.push(rules.id(query.season_id));}else filters.push('s.is_active=1');
  if(query.league_type){require('../utils/competitionRules').competitionName(query.league_type);filters.push('t.league_type=?');args.push(query.league_type);}
  // 一次读取本人关系，查询次数不再随本赛季球队总数增长。
  const [rows]=await w.sql(pool,`SELECT t.id,t.team_name,t.league_type,t.season_id,s.season_name,
    (t.registration_revoked=0 AND (t.manager_player_id=? OR t.captain_player_id=?)) AS can_manage,
    (t.registration_revoked=0 AND EXISTS(SELECT 1 FROM team_player p WHERE p.player_account_id=? AND p.roster_batch_id=(
      SELECT b.id FROM team_roster_batches b WHERE b.team_id=t.id AND (b.effective_from<=? OR b.effective_from IS NULL)
      ORDER BY b.effective_from DESC,b.version_no DESC,b.id DESC LIMIT 1))) AS is_member,
    EXISTS(SELECT 1 FROM team_player p WHERE p.team_id=t.id AND p.player_account_id=?) AS was_member
    FROM team t JOIN seasons s ON s.id=t.season_id WHERE ${filters.join(' AND ')}
    HAVING can_manage OR is_member OR was_member ORDER BY t.league_type,t.team_name`,args);
  return rows.map(r=>({...r,can_manage:Boolean(r.can_manage),is_member:Boolean(r.is_member),was_member:Boolean(r.was_member)}));
}
function extension(feature,query={}){if(!['scorers','standings','competition-format'].includes(feature))throw rules.businessError('功能不存在',404);return {feature,enabled:false,status:'not_implemented',season_id:query.season_id?rules.id(query.season_id):null,league_type:query.league_type||null,message:'此功能尚未启用'};}
module.exports={seasons,teams,detail,matchDetail,matches,mine,extension};
