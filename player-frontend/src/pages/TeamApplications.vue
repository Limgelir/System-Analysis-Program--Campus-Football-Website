<template>
  <div class="content teams-page"><RouterLink to="/dashboard">← 返回我的主页</RouterLink><div class="team-page-heading"><div><span class="eyebrow">球队报名</span><h1>我的球队与报名</h1></div><button class="secondary" :disabled="busy" @click="reload">刷新列表</button></div>
    <div v-if="error" class="error" role="alert">{{ error }}</div>
    <section class="card create-team"><h2>创建球队草稿</h2><p class="field-help">负责人可以不参赛。名单里的球员须先通过当季学籍审核；正式提交后由管理员整队审核。</p><p v-if="!context?.current_season_id || context.ended" class="muted">暂无可以报名的启用赛季。</p>
      <form v-else v-draft="{ value: { competitionId, name } }" @submit.prevent="create"><div class="team-fields"><label>报名赛事<select v-model="competitionId" :disabled="busy"><option value="">请选择赛事</option><option v-for="c in context.competitions" :key="c.id" :value="String(c.id)">{{ c.league_type }}</option></select></label><label>新球队名称<input v-model="name" maxlength="100" required :disabled="busy"></label></div><p v-if="competition" class="field-help">球队报名时间（北京时间）：{{ time(competition.registration_opens_at) }} 至 {{ time(competition.registration_closes_at) }}</p><p v-if="competition?.rules_text" class="rules-text">{{ competition.rules_text }}</p><TeamAutomaticReview v-if="competition" :limits="competition"/><button class="primary" :disabled="busy || !competitionId">创建报名草稿</button></form>
    </section>
    <form class="team-filters" @submit.prevent="page=1; load()"><label>查看赛季<select v-model="seasonId"><option v-for="s in context?.seasons || []" :key="s.id" :value="String(s.id)">{{ s.season_name }}</option></select></label><label>报名状态<select v-model="status"><option value="">全部状态</option><option v-for="(label,value) in teamStatuses" :value="value" :key="value">{{ label }}</option></select></label><button class="secondary">查询</button></form>
    <div class="team-list"><RouterLink v-for="t in items" :key="t.id" :to="'/team-applications/'+t.id" class="card team-list-item"><div><span class="eyebrow">{{ t.league_type }} · {{ t.kind==='roster_change'?'名单变更':'首次报名' }} · {{ t.can_manage ? '我管理的报名' : '我参与的报名' }}</span><h2>{{ t.team_name }}</h2><p class="muted">名单 {{ t.member_count }} 人{{ t.team_id ? ' · 正式球队' : '' }}</p></div><span class="status">{{ teamStatuses[t.status] }}</span></RouterLink><section v-if="!items.length" class="card empty">{{ loading ? '正在读取报名…' : '该赛季暂无符合条件的球队报名。' }}</section></div>
    <ListPagination class="team-pagination" :pagination="{...pagination,page}" :loading="loading" fixed-size @page="value=>{page=value;load()}" />
  </div>
</template>
<script setup>
import TeamAutomaticReview from '../../../shared-ui/TeamAutomaticReview.vue'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, messageOf } from '../session'
import { teamStatuses, time, requestKey } from '../teamWorkflow'
const router=useRouter(), context=ref(null), competitionId=ref(''), name=ref(''), seasonId=ref(''), status=ref(''), page=ref(1), pagination=ref({total:0,total_pages:0}),items=ref([]),busy=ref(false),loading=ref(false),error=ref('');let sequence=0,key='',lastBody=''
const competition=computed(()=>context.value?.competitions.find(c=>String(c.id)===competitionId.value))
async function load(){const n=++sequence;loading.value=true;error.value='';try{const data=await api.get('/team-applications',{params:{season_id:seasonId.value||undefined,status:status.value,page:page.value}});if(n===sequence){items.value=data.items;pagination.value=data.pagination}}catch(e){if(n===sequence)error.value=messageOf(e)}finally{if(n===sequence)loading.value=false}}
async function reload(){try{context.value=await api.get('/team-applications/context');if(!seasonId.value)seasonId.value=String(context.value.current_season_id||context.value.seasons[0]?.id||'');await load()}catch(e){error.value=messageOf(e)}}
async function create(){busy.value=true;error.value='';const body={season_id:context.value.current_season_id,competition_id:Number(competitionId.value),team_name:name.value};if(JSON.stringify(body)!==lastBody){lastBody=JSON.stringify(body);key=requestKey()}try{const data=await api.post('/team-applications',body,{headers:{'Idempotency-Key':key}});name.value='';competitionId.value='';await router.push('/team-applications/'+data.application.id)}catch(e){error.value=messageOf(e)}finally{busy.value=false}}
onMounted(reload)
</script>
