<template>
  <details class="schedule-import card">
    <summary>批量导入赛程</summary>
    <p class="hint">比赛时间可填15:00或15:00-16:00，结束时间仅展示。同赛季、同赛事内场序相同将询问是否替换；原赛程与新赛程均须尚未开赛，已填写报告不能替换。每批最多200场、文件不超过2MB。</p>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <p v-if="success" class="alert success" role="status">{{ success }}</p>
    <form @submit.prevent="previewFile()">
      <fieldset :disabled="busy">
        <div class="import-fields">
          <label>导入比赛类型
            <select v-model="matchType" required @change="invalidate">
              <option value="">请选择比赛类型</option>
              <CompetitionOptions :season-id="season.id" />
            </select>
          </label>
          <label>赛程文件
            <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" required @change="selectFile">
          </label>
        </div>
        <div class="format-options">
          <label><input v-model="futsal" type="checkbox" @change="invalidate"> 五人制裁判安排</label>
          <label v-if="!futsal"><input v-model="fourthRequired" type="checkbox" @change="invalidate"> 本批需要第四官员</label>
          <label><input v-model="supervisorRequired" type="checkbox" @change="invalidate"> 本批需要裁判监督</label>
        </div>
        <p class="hint">以上裁判安排选项仅用于新建赛程；替换时保留原有设置及报名、选派记录。</p>
        <div class="import-actions">
          <button type="button" class="secondary" @click="downloadTemplate">下载赛程模板</button>
          <button type="submit" :disabled="!file || !matchType">{{ busy ? '处理中…' : '检查并预览' }}</button>
        </div>
      </fieldset>
    </form>

    <section v-if="preview" class="preview" aria-label="赛程导入预览">
      <h3>导入预览 · {{ preview.rows.length }} 场</h3>
      <p>{{ preview.season_name }} · {{ preview.match_type }} · {{ preview.futsal ? '五人制' : '普通裁判安排' }} · {{ preview.supervisor_required ? '需要监督' : '无需监督' }}</p>
      <ul v-if="preview.errors.length" class="import-errors" role="alert">
        <li v-for="(item, index) in preview.errors" :key="index">{{ item.row_number ? `第 ${item.row_number} 行：` : '' }}{{ item.message }}</li>
      </ul>
      <p v-if="unresolved.length" class="hint">有 {{ unresolved.length }} 个队名需要确认。请核对对应球队，或修改文件后重新上传；新球队请先到队伍管理建立。</p>
      <button v-if="unresolved.length" type="button" class="secondary" :disabled="busy" @click="openNameDialog">核对队伍名称</button>
      <p v-for="item in confirmedNames" :key="item.name" class="name-note">已确认：“{{ item.name }}” → “{{ item.team_name }}”</p>
      <div class="preview-table">
        <table>
          <thead><tr><th>文件行</th><th>场序</th><th>日期／比赛时间</th><th>主队</th><th>客队</th><th>场地</th><th>处理方式</th></tr></thead>
          <tbody><tr v-for="row in preview.rows" :key="row.row_number">
            <td>{{ row.row_number }}</td><td>{{ row.field_order }}</td><td>{{ row.match_date }} {{ displayMatchTime(row.match_time, row.match_end_time) }}</td>
            <td>{{ row.team_a_name || row.home_name }}<small v-if="!row.team_a_id">（待确认）</small></td>
            <td>{{ row.team_b_name || row.away_name }}<small v-if="!row.team_b_id">（待确认）</small></td>
            <td>{{ row.venue === '其它' ? row.venue_detail : row.venue }}</td>
            <td>{{ row.replacement ? '待确认替换' : '新建' }}</td>
          </tr></tbody>
        </table>
      </div>
      <p v-if="preview.errors.length" class="hint">请修正上述问题后重新上传；当前未添加任何赛程。</p>
      <button type="button" :disabled="busy || !preview.can_confirm" @click="requestConfirm">{{ busy ? '处理中…' : replacementRows.length ? `确认导入 ${preview.rows.length} 场（替换 ${replacementRows.length} 场）` : `确认添加 ${preview.rows.length} 场赛程` }}</button>
    </section>

    <dialog ref="replacementDialog" aria-labelledby="schedule-replacement-title" @cancel="cancelNameDialog">
      <h3 id="schedule-replacement-title">是否替换已有赛程？</h3>
      <p>{{ replacementNotice }}</p>
      <p>本批新建 {{ preview ? preview.rows.length - replacementRows.length : 0 }} 场，替换 {{ replacementRows.length }} 场；取消不会保存本批任何赛程。</p>
      <p v-for="row in replacementRows" :key="row.row_number" class="replacement-comparison">{{ replacementDescription(row) }}</p>
      <div class="import-actions">
        <button type="button" class="secondary" :disabled="busy" @click="replacementDialog.close()">取消替换</button>
        <button type="button" :disabled="busy" @click="confirmImport">确认替换并导入</button>
      </div>
    </dialog>
    <dialog ref="nameDialog" aria-labelledby="schedule-name-title" @cancel="cancelNameDialog">
      <h3 id="schedule-name-title">确认队伍名称</h3>
      <p>以下队名与当前比赛类型中的球队不完全一致。请选择实际对应的球队，同一名称在整份文件中统一替换。</p>
      <form @submit.prevent="applyMappings">
        <div v-for="(item, index) in unresolved" :key="item.name" class="name-choice">
          <label :for="`team-map-${index}`">文件队名：{{ item.name }}</label>
          <p v-if="item.candidates.length" class="hint">相似队伍：{{ item.candidates.map(t => t.team_name).join('、') }}</p>
          <p v-else class="hint">没有找到相似队名，请核对文件或手动选择。</p>
          <select :id="`team-map-${index}`" v-model="mappings[item.name]" required :disabled="busy">
            <option value="">请选择对应球队</option>
            <option v-for="team in sortedTeams(item)" :key="team.id" :value="team.id">{{ team.team_name }}{{ item.candidates.some(t => t.id === team.id) ? '（相似）' : '' }}</option>
          </select>
        </div>
        <p v-if="dialogError" role="alert" class="import-errors">{{ dialogError }}</p>
        <div class="import-actions">
          <button type="button" class="secondary" :disabled="busy" @click="nameDialog.close()">返回修改文件</button>
          <button type="submit" :disabled="busy || unresolved.some(item => !mappings[item.name])">确认对应队伍并重新检查</button>
        </div>
      </form>
    </dialog>
  </details>
