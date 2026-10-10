const {createBusinessError}=require('./scheduleValidator');
const required=value=>value!==false&&value!==0;
function normalizeFourth(value,fallback=true) {
  if(value===undefined)return required(fallback);
  if(![true,false,0,1].includes(value))throw createBusinessError('是否需要第四官员必须为是或否');
  return required(value);
}
function fieldRoles(schedule) {return ['main','assistant1','assistant2',...(required(schedule.fourth_required)?['fourth']:[])];}
function roleRequired(schedule,role) {
  return role==='fourth'?required(schedule.fourth_required):role==='supervisor'?required(schedule.supervisor_required):true;
}
module.exports={required,normalizeFourth,fieldRoles,roleRequired};
