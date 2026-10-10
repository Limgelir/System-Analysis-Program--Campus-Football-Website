<template><div><p v-if="loading">正在读取学籍截图…</p><p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p><img v-if="url" :src="url" alt="1系统学籍信息截图"></div></template>
<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import api from '../api/http'
const props = defineProps({ registrationId: Number, fileId: Number, sourcePath: String }), url = ref(''), loading = ref(false), error = ref(''); let sequence = 0
function clear() { if (url.value) URL.revokeObjectURL(url.value); url.value = '' }
async function load() { const current = ++sequence; clear(); error.value = ''; if (!props.sourcePath && !props.fileId) return; loading.value = true; try { const blob = await api.get(props.sourcePath || `/player-admin/season-registrations/${props.registrationId}/files/${props.fileId}`, { responseType: 'blob' }); if (current === sequence) url.value = URL.createObjectURL(blob) } catch(e) { if (current === sequence) error.value = e.response?.status === 410 ? '材料已清理。' : '截图读取失败，请刷新或核对文件。' } finally { if (current === sequence) loading.value = false } }
watch(() => [props.registrationId, props.fileId, props.sourcePath], load, { immediate: true }); onBeforeUnmount(() => { sequence++; clear() })
</script>
<style scoped>
@layer legacy {
img{width:100%;max-height:620px;object-fit:contain;background:#f3f6fa;border:1px solid #dce5ef;border-radius:8px}p{color:#7c4e32;font-size:14px}
}
</style>
