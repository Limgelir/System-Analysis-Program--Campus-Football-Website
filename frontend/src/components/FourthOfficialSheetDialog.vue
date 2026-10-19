<template>
  <div class="modal-mask" @click.self="close">
    <form class="sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="fourth-sheet-title" @submit.prevent="download">
      <div class="sheet-heading"><h3 id="fourth-sheet-title">生成四官单</h3><button type="button" data-close :disabled="busy" @click="close">关闭</button></div>
      <p>{{ schedule.field_order }} · {{ teamA }} vs {{ teamB }}</p>
      <fieldset :disabled="busy"><legend>选择四官单模板</legend>
        <label><input v-model="template" type="radio" value="eleven" name="fourth-sheet-template">11人制（大联赛）版本</label>
        <label><input v-model="template" type="radio" value="eight" name="fourth-sheet-template">8人制（足协杯）版本</label>
      </fieldset>
      <p class="sheet-help">{{ template === 'eight' ? '下载一页 Word 文档，自动填写队名、球服颜色、比赛日期和时间、场序、场地及本场球员名单，每队最多17人。' : '下载两页 Word 文档，自动填写赛程、裁判、队服颜色和本场球员名单，每队最多30人。' }}停赛球员的首发格标记“×”。</p>
      <p class="sheet-help">姓名后标注 (C) 队长、(GK) 守门员、(F) 外援、(S) 运训或足球特长生。长姓名自动调整字号，最多显示两行。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="sheet-actions"><button type="button" :disabled="busy" @click="close">取消</button><button type="submit" class="btn-primary" :disabled="busy">{{ busy ? '生成中…' : '生成并下载 Word' }}</button></div>
    </form>
  </div>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { scheduleAPI } from '../api/index.js'
import { downloadBlob, exportError } from '../utils/download.js'
const props = defineProps({ schedule: { type: Object, required: true } })
const emit = defineEmits(['close', 'downloaded'])
const template = ref('eleven'), busy = ref(false), error = ref('')
const teamA = computed(() => props.schedule.team_a_name_snapshot || props.schedule.team_a_name || '')
const teamB = computed(() => props.schedule.team_b_name_snapshot || props.schedule.team_b_name || '')
watch(template, () => { error.value = '' })
function close() { if (!busy.value) emit('close') }
async function download() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const blob = await scheduleAPI.generateFourthOfficialSheet(props.schedule.id, template.value)
    const safe = value => String(value || '').replace(/[<>:"/\\|?*\r\n]/g, '_').slice(0, 60)
    downloadBlob(blob, `四官单-${template.value === 'eight' ? 8 : 11}人制-${safe(props.schedule.field_order)}-${safe(teamA.value)}vs${safe(teamB.value)}.docx`)
    emit('downloaded'); emit('close')
  } catch (e) { error.value = await exportError(e) }
  finally { busy.value = false }
}
</script>
<style scoped>
.modal-mask{position:fixed;inset:0;background:rgba(15,23,42,.4);z-index:1000;display:grid;place-items:center;padding:16px}
.sheet-dialog{background:white;border-radius:16px;padding:24px;width:min(100%,560px);max-height:90vh;overflow:auto;box-sizing:border-box;box-shadow:0 20px 60px #17274430}
.sheet-heading,.sheet-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.sheet-heading h3{margin:0}.sheet-actions{justify-content:flex-end;margin-top:20px}
fieldset{border:0;padding:0;margin:20px 0}legend{font-weight:600;margin-bottom:12px}label{display:flex;gap:10px;align-items:center;padding:14px 10px;border:1px solid #dbe3ee;border-radius:8px;margin-top:10px}.unavailable,.sheet-help{color:#64748b}.sheet-help{font-size:14px;line-height:1.6}.error{color:#b91c1c}
button{cursor:pointer}button:disabled{cursor:wait}
</style>