</template>

<script setup>
import { computed, ref } from 'vue'
import CompetitionOptions from './CompetitionOptions.vue'
import { scheduleAPI } from '../api'
import { downloadBlob, exportError } from '../utils/download'
import { displayMatchTime } from '../utils/matchTime.js'
import { replacementDescription, replacementNotice } from '../utils/scheduleReplacement.js'

const props = defineProps({ season: { type: Object, required: true } })
const emit = defineEmits(['imported'])
const matchType = ref(''), file = ref(null), fileInput = ref(null)
const futsal = ref(false), fourthRequired = ref(true), supervisorRequired = ref(false)
const preview = ref(null), busy = ref(false), error = ref(''), success = ref(''), dialogError = ref('')
const mappings = ref(Object.create(null)), nameDialog = ref(null)
const replacementDialog = ref(null)
const replacementRows = computed(() => preview.value?.rows.filter(row => row.replacement) || [])
const unresolved = computed(() => preview.value?.name_matches.filter(m => !m.team_id) || [])
const confirmedNames = computed(() => preview.value?.name_matches.filter(m => m.status === 'confirmed') || [])
function invalidate() { preview.value = null; mappings.value = Object.create(null); error.value = ''; success.value = '' }
function selectFile(event) {
  invalidate()
  file.value = event.target.files?.[0] || null
  if (file.value?.size > 2 * 1024 * 1024) { error.value = '文件不能超过2MB'; file.value = null; event.target.value = '' }
}
function openNameDialog() { dialogError.value = ''; nameDialog.value.showModal() }
function cancelNameDialog(event) { if (busy.value) event.preventDefault() }
function sortedTeams(item) {
  const ids = new Set(item.candidates.map(t => t.id))
  return [...item.candidates, ...preview.value.teams.filter(t => !ids.has(t.id))]
}
async function downloadTemplate() {
  busy.value = true; error.value = ''
  try { downloadBlob(await scheduleAPI.importTemplate(), '赛程导入模板.xlsx') }
  catch (e) { error.value = await exportError(e) }
  finally { busy.value = false }
}
async function previewFile(fromDialog = false) {
  if (busy.value || !file.value || !matchType.value) return false
  busy.value = true; error.value = ''; success.value = ''; dialogError.value = ''
  try {
    const form = new FormData()
    form.append('file', file.value)
    for (const [key, value] of Object.entries({ season_id: props.season.id, match_type: matchType.value, futsal: futsal.value, fourth_required: fourthRequired.value, supervisor_required: supervisorRequired.value, team_mappings: JSON.stringify(mappings.value) })) form.append(key, String(value))
    const result = (await scheduleAPI.previewImport(form)).data
    preview.value = result
    for (const item of unresolved.value) if (!Object.hasOwn(mappings.value, item.name)) mappings.value[item.name] = ''
    if (unresolved.value.length && !fromDialog) openNameDialog()
    return true
  } catch (e) {
    const message = e.response?.data?.message || '检查失败，请重试'
    if (fromDialog) dialogError.value = message
    else { error.value = message; preview.value = null }
    return false
  } finally { busy.value = false }
}
async function applyMappings() {
  if (await previewFile(true)) nameDialog.value.close()
}
function requestConfirm() {
  if (replacementRows.value.length) replacementDialog.value.showModal()
  else confirmImport()
}
async function confirmImport() {
  if (busy.value || !preview.value?.can_confirm) return
  busy.value = true; error.value = ''
  try {
    const { data } = await scheduleAPI.confirmImport({ preview: preview.value.preview, preview_token: preview.value.preview_token, confirm_replacements: replacementRows.value.map(row => row.replacement.id) })
    replacementDialog.value.close()
    preview.value = null; file.value = null; fileInput.value.value = ''; mappings.value = Object.create(null)
    success.value = data.replaced_count ? `已新建 ${data.created_count} 场、替换 ${data.replaced_count} 场，原报名及选派已保留。` : `已添加 ${data.count} 场赛程，裁判可在裁判选派中安排。`
    emit('imported', data)
  } catch (e) {
    replacementDialog.value.close()
    error.value = e.response?.data?.message || '提交结果暂未确认，请先刷新赛程列表核对，再重新预览，避免重复操作'
    preview.value.can_confirm = false
  } finally { busy.value = false }
}
</script>

