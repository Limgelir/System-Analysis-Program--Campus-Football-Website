const crypto=require('node:crypto');
const rules=require('./playerRules');
const FLAGS=['is_captain','is_goalkeeper','is_foreign','is_sports_training','is_football_specialty'];
function text(value,label,max,optional=false){
  if(optional&&(value==null||typeof value==='string'&&!value.trim()))return null;
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw rules.businessError(`${label}不能为空且不能超过${max}字`);
  return value.trim();
}
function number(value,required=false){
  if(value==null||value===''){if(required)throw rules.businessError('提交前须填写每名球员的号码');return null;}
  const raw=String(value).trim();if(!/^\d+$/.test(raw))throw rules.businessError('号码只允许0和正整数');
  const normalized=raw.replace(/^0+(?=\d)/,'');if(normalized.length>20)throw rules.businessError('号码不能超过20位');return normalized;
}
function normalize(body,{complete=false}={}){
  rules.onlyKeys(body,['team_name','shirt_color','shorts_color','socks_color','members']);
  const data={team_name:rules.requiredText(body.team_name,'队名',100)};
  for(const field of ['shirt_color','shorts_color','socks_color'])data[field]=text(body[field],'球衣颜色',50,true);
  if(!Array.isArray(body.members))throw rules.businessError('名单格式不正确');
  data.members=body.members.map(m=>{rules.onlyKeys(m,['id','player_id','jersey_number','remark',...FLAGS]);const out={id:m.id==null?null:rules.id(m.id),player_id:rules.id(m.player_id),jersey_number:number(m.jersey_number,complete),remark:text(m.remark,'备注',255,true)};for(const flag of FLAGS){if(flag==='is_football_specialty'&&m[flag]===undefined)m={...m,[flag]:false};if(typeof m[flag]!=='boolean')throw rules.businessError('球员角色和标记必须为是或否');out[flag]=m[flag];}return out;});
  const unique=(values,label)=>{if(new Set(values).size!==values.length)throw rules.businessError(label);};
  unique(data.members.map(m=>m.player_id),'同一名单不能重复添加球员');unique(data.members.filter(m=>m.id).map(m=>m.id),'名单行重复');unique(data.members.filter(m=>m.jersey_number!==null).map(m=>m.jersey_number),'同队号码不能重复，01与1视为同一号码');
  const captains=data.members.filter(m=>m.is_captain).length;if(captains>1||(complete&&captains!==1))throw rules.businessError('正式提交必须有且仅有一名场上队长');
  return data;
}
function requestKey(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw rules.businessError('提交标识缺失，请刷新重试');return value;}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function correction(previous,proposed,replaceable){
  const before=previous.members,after=proposed.members;
  if(before.length!==after.length||after.some(m=>!before.some(b=>b.id===m.id)))throw rules.businessError('截止后只能替换管理员指定的球员，不能增删名单行',409,'TEAM_CORRECTION_LOCKED');
  for(const m of after){const old=before.find(b=>b.id===m.id);if(old.player_id!==m.player_id&&!replaceable.includes(m.id))throw rules.businessError('该球员未被管理员指定为可替换，其余人员已锁定',409,'TEAM_CORRECTION_LOCKED');}
}
function differences(before,after){
  if(!before)return [];
  const rows=[];for(const [field,label]of [['team_name','队名'],['shirt_color','上衣'],['shorts_color','裤子'],['socks_color','袜子']])if(before[field]!==after[field])rows.push(`${label}：${before[field]||'/'} → ${after[field]||'/'}`);
  for(const old of before.members){const m=after.members.find(v=>v.id===old.id);const name=old.profile_snapshot?.name||`球员#${old.player_id}`;
    if(!m){rows.push(`移除：${name}`);continue;}if(m.player_id!==old.player_id)rows.push(`替换：${name} → ${m.profile_snapshot?.name||'#'+m.player_id}`);
    if((m.remark||null)!==(old.remark||null))rows.push(`${name}备注：${old.remark||'未填'} → ${m.remark||'未填'}`);
    if(m.jersey_number!==old.jersey_number)rows.push(`${name}号码：${old.jersey_number??'未填'} → ${m.jersey_number??'未填'}`);
    for(const [flag,label]of [['is_captain','队长'],['is_goalkeeper','守门员'],['is_foreign','外援'],['is_sports_training','运训'],['is_football_specialty','足球特长生']])if(Boolean(m[flag])!==Boolean(old[flag]))rows.push(`${name}：${m[flag]?'设为':'取消'}${label}`);
  }
  for(const m of after.members)if(!before.members.some(b=>b.id===m.id))rows.push(`新增：${m.profile_snapshot?.name||'#'+m.player_id}`);
  return rows;
}
module.exports={FLAGS,text,number,normalize,requestKey,digest,correction,differences};
