const pool = require('../db');
const bcrypt = require('bcryptjs');
const rules = require('../utils/playerRules');
const { requireCollege } = require('../utils/collegeIdentity');
const { recordSecurityEvent } = require('../utils/securityEvents');
const query = require('../utils/listQuery');

const fields = 'id,student_id,name,college,gender,is_active,must_change_password,revision,created_at,updated_at';
function profile(row) {
  return { id: row.id, student_id: row.student_id, name: row.name, college: row.college, gender: row.gender || null,
    is_active: Boolean(row.is_active), must_change_password: Boolean(row.must_change_password),
    revision: row.revision, created_at: row.created_at, updated_at: row.updated_at };
}
function snapshot(row) {
  return { id: row.id, student_id: row.student_id, name: row.name, college: row.college, gender: row.gender || null,
    is_active: Boolean(row.is_active), must_change_password: Boolean(row.must_change_password) };
}
async function event(c, row, operation, actor, before = null, reason = null) {
  await c.execute(`INSERT INTO player_account_events
    (player_id,operation,revision,actor_player_id,actor_admin_id,reason,before_snapshot,after_snapshot)
    VALUES (?,?,?,?,?,?,?,?)`, [row.id,operation,row.revision,actor.role === 'player' ? actor.id : null,
    actor.role === 'admin' ? actor.id : null,reason,before ? JSON.stringify(snapshot(before)) : null,JSON.stringify(snapshot(row))]);
}
async function transaction(work) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const result = await work(c); await c.commit(); return result; }
  catch (error) {
    await c.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw rules.businessError('该学号已被注册，请核对或联系管理员', 409, 'STUDENT_ID_TAKEN');
    throw error;
  } finally { c.release(); }
}
async function lockedAccount(c, playerId, expectedRevision, actor) {
  const [[row]] = await c.execute('SELECT * FROM player_accounts WHERE id=? FOR UPDATE', [playerId]);
  if (!row) throw rules.businessError('球员账号不存在', 404, 'PLAYER_NOT_FOUND');
  // 在写事务里重新核验会话，防止认证后并发重置密码/停用账号仍能写入。
  if (actor.role === 'player' && (Number(actor.id) !== row.id || !row.is_active || Number(actor.tokenVersion) !== row.token_version)) {
    throw rules.businessError('登录已失效，请重新登录', 401, 'PLAYER_SESSION_EXPIRED');
  }
  if (row.revision !== expectedRevision) throw rules.businessError('账号资料已变化，请刷新后核对再提交', 409, 'PLAYER_REVISION_CONFLICT');
  return row;
}

