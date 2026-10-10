<template>
  <div class="auth-layout">
    <section v-if="!$studioEnabled" class="auth-intro"><span class="eyebrow">TONGJI CAMPUS FOOTBALL</span><h1>从校园出发，<br>为热爱上场。</h1><p>在这里管理你的球员账号，<br>为每一个新赛季做好准备。</p><div class="pitch" aria-hidden="true"><span></span></div></section>
    <section class="card auth-card">
      <h1 v-if="$studioEnabled">{{ registering ? '注册球员账号' : '球员登录' }}</h1>
      <template v-else><span class="eyebrow">球员账号</span><h2>{{ registering ? '注册账号' : '欢迎回来' }}</h2></template>
      <p class="muted">{{ registering ? '填写你的真实姓名、学号、性别和学院。' : '使用球员账号的学号与密码登录。' }}</p>
      <div v-if="notice" class="notice" role="status">{{ notice }}</div>
      <form ref="authForm" v-draft="{ value: form, dirty: registering ? undefined : false }" @submit.prevent="submit">
        <label v-if="registering">姓名<input v-model="form.name" autocomplete="name" maxlength="100" required></label>
        <label>学号<input v-model="form.student_id" autocomplete="username" maxlength="50" required autocapitalize="off" spellcheck="false"></label>
        <label v-if="registering">学院<CollegeSelect v-model="form.college" /></label>
        <label v-if="registering">性别<select v-model="form.gender" aria-label="性别" required><option value="" disabled>请选择</option><option value="male">男</option><option value="female">女</option></select></label><p v-if="registering" class="field-help">性别提交后锁定，如需修改请联系管理员。</p>
        <label>密码<input v-model="form.password" type="password" :autocomplete="registering ? 'new-password' : 'current-password'" required></label>
        <template v-if="registering"><p class="field-help">至少 8 位，包含大小写字母、数字、符号中至少两类；最多 72 字节。</p><label>确认密码<input v-model="form.password_confirm" type="password" autocomplete="new-password" required></label></template>
        <div v-if="error" class="error" role="alert">{{ error }}</div>
        <button class="primary full" :disabled="busy">{{ busy ? '请稍候…' : registering ? '注册账号' : '登录' }}</button>
      </form>
      <p class="auth-switch"><template v-if="registering">已有账号？<RouterLink to="/login">立即登录</RouterLink></template><template v-else>首次使用？<RouterLink to="/register">注册球员账号</RouterLink></template></p>
      <p v-if="!registering" class="field-help">忘记密码或学号被误用，请联系管理员核实处理。</p>
    </section>
  </div>
</template>
<script setup>
import CollegeSelect from '../../../shared-ui/CollegeSelect.vue'
import { computed, reactive, ref } from 'vue'
import { markDraftSaved } from '../../../shared-ui/interaction.js'
import { useRoute, useRouter } from 'vue-router'
import { api, setSession, messageOf } from '../session'
const route = useRoute(), router = useRouter(), registering = computed(() => route.path === '/register')
const authForm = ref(null)
const form = reactive({ name: '', student_id: String(route.query.student_id || ''), college: '', gender: '', password: '', password_confirm: '' }), busy = ref(false), error = ref('')
const notices = { registered: '账号注册成功，请登录。', changed: '修改成功，请重新登录。', expired: '登录已失效，请重新登录。' }
const notice = computed(() => notices[route.query.notice] || '')
async function submit() {
  busy.value = true; error.value = ''
  try {
    if (registering.value) {
      await api.post('/register', form)
      markDraftSaved(authForm.value)
      await router.push({ path: '/login', query: { notice: 'registered', student_id: form.student_id } })
    } else {
      setSession(await api.post('/login', { student_id: form.student_id, password: form.password }))
      await router.push('/dashboard')
    }
  } catch (e) { error.value = messageOf(e) } finally { busy.value = false }
}
</script>
<style scoped>
.auth-card select{display:block;box-sizing:border-box;width:100%;min-height:44px;margin-top:6px;padding:10px 12px;border:1px solid #c9d5e2;border-radius:7px;background:#fff;color:#243b55;font:inherit}
</style>
