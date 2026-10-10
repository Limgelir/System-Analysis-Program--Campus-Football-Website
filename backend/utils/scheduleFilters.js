const q=require('./listQuery');
const hasExternal="EXISTS (SELECT 1 FROM match_official_assignments oa WHERE oa.schedule_id=s.id AND oa.source_type='external')";
const proxy="EXISTS (SELECT 1 FROM match_official_assignments oa WHERE oa.schedule_id=s.id AND oa.role IN ('main','supervisor') AND oa.source_type='external')";
const attention=`((SELECT COUNT(*) FROM match_official_assignments oa WHERE oa.schedule_id=s.id)<>(3+s.fourth_required+s.supervisor_required) OR EXISTS (
  SELECT 1 FROM match_official_assignments oa
  LEFT JOIN referee r ON r.id=oa.referee_id
  LEFT JOIN referee_season_registrations rs ON rs.referee_id=oa.referee_id AND rs.season_id=s.season_id
  LEFT JOIN external_referees er ON er.id=oa.external_referee_id
  WHERE oa.schedule_id=s.id AND ((oa.source_type='system' AND (r.id IS NULL OR r.is_active=0 OR rs.id IS NULL OR rs.status<>'approved'))
    OR (oa.source_type='external' AND (er.id IS NULL OR er.is_active=0)))))`;
const upcoming="s.match_date>=DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR) AND s.match_date<DATE_ADD(DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR),INTERVAL 7 DAY)";
const statuses={main_pending:"COALESCE(mr.main_report_status,'draft')<>'submitted'",supervisor_pending:"s.supervisor_required=1 AND COALESCE(mr.supervisor_review_status,'draft')<>'submitted'",submitted:"mr.main_report_status='submitted' AND (s.supervisor_required=0 OR mr.supervisor_review_status='submitted')",returned:"(mr.main_report_status='returned' OR mr.supervisor_review_status='returned')",proxy,proxy_pending:`EXISTS (SELECT 1 FROM match_official_assignments oa WHERE oa.schedule_id=s.id AND oa.source_type='external' AND ((oa.role='main' AND COALESCE(mr.main_report_status,'draft')<>'submitted') OR (oa.role='supervisor' AND s.supervisor_required=1 AND COALESCE(mr.supervisor_review_status,'draft')<>'submitted')))`,attention:`${upcoming} AND ${attention}`};
function filters(options,seasonId) {
  const where=['s.season_id=?'],params=[seasonId];
  const matchType=q.text(options.matchType??options.match_type,'比赛类型',50);
  const source=q.choice(options.source_type,['system','external','mixed'],'岗位来源');
  const status=q.choice(options.report_status,Object.keys(statuses),'报告状态');
  const from=q.date(options.date_from,'开始日期'),to=q.date(options.date_to,'结束日期');
  if(from&&to&&from>to)throw q.invalid('开始日期不能晚于结束日期');
  if(matchType){where.push('s.match_type=?');params.push(matchType);}
  if(from){where.push('s.match_date>=?');params.push(from);}
  if(to){where.push('s.match_date<=?');params.push(to);}
  if(source==='external')where.push(hasExternal);
  if(source==='system')where.push(`NOT ${hasExternal} AND EXISTS (SELECT 1 FROM match_official_assignments oa WHERE oa.schedule_id=s.id)`);
  if(source==='mixed')where.push(`${hasExternal} AND EXISTS (SELECT 1 FROM match_official_assignments oa WHERE oa.schedule_id=s.id AND oa.source_type='system')`);
  if(status)where.push(`(${statuses[status]})`);
  return {where:'WHERE '+where.join(' AND '),params};
}
module.exports={filters,statuses,attention,upcoming};
