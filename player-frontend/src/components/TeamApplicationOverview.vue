<template><section class="card"><div class="team-page-heading"><div><span class="eyebrow">按赛事独立报名</span><h2>球队报名与管理</h2></div><RouterLink class="primary" to="/team-applications">创建／管理球队</RouterLink></div><p v-if="error" class="error">{{ error }}</p><p v-if="!items.length" class="muted">当前赛季还没有与你关联的报名。负责人可直接创建草稿，不必本人参赛。</p><div v-for="t in items" :key="t.id" class="overview-team"><RouterLink :to="'/team-applications/'+t.id">{{ t.team_name }}</RouterLink><span>{{ t.league_type }} · {{ teamStatuses[t.status] }} · {{ t.can_manage?'可管理':'队员查看' }}</span></div><p class="field-help">这里查看报名及审核进度。审核通过后，可从正式球队查看名单、赛程和比赛结果。</p></section></template>
<script setup>
import { ref,onMounted } from 'vue'
import { api,messageOf } from '../session'
import { teamStatuses } from '../teamWorkflow'
const items=ref([]),error=ref('')
onMounted(async()=>{try{items.value=(await api.get('/team-applications',{params:{page_size:20}})).items}catch(e){error.value=messageOf(e)}})
</script>
<style scoped>
@layer legacy {
.overview-team{display:flex;justify-content:space-between;gap:16px;border-top:1px solid #e3eaf2;padding:14px 0}.overview-team span{font-size:13px;color:#6d8094}.field-help{margin-top:16px}@media(max-width:600px){.overview-team{flex-direction:column;gap:5px}}
}
</style>
