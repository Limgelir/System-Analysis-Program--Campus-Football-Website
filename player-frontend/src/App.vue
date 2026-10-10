<template>
  <div class="ui-app"><AppShell role="球员与公开查询" :home="session.player ? '/dashboard' : '/public'" :groups="groups">
    <template #account><button v-if="session.player" class="secondary" :disabled="loggingOut" @click="logout">退出登录</button><RouterLink v-else class="secondary" to="/login">球员登录</RouterLink></template>
  <div v-if="logoutError" class="banner error" role="alert">{{ logoutError }}</div>
  <RouterView :key="$route.path" />
  </AppShell><GenderRequired /></div>
</template>
<script setup>
import { ref, computed } from 'vue'
import GenderRequired from './components/GenderRequired.vue'
import AppShell from '../../shared-ui/AppShell.vue'
import { confirmDraftLeave } from '../../shared-ui/interaction.js'
import { useRouter } from 'vue-router'
import { api, session, version, clearSession, messageOf } from './session'
const router = useRouter(), loggingOut = ref(false), logoutError = ref('')
const groups = computed(() => session.player ? [
  {title:'我的赛季',items:[{label:'我的主页',to:'/dashboard'},{label:'个人学籍资格',to:'/season-registration'},{label:'球队报名与管理',to:'/team-applications',match:r=>r.path.startsWith('/team-applications')||r.path.startsWith('/teams/')}]},
  {title:'公开查询与账号',items:[{label:'球队与赛程',to:'/public',match:r=>r.path.startsWith('/public')},{label:'账号设置',to:'/account'}]}
] : [{title:'校园足球',items:[{label:'球队与赛程',to:'/public',match:r=>r.path.startsWith('/public')},{label:'球员登录',to:'/login'},{label:'注册球员账号',to:'/register'}]}])
async function logout() {
  if (!confirmDraftLeave()) return
  loggingOut.value = true; logoutError.value = ''
  try { session.player = await api.get('/me'); await api.post('/logout', {}, version()); clearSession(); await router.push('/login') }
  catch (e) { logoutError.value = messageOf(e) } finally { loggingOut.value = false }
}
</script>
