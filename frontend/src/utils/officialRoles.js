export const officialRoles = [
  {code:'main',field:'main_referee_id',name:'main_referee_name',label:'裁判员'},
  {code:'assistant1',field:'assistant1_id',name:'assistant1_name',label:'第一助理裁判员'},
  {code:'assistant2',field:'assistant2_id',name:'assistant2_name',label:'第二助理裁判员'},
  {code:'fourth',field:'fourth_official_id',name:'fourth_official_name',label:'第四官员'},
  {code:'second',field:'second_referee_id',name:'second_referee_name',label:'第二裁判员'},
  {code:'timekeeper',field:'timekeeper_id',name:'timekeeper_name',label:'计时员'},
  {code:'supervisor',field:'supervisor_id',name:'supervisor_name',label:'裁判监督'}
]
export const isFutsal = schedule => schedule?.futsal === true || schedule?.futsal === 1
export function rolesFor(schedule) {
  const codes=isFutsal(schedule)?['main','second','timekeeper']:['main','assistant1','assistant2',...(schedule?.fourth_required===false||schedule?.fourth_required===0?[]:['fourth'])]
  if(schedule?.supervisor_required!==false&&schedule?.supervisor_required!==0)codes.push('supervisor')
  return officialRoles.filter(r=>codes.includes(r.code))
}
export const formatChangeMessage='切换裁判安排类型将保留仍适用的岗位，清空不适用的选派及报名意向；意向全部失效的报名将自动撤回并保留历史。确认切换并保存吗？'
