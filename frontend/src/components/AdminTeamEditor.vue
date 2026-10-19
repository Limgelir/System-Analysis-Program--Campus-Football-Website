<template>
  <section class="team-editor">
    <div class="editor-heading"><h3>管理员修改球队</h3><button type="button" :disabled="busy" @click="reload">{{ data ? '重新载入' : '打开编辑' }}</button></div>
    <p class="help">保存后立即生效，不受报名或名单修改时间、赛事自动审核及球员资格限制。号码须为不重复的非负整数，名单须有且仅有一名场上队长。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="success" role="status">{{ success }}</p>
    <template v-if="data">
      <p v-if="data.blocked_reason" class="notice">{{ data.blocked_reason }}</p>
      <p v-if="data.open_requests.length || data.open_roles.length"><RouterLink to="/admin-team-applications">前往球队报名审核处理申请</RouterLink></p>
      <form v-draft="{value:form,dirty:dirty}" @submit.prevent="save">
        <fieldset :disabled="busy || !data.can_edit">
          <div class="editor-fields"><label>球队名称<input v-model="form.team_name" maxlength="100" required></label><label>上衣主要颜色<input v-model="form.shirt_color" maxlength="50"></label><label>裤子主要颜色<input v-model="form.shorts_color" maxlength="50"></label><label>袜子主要颜色<input v-model="form.socks_color" maxlength="50"></label></div>
          <p>负责人：{{ manager?.name || '尚未关联' }}{{ manager?.student_id ? ' · '+manager.student_id : '' }}</p>
          <div class="lookup"><label>新负责人学号<input v-model="managerStudentId" autocomplete="off"></label><button type="button" :disabled="!managerStudentId.trim()" @click="lookup('manager')">核对并选择负责人</button></div>
          <p class="help">负责人须有球员账号，可以不在参赛名单中。选择后需点击下方保存才生效。</p>
          <div class="lookup"><label>添加球员学号<input v-model="studentId" autocomplete="off"></label><button type="button" :disabled="!studentId.trim()" @click="lookup('member')">按学号添加球员</button></div>
          <p>当前编辑名单：{{ form.members.length }} 人</p>
          <article v-for="(m,index) in form.members" :key="m.player_id || m.id" class="editor-member">
            <div class="editor-heading"><strong>{{ m.name }} · {{ m.student_id || '待关联' }}</strong><button type="button" @click="form.members.splice(index,1)">移除{{ m.name }}</button></div>
            <p class="help">{{ m.college }} · {{ m.gender==='male'?'男':m.gender==='female'?'女':'未填写性别' }} · {{ m.qualification_status==='approved'?'学籍已通过':'学籍未通过' }}{{ m.is_active===0?' · 账号已停用':'' }}</p>
            <div class="editor-options"><label>{{ m.name }}号码<input v-model="m.jersey_number" inputmode="numeric" maxlength="20" required></label><label class="check"><input type="radio" :name="'admin-captain-'+teamId" :checked="m.is_captain" :aria-label="m.name+'任场上队长'" @change="form.members.forEach((p,i)=>p.is_captain=i===index)">场上队长</label><label class="check"><input v-model="m.is_goalkeeper" type="checkbox">守门员</label><label class="check"><input v-model="m.is_foreign" type="checkbox">外援</label><label v-if="tagEnabled(data.limits,'sports_training')" class="check"><input v-model="m.is_sports_training" type="checkbox">运训</label><label v-if="tagEnabled(data.limits,'football_specialty')" class="check"><input v-model="m.is_football_specialty" type="checkbox">足球特长生</label><label>备注<input v-model="m.remark" maxlength="255"></label></div>
          </article>
          <p v-if="!form.members.length" class="help">请按学号添加队员，并指定一名场上队长。</p>
          <button type="submit" class="primary" :disabled="!dirty">{{ busy ? '保存中…' : '保存球队修改（立即生效）' }}</button>
        </fieldset>
      </form>
    </template>
  </section>
