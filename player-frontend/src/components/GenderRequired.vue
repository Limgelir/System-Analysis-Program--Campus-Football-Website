<template>
  <dialog v-if="session.player && !session.player.gender" ref="dialog" class="modal-card gender-dialog" aria-labelledby="gender-title" @cancel.prevent>
    <h2 id="gender-title">请补充性别</h2>
    <p>性别是球员账号的基础信息，请选择后继续。提交后将锁定，如需修改请联系管理员。</p>
    <form @submit.prevent="save">
      <label>性别<select v-model="gender" aria-label="性别" required :disabled="busy"><option value="" disabled>请选择</option><option value="male">男</option><option value="female">女</option></select></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="primary full" :disabled="busy || !gender">{{ busy ? '保存中…' : '确认性别并继续' }}</button>
    </form>
  </dialog>
</template>
<script setup>
import { ref, watch, nextTick } from 'vue'
import { api, session, version, messageOf } from '../session'
const dialog = ref(null), gender = ref(''), busy = ref(false), error = ref('')
watch(() => Boolean(session.player && !session.player.gender), async required => {
  await nextTick()
  if (required && !dialog.value?.open) { gender.value = ''; error.value = ''; dialog.value?.showModal() }
  else if (!required) dialog.value?.close()
}, { immediate: true })
async function save() {
  busy.value = true; error.value = ''
  try { session.player = await api.put('/me/gender', { gender: gender.value }, version()) }
  catch (e) {
    error.value = messageOf(e)
    if (e.response?.status === 409) { try { session.player = await api.get('/me') } catch { /* Keep the actionable save error. */ } }
  } finally { busy.value = false }
}
</script>
<style scoped>
.gender-dialog{box-sizing:border-box;width:min(440px,calc(100% - 32px));max-height:calc(100dvh - 40px);overflow:auto;padding:28px;border:1px solid #d1deec;border-radius:22px;color:#253c56;background:#fff;box-shadow:0 20px 80px #17355630}.gender-dialog::backdrop{background:rgb(229 237 247 / 90%)}.gender-dialog p{line-height:1.8}.gender-dialog select{width:100%;margin:8px 0 20px}.gender-dialog h2{margin-top:0}
</style>
