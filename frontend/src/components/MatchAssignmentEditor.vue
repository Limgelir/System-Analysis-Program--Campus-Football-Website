<template>
  <section class="assignment" :id="'match-'+schedule.id" :data-schedule-id="schedule.id">
    <header><div><h4>场序 {{schedule.field_order}} · {{schedule.team_a_name_snapshot}} VS {{schedule.team_b_name_snapshot}}</h4><p>{{schedule.futsal?'五人制':'普通'}} · {{displayMatchTime(schedule.match_time,schedule.match_end_time)}} · {{venueText(schedule)}}</p></div><span class="status" :class="{complete:schedule.is_assignment_complete}">{{schedule.is_assignment_complete?'已完成选派':'待选派：'+schedule.pending_assignment_roles.join('、')}}</span></header>
    <form v-draft="{value:form,resetKey:schedule.schedule_revision}" @submit.prevent="save">
      <div class="requirements"><label><input v-model="form.futsal" type="checkbox" :disabled="busy">五人制裁判安排</label><label v-if="!form.futsal"><input v-model="form.fourth_required" type="checkbox" :disabled="busy" @change="form.fourth_official_id=form.fourth_required?form.fourth_official_id:''">本场需要第四官员</label><label><input v-model="form.supervisor_required" type="checkbox" :disabled="busy" @change="form.supervisor_id=form.supervisor_required?form.supervisor_id:''">本场需要裁判监督</label></div>
      <div class="role-grid"><div v-for="role in visibleRoles" :key="role.code"><label>{{role.label}}</label><SearchableRefereeSelect v-model="form[role.field]" :role-field="role.field" :role-label="role.label" :season-id="schedule.season_id" :schedule-id="schedule.id" :excluded-ids="excluded(role)" :current-option="current(role)" :disabled="busy" /></div></div>
      <p class="hint">可选派已报名、未报名或非系统裁判员。{{form.futsal?'裁判员、第二裁判员、计时员须为三名不同人员，裁判监督可兼任任一岗位。':'裁判员可兼任第四官员，裁判监督可兼任场上岗位。'}}报告开始或提交后仍可调整选派；受影响人员的数据和评分保留到历史，已提交的相关分区自动退回待填写。</p>
      <aside v-if="warnings.length" class="assignment-warnings" role="status"><strong>比赛时间重合提醒（仍可保存）</strong><ul><li v-for="item in warnings" :key="item.schedule_id+':'+item.source_type+':'+(item.referee_id||item.external_referee_id)+':'+item.role">{{item.message}}</li></ul></aside>
      <p v-if="warningError" class="hint" role="status">{{warningError}}</p>
      <p v-if="error" class="error" role="alert">{{error}}</p><p v-if="message" role="status">{{message}}</p>
      <div class="actions"><button class="primary" :disabled="busy">{{busy?'保存中…':'保存选派'}}</button><button type="button" :disabled="busy" @click="refresh">重新读取当前选派</button><RouterLink :to="'/admin-schedule/'+schedule.id">赛程详情与报告</RouterLink></div>
      <details><summary>查看本场报名明细与历史</summary><AdminMatchSignups :schedule-id="schedule.id" /></details>
    </form>
  </section>
