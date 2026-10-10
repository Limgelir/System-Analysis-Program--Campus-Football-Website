const pool = require('../db');
const w = require('../utils/playerWorkflow');
const rules = require('../utils/playerRules');
const r = require('../utils/teamApplicationRules');
const rosters = require('./playerRosterService');
const settings = require('./playerSeasonSettingsService');
const transaction = work => w.transaction(work, { readCommitted: true });

async function team(c, id, user, write = false) {
  const [[base]] = await w.sql(c, 'SELECT * FROM team WHERE id=?', [rules.id(id)]);
  if (!base) throw rules.businessError('球队不存在', 404);
  if (write) { await w.season(c, base.season_id, { active: true }); await w.actor(c, user); }
  const [[t]] = await w.sql(c, `SELECT t.*,s.is_active,s.season_name,st.ended_at FROM team t JOIN seasons s ON s.id=t.season_id
    LEFT JOIN player_season_settings st ON st.season_id=s.id WHERE t.id=?${write ? ' FOR UPDATE' : ''}`, [base.id]);
  const manages = user.role === 'admin' || [t.manager_player_id, t.captain_player_id].includes(user.id);
  const batch = await rosters.effectiveBatch(t.id, undefined, c);
  const current = batch ? await rosters.roster(batch.id, { connection: c, rawTags: write, currentProfile: Boolean(t.is_active && !t.ended_at) }) : [];
  if (!manages && !current.some(p => p.player_account_id === user.id)) throw rules.businessError('只有本队当前成员或管理角色可以查看', 403);
  if (write && t.registration_revoked) throw rules.businessError('球队报名通过已撤销，请在报名时间内修改原报名申请并重新提交',409,'TEAM_REGISTRATION_REVOKED');
  if (write && !manages) throw rules.businessError('只有本队负责人或场上队长可以变更名单', 403);
  return { t, batch, current, manages };
}
async function assertNoOther(c, teamId, except = 0) {
  const [[open]] = await w.sql(c, "SELECT id FROM team_applications WHERE team_id=? AND kind='roster_change' AND status IN ('draft','pending','returned','auto_failed') AND id<>?", [teamId, except]);
  if (open) throw rules.businessError('已有进行中的名单变更，请先处理或撤回原申请', 409, 'ROSTER_CHANGE_EXISTS');
}
async function assertBase(c, a) {
  if (a.kind !== 'roster_change') return;
  const [[t]] = await w.sql(c, 'SELECT revision,registration_revoked FROM team WHERE id=? FOR UPDATE', [a.team_id]);
  const batch = await rosters.effectiveBatch(a.team_id, undefined, c);
  if (!t || t.registration_revoked || t.revision !== a.base_team_revision || (batch?.id??null) !== a.base_roster_batch_id) throw rules.businessError('正式名单、球队资料或角色已变化，请撤回本次变更并从最新名单重新建立申请', 409, 'ROSTER_BASE_CHANGED');
  await assertNoOther(c, a.team_id, a.id);
}
async function create(id, user, revision, key) {
  key = r.requestKey(key);
  return transaction(async c => {
    const { t, batch, current } = await team(c, id, user, true);
    const [[prior]] = await w.sql(c, 'SELECT id,team_id,kind FROM team_applications WHERE manager_player_id=? AND request_key=?', [t.manager_player_id,key]);
    const service = require('./playerTeamService');
    if (prior) { if (prior.team_id !== t.id || prior.kind !== 'roster_change') throw rules.businessError('提交标识已用于其他申请',409); return service.detailIn(c,prior.id,user); }
    w.expectRevision(t.revision, revision); await assertNoOther(c,t.id);
    const config = await settings.read(t.season_id,c), competition = config.competitions.find(v => v.league_type === t.league_type);
    if (!competition?.is_enabled || !competition.change_windows.some(v => Date.now() >= Date.parse(v.opens_at) && Date.now() < Date.parse(v.closes_at))) throw rules.businessError('当前不在本赛事名单修改窗口内',409,'ROSTER_WINDOW_CLOSED');
    if (!t.manager_player_id || !t.captain_player_id || !batch || current.some(p => !p.player_account_id)) throw rules.businessError('名单中仍有待关联身份，请先完成相关人员注册和当季学籍审核；也可由管理员直接导入新名单',409);
    const [insert] = await c.execute(`INSERT INTO team_applications
      (season_id,competition_id,team_id,manager_player_id,kind,team_name,shirt_color,shorts_color,socks_color,revision,base_roster_batch_id,base_team_revision,request_key,request_hash,created_at)
      VALUES (?,?,?,?,'roster_change',?,?,?,?,1,?,?,?,?,?)`,
    [t.season_id,competition.id,t.id,t.manager_player_id,t.team_name,t.shirt_color,t.shorts_color,t.socks_color,batch.id,t.revision,key,r.digest([t.id,t.revision]),w.chinaSql()]);
    for (const p of current) {
      const [[account]] = await w.sql(c,'SELECT id,name,student_id,college,gender FROM player_accounts WHERE id=? FOR SHARE',[p.player_account_id]);
      await c.execute(`INSERT INTO team_application_members
        (application_id,player_id,jersey_number,is_captain,is_goalkeeper,is_foreign,is_sports_training,is_football_specialty,remark,profile_snapshot)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,[insert.insertId,p.player_account_id,p.jersey_number,Number(p.player_account_id===t.captain_player_id),Number(p.is_goalkeeper||0),Number(p.is_foreign||0),Number(p.is_sports_training||0),Number(p.is_football_specialty||0),p.remark,JSON.stringify(w.accountSnapshot(account))]);
    }
    const a = await service.application(c,insert.insertId), snapshot = await service.snapshot(c,a);
    await c.execute('UPDATE team_applications SET base_snapshot=? WHERE id=?',[JSON.stringify(snapshot),a.id]);
    await service.event(c,a,'created',user,null);return service.detailIn(c,a.id,user);
  });
}
async function detail(id,user) {
  return transaction(async c => {
    const {t,batch,current,manages} = await team(c,id,user);
    const config = await settings.read(t.season_id,c), competition = config.competitions.find(v=>v.league_type===t.league_type);
    const [requests] = manages ? await w.sql(c,"SELECT id,kind,source_type,status,revision,submitted_at,reviewed_at,return_reason FROM team_applications WHERE team_id=? AND kind='roster_change' ORDER BY id DESC LIMIT 100",[t.id]) : [[]];
    const [[manager]] = t.manager_player_id ? await w.sql(c,'SELECT id,name,student_id FROM player_accounts WHERE id=?',[t.manager_player_id]) : await w.sql(c,'SELECT NULL AS id,name,student_id FROM imported_player_identities WHERE id=?',[t.manager_import_person_id]);
    const players = [];
    for (const p of current) {
      const [[a]] = p.player_account_id ? await w.sql(c,'SELECT student_id FROM player_accounts WHERE id=?',[p.player_account_id]) : [[]];
      players.push({...p,is_captain:p.player_account_id?p.player_account_id===t.captain_player_id:Boolean(p.is_captain),student_id:manages||p.player_account_id===user.id?a?.student_id:undefined});
    }
    return {team:{id:t.id,registration_revoked:Boolean(t.registration_revoked),season_id:t.season_id,season_name:t.season_name,team_name:t.team_name,league_type:t.league_type,revision:t.revision,shirt_color:t.shirt_color,shorts_color:t.shorts_color,socks_color:t.socks_color},manager:manager?{id:manager.id,name:manager.name,student_id:manages?manager.student_id:undefined}:null,batch,players,requests,
      can_manage:manages,can_create:manages&&!t.registration_revoked&&Boolean(t.is_active&&!t.ended_at&&competition?.is_enabled&&competition.change_windows.some(v=>Date.now()>=Date.parse(v.opens_at)&&Date.now()<Date.parse(v.closes_at)))&&!requests.some(v=>['draft','pending','returned','auto_failed'].includes(v.status)),change_windows:competition?.change_windows||[]};
  });
}
async function list(user) {
  const [items] = await w.sql(pool,`SELECT DISTINCT t.id,t.team_name,t.league_type,s.season_name,t.manager_player_id,t.captain_player_id FROM team t JOIN seasons s ON s.id=t.season_id
    LEFT JOIN team_player p ON p.team_id=t.id AND p.roster_batch_id=(SELECT b.id FROM team_roster_batches b WHERE b.team_id=t.id AND (b.effective_from<=? OR b.effective_from IS NULL) ORDER BY b.effective_from DESC,b.version_no DESC,b.id DESC LIMIT 1)
    WHERE t.registration_revoked=0 AND s.is_active=1 AND (? IN (t.manager_player_id,t.captain_player_id) OR p.player_account_id=?) ORDER BY t.league_type,t.team_name`,[require('../utils/competitionTime').businessDate(),user.id,user.id]);
  return items.map(({manager_player_id,captain_player_id,...t})=>({...t,can_manage:[manager_player_id,captain_player_id].includes(user.id)}));
}
module.exports={team,assertBase,assertNoOther,create,detail,list};
