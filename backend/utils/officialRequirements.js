const {createBusinessError}=require('./scheduleValidator');
const required=value=>value!==false&&value!==0;
function normalizeFourth(value,fallback=true) {
  if(value===undefined)return required(fallback);
  if(![true,false,0,1].includes(value))throw createBusinessError('是否需要第四官员必须为是或否');
  return required(value);
}
function isFutsal(schedule={}) { return schedule.futsal===true || schedule.futsal===1; }
function normalizeFutsal(value,fallback=false) {
  if(value===undefined)return isFutsal({futsal:fallback});
  if(![true,false,0,1].includes(value))throw createBusinessError('是否采用五人制裁判安排必须为是或否');
  return isFutsal({futsal:value});
}
function fieldRoles(schedule) {return isFutsal(schedule)?['main','second','timekeeper']:['main','assistant1','assistant2',...(required(schedule.fourth_required)?['fourth']:[])];}
function roleRequired(schedule,role) {
  return role==='supervisor'?required(schedule.supervisor_required):fieldRoles(schedule).includes(role);
}
function signupIntentions(schedule) {return [...new Set(fieldRoles(schedule).map(r=>r.startsWith('assistant')?'assistant':r)),...(required(schedule.supervisor_required)?['supervisor']:[])];}
module.exports={required,normalizeFourth,fieldRoles,roleRequired,isFutsal,normalizeFutsal,signupIntentions};
