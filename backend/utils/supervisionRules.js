const {createBusinessError}=require('./scheduleValidator');
const required=value=>value!==false&&value!==0;
function normalize(value,fallback=true){
  if(value===undefined)return required(fallback);
  if(![true,false,0,1].includes(value))throw createBusinessError('是否需要裁判监督必须为是或否');
  return required(value);
}
function supervisorLocked(schedule={}){
  const report=schedule.report||schedule;
  return Boolean(report.supervisor_review_started_at||report.supervisor_review_submitted_at||
    ((report.supervisor_review_status||report.report_supervisor_status)&& (report.supervisor_review_status||report.report_supervisor_status)!=='draft')||schedule.supervisor_revision>0);
}
function fieldLocked(schedule={}){
  const report=schedule.report||schedule;
  return supervisorLocked(schedule)||Boolean(report.main_report_started_at||report.main_report_submitted_at||
    (report.main_report_status&&report.main_report_status!=='draft'));
}
module.exports={required,normalize,supervisorLocked,fieldLocked};
