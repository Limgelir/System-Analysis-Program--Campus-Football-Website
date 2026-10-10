<template><div class="content">
  <span class="eyebrow">校园足球</span><h1>球队与赛程</h1><p class="muted">查询各赛季的正式球队、名单和比赛结果。</p>
  <div class="public-filters"><label>查询赛季<select v-model="selected" :disabled="!seasons.length"><option v-if="!seasons.length" value="">暂无可查询赛季</option><option v-for="s in seasons" :key="s.id" :value="String(s.id)">{{ s.season_name }}</option></select></label><label>查询赛事<select v-model="league" :disabled="!seasons.length"><option value="">全部赛事</option><option v-for="c in competitions" :key="c.id" :value="c.league_type">{{ c.league_type }}</option></select></label><button class="secondary" @click="seasons.length ? load() : initialize()">刷新球队</button></div>
  <PageState v-if="error" kind="error" :message="error" @retry="initialize" /><PageState v-else-if="loading" kind="loading" /><PageState v-else-if="!seasons.length" title="暂无可查询的赛季" message="赛季开放并公布球队后，可在这里查看名单和赛程。" /><PageState v-else-if="!teams.length" title="当前选择下暂无正式球队" message="试试其他赛季或赛事，或等待球队审核通过。" />
  <section v-for="group in groups" :key="group.league" class="card public-group"><h2>{{ group.league }}</h2><div class="team-list"><RouterLink v-for="t in group.items" :key="t.id" :to="'/public/teams/'+t.id" class="team-list-item">{{ t.team_name }} <span>查看名单与赛程 →</span></RouterLink></div></section>
  <p class="field-help">射手榜和积分榜尚未启用。</p>
</div></template>
<script setup>
import {ref,computed,watch,onMounted} from 'vue'
import {publicApi} from '../publicApi'
import {messageOf} from '../session'
const competitions=ref([])
const selected=ref(''),league=ref(''),seasons=ref([]),teams=ref([]),error=ref(''),loading=ref(false);let seq=0
const groups=computed(()=>[...new Set(teams.value.map(t=>t.league_type))].map(league=>({league,items:teams.value.filter(t=>t.league_type===league)})).filter(g=>g.items.length))
async function load(){const n=++seq;teams.value=[];if(!selected.value)return;loading.value=true;try{const d=await publicApi.get('/teams',{params:{season_id:selected.value,league_type:league.value}});if(n===seq){teams.value=d;error.value=''}}catch(e){if(n===seq)error.value=messageOf(e)}finally{if(n===seq)loading.value=false}}
watch(selected,async id=>{league.value='';competitions.value=[];try{const d=await publicApi.get('/competitions',{params:{season_id:id}});if(String(id)===String(selected.value))competitions.value=d.competitions}catch(e){error.value=messageOf(e)}})
watch([selected,league],load)
async function initialize(){try{seasons.value=await publicApi.get('/seasons');selected.value=String(seasons.value.find(s=>s.is_active)?.id||seasons.value[0]?.id||'');error.value='';await load()}catch(e){error.value=messageOf(e)}}
onMounted(initialize)
</script>
<style scoped>
@layer legacy {
.public-group{margin-bottom:24px}.public-filters{display:flex;gap:20px;align-items:center;flex-wrap:wrap}select{display:block;padding:10px;font:inherit;border:1px solid #ccd8e4;border-radius:6px;margin-top:7px;max-width:100%}.public-filters label{max-width:100%}.team-list-item{overflow-wrap:anywhere}
}
</style>
