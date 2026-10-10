<template>
  <div class="referee-picker" :class="{ disabled }">
    <div v-if="selectedDisplay" class="selected-card">
      <div><strong>{{ selectedDisplay.name }}</strong><small>{{ selectedDisplay.student_id || selectedDisplay.note || '' }}</small></div>
      <span class="source-badge">{{ selectedDisplay.source_type === 'external' ? '非系统裁判' : '系统裁判' }}</span>
      <button v-if="!disabled" type="button" aria-label="清除选择" @click="clearSelection">×</button>
    </div>
    <input v-model="query" type="search" :disabled="disabled || !seasonId || creating"
      :placeholder="seasonId ? '搜索' + roleLabel + '姓名或学号' : '缺少赛季信息'" @focus="openResults" @input="scheduleSearch" />
    <div v-if="open && !disabled" class="result-panel">
      <div v-if="loading" class="result-state">正在搜索…</div>
      <div v-else-if="error" class="result-state error">{{ error }} <button type="button" @click="loadPage(1)">重试</button></div>
      <template v-else>
        <template v-for="(item, index) in availableItems" :key="itemKey(item)">
          <div v-if="scheduleId && (index === 0 || Boolean(item.signed_up) !== Boolean(availableItems[index - 1].signed_up))"
            class="result-group-heading" :class="{ 'is-signed': item.signed_up, 'has-gap': index > 0 }" role="heading" aria-level="4">
            <strong>{{ item.signed_up ? '已报名' : '未报名' }}</strong>
            <span>{{ item.signed_up ? '优先显示' : '仍可选派' }}</span>
          </div>
        <button class="result-item" type="button" @click="selectItem(item)">
          <span class="result-main"><strong>{{ item.name_snapshot }}</strong>
            <small>{{ item.student_id || ('名单编号 #' + item.external_referee_id) }} {{ item.grade_snapshot || '' }}</small>
            <small>{{ item.note || formatTypes(item) }}</small><small v-if="scheduleId">{{ item.signed_up ? (item.signup_rank===0 ? '已报名 · 意向匹配' : '已报名 · 其他意向') : '未报名' }}<span v-if="item.signed_up"> · {{ intentionText(item.signup_intentions) }}</span></small><small v-if="item.signup_venue_changed">比赛场地已变更，需核对</small><small v-if="item.signup_time_changed">比赛时间已变更，需核对</small></span>
          <span class="source-badge">{{ item.source_type === 'external' ? '非系统裁判' : '系统裁判' }}</span>
        </button>
        </template>
        <div v-if="!availableItems.length" class="result-state">没有匹配的可选裁判</div>
        <div v-if="pagination.total_pages > 1" class="result-pagination">
          <button type="button" :disabled="pagination.page <= 1" @click="loadPage(pagination.page - 1)">上一页</button>
          <span>{{ pagination.page }} / {{ pagination.total_pages }}</span>
          <button type="button" :disabled="pagination.page >= pagination.total_pages" @click="loadPage(pagination.page + 1)">下一页</button>
        </div>
        <button v-if="query.trim() && !createOpen" type="button" class="result-item result-create" @click="beginCreate">新增非系统裁判“{{ query.trim() }}”</button>
      </template>
    </div>
    <form v-if="createOpen && !disabled" class="selected-card" style="display:flex;flex-direction:column;align-items:stretch" @submit.prevent="createExternal">
      <strong>新增非系统裁判（无登录账号）</strong>
      <label>姓名<input v-model="newName" maxlength="100" required :disabled="creating" /></label>
      <label>备注/来源<input v-model="newNote" maxlength="255" :disabled="creating" placeholder="可用于区分同名人员" /></label>
      <p v-if="createError" role="alert">{{ createError }}</p>
      <button type="submit" :disabled="creating">{{ creating ? '创建中…' : '创建并选中' }}</button>
      <button type="button" :disabled="creating" @click="createOpen = false">取消</button>
    </form>
    <button v-if="open" class="close-results" type="button" @click="closeResults">收起搜索结果</button>
  </div>
</template>