<style scoped>
.schedule-import { margin-bottom: 24px; padding: 22px; background: white; border: 1px solid #dce5f1; border-radius: 12px; min-width: 0; }
summary { cursor: pointer; font-size: 20px; font-weight: 700; color: #1f4280; }
.hint { color: #536278; line-height: 1.7; font-size: 14px; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.import-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.import-fields label, .name-choice label { display: grid; gap: 8px; font-weight: 600; }
input[type=file], select { box-sizing: border-box; width: 100%; min-width: 0; padding: 10px; border: 1px solid #b6c5da; border-radius: 7px; background: #fff; }
.format-options, .import-actions { display: flex; flex-wrap: wrap; gap: 14px; margin: 18px 0; }
.format-options label { display: flex; align-items: center; gap: 6px; }
input[type=checkbox] { width: auto; }
button { width: auto; padding: 10px 18px; border: 0; border-radius: 7px; background: #2458a6; color: #fff; cursor: pointer; }
button.secondary { background: #edf3fc; color: #204d89; border: 1px solid #c4d3e9; }
button:disabled { opacity: .55; cursor: not-allowed; }
.preview { border-top: 1px solid #dce5f1; margin-top: 20px; padding-top: 10px; }
.preview-table { max-height: 440px; overflow: auto; margin: 16px 0; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 12px; text-align: left; border-bottom: 1px solid #dce5f1; white-space: nowrap; }
th { background: #edf3fc; }
small, .import-errors { color: #a92a2a; }
.import-errors { line-height: 1.8; max-height: 220px; overflow: auto; }
.name-note { color: #275784; font-size: 14px; }
dialog { margin: auto; width: min(640px, calc(100vw - 32px)); max-height: 85vh; overflow: auto; box-sizing: border-box; padding: 24px; border: 1px solid #c4d3e9; border-radius: 12px; color: #24344d; }
dialog::backdrop { background: #15263e88; }
dialog p { line-height: 1.6; overflow-wrap: anywhere; }
.replacement-comparison { white-space: pre-line; padding: 12px 0; border-bottom: 1px solid #dce5f1; }
.name-choice { padding: 16px 0; border-bottom: 1px solid #dce5f1; }
@media (max-width: 640px) { .import-fields { grid-template-columns: 1fr; } .schedule-import { padding: 16px; } .import-actions button { flex: 1 1 160px; } dialog { padding: 18px; } }
</style>
