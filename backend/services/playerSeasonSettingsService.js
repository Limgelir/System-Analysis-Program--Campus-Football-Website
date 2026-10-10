const pool=require('../db');
const rules=require('../utils/playerRules');
const w=require('../utils/playerWorkflow');
const { PRESETS, RULE_FIELDS, competitionName, disciplineRules }=require('../utils/competitionRules');
const { ADDED_COMPETITION_SQL }=require('./competitionService');
const automatic=require('../utils/teamAutoReview');
const tags=require('../utils/teamTags');

async function read(seasonId,c=pool){
  const [[season]]=await w.sql(c,'SELECT id,season_name,season_code,start_date,end_date,is_active FROM seasons WHERE id=?',[rules.id(seasonId)]);
  if(!season)throw rules.businessError('赛季不存在',404,'SEASON_NOT_FOUND');
  const [[setting]]=await w.sql(c,'SELECT * FROM player_season_settings WHERE season_id=?',[season.id]);
  const [competitions]=await w.sql(c,`SELECT c.*,EXISTS(SELECT 1 FROM match_schedules m JOIN match_reports r ON r.schedule_id=m.id JOIN match_publications p ON p.report_id=r.id WHERE m.season_id=c.season_id AND m.match_type=c.league_type) AS rules_locked FROM season_competitions c WHERE c.season_id=? AND ${ADDED_COMPETITION_SQL} ORDER BY c.id`,[season.id]);
  const [windows]=await w.sql(c,'SELECT w.* FROM roster_change_windows w JOIN season_competitions c ON c.id=w.competition_id WHERE c.season_id=? AND w.is_cancelled=0 ORDER BY w.opens_at,w.id',[season.id]);
  return {season,revision:setting?.revision||0,ended_at:w.chinaIso(setting?.ended_at),
    registration_opens_at:w.chinaIso(setting?.registration_opens_at),registration_closes_at:w.chinaIso(setting?.registration_closes_at),
    window_status:w.windowStatus(setting?.registration_opens_at,setting?.registration_closes_at),server_time:w.chinaIso(w.chinaSql()),
    presets:PRESETS,competitions:competitions.map(item=>{const league_type=item.league_type;return {
      ...Object.fromEntries([...RULE_FIELDS,...automatic.LIMIT_FIELDS].map(k=>[k,item[k]])),enable_sports_training:Boolean(item.enable_sports_training),enable_football_specialty:Boolean(item.enable_football_specialty),combined_player_limits:item.combined_player_limits||[],rules_locked:Boolean(item.rules_locked)&&RULE_FIELDS.every(k=>item[k]!=null),id:item.id,league_type,is_enabled:Boolean(item?.is_enabled),rules_text:item?.rules_text||'',
      registration_opens_at:w.chinaIso(item?.registration_opens_at),registration_closes_at:w.chinaIso(item?.registration_closes_at),
      change_windows:windows.filter(v=>v.competition_id===item?.id).map(v=>({id:v.id,opens_at:w.chinaIso(v.opens_at),closes_at:w.chinaIso(v.closes_at)}))
    };})};
}
function snapshot(value){const {server_time,window_status,...rest}=value;return rest;}
function validate(body){
  rules.onlyKeys(body,['registration_opens_at','registration_closes_at','competitions']);
  const personal=w.windowPair(body,'registration_opens_at','registration_closes_at','个人注册');
  if(!Array.isArray(body.competitions)||body.competitions.length>100)throw rules.businessError('赛事列表格式不正确，最多100项');
  const names=body.competitions.map(c=>competitionName(c?.league_type));
  if(new Set(names).size!==names.length)throw rules.businessError('同一赛季不能重复添加同名赛事');
  const competitions=body.competitions.map(c=>{
    rules.onlyKeys(c,['league_type','is_enabled','registration_opens_at','registration_closes_at','rules_text','change_windows',...RULE_FIELDS,...automatic.LIMIT_FIELDS,...tags.CONFIG_FIELDS]);
    if(typeof c.is_enabled!=='boolean')throw rules.businessError('赛事类型或启用状态不正确');
    const dates=w.windowPair(c,'registration_opens_at','registration_closes_at',`${c.league_type}球队报名`);
    if(typeof c.rules_text!=='string'||c.rules_text.length>10000)throw rules.businessError('赛事规则应为不超过10000字的文字');
    if(!Array.isArray(c.change_windows)||c.change_windows.length>100)throw rules.businessError('名单修改窗口格式不正确');
    const windows=c.change_windows.map(v=>{rules.onlyKeys(v,['id','opens_at','closes_at']);const dates=w.windowPair(v,'opens_at','closes_at','名单修改');if(!dates.opens)throw rules.businessError('名单修改窗口必须填写时间');return {id:v.id==null?null:rules.id(v.id),...dates};});
    const ids=windows.filter(v=>v.id).map(v=>v.id);if(new Set(ids).size!==ids.length)throw rules.businessError('名单修改窗口不能重复');
    return {...c,league_type:competitionName(c.league_type),...disciplineRules(c),...automatic.normalize(c),...tags.normalize(c),...dates,windows};
  });return {personal,competitions};
}
async function save(seasonId,body,revision,user){
  const data=validate(body);
  return w.transaction(async c=>{
    await w.season(c,seasonId);await w.actor(c,user);
    await c.execute('INSERT IGNORE INTO player_season_settings (season_id) VALUES (?)',[seasonId]);
    await c.execute('SELECT id FROM season_competitions WHERE season_id=? ORDER BY id FOR UPDATE',[seasonId]);
    const before=await read(seasonId,c);w.expectRevision(before.revision,revision);
    if(before.competitions.some(old=>!data.competitions.some(v=>v.league_type===old.league_type)))throw rules.businessError('已有赛事不能移除或改名，请刷新后保留原赛事',409);
    for(const old of before.competitions){const next=data.competitions.find(v=>v.league_type===old.league_type);if(old.rules_locked&&RULE_FIELDS.some(k=>old[k]!==next[k]))throw rules.businessError('已有正式报告的赛事不能修改停赛规则',409);}
    await c.execute('UPDATE player_season_settings SET registration_opens_at=?,registration_closes_at=?,revision=revision+1 WHERE season_id=?',[data.personal.opens,data.personal.closes,seasonId]);
    for(const entry of data.competitions){
      await c.execute('INSERT IGNORE INTO season_competitions (season_id,league_type) VALUES (?,?)',[seasonId,entry.league_type]);
      const [[competition]]=await w.sql(c,'SELECT id FROM season_competitions WHERE season_id=? AND league_type=?',[seasonId,entry.league_type]);
      const [existing]=await w.sql(c,'SELECT id FROM roster_change_windows WHERE competition_id=? AND is_cancelled=0',[competition.id]);
      if(entry.windows.some(v=>v.id&&!existing.some(e=>e.id===v.id)))throw rules.businessError('名单修改窗口不属于当前赛事或已被取消',409,'PLAYER_WORKFLOW_CONFLICT');
      await c.execute('UPDATE season_competitions SET enable_sports_training=?,enable_football_specialty=?,combined_player_limits=? WHERE id=?',[Number(entry.enable_sports_training),Number(entry.enable_football_specialty),JSON.stringify(entry.combined_player_limits),competition.id]);
      for(const tag of tags.TAGS)if(!tags.enabled(entry,tag.key))entry[tag.limit]=null;
      await c.execute('UPDATE season_competitions SET '+automatic.LIMIT_FIELDS.map(k=>k+'=?').join(',')+' WHERE id=?',[...automatic.LIMIT_FIELDS.map(k=>entry[k]),competition.id]);
      await c.execute('UPDATE season_competitions SET '+RULE_FIELDS.map(k=>k+'=?').join(',')+' WHERE id=?',[...RULE_FIELDS.map(k=>entry[k]),competition.id]);
      await c.execute('UPDATE season_competitions SET is_enabled=?,registration_opens_at=?,registration_closes_at=?,rules_text=?,revision=revision+1 WHERE id=?',[Number(entry.is_enabled),entry.opens,entry.closes,entry.rules_text.trim(),competition.id]);
      for(const previous of existing)if(!entry.windows.some(v=>v.id===previous.id))await c.execute('UPDATE roster_change_windows SET is_cancelled=1,revision=revision+1 WHERE id=?',[previous.id]);
      for(const window of entry.windows){
        if(window.id)await c.execute('UPDATE roster_change_windows SET opens_at=?,closes_at=?,revision=revision+1 WHERE id=?',[window.opens,window.closes,window.id]);
        else await c.execute('INSERT INTO roster_change_windows (competition_id,opens_at,closes_at,created_by_admin_id) VALUES (?,?,?,?)',[competition.id,window.opens,window.closes,user.id]);
      }
    }
    const after=await read(seasonId,c);
    await c.execute('INSERT INTO player_season_setting_events (season_id,revision,actor_admin_id,before_snapshot,after_snapshot,created_at) VALUES (?,?,?,?,?,?)',[seasonId,after.revision,user.id,JSON.stringify(snapshot(before)),JSON.stringify(snapshot(after)),w.chinaSql()]);
    return after;
  },{readCommitted:true});
}
async function history(seasonId){await read(seasonId);const [rows]=await w.sql(pool,'SELECT revision,actor_admin_id,before_snapshot,after_snapshot,created_at FROM player_season_setting_events WHERE season_id=? ORDER BY revision DESC LIMIT 50',[seasonId]);return rows.map(r=>({...r,created_at:w.chinaIso(r.created_at)}));}
module.exports={read,save,history};
