<template>
  <section class="card team-role-panel"><div class="team-page-heading"><h2>负责人／场上队长变更</h2><button class="secondary" :disabled="busy" @click="load">刷新角色申请</button></div><p class="field-help">无需报名或名单修改窗口开放。审核通过后立即生效，原角色权限随之更新；此入口不能添加参赛队员。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="success" class="notice" role="status">{{ success }}</p>
    <form v-draft="{ value: {studentId,reason}, resetKey: saved }" v-if="data?.team.can_request" @submit.prevent="submit"><div class="team-fields"><label>要变更的角色<select v-model="role" :disabled="busy" @change="candidate=null"><option value="manager">球队负责人</option><option value="captain">场上队长</option></select></label><label>新任人选学号<input v-model="studentId" :disabled="busy" @input="candidate=null"></label></div><button type="button" class="secondary" :disabled="busy || !studentId" @click="lookup">核对新任人选</button><p v-if="candidate" class="notice">{{ candidate.name }} · {{ candidate.student_id }} · {{ candidate.college }}</p><label>角色变更说明<textarea v-model="reason" maxlength="500" rows="2" :disabled="busy"></textarea></label><button class="primary" :disabled="busy || !candidate">提交角色变更申请</button></form>
    <ul class="role-requests"><li v-for="v in data?.requests || []" :key="v.id"><span>{{ v.role==='manager'?'负责人':'场上队长' }} → {{ v.new_name }} · {{ teamStatuses[v.status] }} · {{ time(v.created_at) }}</span><button class="secondary" :disabled="busy" @click="open(v.id)">查看角色申请</button></li></ul>
    <div v-if="detail" class="notice"><h3>{{ detail.old.name }} → {{ detail.next.name }}</h3><p>{{ teamStatuses[detail.request.status] }}{{ detail.request.reason ? ' · '+detail.request.reason : '' }}</p><button v-if="detail.request.status==='pending' && data?.team.can_request" class="secondary" :disabled="busy" @click="withdraw">撤回角色申请</button><ol><li v-for="e in detail.events" :key="e.id">{{ teamOperations[e.operation] }} · {{ time(e.created_at) }}{{ e.reason ? ' · '+e.reason : '' }}</li></ol></div>
  </section>
</template>
<script setup>
import { ref, watch } from 'vue'
import { api, messageOf } from '../session'
import { requestKey, teamStatuses, teamOperations, time } from '../teamWorkflow'
const props=defineProps({teamId:Number}),emit=defineEmits(['refresh']),data=ref(null),role=ref('manager'),studentId=ref(''),candidate=ref(null),reason=ref(''),busy=ref(false),error=ref(''),success=ref(''),detail=ref(null);const saved=ref(0);let key='',lastBody=''
async function load(){error.value='';try{data.value=await api.get(`/teams/${props.teamId}/role-changes`)}catch(e){error.value=messageOf(e);if(e.response?.status===403)emit('refresh')}}
async function lookup(){busy.value=true;error.value='';candidate.value=null;try{candidate.value=await api.get(`/teams/${props.teamId}/role-candidates`,{params:{student_id:studentId.value,role:role.value}})}catch(e){error.value=messageOf(e)}finally{busy.value=false}}
async function submit(){busy.value=true;error.value='';success.value='';const body={role:role.value,new_player_id:candidate.value.id,reason:reason.value};if(lastBody!==JSON.stringify(body)){lastBody=JSON.stringify(body);key=requestKey()}try{detail.value=await api.post(`/teams/${props.teamId}/role-changes`,body,{headers:{'If-Match':String(data.value.team.revision),'Idempotency-Key':key}});saved.value++;success.value='角色变更已提交，等待管理员审核。';key='';lastBody='';await load()}catch(e){error.value=messageOf(e)}finally{busy.value=false}}
async function open(id){try{detail.value=await api.get('/role-changes/'+id)}catch(e){error.value=messageOf(e)}}
async function withdraw(){busy.value=true;try{detail.value=await api.post(`/role-changes/${detail.value.request.id}/withdraw`,{},{headers:{'If-Match':String(detail.value.request.revision)}});await load()}catch(e){error.value=messageOf(e)}finally{busy.value=false}}
watch(()=>props.teamId,load,{immediate:true})
</script>
