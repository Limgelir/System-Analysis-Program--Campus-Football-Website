<template>
  <form class="college-settings" v-draft="{ value: form, ready: loaded, resetKey: savedVersion }" @submit.prevent="save">
    <h3>账号学院</h3>
    <p>可随时修改，保存后立即生效。已提交的赛季注册和审核记录保留原学院。</p>
    <fieldset :disabled="loading || saving || !loaded">
      <label for="settings-college">学院</label>
      <CollegeSelect id="settings-college" v-model="form.college" show-empty-legacy />
      <button type="submit">{{ saving ? '保存中…' : '保存学院' }}</button>
    </fieldset>
    <p v-if="loading" role="status">正在读取学院…</p>
    <p v-if="message" :role="error ? 'alert' : 'status'" :class="{ error }">{{ message }}</p>
    <button v-if="!loaded && !loading" type="button" @click="load">重新读取学院</button>
  </form>
</template>
<script setup>
import { ref, reactive, onMounted } from 'vue'
import { refereeAPI } from '../api'
import CollegeSelect from '../../../shared-ui/CollegeSelect.vue'
const props = defineProps({ refereeId: { type: [Number, String], required: true } })
const emit = defineEmits(['saved', 'saving'])
const form = reactive({ college: '' }), loaded = ref(false), loading = ref(false), saving = ref(false), error = ref(false), message = ref(''), savedVersion = ref(0)
async function load() {
  if (loading.value || saving.value) return
  loading.value = true; loaded.value = false; message.value = ''
  try { const { data } = await refereeAPI.getInfo(props.refereeId); form.college = data.college || ''; loaded.value = true; error.value = false }
  catch (e) { error.value = true; message.value = e?.response?.data?.message || e.message || '读取学院失败' }
  finally { loading.value = false }
}
async function save() {
  if (!loaded.value || loading.value || saving.value) return
  saving.value = true; emit('saving', true); error.value = false; message.value = ''
  try {
    const { data } = await refereeAPI.updateCollege(props.refereeId, { college: form.college })
    form.college = data.college; savedVersion.value++; message.value = '学院已保存'; emit('saved', data)
  } catch (e) { error.value = true; message.value = e?.response?.data?.message || e.message || '保存学院失败' }
  finally { saving.value = false; emit('saving', false) }
}
onMounted(load)
</script>
<style scoped>
.college-settings{padding-bottom:20px;margin-bottom:20px;border-bottom:1px solid #dbe3ed;min-width:0}
h3{margin:0 0 10px}p{font-size:14px;line-height:1.6;color:#52627a;overflow-wrap:anywhere}
fieldset{padding:0;border:0;min-width:0;display:grid;gap:10px}
button{box-sizing:border-box;width:100%;font:inherit;padding:10px 12px;border:0;border-radius:6px;background:#245ac7;color:white;cursor:pointer;margin-top:8px}
button:disabled{opacity:.5;cursor:not-allowed}.error{color:#b42318}
</style>
