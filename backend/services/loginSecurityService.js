const pool = require('../db');
const { securityKey, recordSecurityEvent } = require('../utils/securityEvents');

const POLICY = Object.freeze({ windowMs: 15 * 60 * 1000, lockMs: 5 * 60 * 1000, pairLimit: 5, accountLimit: 20 });
const FAILURE_MESSAGE = '账号或密码错误，或账号暂不可用';
function canonicalAccount(value) {
  return String(value).normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase();
}
function loginError(statusCode, message, retryAfter) {
  return Object.assign(new Error(message), { statusCode, retryAfter, isBusinessError: true });
}

async function protectedLogin({ role, identifier, password, ip, verify }) {
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 100 ||
      typeof password !== 'string' || !password || Buffer.byteLength(password) > 256) {
    throw loginError(401, FAILURE_MESSAGE);
  }
  if (!['admin','referee','player'].includes(role)) throw loginError(401, FAILURE_MESSAGE);
  const c = await pool.getConnection();
  try {
    // 已存在账号以数据库识别出的 ID 归并；不能只靠 JavaScript 猜测数据库排序规则。
    const [[account]] = await c.execute(role === 'admin'
      ? 'SELECT id FROM admin WHERE username=? LIMIT 1'
      : role === 'player' ? 'SELECT id FROM player_accounts WHERE student_id=? LIMIT 1'
      : 'SELECT id FROM referee WHERE student_id=? LIMIT 1', [identifier.trim()]);
    const accountKey = securityKey(account ? `${role}:id:${account.id}` : `${role}:${canonicalAccount(identifier)}`);
    const ipKey = securityKey(`ip:${ip || ''}`);
    const keys = { accountKey, ipKey };
    const buckets = [
      { key: securityKey(`account:${accountKey}`), limit: POLICY.accountLimit },
      { key: securityKey(`pair:${accountKey}:${ipKey}`), limit: POLICY.pairLimit }
    ].sort((a,b) => a.key.localeCompare(b.key));
    await c.beginTransaction();
    // 同账号串行验证，防止并发失败绕过计数；账号限流独立于 IP，进程重启仍有效。
    for (const b of buckets) {
      await c.execute(`INSERT INTO login_security_buckets (bucket_key,window_started_at) VALUES (?,?)
        ON DUPLICATE KEY UPDATE bucket_key=VALUES(bucket_key)`, [b.key,new Date()]);
      const [[row]] = await c.execute('SELECT * FROM login_security_buckets WHERE bucket_key=? FOR UPDATE',[b.key]);
      b.row = row;
    }
    const now = new Date();
    const blockedUntil = Math.max(...buckets.map(b => b.row.blocked_until ? new Date(b.row.blocked_until).getTime() : 0));
    if (blockedUntil > now.getTime()) {
      await recordSecurityEvent(c,'login_blocked',role,null,{role:'anonymous'},keys);
      await c.commit();
      throw loginError(429,'登录尝试过多，请稍后再试',Math.ceil((blockedUntil-now.getTime())/1000));
    }
    let user;
    try { user = await verify(identifier.trim(), password, c); }
    catch (error) {
      // 仅认证失败计入失败次数；数据库等内部故障不得伪装成密码错误。
      if (!['学号或密码错误','账号已停用，请联系管理员','管理员账号或密码错误'].includes(error.message)) throw error;
    }
    if (user && Number(user.id) !== Number(account?.id)) throw loginError(409,'账号资料刚刚变化，请重试登录');
    if (!user) {
      let locked = false;
      for (const b of buckets) {
        const expired = b.row.blocked_until || now - new Date(b.row.window_started_at) >= POLICY.windowMs;
        const count = expired ? 1 : Number(b.row.failed_count)+1;
        const blocked = count >= b.limit;
        locked ||= blocked;
        await c.execute('UPDATE login_security_buckets SET failed_count=?,window_started_at=?,blocked_until=?,updated_at=? WHERE bucket_key=?',
          [count,expired?now:b.row.window_started_at,blocked?new Date(now.getTime()+POLICY.lockMs):null,now,b.key]);
      }
      await recordSecurityEvent(c,'login_failed',role,null,{role:'anonymous'},keys);
      if (locked) await recordSecurityEvent(c,'login_blocked',role,null,{role:'anonymous'},keys);
      await c.commit();
      throw loginError(locked?429:401,locked?'登录尝试过多，请稍后再试':FAILURE_MESSAGE,locked?POLICY.lockMs/1000:undefined);
    }
    for (const b of buckets) await c.execute('UPDATE login_security_buckets SET failed_count=0,blocked_until=NULL,window_started_at=?,updated_at=? WHERE bucket_key=?',[now,now,b.key]);
    const [[prior]] = await c.execute("SELECT id FROM security_events WHERE account_key=? AND event_type='login_success' LIMIT 1",[accountKey]);
    const [[knownIp]] = await c.execute("SELECT id FROM security_events WHERE account_key=? AND event_type='login_success' AND ip_key=? LIMIT 1",[accountKey,ipKey]);
    const actor = {role,id:user.id};
    if (prior && !knownIp) await recordSecurityEvent(c,'login_new_ip',role,user.id,actor,keys);
    await recordSecurityEvent(c,'login_success',role,user.id,actor,keys);
    await c.commit();
    return user;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally { c.release(); }
}

function sendLoginError(res,error) {
  const status = error.statusCode || 503;
  if (error.retryAfter) res.set('Retry-After',String(error.retryAfter));
  res.status(status).json({success:false,message:error.isBusinessError?error.message:'登录服务暂不可用，请稍后再试',retry_after_seconds:error.retryAfter});
}

module.exports = { protectedLogin, sendLoginError, canonicalAccount, POLICY, FAILURE_MESSAGE };