<script>
import { intentionText } from '../utils/matchSignup.js'
import { officialAPI } from '../api/index.js'
function key(value) {
  if (!value) return ''
  return String(value).includes(':') ? String(value) : 'system:' + value
}
export default {
  name: 'SearchableRefereeSelect',
  props: {
    modelValue: { type: [String, Number], default: '' },
    scheduleId: { type:[String,Number], default:null },
    seasonId: { type: [String, Number], default: null },
    roleField: { type: String, default: 'main_referee_id' },
    roleLabel: { type: String, default: '裁判' },
    excludedIds: { type: Array, default: () => [] },
    currentOption: { type: Object, default: null },
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  data() { return {
    query:'',open:false,loading:false,error:'',items:[],selectedItem:null,
    pagination:{page:1,total:0,total_pages:0},timer:null,requestSequence:0,
    createOpen:false,newName:'',newNote:'',creating:false,createError:''
  } },
  computed: {
    roleCode() { return ({main_referee_id:'main',assistant1_id:'assistant1',assistant2_id:'assistant2',fourth_official_id:'fourth',supervisor_id:'supervisor'})[this.roleField] },
    selectedDisplay() {
      if (!this.modelValue) return null
      const item = [this.selectedItem, ...this.items].find(item => item && this.itemKey(item) === key(this.modelValue))
      if (item) return { ...item, name:item.name_snapshot }
      if (this.currentOption && key(this.currentOption.id) === key(this.modelValue)) return this.currentOption
      return {name:'裁判 #' + this.modelValue,source_type:String(this.modelValue).startsWith('external:') ? 'external' : 'system'}
    },
    availableItems() {
      const excluded = new Set(this.excludedIds.filter(Boolean).map(key))
      return this.items.filter(item => !excluded.has(this.itemKey(item)))
    }
  },
  watch: {
    scheduleId() { this.invalidate();this.items=[];this.selectedItem=null;if(this.open)this.loadPage(1) },
    seasonId() { this.invalidate(); this.items=[]; this.selectedItem=null; this.createOpen=false; if(this.open && this.seasonId) this.loadPage(1) },
    disabled(value) { if(value) { this.invalidate(); this.open=false; this.createOpen=false } },
    modelValue(value) { if(!value) this.selectedItem=null }
  },
  beforeUnmount() { this.invalidate() },
  methods: {
    intentionText(value){return intentionText(value)},
    itemKey(item) { return (item.source_type || 'system') + ':' + (item.referee_id || item.external_referee_id) },
    invalidate() { this.requestSequence++; if(this.timer) window.clearTimeout(this.timer); this.loading=false },
    openResults() { if(this.disabled || !this.seasonId) return; this.open=true; this.loadPage(1) },
    closeResults() { this.invalidate(); this.open=false },
    scheduleSearch() {
      this.invalidate(); this.open=true; this.loading=true
      this.timer=window.setTimeout(() => this.loadPage(1),320)
    },
    async loadPage(page) {
      if(this.disabled || !this.seasonId) return
      const sequence=++this.requestSequence
      this.loading=true; this.error=''
      try {
        const response=await officialAPI.candidates({season_id:this.seasonId,schedule_id:this.scheduleId||undefined,role:this.roleCode,query:this.query.trim(),page,page_size:20})
        if(sequence!==this.requestSequence) return
        this.items=response.data.items || []
        this.pagination=response.data.pagination
      } catch(error) {
        if(sequence!==this.requestSequence) return
        this.items=[]; this.error=error?.response?.data?.message || error.message || '搜索失败'
      } finally { if(sequence===this.requestSequence) this.loading=false }
    },
    selectItem(item) { this.selectedItem=item; this.$emit('update:modelValue',this.itemKey(item)); this.query=''; this.closeResults() },
    clearSelection() { this.selectedItem=null; this.$emit('update:modelValue','') },
    beginCreate() { this.newName=this.query.trim(); this.newNote=''; this.createError=''; this.createOpen=true },
    async createExternal() {
      if(this.creating || this.disabled) return
      this.creating=true; this.createError=''
      const data={name:this.newName.trim(),note:this.newNote.trim()}
      try {
        let response
        try { response=await officialAPI.create(data) } catch(error) {
          if(error?.response?.data?.code!=='DUPLICATE_NAME_CONFIRMATION_REQUIRED' || !window.confirm(error.response.data.message + '\n确认要为不同人员创建同名记录吗？')) throw error
          response=await officialAPI.create({...data,confirm_duplicate:true})
        }
        const person=response.data
        this.createOpen=false
        this.selectItem({external_referee_id:person.id,source_type:'external',name_snapshot:person.name,note:person.note})
      } catch(error) { this.createError=error?.response?.data?.message || error.message || '创建失败' }
      finally { this.creating=false }
    },
    formatTypes(item) {
      const value=item.match_types_snapshot
      return Array.isArray(value) ? value.join('、') : value || ''
    }
  }
}
</script>

<style scoped>
@layer legacy {

.referee-picker { position: relative; display: flex; flex-direction: column; gap: 7px; }
.referee-picker > input { width: 100%; box-sizing: border-box; }
.selected-card { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 9px 10px; border: 1px solid #c7d2fe; border-radius: 8px; background: #f5f7ff; }
.selected-card strong, .selected-card span, .selected-card small { display: block; }
.selected-card span, .selected-card small { margin-top: 2px; color: #64748b; font-size: 11px; }
.selected-card button { border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 19px; }
.source-badge { align-self: center; padding: 3px 6px; border-radius: 999px; background: #dbeafe; color: #1d4ed8 !important; font-size: 10px !important; font-weight: 700; white-space: nowrap; }
.result-panel { position: relative; z-index: 3; max-height: 300px; overflow: auto; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; box-shadow: 0 8px 20px rgba(15,23,42,.12); }
.result-group-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; background: var(--canvas, #f3f6fa); color: var(--muted, #52657a); font-size: 13px; line-height: 1.5; }
.result-group-heading strong { font-size: 14px; }
.result-group-heading.is-signed { border-left: 3px solid var(--primary, #1e5ca8); background: var(--soft, #eaf1fa); color: var(--brand, #123b6d); }
.result-group-heading.has-gap { margin-top: 12px; border-top: 2px solid var(--line, #d6e0ec); }
.result-item { display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 10px; margin: 0; border: 0; border-bottom: 1px solid #eef2f7; background: #fff; color: #1f2937; text-align: left; cursor: pointer; line-height: 1.5; overflow-wrap: anywhere; }
.result-item:hover { background: #f8fafc; }
.result-create { background: #eff6ff; color: #1d4ed8; }
.result-create:hover { background: #dbeafe; color: #1e40af; }
.result-item:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.result-main strong, .result-main small { display: block; }
.result-main small { margin-top: 2px; color: #64748b; font-size: 11px; }
.result-state { padding: 15px 10px; color: #64748b; text-align: center; }
.result-state.error { color: #b91c1c; }
.result-pagination { display: flex; align-items: center; justify-content: space-between; padding: 8px; background: #f8fafc; }
.result-pagination button, .close-results { border: 0; background: transparent; color: #4f46e5; cursor: pointer; font-size: 11px; }
.result-pagination button:disabled { color: #9ca3af; cursor: not-allowed; }
.close-results { align-self: flex-start; }
.disabled { opacity: .72; }

}
</style>
