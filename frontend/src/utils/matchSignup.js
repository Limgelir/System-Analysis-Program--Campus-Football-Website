import {rolesFor} from './officialRoles.js'
export const intentions=[{value:'main',label:'裁判员'},{value:'assistant',label:'助理裁判员'},{value:'fourth',label:'第四官员'},{value:'second',label:'第二裁判员'},{value:'timekeeper',label:'计时员'},{value:'supervisor',label:'裁判监督'}]
export const intentionText=values=>(values||[]).map(v=>intentions.find(i=>i.value===v)?.label||v).join('、')
export const roleText=value=>String(value||'').split(',').map(v=>({main:'裁判员',assistant1:'第一助理裁判员',assistant2:'第二助理裁判员',fourth:'第四官员',second:'第二裁判员',timekeeper:'计时员',supervisor:'裁判监督'})[v]||'').filter(Boolean).join('、')
export const venueText=item=>item.venue==='其它'?item.venue_detail:item.venue||'场地待定'

export const intentionsFor=schedule=>{const allowed=rolesFor(schedule).map(r=>r.code.startsWith('assistant')?'assistant':r.code);return intentions.filter(i=>allowed.includes(i.value))}
