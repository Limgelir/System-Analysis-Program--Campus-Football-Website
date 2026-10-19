<template>
  <div v-if="session.player" class="content account-content"><span class="eyebrow">球员账号</span><h1>账号设置</h1><p class="muted">球员编号 {{ session.player.id }} · 账号历史随球员编号保留。</p>
    <div v-if="session.player.must_change_password" class="notice" role="status">管理员已重置密码，请先用临时密码设置新密码。</div>
    <div v-if="error" class="error" role="alert">{{ error }} <button v-if="conflict" :disabled="busy" @click="reload">刷新最新资料</button></div><div v-if="success" class="notice" role="status">{{ success }}</div>
    <div class="settings-grid">
      <section v-if="!session.player.must_change_password" class="card"><h2>基本资料</h2><p>性别：{{ session.player.gender==='male'?'男':session.player.gender==='female'?'女':'未填写' }}（已锁定，如需修改请联系管理员）</p><p class="field-help">当前学院：{{ session.player.college || '未填写' }}。需要修改学院时，请在下方提交截图申请审核。</p><form class="profile-form" v-draft="{ value: profile, resetKey: profileSaved }" @submit.prevent="save('profile')"><label>姓名<input v-model="profile.name" required maxlength="100"></label><button class="primary" :disabled="busy">保存资料</button></form></section>
      <section class="card"><h2>修改密码</h2><form v-draft="{ value: password }" @submit.prevent="save('password')"><label>{{ session.player.must_change_password ? '临时密码' : '当前密码' }}<input v-model="password.current_password" type="password" autocomplete="current-password" required></label><label>新密码<input v-model="password.new_password" type="password" autocomplete="new-password" required></label><p class="field-help">至少 8 位，包含大小写字母、数字、符号中至少两类；最多 72 字节。</p><label>确认新密码<input v-model="password.password_confirm" type="password" autocomplete="new-password" required></label><button class="primary" :disabled="busy">修改密码并重新登录</button></form></section>
      <section v-if="!session.player.must_change_password" class="card"><h2>修改登录学号</h2><p class="muted">当前学号：{{ session.player.student_id }}</p><p class="field-help">修改后使用新学号登录，历史保留。旧学号立即释放，其他人可以注册使用。</p><form v-draft="{ value: student }" @submit.prevent="save('student')"><label>新学号<input v-model="student.student_id" autocomplete="username" required maxlength="50"></label><label>验证当前密码<input v-model="student.current_password" type="password" autocomplete="current-password" required></label><button class="primary" :disabled="busy">修改学号并重新登录</button></form></section>
      <CollegeChangeSettings v-if="!session.player.must_change_password"/>
    </div>
  </div>
</template>
<script setup>
import CollegeChangeSettings from '../components/CollegeChangeSettings.vue'
import { reactive, ref } from 'vue'
import { confirmDraftLeave } from '../../../shared-ui/interaction.js'
import { useRouter } from 'vue-router'
import { api, session, version, messageOf, clearSession } from '../session'
const router = useRouter(), profile = reactive({ name: session.player.name })
const password = reactive({ current_password: '', new_password: '', password_confirm: '' }), student = reactive({ student_id: '', current_password: '' })
// 学院组件可刷新共享账号；表单版本只随其内容加载或成功保存更新。
const profileSaved = ref(0), profileRevision = ref(session.player.revision)
const busy = ref(false), error = ref(''), success = ref(''), conflict = ref(false)
async function reload() { if(!confirmDraftLeave(document.querySelector('.profile-form')))return; busy.value = true; try { session.player = await api.get('/me'); Object.assign(profile, { name: session.player.name }); profileRevision.value = session.player.revision; profileSaved.value++; error.value = ''; conflict.value = false } catch(e) { error.value = messageOf(e) } finally { busy.value = false } }
async function save(kind) {
  busy.value = true; error.value = ''; success.value = ''; conflict.value = false
  try {
    if (kind === 'profile') { session.player = await api.put('/me', profile, { headers: { 'If-Match': String(profileRevision.value) } }); profileRevision.value = session.player.revision; profileSaved.value++; success.value = '基本资料已保存。' }
    else { await api.put(kind === 'student' ? '/me/student-id' : '/me/password', kind === 'student' ? student : password, version()); clearSession(); await router.push('/login?notice=changed') }
  } catch(e) { error.value = messageOf(e); conflict.value = e.response?.data?.code === 'PLAYER_REVISION_CONFLICT' } finally { busy.value = false }
}
</script>
