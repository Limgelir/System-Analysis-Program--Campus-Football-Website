<template><div class="content"><RouterLink to="/dashboard">← 返回我的主页</RouterLink><p v-if="error" class="error" role="alert">{{ error }}</p>
  <template v-if="data"><section class="card"><div class="team-page-heading"><div><span class="eyebrow">{{ data.team.season_name }} · {{ data.team.league_type }}</span><h1>{{ data.team.team_name }}</h1></div><button class="secondary" :disabled="busy" @click="load">刷新正式名单</button></div><p>负责人：{{ data.manager?.name || '尚未关联' }}</p><p>球衣（上衣／裤子／袜子）：{{ data.team.shirt_color||'/' }} / {{ data.team.shorts_color||'/' }} / {{ data.team.socks_color||'/' }}</p><p v-if="data.team.registration_revoked" class="notice">本队报名通过已撤销，以下名单和赛程保留供查询。请前往<RouterLink to="/team-applications">球队报名</RouterLink>，在报名时间内修改原申请并重新提交。</p><p v-else class="notice">当前正式名单第 {{ data.batch?.version_no||0 }} 版。变更待审时此名单继续有效，审核通过后立即更新。</p>
    <div class="member-cards"><article v-for="p in data.players" :key="p.id" class="member-card"><h3>{{ p.jersey_number }}号 · {{ p.player_name }}</h3><p>{{ p.college }}{{ p.student_id?' · '+p.student_id:'' }}</p><p>{{ p.is_captain?'场上队长 · ':'' }}{{ p.is_goalkeeper?'守门员 · ':'' }}{{ p.is_foreign?'外援 · ':'' }}{{ p.is_sports_training?'运训 ':'' }}{{ p.is_football_specialty?'足球特长生':'' }}</p></article></div></section>
    <section v-if="data.can_manage" class="card"><h2>中期名单变更</h2><p class="field-help">负责人和当前场上队长都能操作。修改需在管理员统一开放的时间内进行；每队同时只能有一份进行中的变更。</p><p v-for="v in data.change_windows" :key="v.id">{{ time(v.opens_at) }} 至 {{ time(v.closes_at) }}（北京时间）</p><p v-if="!data.change_windows.length">尚未设置修改窗口。</p><button class="primary" :disabled="busy||!data.can_create" @click="create">从当前名单建立变更稿</button><ul><li v-for="a in data.requests" :key="a.id"><RouterLink :to="'/team-applications/'+a.id">名单变更 #{{ a.id }} · {{ teamStatuses[a.status] }}{{ a.source_type==='admin_import'?' · 管理员导入':'' }}</RouterLink><p v-if="a.return_reason">{{ a.return_reason }}</p></li></ul></section>
    <TeamRolePanel v-if="data.can_manage" :team-id="data.team.id" @refresh="load"/>
    <TeamResults :team-id="data.team.id"/>
  </template></div></template>
<script setup>
import {ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {api,messageOf} from '../session'
import {teamStatuses,time,requestKey} from '../teamWorkflow'
import TeamRolePanel from '../components/TeamRolePanel.vue'
import TeamResults from '../components/TeamResults.vue'
const route=useRoute(),router=useRouter(),data=ref(null),error=ref(''),busy=ref(false);let sequence=0,key=requestKey()
async function load(){const n=++sequence;error.value='';try{const d=await api.get('/teams/'+route.params.id);if(n===sequence)data.value=d}catch(e){if(n===sequence){data.value=null;error.value=messageOf(e)}}}
async function create(){busy.value=true;error.value='';try{const d=await api.post(`/teams/${data.value.team.id}/roster-changes`,{},{headers:{'If-Match':String(data.value.team.revision),'Idempotency-Key':key}});key=requestKey();router.push('/team-applications/'+d.application.id)}catch(e){error.value=messageOf(e)}finally{busy.value=false}}
watch(()=>route.params.id,load,{immediate:true})
</script>
