const pool = require('../db');
const rules = require('./playerRules');

// 新球员工作流的 DATETIME 均为中国墙上时间；取出字符串，避免驱动按宿主时区转换。
const sql = (c,statement,args=[]) => c.execute({sql:statement,dateStrings:true},args);
function chinaSql(instant=new Date()) {
  const time=new Date(instant).getTime();
  if(!Number.isFinite(time))throw rules.businessError('时间不正确');
  return new Date(time+8*3600000).toISOString().slice(0,23).replace('T',' ');
}
function chinaIso(value) {
  if(!value)return null;
  if(typeof value!=='string')throw new Error('中国时间字段必须以字符串读取');
  return value.replace(' ','T').padEnd(23,'.000'.slice(value.length-19))+'+08:00';
}
function normalizeTime(value,label) {
  if(value===null||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?\+08:00$/.test(value))throw rules.businessError(`${label}须为中国时间，格式为带 +08:00 的日期时间`);
  const normalized=chinaSql(value);
  if(chinaIso(normalized)!==(value.includes('.')?value:value.replace('+08:00','.000+08:00')))throw rules.businessError(`${label}不是有效日期时间`);
  return normalized;
}
function windowPair(body,openKey,closeKey,label) {
  const opens=normalizeTime(body[openKey],`${label}开放时间`),closes=normalizeTime(body[closeKey],`${label}截止时间`);
  if(Boolean(opens)!==Boolean(closes)||(opens&&opens>=closes))throw rules.businessError(`${label}必须同时设置开放和截止时间，且开放时间早于截止时间`);
  return {opens,closes};
}
function windowStatus(opens,closes,now=chinaSql()) {
  if(!opens||!closes)return 'unconfigured';
  if(now<opens)return 'upcoming';
  return now<closes?'open':'closed';
}
async function transaction(work,{readCommitted=false}={}) {
  const c=await pool.getConnection();
  try{if(readCommitted)await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();const data=await work(c);await c.commit();return data;}
  catch(e){await c.rollback();throw e;}finally{c.release();}
}
async function season(c,id,{active=false}={}) {
  const [[row]]=await sql(c,'SELECT * FROM seasons WHERE id=? FOR UPDATE',[rules.id(id)]);
  if(!row)throw rules.businessError('赛季不存在',404,'SEASON_NOT_FOUND');
  if(active&&!row.is_active)throw rules.businessError('当前启用赛季已变化，请刷新页面',409,'PLAYER_SEASON_CHANGED');
  const [[setting]]=await sql(c,'SELECT * FROM player_season_settings WHERE season_id=?',[row.id]);
  if(setting?.ended_at)throw rules.businessError('该赛季已经结束，不能继续提交或审核',409,'PLAYER_SEASON_ENDED');
  return row;
}
async function actor(c,user) {
  if(user.role==='player'){
    const [[row]]=await sql(c,'SELECT id,student_id,name,college,is_active,must_change_password,token_version,revision FROM player_accounts WHERE id=? FOR UPDATE',[user.id]);
    if(!row||!row.is_active||row.token_version!==user.tokenVersion)throw rules.businessError('登录已失效，请重新登录',401,'PLAYER_SESSION_EXPIRED');
    if(row.must_change_password)throw rules.businessError('请先修改临时密码',403,'PLAYER_PASSWORD_CHANGE_REQUIRED');
    return row;
  }
  const [[row]]=await sql(c,'SELECT id,token_version,must_change_password FROM admin WHERE id=? FOR SHARE',[user.id]);
  if(user.role!=='admin'||!row||row.token_version!==user.tokenVersion)throw rules.businessError('管理员会话已失效，请重新登录',401,'ADMIN_SESSION_EXPIRED');
  if(row.must_change_password)throw rules.businessError('请先修改管理员密码',403);
  return row;
}
function expectRevision(actual,expected) {
  if(actual!==expected)throw rules.businessError('内容已变化，请刷新后核对再提交',409,'PLAYER_WORKFLOW_CONFLICT');
}
function accountSnapshot(p){return {id:p.id,student_id:p.student_id,name:p.name,college:p.college,gender:p.gender||null};}
module.exports={sql,chinaSql,chinaIso,normalizeTime,windowPair,windowStatus,transaction,season,actor,expectRevision,accountSnapshot};
