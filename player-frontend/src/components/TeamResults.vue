<template>
  <section class="card results-card">
    <div class="team-page-heading"><h2>赛程与正式结果</h2><button class="secondary" @click="load">刷新比赛结果</button></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="data">
      <p v-if="data.my_goals !== undefined" class="goal-total">本人在本队本赛季进球：<strong>{{ data.my_goals }}</strong></p>
      <p class="field-help">普通进球和比赛内点球计入个人进球；乌龙球和点球大战不计入。结果每30秒自动刷新，也可手动刷新。</p>
      <div class="schedule-tabs" role="group" aria-label="赛程分类"><button :aria-pressed="tab==='upcoming'" @click="tab='upcoming'">未来赛程</button><button :aria-pressed="tab==='history'" @click="tab='history'">历史比赛</button></div><p v-if="!visibleMatches.length">{{ tab==='upcoming'?'暂无待赛或待确认的比赛。':'暂无正式比赛结果。' }}</p>
      <p v-if="!data.matches.length" class="muted">本队暂无赛程。</p>
      <article v-for="m in visibleMatches" :key="m.id" class="match-card">
        <p class="muted">{{ m.match_date }} · {{ m.match_time ? m.match_time + (m.match_end_time ? '-' + m.match_end_time : '') : '时间待定' }} · {{ m.venue==='其它'?m.venue_detail:m.venue||'场地待定' }} · {{ m.match_type }} · 场序 {{ m.field_order }}</p>
        <h3>{{ m.home_name }} <span class="score">{{ m.result ? `${m.result.home_score} : ${m.result.away_score}` : '待发布' }}</span> {{ m.away_name }}</h3>
        <p v-if="m.result?.forfeit_side && m.result.forfeit_side !== 'none'" class="notice">{{ ({home:'主队弃权',away:'客队弃权',both:'双方弃权'})[m.result.forfeit_side] }} · 判定比分不计入球员进球。</p>
        <p v-if="m.status==='revising'" class="notice">修订中，当前展示上次正式结果。</p>
        <p v-if="m.result && (m.result.home_penalty_score > 0 || m.result.away_penalty_score > 0)">点球大战：{{ m.result.home_penalty_score }} : {{ m.result.away_penalty_score }}</p>
        <div v-if="tab==='upcoming' && m.discipline" class="suspensions"><h4>双方停赛名单</h4><p v-if="!m.discipline.configured">本赛事尚未设置停赛规则。</p><template v-else><p class="field-help">根据当前正式报告和未完成赛程顺序预计；改期、前场报告未提交或更正可能影响名单，请赛前刷新。</p><div v-for="team in [{id:m.team_a_id,name:m.home_name},{id:m.team_b_id,name:m.away_name}]" :key="team.id"><strong>{{ team.name }}</strong><p v-if="!m.discipline.suspensions.some(p=>p.team_id===team.id)">当前预计无停赛球员</p><p v-for="p in m.discipline.suspensions.filter(p=>p.team_id===team.id)" :key="p.key">{{ p.jersey_number }}号 {{ p.player_name }} · {{ p.reason }} · 本场前剩余 {{ p.remaining_before }} 场</p></div></template></div>
        <p v-if="m.my_goals !== undefined">本人本场进球：{{ m.my_goals }}</p>
        <details v-if="m.result"><summary>查看进球记录</summary><p v-if="!m.result.goals.length" class="muted">无进球记录。</p><p v-for="(g,i) in m.result.goals" :key="i">{{ g.minute_label }}′ · {{ g.jersey_number }}号 {{ g.player_name }} · {{ goalLabels[g.goal_type] }}</p></details>
        <details @toggle="loadRoster($event,m.id)"><summary>查看本场名单</summary><p v-if="rosterErrors[m.id]" class="error">{{ rosterErrors[m.id] }}</p><div v-for="r in rosters[m.id]" :key="r.team_id"><h4>{{ r.team_id===m.team_a_id?m.home_name:m.away_name }}</h4><p v-for="p in r.players" :key="p.id">{{ p.jersey_number }}号 {{ p.player_name }} · {{ p.college }} {{ p.is_captain?'· 队长':'' }} {{ p.is_goalkeeper?'· 守门员':'' }} {{ p.is_foreign?'· 外援':'' }} {{ p.is_sports_training?'· 运训':'' }} {{ p.is_football_specialty?'· 足球特长生':'' }}</p></div></details>
      </article>
    </template>
  </section>
</template>
<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { api, session, messageOf } from '../session'
import { publicApi } from '../publicApi'
const props=defineProps({teamId:{type:Number,required:true}}),data=ref(null),error=ref('')
const tab=ref('upcoming')
const order=v=>String(v??'').replace(/\d+/g,p=>{const d=p.replace(/^0+(?=\d)/,'');return `#${String(d.length).padStart(2,'0')}:${d}`})
const compare=(a,b)=>a<b?-1:a>b?1:0
const visibleMatches=computed(()=>[...(data.value?.matches||[])].filter(m=>tab.value==='history'?!!m.result:!m.result).sort((a,b)=>{const date=compare(a.match_date,b.match_date);return (tab.value==='history'?-date:date)||compare(a.match_time||'99:99',b.match_time||'99:99')||compare(order(a.field_order),order(b.field_order))||compare(a.field_order,b.field_order)||a.id-b.id}))
const goalLabels={normal:'进球',penalty:'点球',own_goal:'乌龙球（不计个人进球）'}
const rosters=ref({}),rosterErrors=ref({})
async function loadRoster(event,id){if(!event.target.open)return;try{rosters.value[id]=(await publicApi.get('/matches/'+id)).rosters;rosterErrors.value[id]=''}catch(e){rosterErrors.value[id]=messageOf(e)}}
let seq=0,timer
async function load(){const n=++seq;try{const result=session.player?await api.get('/team-results/'+props.teamId):await publicApi.get('/teams/'+props.teamId);if(n===seq){data.value=result;error.value=''}}catch(e){if(n===seq)error.value=messageOf(e)}}
function refreshVisible(){if(document.visibilityState==='visible')load()}
watch(()=>props.teamId,()=>{data.value=null;load()},{immediate:true})
onMounted(()=>{timer=setInterval(refreshVisible,30000);window.addEventListener('focus',refreshVisible)})
onUnmounted(()=>{seq++;clearInterval(timer);window.removeEventListener('focus',refreshVisible)})
</script>
<style scoped>
@layer legacy {
.suspensions{padding:14px;border:1px solid #d5e1ed;border-radius:10px;background:#f7faff;margin:16px 0}.schedule-tabs{display:flex;gap:10px;margin:16px 0}.schedule-tabs button{padding:9px 15px;border:1px solid #c6d7e6;border-radius:8px;background:white}.schedule-tabs button[aria-pressed="true"]{background:#195c83;color:white}.results-card{margin-top:24px}.match-card{padding:20px 0;border-top:1px solid #e3eaf2;overflow-wrap:anywhere}.match-card p{margin-bottom:8px}.score{color:#1b5aa2;white-space:nowrap;display:inline-block;padding:0 12px}.goal-total{font-size:18px}.goal-total strong{font-size:27px;color:#205998}summary{cursor:pointer;color:#275fa7}
}
</style>
