const pool=require('../db');
const {resolveSeasonScope}=require('../utils/seasonScope');
const {choice}=require('../utils/listQuery');
const {json,windowEnd}=require('../utils/matchSignup');
const {hydrate}=require('../utils/officialAssignments');
async function list(options={}){
  const view=choice(options.view,['week','all'],'选派范围')||'week';
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const scope=await resolveSeasonScope(c,view==='week'?undefined:options.season_id);
    const [[clock]]=await c.query("SELECT DATE_FORMAT(UTC_TIMESTAMP()+INTERVAL 8 HOUR,'%Y-%m-%d %H:%i:%s') now");
    const range={from:clock.now.slice(0,10),to:windowEnd(clock.now.slice(0,10))};
    if(!scope.selected_season){await c.commit();return {...scope,groups:[],window:range};}
    const where=view==='week'?`AND ps.ended_at IS NULL AND s.match_date BETWEEN ? AND ? AND s.match_time IS NOT NULL AND TIMESTAMP(s.match_date,s.match_time)>?`:'';
    const params=[scope.selected_season.id,...(view==='week'?[range.from,range.to,clock.now]:[])];
    const [rows]=await c.query(`SELECT s.*,co.id competition_id,se.season_name,se.season_code,se.is_active season_is_active,
      mr.id report_id,mr.main_report_status report_main_status,mr.supervisor_review_status report_supervisor_status,
      mr.main_report_started_at,mr.supervisor_review_started_at,mr.main_report_submitted_at,mr.supervisor_review_submitted_at
      FROM match_schedules s JOIN seasons se ON se.id=s.season_id
      LEFT JOIN player_season_settings ps ON ps.season_id=s.season_id
      LEFT JOIN season_competitions co ON co.season_id=s.season_id AND co.league_type=s.match_type
      LEFT JOIN match_reports mr ON mr.schedule_id=s.id
      WHERE s.season_id=? ${where} ORDER BY co.id,s.match_type,s.match_date,s.match_time,s.field_order_sort,s.field_order,s.id`,params);
    await hydrate(c,rows);
    const [signups]=await c.query(`SELECT ms.schedule_id,ms.referee_id,ms.intentions,ms.match_date_snapshot,TIME_FORMAT(ms.match_time_snapshot,'%H:%i') match_time_snapshot,ms.venue_snapshot,ms.venue_detail_snapshot,
      r.name,r.student_id,r.is_active referee_active,rs.status registration_status,m.team_ids,m.revision membership_revision
      FROM referee_match_signups ms JOIN match_schedules s ON s.id=ms.schedule_id JOIN referee r ON r.id=ms.referee_id
      LEFT JOIN referee_season_registrations rs ON rs.referee_id=r.id AND rs.season_id=s.season_id
      LEFT JOIN season_competitions co ON co.season_id=s.season_id AND co.league_type=s.match_type
      LEFT JOIN referee_competition_memberships m ON m.competition_id=co.id AND m.referee_id=r.id
      WHERE s.season_id=? AND ms.status='active' ORDER BY r.name,r.id`,[scope.selected_season.id]);
    const [teams]=await c.execute('SELECT id,team_name FROM team WHERE season_id=?',[scope.selected_season.id]);
    const teamMap=new Map(teams.map(t=>[t.id,t.team_name])),groups=new Map();
    const schedules=new Map(rows.map(row=>[row.id,require('./scheduleService').normalizeScheduleRecord(row)]));
    for(const row of rows){
      if(!groups.has(row.match_type))groups.set(row.match_type,{competition_id:row.competition_id,match_type:row.match_type,days:[]});
      const group=groups.get(row.match_type);
      let day=group.days.find(d=>d.match_date===row.match_date);
      if(!day){day={match_date:row.match_date,registrants:[],matches:[]};group.days.push(day);}
      day.matches.push(schedules.get(row.id));
    }
    for(const signup of signups){
      const match=schedules.get(signup.schedule_id);if(!match)continue;
      const day=groups.get(match.match_type).days.find(d=>d.match_date===match.match_date);
      let ref=day.registrants.find(r=>r.id===signup.referee_id);
      if(!ref){ref={id:signup.referee_id,name:signup.name,student_id:signup.student_id,eligible:Boolean(signup.referee_active&&signup.registration_status==='approved'),membership_confirmed:Boolean(signup.membership_revision),teams:(json(signup.team_ids)||[]).map(id=>({id,team_name:teamMap.get(id)||'已移除队伍 #'+id})),matches:[],intentions:[]};day.registrants.push(ref);}
      const intentions=json(signup.intentions)||[];
      ref.matches.push({id:match.id,field_order:match.field_order,team_a:match.team_a_name_snapshot,team_b:match.team_b_name_snapshot,intentions,
        changed:match.match_date!==signup.match_date_snapshot||match.match_time!==signup.match_time_snapshot||match.venue!==signup.venue_snapshot||match.venue_detail!==signup.venue_detail_snapshot});
      for(const value of intentions)if(!ref.intentions.includes(value))ref.intentions.push(value);
    }
    await c.commit();return {...scope,groups:[...groups.values()],window:range,server_time:clock.now};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}
module.exports={list};
