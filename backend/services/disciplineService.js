const pool=require('../db');
const w=require('../utils/playerWorkflow');
const rules=require('../utils/playerRules');
const engine=require('../utils/disciplineEngine');
const {parseJson}=require('../utils/reportHistory');
const {configured,ADDED_COMPETITION_SQL}=require('./competitionService');
async function competition(c,id,lock=false){
  const [[row]]=await w.sql(c,`SELECT c.*,s.season_name FROM season_competitions c JOIN seasons s ON s.id=c.season_id WHERE c.id=? AND ${ADDED_COMPETITION_SQL}`+(lock?' FOR UPDATE':''),[rules.id(id)]);
  if(!row)throw rules.businessError('赛事不存在',404);
  return row;
}
async function events(c,id){
  const [rows]=await w.sql(c,'SELECT * FROM competition_discipline_events WHERE competition_id=? ORDER BY id',[id]);
  const [identities]=await c.execute('SELECT i.id,i.player_id FROM imported_player_identities i JOIN season_competitions c ON c.season_id=i.season_id WHERE c.id=? AND i.player_id IS NOT NULL',[id]);
  const linked=new Map(identities.map(i=>[i.id,i.player_id]));
  const resolve=item=>{
    const match=/^(\d+):i(\d+)$/.exec(item.key||''),playerId=match&&linked.get(Number(match[2]));
    return playerId?{...item,key:engine.playerKey(Number(match[1]),playerId),...('player_id'in item?{player_id:playerId}:{})}:item;
  };
  // Resolve identity only while reading; original reports and audit payloads remain intact.
  return rows.map(row=>{let payload=parseJson(row.payload);payload=resolve(payload);for(const field of ['cards','served','players'])if(payload[field])payload[field]=payload[field].map(resolve);return {...row,payload};});
}
async function state(c,comp){const log=await events(c,comp.id);return {...engine.replay(log,comp),events:log};}
function kickoff(match){return `${match.match_date} ${match.match_time||'00:00'}`.slice(0,16);}
async function afterReport(c,reportId){
  const [[match]]=await w.sql(c,`SELECT m.*,TIME_FORMAT(m.match_time,'%H:%i') AS match_time,p.source_history_id
    FROM match_reports r JOIN match_schedules m ON m.id=r.schedule_id JOIN match_publications p ON p.report_id=r.id WHERE r.id=?`,[reportId]);
  if(!match)return;
  const [[ref]]=await c.execute('SELECT id FROM season_competitions WHERE season_id=? AND league_type=?',[match.season_id,match.match_type]);
  if(!ref)return;
  const comp=await competition(c,ref.id,true);
  if(!configured(comp))return; // Preserved local legacy events remain read-only until rules are supplied.
  const time=kickoff(match);
  if(time>w.chinaSql().slice(0,16))throw rules.businessError('比赛尚未开球，不能正式提交比赛结果和红黄牌',400,'MATCH_NOT_STARTED');
  const [[source]]=await c.execute('SELECT after_snapshot FROM report_section_history WHERE id=?',[match.source_history_id]);
  const snapshot=parseJson(source.after_snapshot);
  const cards=[];
  for(const card of snapshot.data.cards||[]){
    const [[p]]=await c.execute('SELECT player_account_id,import_person_id FROM team_player WHERE id=?',[card.team_player_id]);
    cards.push({key:engine.playerKey(card.team_id,p?.player_account_id,card.team_player_id,p?.import_person_id),team_id:card.team_id,
      player_id:p?.player_account_id||null,player_name:card.player_name,jersey_number:card.player_jersey_number,card_type:card.card_type});
  }
  const current=await state(c,comp),previous=current.events.find(e=>e.report_id===reportId);
  const reset=current.events.filter(e=>e.operation==='reset').at(-1);
  const payload={schedule_id:match.id,field_order:match.field_order,kickoff:time,team_ids:[match.team_a_id,match.team_b_id],cards,
    served:previous?.payload.served||engine.serviceReceipts(current,{team_ids:[match.team_a_id,match.team_b_id],kickoff:time},cards),
    ignored_by_reset:previous?.payload.ignored_by_reset??Boolean(reset&&time<=reset.payload.cutoff)};
  await c.execute(`INSERT INTO competition_discipline_events(competition_id,operation,report_id,source_history_id,payload,created_at)
    VALUES (?,'report',?,?,?,?) ON DUPLICATE KEY UPDATE source_history_id=VALUES(source_history_id),payload=VALUES(payload)`,
  [comp.id,reportId,match.source_history_id,JSON.stringify(payload),w.chinaSql()]);
  await c.execute('UPDATE season_competitions SET discipline_revision=discipline_revision+1 WHERE id=?',[comp.id]);
}
async function summary(id,c=pool){
  const comp=await competition(c,id),data=await state(c,comp);
  // Include players with no cards, using the current effective roster for display only.
  const [teams]=await c.execute('SELECT id,team_name FROM team WHERE season_id=? AND league_type=? ORDER BY team_name,id',[comp.season_id,comp.league_type]);
  const byKey=new Map(data.players.map(p=>[p.key,{...p,current_member:false}]));
  for(const team of teams){
    const batch=await require('./playerRosterService').effectiveBatch(team.id,undefined,c);
    if(batch){const [roster]=await c.execute('SELECT id,team_id,player_account_id,import_person_id,player_name,jersey_number FROM team_player WHERE roster_batch_id=?',[batch.id]);
      for(const p of roster){const key=engine.playerKey(team.id,p.player_account_id,p.id,p.import_person_id);const entry=byKey.get(key)||engine.emptyPlayer({...p,key,player_id:p.player_account_id});
        byKey.set(key,{...entry,current_member:true,player_name:p.player_name,jersey_number:p.jersey_number});}
    }
  }
  return {competition:comp,revision:comp.discipline_revision,configured:configured(comp),
    groups:teams.map(t=>({...t,players:[...byKey.values()].filter(p=>p.team_id===t.id)})),warnings:data.warnings,
    operations:data.events.filter(e=>e.operation!=='report').map(e=>({id:e.id,operation:e.operation,reason:e.reason,payload:e.payload,created_at:w.chinaIso(e.created_at),actor_admin_id:e.actor_admin_id}))};
}
async function mutate(id,user,revision,body,operation){
  rules.onlyKeys(body,operation==='reset'?['reason','confirm_name']:['reason','key','remaining']);
  if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>500)throw rules.businessError('请填写1—500字的操作原因');
  return w.transaction(async c=>{
    const initial=await competition(c,id);await w.season(c,initial.season_id);await w.actor(c,user);
    const comp=await competition(c,id,true);w.expectRevision(comp.discipline_revision,revision);
    const data=await state(c,comp);let payload;
    if(operation==='reset'){
      if(body.confirm_name!==comp.league_type)throw rules.businessError('请核对并输入完整赛事名称');
      payload={cutoff:w.chinaSql().slice(0,16),players:data.players.map(p=>({key:p.key,yellow:p.yellow,red:p.red,remaining:p.remaining}))};
    }else{
      const player=data.players.find(p=>p.key===body.key);
      if(!player||(!player.origin&&!(body.remaining===0&&data.warnings.some(v=>v.key===player.key))))throw rules.businessError('该球员没有可纠正的停赛记录');
      if(typeof body.remaining!=='number'||!Number.isSafeInteger(body.remaining)||body.remaining<0||body.remaining>100)throw rules.businessError('剩余停赛场数须为0—100的整数');
      payload={key:player.key,origin:player.origin,remaining:body.remaining,before:{yellow:player.yellow,red:player.red,remaining:player.remaining}};
    }
    await c.execute('INSERT INTO competition_discipline_events(competition_id,operation,actor_admin_id,reason,payload,created_at) VALUES (?,?,?,?,?,?)',[comp.id,operation,user.id,body.reason.trim(),JSON.stringify(payload),w.chinaSql()]);
    await c.execute('UPDATE season_competitions SET discipline_revision=discipline_revision+1 WHERE id=?',[comp.id]);
    return summary(comp.id,c);
  },{readCommitted:true});
}
async function projections(compId,c=pool){
  const comp=await competition(c,compId),data=await state(c,comp);
  const [matches]=await w.sql(c,`SELECT m.id,m.team_a_id,m.team_b_id,m.match_date,TIME_FORMAT(m.match_time,'%H:%i') AS match_time
    FROM match_schedules m LEFT JOIN match_reports r ON r.schedule_id=m.id LEFT JOIN match_publications p ON p.report_id=r.id
    WHERE m.season_id=? AND m.match_type=? AND p.report_id IS NULL
    ORDER BY m.match_date,(m.match_time IS NULL),m.match_time,m.field_order_sort,m.field_order,m.id`,[comp.season_id,comp.league_type]);
  // Overdue unreported games cannot silently be treated as already served. Their
  // projected place remains reserved and is labelled for reconciliation in the UI.
  return {configured:configured(comp),revision:comp.discipline_revision,warnings:data.warnings,
    matches:engine.project(data.players,matches.map(m=>({...m,kickoff:kickoff(m)})))};
}
async function forMatch(id,c=pool){
  const [[m]]=await c.execute('SELECT m.*,a.team_name home_name,b.team_name away_name FROM match_schedules m JOIN team a ON a.id=m.team_a_id JOIN team b ON b.id=m.team_b_id WHERE m.id=?',[rules.id(id)]);
  if(!m)throw rules.businessError('比赛不存在',404);
  const [[comp]]=await c.execute('SELECT id FROM season_competitions WHERE season_id=? AND league_type=?',[m.season_id,m.match_type]);
  if(!comp)return {configured:false,teams:[],suspensions:[]};
  const [[published]]=await c.execute('SELECT p.report_id FROM match_publications p JOIN match_reports r ON r.id=p.report_id WHERE r.schedule_id=?',[m.id]);
  if(published)return {configured:true,completed:true,teams:[],suspensions:[]};
  const result=await projections(comp.id,c);
  return {configured:result.configured,revision:result.revision,projected:true,
    teams:[{id:m.team_a_id,name:m.home_name},{id:m.team_b_id,name:m.away_name}],
    suspensions:result.matches.find(v=>v.schedule_id===m.id)?.suspensions||[],
    needs_review:result.warnings.some(v=>[m.team_a_id,m.team_b_id].includes(Number(v.key.split(':')[0])))};
}
async function forSheet(id,c=pool){
  const current=await forMatch(id,c);
  if(!current.completed)return current;
  // Published games have already consumed their bans. Their stored service
  // receipts describe that game's bans, not today's remaining balance.
  const [[comp]]=await c.execute('SELECT c.id FROM season_competitions c JOIN match_schedules m ON m.season_id=c.season_id AND m.match_type=c.league_type WHERE m.id=?',[id]);
  if(!comp)return {...current,suspensions:[]};
  const log=await events(c,comp.id);
  const report=log.find(e=>e.operation==='report'&&Number(e.payload.schedule_id)===Number(id));
  return {...current,suspensions:report?.payload.served||[]};
}
module.exports={afterReport,summary,mutate,projections,forMatch,forSheet};
