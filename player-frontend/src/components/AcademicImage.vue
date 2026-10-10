<template><div class="academic-image"><p v-if="loading" class="muted">正在读取学籍截图…</p><p v-if="error" class="error" role="alert">{{ error }} <button @click="load">重试</button></p><img v-if="url" :src="url" alt="1系统学籍信息截图"></div></template>
<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { api, messageOf } from '../session'
const props = defineProps({ registrationId: Number, fileId: Number, sourcePath: String })
const url = ref(''), loading = ref(false), error = ref(''); let sequence = 0
function clear() { if (url.value) URL.revokeObjectURL(url.value); url.value = '' }
async function load() {
  const current = ++sequence; clear(); error.value = ''; if (!props.sourcePath && (!props.registrationId || !props.fileId)) return
  loading.value = true
  try { const blob = await api.get(props.sourcePath || `/season-registration/${props.registrationId}/files/${props.fileId}`, { responseType: 'blob' }); if (current === sequence) url.value = URL.createObjectURL(blob) }
  catch(e) { if (current === sequence) error.value = messageOf(e) } finally { if (current === sequence) loading.value = false }
}
watch(() => [props.registrationId, props.fileId, props.sourcePath], load, { immediate: true })
onBeforeUnmount(() => { sequence++; clear() })
</script>
<style scoped>
@layer legacy {
.academic-image img{display:block;width:100%;max-height:600px;object-fit:contain;border:1px solid #dae4ef;border-radius:8px;background:#f6f8fb}
}
</style>
