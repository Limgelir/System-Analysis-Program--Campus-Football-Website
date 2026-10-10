const w = require('../utils/playerWorkflow');
const rules = require('../utils/playerRules');
const r = require('../utils/teamApplicationRules');
const { businessDate } = require('../utils/competitionTime');

async function publish(c, a, user, {automaticOverride=false}={}) {
  const service = require('./playerTeamService');
  const {rows,autoReview} = await service.checkSubmission(c,a);
  if(!autoReview.passed&&!(automaticOverride&&user.role==='admin'&&(a.status==='auto_failed'||a.status==='pending'&&a.auto_review?.manual_requested)))throw rules.businessError('自动审核未通过，不能发布正式名单',409,'TEAM_AUTO_REVIEW_FAILED');
  let teamId = a.team_id;
  const previousBatch=teamId?await require('./playerRosterService').effectiveBatch(teamId,undefined,c):null;
  const previousPlayerIds=previousBatch?(await require('./playerRosterService').roster(previousBatch.id,{connection:c})).map(m=>m.player_account_id).filter(Boolean):[];
  const metadata = {team_name:a.team_name,manager_player_id:a.manager_player_id,captain_player_id:rows.find(m=>m.is_captain).player_id,shirt_color:a.shirt_color,shorts_color:a.shorts_color,socks_color:a.socks_color,manager_import_person_id:a.manager_import_person_id||null};
  const values = Object.values(metadata), now = w.chinaSql();
  try {
    if (teamId) {
      await require('./matchRosterService').preserveTeamMatches(c,teamId);
      await c.execute('UPDATE team SET team_name=?,manager_player_id=?,captain_player_id=?,shirt_color=?,shorts_color=?,socks_color=?,manager_import_person_id=?,registration_revoked=0,revision=revision+1 WHERE id=?',[...values,teamId]);
    } else {
      const [insert] = await c.execute('INSERT INTO team (season_id,league_type,team_name,manager_player_id,captain_player_id,shirt_color,shorts_color,socks_color,manager_import_person_id,revision) VALUES (?,?,?,?,?,?,?,?,?,1)',[a.season_id,a.league_type,...values]);
      teamId=insert.insertId;
    }
  } catch(e) {if(e.code==='ER_DUP_ENTRY')throw rules.businessError('本赛季该赛事已有同名正式球队，请修改队名',409,'TEAM_NAME_TAKEN');throw e;}
  const [[version]] = await c.execute('SELECT COALESCE(MAX(version_no),0)+1 AS n FROM team_roster_batches WHERE team_id=?',[teamId]);
  const [batch] = await c.execute('INSERT INTO team_roster_batches (team_id,season_id,version_no,source_type,application_id,application_revision,effective_from,approved_at,metadata_snapshot) VALUES (?,?,?,?,?,?,?,?,?)',[teamId,a.season_id,version.n,a.source_type||'online',a.id,a.revision+1,businessDate(),now,JSON.stringify(metadata)]);
  for(const m of rows) await c.execute('INSERT INTO team_player (roster_batch_id,team_id,player_account_id,import_person_id,jersey_number,player_name,is_captain,is_goalkeeper,is_foreign,is_sports_training,is_football_specialty,remark,profile_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[batch.insertId,teamId,m.player_id,m.import_person_id||null,m.jersey_number,m.name,...r.FLAGS.map(f=>Number(m[f])),m.remark,JSON.stringify({id:m.player_id,student_id:m.student_id,name:m.name,college:m.college,gender:m.gender||null})]);
  await c.execute("UPDATE team_application_members m JOIN player_accounts p ON p.id=m.player_id SET m.profile_snapshot=JSON_OBJECT('id',p.id,'student_id',p.student_id,'name',p.name,'college',p.college,'gender',p.gender) WHERE m.application_id=? AND m.is_removed=0",[a.id]);
  await c.execute("UPDATE team_applications SET status='approved',team_id=?,revision=revision+1,effective_from=?,reviewed_at=?,reviewed_by_admin_id=? WHERE id=?",[teamId,businessDate(),now,user.id,a.id]);
  return {teamId,batchId:batch.insertId,previousPlayerIds};
}
module.exports={publish};