class PlayerService {
  async register(body, actor = {}) {
    rules.onlyKeys(body, ['student_id','name','college','gender','password','password_confirm']);
    const data = { student_id: rules.studentId(body.student_id), name: rules.requiredText(body.name,'姓名',100), college: requireCollege(body.college), gender: rules.gender(body.gender) };
    rules.password(body.password);
    if (body.password !== body.password_confirm) throw rules.businessError('两次密码不一致');
    const hash = await bcrypt.hash(body.password, 10);
    return transaction(async c => {
      const [insert] = await c.execute('INSERT INTO player_accounts (student_id,name,college,gender,password_hash) VALUES (?,?,?,?,?)', [data.student_id,data.name,data.college,data.gender,hash]);
      const [[row]] = await c.execute(`SELECT ${fields} FROM player_accounts WHERE id=?`, [insert.insertId]);
      await event(c,row,'register',{role:'player',id:row.id});
      await recordSecurityEvent(c,'account_created','player',row.id,{role:'player',id:row.id,ip:actor.ip});
      return profile(row);
    });
  }
  async login(identifier, password, c) {
    const [[row]] = await c.execute('SELECT * FROM player_accounts WHERE student_id=? FOR UPDATE', [identifier]);
    if (!row || !(await bcrypt.compare(password,row.password_hash))) throw new Error('学号或密码错误');
    if (!row.is_active) throw new Error('账号已停用，请联系管理员');
    return { ...profile(row), token_version: row.token_version };
  }
  async getSecurityState(playerId) {
    const [[row]] = await pool.execute('SELECT is_active,must_change_password,token_version FROM player_accounts WHERE id=?', [playerId]);
    return row || null;
  }
  async getProfile(playerId) {
    const [[row]] = await pool.execute(`SELECT ${fields} FROM player_accounts WHERE id=?`, [playerId]);
    if (!row) throw rules.businessError('球员账号不存在',404,'PLAYER_NOT_FOUND');
    return profile(row);
  }
  async updateProfile(playerId, body, expectedRevision, actor) {
    rules.onlyKeys(body, ['name','college']);
    const name = rules.requiredText(body.name,'姓名',100);
    return transaction(async c => {
      const before = await lockedAccount(c,playerId,expectedRevision,actor);
      if (before.must_change_password) throw rules.businessError('请先修改临时密码',403,'PLAYER_PASSWORD_CHANGE_REQUIRED');
      if (body.college !== undefined && body.college !== before.college) throw rules.businessError('修改学院须上传1系统截图并经管理员审核，请提交学院修改申请',400,'PLAYER_COLLEGE_REVIEW_REQUIRED');
      await c.execute('UPDATE player_accounts SET name=?,revision=revision+1 WHERE id=?',[name,playerId]);
      const [[row]] = await c.execute(`SELECT ${fields} FROM player_accounts WHERE id=?`,[playerId]);
      await event(c,row,'profile_changed',actor,before);
      return profile(row);
    });
  }
  async setGender(playerId, body, expectedRevision, actor) {
    const admin = actor.role === 'admin';
    rules.onlyKeys(body, admin ? ['gender', 'reason'] : ['gender']);
    const gender = rules.gender(body.gender);
    const reason = admin ? rules.requiredText(body.reason, '核实原因', 500) : null;
    return transaction(async c => {
      const before = await lockedAccount(c, playerId, expectedRevision, actor);
      if (!admin && before.gender) throw rules.businessError('性别已锁定，如需修改请联系管理员', 409, 'PLAYER_GENDER_LOCKED');
      await c.execute('UPDATE player_accounts SET gender=?,revision=revision+1 WHERE id=?', [gender, playerId]);
      const [[row]] = await c.execute(`SELECT ${fields} FROM player_accounts WHERE id=?`, [playerId]);
      await event(c, row, 'gender_changed', actor, before, reason);
      return profile(row);
    });
  }
  async changeStudentId(playerId, body, expectedRevision, actor) {
    const isAdmin = actor.role === 'admin';
    rules.onlyKeys(body,isAdmin?['student_id','reason']:['student_id','current_password']);
    const student = rules.studentId(body.student_id);
    const reason = isAdmin ? rules.requiredText(body.reason,'核实原因',500) : null;
    return transaction(async c => {
      const before = await lockedAccount(c,playerId,expectedRevision,actor);
      if (!isAdmin) {
        if (before.must_change_password) throw rules.businessError('请先修改临时密码',403,'PLAYER_PASSWORD_CHANGE_REQUIRED');
        if (typeof body.current_password !== 'string' || !(await bcrypt.compare(body.current_password,before.password_hash))) throw rules.businessError('当前密码不正确');
      }
      if (student === before.student_id) throw rules.businessError('新学号与当前学号相同');
      await c.execute('UPDATE player_accounts SET student_id=?,token_version=token_version+1,revision=revision+1 WHERE id=?',[student,playerId]);
      const [[row]] = await c.execute(`SELECT ${fields} FROM player_accounts WHERE id=?`,[playerId]);
      await event(c,row,'student_id_changed',actor,before,reason);
      return { player: profile(row), reauthenticate: true };
    });
  }
  async changePassword(playerId, body, expectedRevision, actor) {
    rules.onlyKeys(body,['current_password','new_password','password_confirm']);
    rules.password(body.new_password);
    if (body.new_password !== body.password_confirm) throw rules.businessError('两次密码不一致');
    return transaction(async c => {
      const before = await lockedAccount(c,playerId,expectedRevision,actor);
      if (typeof body.current_password !== 'string' || !(await bcrypt.compare(body.current_password,before.password_hash))) throw rules.businessError('当前密码不正确');
      if (await bcrypt.compare(body.new_password,before.password_hash)) throw rules.businessError('新密码不能与当前密码相同');
      const hash = await bcrypt.hash(body.new_password,10);
      await c.execute('UPDATE player_accounts SET password_hash=?,must_change_password=0,token_version=token_version+1,revision=revision+1,password_changed_at=NOW(3) WHERE id=?',[hash,playerId]);
      const [[row]] = await c.execute(`SELECT ${fields} FROM player_accounts WHERE id=?`,[playerId]);
      await event(c,row,'password_changed',actor,before);
      await recordSecurityEvent(c,'password_changed','player',playerId,actor);
      return { reauthenticate: true };
    });
  }
  async logout(playerId, expectedRevision, actor) {
    return transaction(async c => {
      const before = await lockedAccount(c,playerId,expectedRevision,actor);
      await c.execute('UPDATE player_accounts SET token_version=token_version+1,revision=revision+1 WHERE id=?',[playerId]);
      await event(c,{...before,revision:before.revision+1},'logout',actor,before);
      return { logged_out:true };
    });
  }
  async adminList(q) {
    const { page, pageSize } = query.pagination(q);
    const search = query.text(q.q,'搜索内容');
    const active = query.choice(q.active,['0','1'],'账号状态');
    const where = ['1=1']; const args=[];
    if (search) { where.push("(name LIKE ? ESCAPE '!' OR student_id LIKE ? ESCAPE '!' OR college LIKE ? ESCAPE '!')"); args.push(...Array(3).fill(query.like(search))); }
    if (active) { where.push('is_active=?'); args.push(Number(active)); }
    const clause = where.join(' AND ');
    const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM player_accounts WHERE ${clause}`,args);
    const [rows] = await pool.query(`SELECT ${fields} FROM player_accounts WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,[...args,pageSize,(page-1)*pageSize]);
    return { players: rows.map(profile), pagination: query.pageMeta(page,pageSize,Number(count.total)) };
  }
  async history(playerId) {
    await this.getProfile(playerId);
    const [rows] = await pool.execute(`SELECT id,operation,revision,actor_player_id,actor_admin_id,reason,before_snapshot,after_snapshot,created_at
      FROM player_account_events WHERE player_id=? ORDER BY revision DESC LIMIT 100`,[playerId]);
    return rows;
  }
  async resetPassword(playerId, body, expectedRevision, actor) {
    rules.onlyKeys(body,['reason']);
    const reason=rules.requiredText(body.reason,'核实原因',500);
    return transaction(async c => {
      const before = await lockedAccount(c,playerId,expectedRevision,actor);
      const temporary = rules.temporaryPassword();
      await c.execute('UPDATE player_accounts SET password_hash=?,must_change_password=1,token_version=token_version+1,revision=revision+1,password_changed_at=NOW(3) WHERE id=?',[await bcrypt.hash(temporary,10),playerId]);
      const [[row]] = await c.execute(`SELECT ${fields} FROM player_accounts WHERE id=?`,[playerId]);
      await event(c,row,'password_reset',actor,before,reason);
      await recordSecurityEvent(c,'password_reset','player',playerId,actor);
      return {player:profile(row),temporary_password:temporary};
    });
  }
  async setActive(playerId, body, expectedRevision, actor) {
    rules.onlyKeys(body,['is_active','reason']);
    if (typeof body.is_active !== 'boolean') throw rules.businessError('账号状态必须为启用或停用');
    const reason=rules.requiredText(body.reason,'操作原因',500);
    return transaction(async c => {
      const before=await lockedAccount(c,playerId,expectedRevision,actor);
      await c.execute('UPDATE player_accounts SET is_active=?,token_version=token_version+1,revision=revision+1 WHERE id=?',[body.is_active?1:0,playerId]);
      const [[row]]=await c.execute(`SELECT ${fields} FROM player_accounts WHERE id=?`,[playerId]);
      await event(c,row,body.is_active?'account_enabled':'account_disabled',actor,before,reason);
      await recordSecurityEvent(c,body.is_active?'account_enabled':'account_disabled','player',playerId,actor);
      return profile(row);
    });
  }
}
module.exports=new PlayerService();
