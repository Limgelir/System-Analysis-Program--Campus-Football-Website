<template><div class="content"><RouterLink to="/public">← 返回球队查询</RouterLink><p v-if="error" class="error" role="alert">{{ error }}</p>
  <section v-if="data" class="card public-team"><span class="eyebrow">{{ data.team.season_name }} · {{ data.team.league_type }}</span><h1>{{ data.team.team_name }}</h1><p>球衣（上衣／裤子／袜子）：{{ data.team.shirt_color||'/' }} / {{ data.team.shorts_color||'/' }} / {{ data.team.socks_color||'/' }}</p><p v-if="data.team.registration_revoked" class="notice">本队报名通过已撤销，以下为保留的历史名单与赛程。</p><h2>{{ data.team.registration_revoked ? '撤销前名单' : '正式名单' }}</h2><div class="member-cards"><article v-for="p in data.players" :key="p.id" class="member-card"><h3>{{ p.jersey_number }}号 · {{ p.player_name }}</h3><p>{{ p.college }}</p><p>{{ p.is_captain?'场上队长 · ':'' }}{{ p.is_goalkeeper?'守门员 · ':'' }}{{ p.is_foreign?'外援 · ':'' }}{{ p.is_sports_training?'运训 ':'' }}{{ p.is_football_specialty?'足球特长生':'' }}</p></article></div></section>
  <TeamResults v-if="data" :team-id="data.team.id"/>
</div></template>
<script setup>
import {ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {publicApi} from '../publicApi'
import {messageOf} from '../session'
import TeamResults from '../components/TeamResults.vue'
const route=useRoute(),data=ref(null),error=ref('');let seq=0
watch(()=>route.params.id,async id=>{const n=++seq;data.value=null;try{const d=await publicApi.get('/teams/'+id);if(n===seq){data.value=d;error.value=''}}catch(e){if(n===seq)error.value=messageOf(e)}},{immediate:true})
</script>
<style scoped>
@layer legacy {
.public-team{margin-top:24px;overflow-wrap:anywhere}
}
</style>
