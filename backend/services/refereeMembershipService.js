const pool=require('../db');
const {createBusinessError}=require('../utils/scheduleValidator');
const {json}=require('../utils/matchSignup');
async function competition(c,id){
  const [[row]]=await c.execute('SELECT id,season_id,league_type FROM season_competitions WHERE id=?',[id]);
  if(!row)throw createBusinessError('赛事不存在',{statusCode:404});
  return row;
}
async function read(refereeId,competitionId,c=pool){
  const comp=await competition(c,competitionId);
  const [teams]=await c.execute('SELECT id,team_name FROM team WHERE season_id=? AND league_type=? ORDER BY team_name,id',[comp.season_id,comp.league_type]);
  const [[saved]]=await c.execute('SELECT team_ids,revision FROM referee_competition_memberships WHERE referee_id=? AND competition_id=?',[refereeId,competitionId]);
  return {competition:comp,teams,team_ids:saved?json(saved.team_ids):[],confirmed:Boolean(saved),revision:saved?.revision||0};
}
async function save(refereeId,competitionId,data){
  if(!data||Object.keys(data).some(k=>!['team_ids','revision'].includes(k))||!Array.isArray(data.team_ids)||data.team_ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(data.team_ids).size!==data.team_ids.length)
    throw createBusinessError('请选择该赛事的有效球队，或选择未参加队伍');
  if(!Number.isSafeInteger(data.revision)||data.revision<0)throw createBusinessError('请刷新参队信息后重试',{statusCode:409});
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    // 同一裁判员的设置串行保存，避免首次登记的并发覆盖。
    await c.execute('SELECT id FROM referee WHERE id=? FOR UPDATE',[refereeId]);
    const comp=await competition(c,competitionId);
    const [teams]=await c.execute('SELECT id FROM team WHERE season_id=? AND league_type=? FOR SHARE',[comp.season_id,comp.league_type]);
    const valid=new Set(teams.map(t=>t.id));
    if(data.team_ids.some(id=>!valid.has(id)))throw createBusinessError('所选队伍不属于该赛季的该赛事，请刷新后重选');
    const [[saved]]=await c.execute('SELECT revision FROM referee_competition_memberships WHERE referee_id=? AND competition_id=? FOR UPDATE',[refereeId,competitionId]);
    if(data.revision!==(saved?.revision||0))throw createBusinessError('参队信息已在其他页面更新，请刷新后核对',{statusCode:409,code:'MEMBERSHIP_REVISION_CONFLICT'});
    await c.execute(`INSERT INTO referee_competition_memberships(referee_id,competition_id,team_ids,revision,updated_at) VALUES (?,?,?,1,UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE team_ids=VALUES(team_ids),revision=revision+1,updated_at=UTC_TIMESTAMP(3)`,[refereeId,competitionId,JSON.stringify([...data.team_ids].sort((a,b)=>a-b))]);
    const result=await read(refereeId,competitionId,c);await c.commit();return result;
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}
module.exports={read,save};
