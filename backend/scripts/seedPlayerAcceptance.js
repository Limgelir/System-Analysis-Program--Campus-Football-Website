// 只追加本机验收账号；不调用会重置既有管理员的 bootstrap，不修改旧账号。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { assertMigrationsCurrent } = require('../utils/migrationRunner');
const { recordSecurityEvent } = require('../utils/securityEvents');
const file = path.resolve(__dirname, '../../.cache/player-batch1-accounts.seed');
async function main() {
  if (!['localhost','127.0.0.1','::1'].includes(String(process.env.DB_HOST).toLowerCase()) || process.env.NODE_ENV !== 'development') throw Error('验收账号只能追加到本机 development 数据库');
  if (fs.existsSync(file)) { console.log(`验收凭据已存在，本次不修改账号：${file}`); return; }
  const c = await pool.getConnection(); let written = false;
  try {
    await assertMigrationsCurrent(c);
    const tag = crypto.randomBytes(4).toString('hex');
    const credentials = { database: process.env.DB_NAME, admin: { username: `player-batch1-${tag}`, password: 'Admin!7' + crypto.randomBytes(12).toString('base64url') }, players: [] };
    await c.beginTransaction();
    const [a] = await c.execute('INSERT INTO admin (username,password_hash,must_change_password,password_changed_at,token_version) VALUES (?,?,0,NOW(),0)', [credentials.admin.username, await bcrypt.hash(credentials.admin.password, 12)]);
    credentials.admin.id = a.insertId;
    await recordSecurityEvent(c, 'account_created', 'admin', a.insertId, { role: 'system' });
    for (const suffix of ['A','B']) {
      const p = { student_id: `PB1-${tag}-${suffix}`, name: '首批验收球员', college: `验收学院${suffix}`, password: 'Player!7' + crypto.randomBytes(12).toString('base64url') };
      const [r] = await c.execute('INSERT INTO player_accounts (student_id,name,college,password_hash) VALUES (?,?,?,?)', [p.student_id,p.name,p.college,await bcrypt.hash(p.password,10)]);
      p.id = r.insertId;
      const snapshot = { id:p.id,student_id:p.student_id,name:p.name,college:p.college,is_active:true,must_change_password:false };
      await c.execute("INSERT INTO player_account_events (player_id,operation,revision,actor_player_id,after_snapshot) VALUES (?,'register',0,?,?)", [p.id,p.id,JSON.stringify(snapshot)]);
      await recordSecurityEvent(c,'account_created','player',p.id,{role:'system'});
      credentials.players.push(p);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(credentials,null,2)+'\n', { flag: 'wx', mode: 0o600 }); written = true;
    await c.commit();
    console.log(`已追加 1 个管理员和 2 个同名球员；旧账号未修改。凭据仅写入：${file}`);
  } catch(e) { await c.rollback(); if (written) fs.unlinkSync(file); throw e; }
  finally { c.release(); }
}
main().catch(e=>{ console.error(e.isBusinessError?e.message:'验收账号准备失败，请检查本地环境和数据库迁移状态'); process.exitCode=1; }).finally(()=>pool.end());