</template>
<script setup>
import {displayMatchTime} from '../utils/matchTime.js'
import {ref,computed,watch,onBeforeUnmount} from 'vue'
import {officialRoles,rolesFor,formatChangeMessage} from '../utils/officialRoles.js'
import {scheduleAPI} from '../api/index.js'
import {venueText} from '../utils/matchSignup.js'
import SearchableRefereeSelect from './SearchableRefereeSelect.vue'
import AdminMatchSignups from './AdminMatchSignups.vue'
const props=defineProps({schedule:Object,warningRevision:Number}),emit=defineEmits(['updated'])
const roles=officialRoles
const form=ref({}),busy=ref(false),error=ref(''),message=ref('')
const warnings=ref([]),warningError=ref('')
let warningTimer,warningSequence=0
const warningPayload=computed(()=>Object.fromEntries(visibleRoles.value.map(r=>[r.field,form.value[r.field]||null])))
function scheduleWarnings(){
  clearTimeout(warningTimer);const sequence=++warningSequence;warnings.value=[];warningError.value=''
  const payload={...warningPayload.value},id=props.schedule.id
  if(!Object.values(payload).some(Boolean))return
  warningTimer=setTimeout(async()=>{
    try{const r=await scheduleAPI.assignmentWarnings(id,payload);if(sequence===warningSequence)warnings.value=r.data||[]}
    catch{if(sequence===warningSequence)warningError.value='暂时无法读取时间重合提醒，仍可保存选派。'}
  },250)
}
onBeforeUnmount(()=>{clearTimeout(warningTimer);warningSequence++})
const visibleRoles=computed(()=>rolesFor(form.value))
function reset(){form.value={futsal:Boolean(props.schedule.futsal),schedule_revision:props.schedule.schedule_revision,fourth_required:props.schedule.fourth_required,supervisor_required:props.schedule.supervisor_required,...Object.fromEntries(roles.map(r=>[r.field,props.schedule[r.field+'_selection']||'']))}}
function excluded(role){return role.code==='supervisor'?[]:visibleRoles.value.filter(r=>r.code!=='supervisor'&&r.code!==role.code&&!(role.code==='main'&&r.code==='fourth')&&!(role.code==='fourth'&&r.code==='main')).map(r=>form.value[r.field]).filter(Boolean)}
function current(role){const a=props.schedule.officials.find(a=>a.role===role.code);return a?{id:a.source_type+':'+(a.referee_id||a.external_referee_id),name:a.name_snapshot,source_type:a.source_type}:null}
async function refresh(){if(!window.confirm('重新读取会替换本场尚未保存的选派，是否继续？'))return;busy.value=true;try{const r=await scheduleAPI.getDetail(props.schedule.id);emit('updated',r.data);error.value='';message.value='已读取最新选派，请核对后保存'}catch(e){error.value=e.response?.data?.message||'读取失败'}finally{busy.value=false}}
async function save(){if(busy.value)return;const changed=form.value.futsal!==props.schedule.futsal;if(changed&&!window.confirm(formatChangeMessage))return;busy.value=true;error.value='';message.value='';try{const r=await scheduleAPI.assignReferees(props.schedule.id,{...form.value,confirm_format_change:changed,fourth_required:form.value.futsal?false:form.value.fourth_required});emit('updated',r.data);message.value='选派已保存';warnings.value=r.data.assignment_warnings||[]}catch(e){error.value=e.response?.data?.message||'保存失败';if(e.response?.status===409)error.value+='；请先重新读取当前选派。'}finally{busy.value=false}}
watch(()=>props.schedule,reset,{immediate:true})
watch([warningPayload,()=>props.warningRevision],scheduleWarnings,{immediate:true})
</script>
<style scoped>
.assignment{border:1px solid #d6e0ec;background:white;border-radius:12px;padding:20px;margin:16px 0;scroll-margin-top:24px}.assignment header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}.assignment h4{margin:0;font-size:18px}.assignment p{line-height:1.7}.status{background:#fff3d1;color:#825511;border-radius:8px;padding:7px 10px;font-size:13px}.status.complete{background:#e2f4ec;color:#166443}.requirements{display:flex;flex-wrap:wrap;gap:20px;margin:14px 0}.requirements label{display:flex;align-items:center;gap:8px;min-height:44px}.requirements input{width:18px;height:18px}.role-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px}.role-grid>div>label{display:block;margin-bottom:8px;font-weight:600}.hint{color:#52657a;font-size:13px}.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.assignment button{width:auto;margin:0;padding:10px 16px;border:1px solid #bccddd;border-radius:8px;background:white;color:#123b6d;min-height:44px;cursor:pointer}.assignment button.primary{background:#1e5ca8;color:white}.assignment button:disabled{opacity:.55;cursor:not-allowed}.assignment-warnings{padding:12px 16px;border:1px solid #dfbd65;border-radius:8px;background:#fff8e5;color:#725315;font-size:14px;line-height:1.7;overflow-wrap:anywhere}.assignment-warnings ul{margin:6px 0 0;padding-left:20px}.assignment .error{color:#a21d25}.assignment details{margin-top:18px}.assignment summary{cursor:pointer;min-height:36px}.assignment a{color:#1e5ca8}@media(max-width:600px){.assignment{padding:14px}.role-grid{grid-template-columns:1fr}}
</style>
