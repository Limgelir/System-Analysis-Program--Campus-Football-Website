const w=require('../utils/playerWorkflow');
const rules=require('../utils/playerRules');

// Only a reviewed, matching identity can acquire account or team permissions.
async function inspect(c,seasonId,studentId,name){
  studentId=rules.studentId(studentId);name=rules.requiredText(name,'姓名',100);
  const [[p]]=await w.sql(c,`SELECT p.id,p.student_id,p.name,p.college,p.revision,p.is_active,
    g.id AS registration_id,g.status AS qualification_status,g.revision AS qualification_revision,g.review_profile_snapshot
    FROM player_accounts p LEFT JOIN player_season_registrations g ON g.player_id=p.id AND g.season_id=?
    WHERE p.student_id=? FOR SHARE`,[seasonId,studentId]);
  const reviewed=p?.review_profile_snapshot;
  const matched=Boolean(p?.is_active&&p.student_id===studentId&&p.name===name&&p.qualification_status==='approved'&&reviewed?.student_id===studentId&&reviewed?.name===name);
  return {id:matched?p.id:null,student_id:studentId,name,college:matched?p.college:null,
    account_revision:p?.revision||null,account_active:Boolean(p?.is_active),qualification_status:p?.qualification_status||null,
    qualification_revision:p?.qualification_revision||null,registration_id:p?.registration_id||null,
    link_status:matched?'linked':!p?'unregistered':!p.is_active?'disabled':p.student_id!==studentId||p.name!==name?'identity_mismatch':'awaiting_approval'};
}
async function ensure(c,seasonId,person,user){
  await c.execute(`INSERT INTO imported_player_identities (season_id,student_id,name,created_by_admin_id,created_at)
    VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,[seasonId,person.student_id,person.name,user.id,w.chinaSql()]);
  const [[row]]=await w.sql(c,'SELECT * FROM imported_player_identities WHERE season_id=? AND student_id=? AND name=? FOR UPDATE',[seasonId,person.student_id,person.name]);
  if(row.player_id&&row.player_id!==person.id)throw rules.businessError('该导入身份已关联账号，但当前资料或资格发生变化，请先核对账号及当季学籍',409);
  if(!row.player_id&&person.id)await link(c,person.id,seasonId,person.registration_id,user);
  const [[saved]]=await w.sql(c,'SELECT * FROM imported_player_identities WHERE id=?',[row.id]);
  if(person.id!==saved.player_id)throw rules.businessError('该身份与已有名单中的账号关联冲突，请先核对名单',409);
  return saved;
}
async function link(c,playerId,seasonId,registrationId,user){
  const [[account]]=await w.sql(c,'SELECT id,student_id,name FROM player_accounts WHERE id=?',[playerId]);
  const person=await inspect(c,seasonId,account.student_id,account.name);
  if(person.id!==playerId||person.registration_id!==registrationId)return;
  const [identities]=await w.sql(c,'SELECT * FROM imported_player_identities WHERE season_id=? AND student_id=? AND name=? AND player_id IS NULL FOR UPDATE',[seasonId,account.student_id,account.name]);
  const service=require('./playerTeamService');
  for(const identity of identities){
    // A previously used account alias must not create two copies in one roster.
    const [[duplicate]]=await c.execute(`SELECT 1 FROM team_player pending JOIN team_player existing
      ON existing.roster_batch_id=pending.roster_batch_id AND existing.player_account_id=? AND existing.id<>pending.id
      WHERE pending.import_person_id=? LIMIT 1`,[playerId,identity.id]);
    if(duplicate)continue;
    const [applications]=await c.execute(`SELECT DISTINCT a.id FROM team_applications a LEFT JOIN team_application_members m ON m.application_id=a.id
      WHERE a.manager_import_person_id=? OR m.import_person_id=? ORDER BY a.id`,[identity.id,identity.id]);
    const before=new Map();for(const {id}of applications)before.set(id,await service.snapshot(c,await service.application(c,id)));
    await c.execute('UPDATE imported_player_identities SET player_id=?,linked_registration_id=?,linked_by_admin_id=?,linked_at=? WHERE id=?',[playerId,registrationId,user.id,w.chinaSql(),identity.id]);
    await c.execute('UPDATE team_applications SET manager_player_id=? WHERE manager_import_person_id=? AND manager_player_id IS NULL',[playerId,identity.id]);
    await c.execute('UPDATE team_application_members SET player_id=? WHERE import_person_id=? AND player_id IS NULL',[playerId,identity.id]);
    await c.execute('UPDATE team_player SET player_account_id=? WHERE import_person_id=? AND player_account_id IS NULL',[playerId,identity.id]);
    const [teams]=await c.execute(`SELECT DISTINCT t.id,t.team_name FROM team t LEFT JOIN team_player p ON p.team_id=t.id
      WHERE t.manager_import_person_id=? OR p.import_person_id=? ORDER BY t.id`,[identity.id,identity.id]);
    for(const team of teams){
      const batch=await require('./playerRosterService').effectiveBatch(team.id,undefined,c);
      const [[captain]]=batch?await c.execute('SELECT id FROM team_player WHERE roster_batch_id=? AND import_person_id=? AND is_captain=1',[batch.id,identity.id]):[[]];
      await c.execute(`UPDATE team SET manager_player_id=IF(manager_import_person_id=? AND manager_player_id IS NULL,?,manager_player_id),
        captain_player_id=IF(? AND captain_player_id IS NULL,?,captain_player_id),revision=revision+1 WHERE id=?`,[identity.id,playerId,Boolean(captain),playerId,team.id]);
      await service.notify(c,[playerId],`import-link:${identity.id}:${team.id}`,'team_identity_linked',`你已通过当季学籍审核，并关联“${team.team_name}”中管理员录入的身份。`,seasonId,team.id);
    }
    for(const {id}of applications){
      await c.execute('UPDATE team_applications SET revision=revision+1 WHERE id=?',[id]);
      await service.event(c,await service.application(c,id),'identity_linked',user,before.get(id),'学号、姓名一致且当季学籍审核通过，关联原导入身份');
    }
  }
}
module.exports={inspect,ensure,link};