</template>
<script setup>
import {ref,computed,watch,nextTick} from 'vue'
import api from '../api/http'
import {confirmDraftLeave} from '../../../shared-ui/interaction.js'
import {tagEnabled} from '../../../shared-ui/teamRegistrationRules.js'
const props=defineProps({teamId:{type:Number,required:true}}),emit=defineEmits(['saved','busy'])
const data=ref(null),form=ref(null),manager=ref(null),managerStudentId=ref(''),studentId=ref(''),error=ref(''),success=ref(''),busy=ref(false)
let baseline='',sequence=0
const flags=['is_captain','is_goalkeeper','is_foreign','is_sports_training','is_football_specialty']
function payload(){return {team_name:form.value.team_name,shirt_color:form.value.shirt_color,shorts_color:form.value.shorts_color,socks_color:form.value.socks_color,manager_player_id:form.value.manager_player_id,members:form.value.members.map(m=>({id:m.id,player_id:m.player_id,jersey_number:m.jersey_number,remark:m.remark||null,...Object.fromEntries(flags.map(f=>[f,Boolean(m[f])]))}))}}
const dirty=computed(()=>Boolean(form.value)&&JSON.stringify(payload())!==baseline)
function assign(d){data.value=d;manager.value=d.manager;form.value={team_name:d.team.team_name,shirt_color:d.team.shirt_color||'',shorts_color:d.team.shorts_color||'',socks_color:d.team.socks_color||'',manager_player_id:d.manager?.id,members:d.members.map(m=>({...m,...Object.fromEntries(flags.map(f=>[f,Boolean(m[f])]))}))};baseline=JSON.stringify(payload());studentId.value='';managerStudentId.value=''}
const fail=e=>error.value=e.response?.data?.message||'操作失败，请重试'
async function reload(){if(!confirmDraftLeave())return;const n=++sequence;busy.value=true;error.value='';success.value='';try{const r=await api.get(`/player-admin/teams/${props.teamId}/manage`);if(n===sequence)assign(r.data)}catch(e){if(n===sequence)fail(e)}finally{if(n===sequence)busy.value=false}}
async function lookup(role){busy.value=true;error.value='';success.value='';try{const p=(await api.get(`/player-admin/teams/${props.teamId}/manage/players`,{params:{role,student_id:role==='manager'?managerStudentId.value:studentId.value}})).data;if(role==='manager'){manager.value=p;form.value.manager_player_id=p.id;managerStudentId.value=''}else{if(form.value.members.some(m=>m.player_id===p.id)){error.value='该球员已在名单中';return}form.value.members.push({...p,id:null,player_id:p.id,jersey_number:'',remark:null,...Object.fromEntries(flags.map(f=>[f,false]))});studentId.value=''}}catch(e){fail(e)}finally{busy.value=false}}
async function save(){busy.value=true;error.value='';success.value='';try{const r=await api.put(`/player-admin/teams/${props.teamId}/manage`,payload(),{headers:{'If-Match':String(data.value.team.revision)}});assign(r.data);success.value='球队资料和正式名单已更新，立即生效。';busy.value=false;await nextTick();emit('saved')}catch(e){fail(e)}finally{busy.value=false}}
watch(busy,value=>emit('busy',value))
watch(()=>props.teamId,()=>{sequence++;data.value=null;form.value=null;error.value='';success.value='';busy.value=false})
</script>
<style scoped>
.team-editor{border:1px solid #dbe4f0;border-radius:14px;padding:16px;margin:16px 0;background:#f8fafc}.editor-heading,.lookup{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.editor-heading h3{margin:0}.editor-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}label{display:flex;flex-direction:column;gap:6px;min-width:0}input{box-sizing:border-box;max-width:100%;min-width:0;padding:8px;border:1px solid #cbd5e1;border-radius:6px}fieldset{border:0;padding:0;min-width:0}.editor-member{padding:14px;margin:12px 0;background:white;border:1px solid #dbe4f0;border-radius:10px}.editor-options{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.editor-options>label:not(.check){width:140px}.check{flex-direction:row;align-items:center}.help{color:#64748b;line-height:1.6}.error{color:#b91c1c}.notice{color:#92400e}.lookup{justify-content:flex-start;margin:12px 0}button{padding:8px 12px;border-radius:8px;border:1px solid #cbd5e1;cursor:pointer}.primary{background:#2563eb;color:white}button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:600px){.editor-fields{grid-template-columns:1fr}.lookup{align-items:stretch;flex-direction:column}.lookup label,.lookup button{width:100%}}
</style>
