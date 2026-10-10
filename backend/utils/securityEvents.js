const crypto = require('node:crypto');
const EVENTS = new Set(['login_failed','login_blocked','login_success','login_new_ip','password_changed','password_reset','account_created','account_disabled','account_enabled','account_deleted']);

function securityKey(value) {
  if (!process.env.JWT_SECRET) throw new Error('安全事件密钥未配置');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(value)).digest('hex');
}

function requestActor(req) {
  return { role: req.user?.role || 'anonymous', id: req.user?.id || null, ip: req.ip };
}

// 严格列白名单：不接收请求正文、密码、令牌、姓名、学号或原始 IP。
async function recordSecurityEvent(c, event, targetRole, targetId, actor = {}, keys = {}) {
  if (!EVENTS.has(event)) throw new Error('未知安全事件');
  await c.execute(`INSERT INTO security_events
    (event_type,actor_role,actor_id,target_role,target_id,account_key,ip_key) VALUES (?,?,?,?,?,?,?)`,
  [event, actor.role || 'system', actor.id || null, targetRole, targetId || null,
    keys.accountKey || null, keys.ipKey || (actor.ip ? securityKey(`ip:${actor.ip}`) : null)]);
}

module.exports = { securityKey, requestActor, recordSecurityEvent };
