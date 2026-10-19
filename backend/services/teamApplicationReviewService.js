const pool=require('../db');
const rules=require('../utils/playerRules');
const w=require('../utils/playerWorkflow');
const transaction=work=>w.transaction(work,{readCommitted:true});
const r=require('../utils/teamApplicationRules');
const service=require('./playerTeamService');
const query=require('../utils/listQuery');
const {businessDate}=require('../utils/competitionTime');

async function review(id,user,operation,body,revision){
  const override=operation==='override-approve';
  rules.onlyKeys(body,operation!=='return'?['reason','review_token']:['reason','replaceable_member_ids','member_comments','review_token']);
  const reason=r.text(body.reason,override?'人工通过原因':operation==='approve'?'审核说明':'退回理由',500,operation==='approve');
  return transaction(async c=>{
    const a=await service.lock(c,id,user);w.expectRevision(a.revision,revision);
    if(!['initial','roster_change'].includes(a.kind)||!service.writable(a)||!(override?['auto_failed',...(a.auto_review?.manual_requested?['pending']:[])]:operation==='return'?['pending','auto_failed']:['pending']).includes(a.status))throw rules.businessError('当前申请不可审核或已经处理，请刷新',409,'TEAM_REVIEW_STATE');
    const rows=await service.members(c,id,true),context=await service.reviewContext(c,a,rows);
    if(body.review_token!==context.token)throw rules.businessError('球员资料、学籍资格、参队数量或赛事规则已变化，请刷新核对再审核',409,'TEAM_REVIEW_CHANGED');
    const before=await service.snapshot(c,a),now=w.chinaSql();
    if(operation==='return'){
      const undo=await require('./teamOperationUndoService').capture(c,a,'returned');
      if(!Array.isArray(body.replaceable_member_ids)||!body.member_comments||typeof body.member_comments!=='object'||Array.isArray(body.member_comments))throw rules.businessError('请核对可替换球员和逐人说明');
      const ids=body.replaceable_member_ids.map(rules.id);if(new Set(ids).size!==ids.length||ids.some(id=>!rows.some(m=>m.id===id)))throw rules.businessError('只能指定本申请名单中的球员');
      const comments={};for(const [id,value]of Object.entries(body.member_comments)){if(!rows.some(m=>String(m.id)===id))throw rules.businessError('逐人说明不属于本申请');const text=r.text(value,'球员说明',500,true);if(text)comments[id]=text;}
      await c.execute("UPDATE team_applications SET status='returned',revision=revision+1,return_reason=?,return_snapshot=?,member_comments=?,reviewed_by_admin_id=?,reviewed_at=? WHERE id=?",[reason,JSON.stringify(before),JSON.stringify(comments),user.id,now,id]);
      const after=await service.application(c,id);await service.event(c,after,'returned',user,before,reason);
      for(const memberId of ids)await c.execute('INSERT INTO team_return_replacements (application_id,return_revision,member_id) VALUES (?,?,?)',[id,after.revision,memberId]);
      await require('./teamOperationUndoService').store(c,id,undo);
      await service.notify(c,[a.manager_player_id,rows.find(m=>m.is_captain)?.player_id],`application:${id}:${after.revision}`,'team_returned',`“${a.team_name}”${a.league_type}报名已退回：${reason}`,a.season_id);
    }else{
      const {autoReview}=await service.checkSubmission(c,a);
      if(!autoReview.passed&&!override)return service.recordAutoFailure(c,a,user,autoReview);
      if(override)autoReview.override={reason,admin_id:user.id,approved_at:w.chinaIso(now),failed_review:a.auto_review};
      await c.execute('UPDATE team_applications SET auto_review=? WHERE id=?',[JSON.stringify(autoReview),a.id]);
      const {teamId,previousPlayerIds}=await require('./teamPublicationService').publish(c,a,user,{automaticOverride:override});
      const after=await service.application(c,id);await service.event(c,after,'approved',user,before,reason);
      await service.notify(c,[a.manager_player_id,...rows.map(m=>m.player_id),...previousPlayerIds],`application:${id}:${after.revision}`,'team_approved',`${a.season_name}·${a.league_type}“${a.team_name}”正式名单已通过审核并立即生效。`,a.season_id,teamId);
    }
    return service.detailIn(c,id,user);
  });
}
async function list(q,user){
  const {page,pageSize}=query.pagination(q),status=query.choice(q.status,['draft','pending','returned','withdrawn','approved','auto_failed','revoked'],'申请状态'),league=query.text(q.league_type,'赛事',50),search=query.text(q.q,'队名');
  const seasonId=q.season_id?rules.id(q.season_id):(await w.sql(pool,'SELECT id FROM seasons WHERE is_active=1 LIMIT 1'))[0][0]?.id;
  if(!seasonId)return {season:null,items:[],pagination:query.pageMeta(page,pageSize,0)};
  const [[season]]=await w.sql(pool,'SELECT id,season_name,is_active FROM seasons WHERE id=?',[seasonId]);if(!season)throw rules.businessError('赛季不存在',404);
  const where=["a.season_id=? AND a.kind IN ('initial','roster_change')"],args=[seasonId];if(status){where.push('a.status=?');args.push(status);}if(league){where.push('c.league_type=?');args.push(league);}if(search){where.push("a.team_name LIKE ? ESCAPE '!'");args.push(query.like(search));}
  if(user.role!=='admin'){where.push(`(a.manager_player_id=? AND (a.team_id IS NULL OR a.kind='initial' AND EXISTS (SELECT 1 FROM team t WHERE t.id=a.team_id AND t.registration_revoked=1)) OR EXISTS (SELECT 1 FROM team t WHERE t.id=a.team_id AND NOT(a.kind='initial' AND t.registration_revoked=1) AND ? IN (t.manager_player_id,t.captain_player_id)) OR EXISTS (SELECT 1 FROM team_application_members m WHERE m.application_id=a.id AND m.player_id=? AND m.is_removed=0))`);args.push(user.id,user.id,user.id);}
  const from=`FROM team_applications a JOIN season_competitions c ON c.id=a.competition_id WHERE ${where.join(' AND ')}`;
  const [[count]]=await w.sql(pool,`SELECT COUNT(*) AS n ${from}`,args);
  const [items]=await pool.query({sql:`SELECT a.id,a.kind,a.source_type,(SELECT t.registration_revoked FROM team t WHERE t.id=a.team_id) AS registration_revoked,a.team_id,a.team_name,a.status,a.revision,a.auto_review,a.submitted_at,a.created_at,c.league_type,c.enable_sports_training,c.enable_football_specialty,a.manager_player_id,
    (SELECT m.player_id FROM team_application_members m WHERE m.application_id=a.id AND m.is_captain=1 AND m.is_removed=0) AS captain_player_id,
    (SELECT COUNT(*) FROM team_application_members m WHERE m.application_id=a.id AND m.is_removed=0) AS member_count,
    (SELECT t.manager_player_id FROM team t WHERE t.id=a.team_id) AS current_manager_id,
    (SELECT t.captain_player_id FROM team t WHERE t.id=a.team_id) AS current_captain_id ${from} ORDER BY a.id DESC LIMIT ? OFFSET ?`,dateStrings:true},[...args,pageSize,(page-1)*pageSize]);
  return {season,items:items.map(v=>({id:v.id,kind:v.kind,source_type:v.source_type,team_id:v.team_id,team_name:v.team_name,status:v.status,revision:v.revision,auto_review:user.role==='admin'?require('../utils/teamTags').present(v,v.auto_review):undefined,league_type:v.league_type,member_count:Number(v.member_count),submitted_at:w.chinaIso(v.submitted_at),created_at:w.chinaIso(v.created_at),can_manage:user.role==='player'&&(v.team_id&&!(v.kind==='initial'&&v.registration_revoked)?[v.current_manager_id,v.current_captain_id]:[v.manager_player_id,v.captain_player_id]).includes(user.id)})),pagination:query.pageMeta(page,pageSize,Number(count.n))};
}
module.exports={review,list};
