const rules = require('../utils/playerRules');
const w = require('../utils/playerWorkflow');
const r = require('../utils/teamApplicationRules');
const tags = require('../utils/teamTags');
const automatic = require('../utils/teamAutoReview');
const service = require('./playerTeamService');
const changes = require('./rosterChangeService');
const transaction = work => w.transaction(work, { readCommitted: true });

async function state(c, id, user, write = false) {
  if (user.role !== 'admin') throw rules.businessError('只有管理员可以直接修改球队', 403);
  const data = await changes.team(c, id, user, write);
  const [[competition]] = await w.sql(c, 'SELECT * FROM season_competitions WHERE season_id=? AND league_type=?', [data.t.season_id, data.t.league_type]);
  if (write && (!data.t.is_active || data.t.ended_at || !competition?.is_enabled)) throw rules.businessError('只能修改当前启用且未结束赛事的正式球队', 409);
  return { ...data, competition };
}
async function detailIn(c, id, user) {
  const { t, batch, current, competition } = await state(c, id, user);
  const [[manager]] = await w.sql(c, 'SELECT id,name,student_id FROM player_accounts WHERE id=?', [t.manager_player_id]);
  const [open] = await w.sql(c, "SELECT id,status FROM team_applications WHERE team_id=? AND kind='roster_change' AND status IN ('draft','pending','returned','auto_failed')", [t.id]);
  const [roles] = await w.sql(c, "SELECT id,role FROM team_role_change_requests WHERE team_id=? AND status='pending'", [t.id]);
  const members = [];
  for (const p of current) {
    const [[account]] = await w.sql(c, `SELECT p.id,p.name,p.student_id,p.college,p.gender,p.is_active,g.status AS qualification_status
      FROM player_accounts p LEFT JOIN player_season_registrations g ON g.player_id=p.id AND g.season_id=? WHERE p.id=?`, [t.season_id, p.player_account_id]);
    members.push({ ...p, ...account, id:p.id, player_id:p.player_account_id, name:account?.name || p.player_name,
      is_captain:p.player_account_id ? p.player_account_id === t.captain_player_id : Boolean(p.is_captain) });
  }
  const blocked = t.registration_revoked ? '球队报名通过已撤销，请先恢复通过或完成重新审核。'
    : open.length || roles.length ? '已有进行中的名单或角色变更，请先处理或撤回原申请。' : null;
  return { team:t, batch, manager, members, open_requests:open, open_roles:roles, blocked_reason:blocked,
    limits:competition ? Object.fromEntries([...automatic.LIMIT_FIELDS,...tags.CONFIG_FIELDS].map(k=>[k,competition[k]])) : {},
    can_edit:!blocked && Boolean(t.is_active && !t.ended_at && competition?.is_enabled) };
}
const detail = (id, user) => transaction(c=>detailIn(c,id,user));
async function lookup(id, studentId, role, user) {
  if (!['manager','member'].includes(role)) throw rules.businessError('查询角色不正确');
  return transaction(async c=>{
    const {t} = await state(c,id,user);
    const [[p]] = await w.sql(c,`SELECT p.id,p.name,p.student_id,p.college,p.gender,p.is_active,g.status AS qualification_status
      FROM player_accounts p LEFT JOIN player_season_registrations g ON g.player_id=p.id AND g.season_id=?
      WHERE p.student_id=?`,[t.season_id,rules.studentId(studentId)]);
    if (!p) throw rules.businessError('未找到该学号，请先注册球员账号',404);
    return p;
  });
}
async function update(id, user, body, revision) {
  rules.onlyKeys(body,['team_name','shirt_color','shorts_color','socks_color','manager_player_id','members']);
  const {manager_player_id,...fields} = body;
  const managerId = rules.id(manager_player_id), data = r.normalize(fields,{complete:true});
  return transaction(async c=>{
    const {t,batch,current,competition} = await state(c,id,user,true);
    w.expectRevision(t.revision,revision);
    await changes.assertNoOther(c,t.id);
    const [[role]] = await w.sql(c,"SELECT id FROM team_role_change_requests WHERE team_id=? AND status='pending'",[t.id]);
    if (role) throw rules.businessError('已有待审核角色变更，请先处理或撤回原申请',409,'TEAM_ROLE_CHANGE_EXISTS');
    for (const m of data.members) {
      if (m.id && !current.some(p=>p.id===m.id && p.player_account_id===m.player_id)) throw rules.businessError('名单行已变化，请刷新球队',409);
      for (const tag of tags.TAGS) if (!tags.enabled(competition,tag.key)) m[tag.flag] = Boolean(current.find(p=>p.player_account_id===m.player_id)?.[tag.flag]);
    }
    const [[manager]] = await w.sql(c,'SELECT id FROM player_accounts WHERE id=? FOR SHARE',[managerId]);
    if (!manager) throw rules.businessError('负责人球员账号不存在',404);
    // 管理员直接编辑仅保留名单基本规则；豁免信息随正式名单和操作历史一起保存。
    const [insert] = await c.execute(`INSERT INTO team_applications
      (season_id,competition_id,team_id,manager_player_id,kind,team_name,shirt_color,shorts_color,socks_color,revision,base_roster_batch_id,base_team_revision,created_at)
      VALUES (?,?,?,?,'roster_change',?,?,?,?,1,?,?,?)`,
    [t.season_id,competition.id,t.id,managerId,data.team_name,data.shirt_color,data.shorts_color,data.socks_color,batch?.id||null,t.revision,w.chinaSql()]);
    const before = {team_name:t.team_name,manager_player_id:t.manager_player_id,shirt_color:t.shirt_color,shorts_color:t.shorts_color,socks_color:t.socks_color,members:[]};
    for (const m of data.members) {
      const [[p]] = await w.sql(c,'SELECT id,name,student_id,college,gender FROM player_accounts WHERE id=? FOR SHARE',[m.player_id]);
      if (!p) throw rules.businessError('球员账号不存在',404);
      const [row] = await c.execute(`INSERT INTO team_application_members
        (application_id,player_id,jersey_number,is_captain,is_goalkeeper,is_foreign,is_sports_training,is_football_specialty,remark,profile_snapshot)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,[insert.insertId,p.id,m.jersey_number,...r.FLAGS.map(f=>Number(m[f])),m.remark,JSON.stringify(w.accountSnapshot(p))]);
      const old = current.find(v=>v.player_account_id===p.id);
      if (old) before.members.push({...old,id:row.insertId,player_id:p.id,is_captain:p.id===t.captain_player_id,profile_snapshot:{name:old.player_name}});
    }
    for (const old of current.filter(v=>!data.members.some(m=>m.player_id===v.player_account_id))) before.members.push({...old,id:-old.id,player_id:old.player_account_id,profile_snapshot:{name:old.player_name}});
    const a = await service.application(c,insert.insertId);
    await c.execute('UPDATE team_applications SET base_snapshot=? WHERE id=?',[JSON.stringify(before),a.id]);
    await require('./teamPublicationService').publish(c,a,user,{adminDirectEdit:true});
    const after = await service.application(c,a.id);
    await service.event(c,after,'admin_updated',user,before,'管理员直接修改球队，立即生效');
    await service.notify(c,[t.manager_player_id,t.captain_player_id,managerId,...current.map(p=>p.player_account_id),...data.members.map(p=>p.player_id)],
      `application:${a.id}:${after.revision}`,'team_admin_updated',`管理员已更新“${data.team_name}”球队资料及正式名单，立即生效。`,t.season_id,t.id);
    return detailIn(c,t.id,user);
  });
}
module.exports = { detail, lookup, update };
