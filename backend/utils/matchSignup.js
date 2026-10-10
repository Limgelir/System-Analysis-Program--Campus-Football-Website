const { createBusinessError } = require('./scheduleValidator');
const INTENTIONS = Object.freeze(['main','assistant','fourth','supervisor']);
function parseIntentions(value) {
  if (!Array.isArray(value) || !value.length || value.length > 4 || value.some(v => !INTENTIONS.includes(v)) || new Set(value).size !== value.length) {
    throw createBusinessError('请选择至少一项有效意向：裁判员、助理裁判员、第四官员、裁判监督', { code:'SIGNUP_INTENTIONS_INVALID' });
  }
  return INTENTIONS.filter(v => value.includes(v));
}
function json(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function windowEnd(today) { return new Date(Date.parse(today+'T00:00:00Z')+6*86400000).toISOString().slice(0,10); }
function availability(row, now) {
  if (!row.is_active || row.ended_at) return {can_apply:false, can_change:false, reason:'赛季未启用或已结束'};
  if (!row.referee_active || row.registration_status !== 'approved') return {can_apply:false, can_change:false, reason:'请先完成本赛季注册并通过审核'};
  if (!row.match_time) return {can_apply:false, can_change:false, reason:'时间待定，管理员补齐后开放报名'};
  if (`${row.match_date} ${row.match_time.slice(0,5)}:00` <= now) return {can_apply:false, can_change:false, reason:'已开球，报名、修改和撤回已关闭'};
  const inWindow = row.match_date >= now.slice(0,10) && row.match_date <= windowEnd(now.slice(0,10));
  const changing = row.signup_status === 'active';
  return {can_apply:inWindow, can_change:changing, reason:inWindow || changing ? null : '不在未来7天报名范围内'};
}
function checkScheduleRevision(value, current) {
  if (!Number.isSafeInteger(value) || value < 0 || value !== Number(current)) throw createBusinessError('赛程或选派已更新，请刷新核对后再保存；当前输入尚未提交', {statusCode:409,code:'SCHEDULE_REVISION_CONFLICT'});
}
module.exports = { INTENTIONS, parseIntentions, json, windowEnd, availability, checkScheduleRevision };
