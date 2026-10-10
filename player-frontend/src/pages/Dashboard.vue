<template>
  <div class="content">
    <template v-if="$studioEnabled">
      <StudioHero title="我的主页" :badge="[session.player?.name, session.player?.college].filter(Boolean).join(' · ')" />
      <section class="studio-stats" aria-label="我的赛季概览"><div><span>所选赛季球队</span><strong>{{ loading || error ? '—' : teams.length }}</strong></div><div><span>未读提示</span><strong>{{ loading || error ? '—' : notifications.filter(item => !item.read_at).length }}</strong></div><div><span>学籍资格</span><strong class="studio-stat-text">{{ loading ? '读取中…' : error ? '读取失败' : context?.season ? labels[context.status] || '待确认' : '暂无赛季' }}</strong></div></section>
    </template>
    <section v-else class="welcome"><div><span class="eyebrow">我的球员主页</span><h1>{{ session.player?.name }}，欢迎回来</h1><p>{{ session.player?.college }}</p></div><RouterLink class="secondary" to="/account">管理账号资料</RouterLink></section>
    <p v-if="session.player && !colleges.includes(session.player.college)" class="notice college-notice" role="status">你的学院尚未匹配，请选择学院并上传截图申请审核。原填写：{{ session.player.college || '未填写' }}。<RouterLink to="/account">去申请修改学院</RouterLink></p>
    <nav class="ui-quick-links" aria-label="球员常用操作"><RouterLink to="/season-registration">个人学籍资格</RouterLink><RouterLink to="/team-applications">球队报名与管理</RouterLink><RouterLink to="/public">公开球队与赛程</RouterLink></nav>
    <div v-if="error" class="error" role="alert">{{ error }} <button @click="load">重试</button></div>
    <section class="card season-card"><div><span class="eyebrow">当前赛季</span><h2>{{ loading ? '正在加载…' : context?.season?.season_name || '暂无启用赛季' }}</h2><p class="muted">{{ context?.message }}</p><RouterLink v-if="context?.season" class="primary registration-link" to="/season-registration">{{ context?.status === 'unsubmitted' ? '参加本赛季注册' : '查看学籍注册' }}</RouterLink></div><span class="status">{{ context?.season ? labels[context.status] : '等待赛季启用' }}</span></section>
    <section v-if="notifications.length" class="card notifications"><h2>站内提示</h2><ul><li v-for="notice in notifications" :key="notice.id"><p>{{ notice.message }}</p><button v-if="!notice.read_at" class="secondary" @click="markRead(notice)">标记已读</button><span v-else class="muted">已读</span></li></ul></section>
    <section class="card my-teams"><label v-if="seasons.length">查看队伍赛季<select v-model="selectedSeason"><option v-for="s in seasons" :key="s.id" :value="String(s.id)">{{ s.season_name }}</option></select></label><p v-if="!teams.length" class="muted">本赛季暂无你的正式球队。普通队员由负责人加入名单；需要组织球队时可前往球队报名。</p>
      <div v-for="section in teamSections" :key="section.title"><h2>{{ section.title }}</h2><div v-for="group in section.groups" :key="group.league"><h3>{{ group.league }}</h3><div class="team-list"><RouterLink v-for="t in group.items" :key="t.id" :to="(t.can_manage ? '/teams/' : '/public/teams/')+t.id" class="team-list-item"><span>{{ t.team_name }}</span><span class="muted">查看名单与比赛 →</span></RouterLink></div></div></div>
    </section>
    <TeamApplicationOverview/>
  </div>
</template>
<script setup>
import collegeCatalog from '../../../shared-data/colleges.json'
const colleges = collegeCatalog.map(item => item.name)
import { ref, computed, watch, onMounted } from 'vue'
import { api, session, messageOf } from '../session'
import { publicApi } from '../publicApi'
import TeamApplicationOverview from '../components/TeamApplicationOverview.vue'
import { teamGroups } from '../teamGroups'
const context = ref(null), loading = ref(true), error = ref('')
const teams=ref([]);
const seasons=ref([]),selectedSeason=ref('');let teamSequence=0
const teamSections=computed(()=>teamGroups(teams.value))
async function loadTeams(){const n=++teamSequence;teams.value=[];if(!selectedSeason.value)return;try{const d=await api.get('/my-teams',{params:{season_id:selectedSeason.value}});if(n===teamSequence)teams.value=d}catch(e){if(n===teamSequence)error.value=messageOf(e)}}
watch(selectedSeason,loadTeams)
const notifications = ref([]), labels = { unsubmitted: '未注册', pending: '待审核', approved: '已注册', returned: '已退回', withdrawn: '已撤回', revoked: '资格已撤销' }
async function load() { loading.value = true; error.value = ''; try { const [current, notices, list] = await Promise.all([api.get('/season-registration/current'), api.get('/notifications'),publicApi.get('/seasons')]); context.value = current; notifications.value = notices; seasons.value=list; selectedSeason.value=String(list.find(s=>s.is_active)?.id||list[0]?.id||'');await loadTeams() } catch(e) { error.value = messageOf(e) } finally { loading.value = false } }
async function markRead(notice) { try { await api.put(`/notifications/${notice.id}/read`, {}); notice.read_at = new Date().toISOString() } catch(e) { error.value = messageOf(e) } }
onMounted(load)
</script>
<style scoped>
@layer legacy {
.registration-link{margin-top:20px}.notifications{margin-bottom:24px}.notifications ul{padding:0;list-style:none}.notifications li{display:flex;align-items:center;justify-content:space-between;gap:20px;border-top:1px solid #e5ebf2;padding:13px 0}.notifications p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.notifications button{flex-shrink:0;font-size:12px}@media(max-width:600px){.notifications li{align-items:flex-start;flex-direction:column;gap:10px}}
}
</style>
