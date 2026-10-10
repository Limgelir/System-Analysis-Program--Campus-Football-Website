const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const pool = require('../db');
const rules = require('../utils/playerRules');
const w = require('../utils/playerWorkflow');
const query = require('../utils/listQuery');
const images = require('../utils/playerAcademicUpload');
const { requireCollege } = require('../utils/collegeIdentity');
const STATUSES = ['pending','approved','returned','withdrawn'];
function view(row) {
  return { id:row.id, player_id:row.player_id, old_college:row.old_college, new_college:row.new_college,
    status:row.status, revision:row.revision, profile_snapshot:row.profile_snapshot, review_profile_snapshot:row.review_profile_snapshot,
    submitted_at:w.chinaIso(row.submitted_at), reviewed_at:w.chinaIso(row.reviewed_at), withdrawn_at:w.chinaIso(row.withdrawn_at),
    reviewed_by_admin_id:row.reviewed_by_admin_id, review_reason:row.review_reason };
}
async function readRow(c,id,lock=false) {
  const [[row]] = await w.sql(c,'SELECT * FROM player_college_changes WHERE id=?'+(lock?' FOR UPDATE':''),[rules.id(id)]);
  if (!row) throw rules.businessError('学院修改申请不存在',404,'COLLEGE_CHANGE_NOT_FOUND');
  return row;
}
function allow(row,user) {
  if (user.role !== 'admin' && (user.role !== 'player' || row.player_id !== user.id)) throw rules.businessError('无权查看该学院修改申请',403,'COLLEGE_CHANGE_FORBIDDEN');
}
async function accountIn(c,id,lock=false) {
  const [[row]] = await w.sql(c,'SELECT id,student_id,name,college,revision,is_active,must_change_password FROM player_accounts WHERE id=?'+(lock?' FOR UPDATE':''),[id]);
  if (!row) throw rules.businessError('球员账号不存在',404,'PLAYER_NOT_FOUND');
  return {...row,is_active:Boolean(row.is_active),must_change_password:Boolean(row.must_change_password)};
}
async function detailIn(c,id,user) {
  const row=await readRow(c,id); allow(row,user);
  const [events]=await w.sql(c,'SELECT id,revision,operation,actor_player_id,actor_admin_id,reason,after_snapshot,created_at FROM player_college_change_events WHERE change_id=? ORDER BY revision DESC',[id]);
  return {change:view(row),account:await accountIn(c,row.player_id),events:events.map(e=>({...e,created_at:w.chinaIso(e.created_at)}))};
}
const detail=(id,user)=>w.transaction(c=>detailIn(c,rules.id(id),user));
async function event(c,row,operation,user,reason=null) {
  await c.execute('INSERT INTO player_college_change_events (change_id,revision,operation,actor_player_id,actor_admin_id,reason,after_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [row.id,row.revision,operation,user.role==='player'?user.id:null,user.role==='admin'?user.id:null,reason,JSON.stringify(view(row)),w.chinaSql()]);
}
async function current(user,q={}) {
  const {page,pageSize}=query.pagination(q);
  return w.transaction(async c=>{
    const account=await accountIn(c,user.id);
    const [[pending]]=await w.sql(c,"SELECT * FROM player_college_changes WHERE player_id=? AND status='pending'",[user.id]);
    const [[count]]=await c.execute('SELECT COUNT(*) n FROM player_college_changes WHERE player_id=?',[user.id]);
    const [rows]=await c.query({sql:'SELECT * FROM player_college_changes WHERE player_id=? ORDER BY id DESC LIMIT ? OFFSET ?',dateStrings:true},[user.id,pageSize,(page-1)*pageSize]);
    return {account,pending:pending?view(pending):null,items:rows.map(view),pagination:query.pageMeta(page,pageSize,Number(count.n))};
  });
}
async function submit(user,body,key,file,meta) {
  rules.onlyKeys(body,['new_college','account_revision']);
  const college=requireCollege(body.new_college),revision=rules.revision(body.account_revision);
  if (typeof key!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key)) throw rules.businessError('提交标识缺失，请刷新页面后重试',400,'PLAYER_REQUEST_KEY_REQUIRED');
  const hash=crypto.createHash('sha256').update(JSON.stringify([college,revision,meta.sha256])).digest('hex');
  const c=await pool.getConnection();let saved=null,commitAttempted=false;
  try {
    await c.beginTransaction();
    // All mutations lock the player first, so submission, withdrawal and review serialize.
    const account=await w.actor(c,user);
    const [[prior]]=await w.sql(c,'SELECT * FROM player_college_changes WHERE player_id=? AND request_key=?',[user.id,key]);
    if (prior) {
      if (prior.request_hash!==hash) throw rules.businessError('同一提交标识不能用于不同材料',409,'PLAYER_REQUEST_KEY_CONFLICT');
      const data=await detailIn(c,prior.id,user);await c.commit();return {...data,replayed:true};
    }
    if (account.revision!==revision) throw rules.businessError('账号资料已变化，请刷新并核对原学院后重新提交',409,'PLAYER_PROFILE_CHANGED');
    if (account.college===college) throw rules.businessError('新学院与当前学院相同，无需申请');
    const [[pending]]=await c.execute("SELECT id FROM player_college_changes WHERE player_id=? AND status='pending'",[user.id]);
    if (pending) throw rules.businessError('已有待审核的学院修改申请，请等待审核或先撤回',409,'COLLEGE_CHANGE_PENDING');
    saved=await images.save(file,meta);
    const [insert]=await c.execute(`INSERT INTO player_college_changes
      (player_id,old_college,new_college,profile_snapshot,request_key,request_hash,file_path,mime_type,sha256,submitted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,[user.id,account.college,college,JSON.stringify(w.accountSnapshot(account)),key,hash,saved,meta.mime,meta.sha256,w.chinaSql()]);
    const row=await readRow(c,insert.insertId);await event(c,row,'submitted',user);
    const data=await detailIn(c,row.id,user);commitAttempted=true;await c.commit();return {...data,replayed:false};
  } catch(e) { await c.rollback();if(saved&&!commitAttempted)await images.remove(saved);throw e; }
  finally { c.release(); }
}
async function withdraw(id,user,body,revision) {
  rules.onlyKeys(body,[]);
  return w.transaction(async c=>{
    await w.actor(c,user);const row=await readRow(c,id,true);allow(row,user);w.expectRevision(row.revision,revision);
    if(row.status!=='pending') throw rules.businessError('只有待审核的学院修改申请可以撤回',409,'COLLEGE_CHANGE_STATE');
    await c.execute("UPDATE player_college_changes SET status='withdrawn',revision=revision+1,withdrawn_at=? WHERE id=?",[w.chinaSql(),row.id]);
    await event(c,await readRow(c,row.id),'withdrawn',user);return detailIn(c,row.id,user);
  });
}
async function review(id,operation,user,body,revision) {
  if(!['approve','return'].includes(operation)) throw rules.businessError('审核操作不正确');
  rules.onlyKeys(body,operation==='approve'?['reason','account_revision']:['reason']);
  const reason=operation==='return'?rules.requiredText(body.reason,'退回理由',500):body.reason==null||body.reason===''?null:rules.requiredText(body.reason,'审核说明',500);
  return w.transaction(async c=>{
    await w.actor(c,user);const existing=await readRow(c,id);
    const account=await accountIn(c,existing.player_id,true),row=await readRow(c,id,true);
    w.expectRevision(row.revision,revision);
    if(row.status!=='pending') throw rules.businessError('申请状态已变化，请刷新后再处理',409,'COLLEGE_CHANGE_STATE');
    if(operation==='approve') {
      if(!account.is_active) throw rules.businessError('球员账号已停用，不能通过审核',409,'PLAYER_ACCOUNT_DISABLED');
      if(account.revision!==rules.revision(String(body.account_revision)) || account.college!==row.old_college) throw rules.businessError('账号资料已变化，请刷新并核对；原学院变化时请退回重提',409,'PLAYER_PROFILE_CHANGED');
      requireCollege(row.new_college);
      try { await fs.access(images.resolve(row.file_path)); } catch { throw rules.businessError('材料文件缺失，请退回球员重新上传',409,'PLAYER_MATERIAL_UNAVAILABLE'); }
      await c.execute('UPDATE player_accounts SET college=?,revision=revision+1 WHERE id=?',[row.new_college,row.player_id]);
      const after={...account,college:row.new_college,revision:account.revision+1};
      await c.execute(`INSERT INTO player_account_events (player_id,operation,revision,actor_admin_id,reason,before_snapshot,after_snapshot)
        VALUES (?,'college_change_approved',?,?,?,?,?)`,[row.player_id,after.revision,user.id,reason,JSON.stringify(account),JSON.stringify(after)]);
    }
    const status=operation==='approve'?'approved':'returned',now=w.chinaSql();
    await c.execute('UPDATE player_college_changes SET status=?,revision=revision+1,review_profile_snapshot=?,reviewed_at=?,reviewed_by_admin_id=?,review_reason=? WHERE id=?',
      [status,JSON.stringify(w.accountSnapshot(account)),now,user.id,reason,row.id]);
    const after=await readRow(c,row.id);await event(c,after,status,user,reason);
    const message=operation==='approve'?`你的学院修改申请已通过：${row.old_college||'未填写'} → ${row.new_college}。`:`你的学院修改申请已退回：${reason}。请到账号设置重新上传截图申请。`;
    await c.execute('INSERT INTO player_notifications (player_id,event_key,kind,message,created_at) VALUES (?,?,?,?,?)',
      [row.player_id,`college-change:${row.id}:${after.revision}`,'college_change_'+status,Array.from(message).slice(0,500).join(''),now]);
    return detailIn(c,row.id,user);
  });
}
async function list(q) {
  const {page,pageSize}=query.pagination(q),status=query.choice(q.status,STATUSES,'申请状态'),search=query.text(q.q,'搜索内容');
  const where=['1=1'],args=[];
  if(status){where.push('r.status=?');args.push(status);}
  if(search){where.push("(a.name LIKE ? ESCAPE '!' OR a.student_id LIKE ? ESCAPE '!' OR r.old_college LIKE ? ESCAPE '!' OR r.new_college LIKE ? ESCAPE '!')");args.push(...Array(4).fill(query.like(search)));}
  const from=`FROM player_college_changes r JOIN player_accounts a ON a.id=r.player_id WHERE ${where.join(' AND ')}`;
  const [[count]]=await pool.execute(`SELECT COUNT(*) n ${from}`,args);
  const [rows]=await pool.query({sql:`SELECT r.*,a.name,a.student_id,a.is_active ${from} ORDER BY r.submitted_at DESC,r.id DESC LIMIT ? OFFSET ?`,dateStrings:true},[...args,pageSize,(page-1)*pageSize]);
  const [counts]=await pool.execute('SELECT status,COUNT(*) n FROM player_college_changes GROUP BY status');
  return {items:rows.map(r=>({...view(r),account:{name:r.name,student_id:r.student_id,is_active:Boolean(r.is_active)}})),
    summary:Object.fromEntries(STATUSES.map(s=>[s,Number(counts.find(r=>r.status===s)?.n||0)])),pagination:query.pageMeta(page,pageSize,Number(count.n))};
}
async function file(id,user) { const row=await readRow(pool,id);allow(row,user);return {path:images.resolve(row.file_path),mime:row.mime_type}; }
module.exports={current,submit,withdraw,detail,review,list,file};
