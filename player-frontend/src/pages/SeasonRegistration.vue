<template>
  <div v-draft="{ value: selected, dirty: !!selected }" class="content registration-page">
    <RouterLink to="/dashboard">← 返回我的主页</RouterLink>
    <div class="page-title"><div><span class="eyebrow">球员赛季注册</span><h1>{{ data?.season?.season_name || '个人学籍注册' }}</h1></div><button class="secondary" :disabled="busy || loading" @click="load">刷新状态</button></div>
    <label v-if="registrations.length">查看学籍记录<select :value="historyId" :disabled="busy || loading" @change="changeHistory"><option value="">当前启用赛季</option><option v-for="r in registrations" :key="r.id" :value="String(r.id)">{{ r.season_name }}（历史记录）</option></select></label>
    <div v-if="error" class="error" role="alert">{{ error }}</div><div v-if="success" class="notice" role="status">{{ success }}</div>
    <p v-if="loading && !data" class="muted">正在读取本季注册信息…</p>
    <section v-if="data && !data.season" class="card empty"><h2>暂无启用赛季</h2><p>你仍然可以管理账号资料；管理员启用赛季后再来查看。</p></section>
    <template v-if="data?.season">
      <section class="card registration-status"><span :class="['status', data.status]">{{ labels[data.status] }}</span><h2>{{ data.message }}</h2><p class="muted">个人注册时间（北京时间）：{{ time(data.registration_opens_at) }} 至 {{ time(data.registration_closes_at) }}</p><p v-if="!data.registration_opens_at" class="field-help">管理员尚未设置个人注册窗口。</p><p v-if="['upcoming','closed'].includes(data.window_status) && !data.is_correction" class="field-help">{{ data.window_status === 'upcoming' ? '还未到开放时间。' : '正常注册已截止。' }}</p>
        <div v-if="data.registration?.return_reason" class="notice review-reason"><strong>{{ data.status === 'revoked' ? '撤销原因' : data.status === 'returned' ? '退回理由' : '审核说明' }}</strong><p>{{ data.registration.return_reason }}</p></div>
        <p v-if="data.is_correction" class="field-help">退回或资格撤销后，可在截止后补正重提；通过新审核前不具备当季参赛资格。</p>
        <button v-if="data.can_withdraw" class="secondary" :disabled="busy" @click="withdraw">撤回申请</button><p v-if="data.can_withdraw" class="field-help">撤回后再次提交必须处于正常个人注册窗口内；截图历史仍会保留。</p>
        <AcademicScreenshotExample v-if="!historyId"/>
      </section>
      <section v-if="data.can_submit" class="card submission-card"><h2>{{ data.is_correction ? '补正学籍材料' : '提交学籍材料' }}</h2>
        <div class="profile-preview"><div><span>姓名</span><strong>{{ data.account.name }}</strong></div><div><span>学号</span><strong>{{ data.account.student_id }}</strong></div><div><span>学院</span><strong>{{ data.account.college }}</strong></div></div>
        <p class="field-help">以上资料会随本次提交留存。需要修改时，先前往 <RouterLink to="/account">账号设置</RouterLink>，回来后刷新本页。</p>
        <form @submit.prevent="submit"><label for="academic-file">1系统学籍信息截图</label><input id="academic-file" ref="input" type="file" accept="image/jpeg,image/png" :disabled="busy" @change="selectFile"><p class="field-help">每次提交一张 JPG/PNG 图片，不超过5MB。截图仅本人和管理员可查看。</p><img v-if="preview" class="local-preview" :src="preview" alt="待提交学籍截图预览"><button class="primary" :disabled="busy || !selected">{{ busy ? '正在提交…' : '提交审核' }}</button></form>
      </section>
      <section v-if="data.registration" class="card material-card"><h2>已提交材料</h2><p class="field-help">提交时：{{ data.registration.profile_snapshot.name }} / {{ data.registration.profile_snapshot.student_id }} / {{ data.registration.profile_snapshot.college }}</p>
        <label v-if="data.files.length > 1">查看提交版本<select v-model="selectedFile"><option v-for="f in data.files" :key="f.id" :value="f.id">版本 {{ f.revision }} · {{ time(f.created_at) }}</option></select></label>
        <AcademicImage v-if="chosenFile?.available" :registration-id="data.registration.id" :file-id="chosenFile.id"/><p v-else class="muted">材料已清理。</p>
      </section>
      <section v-if="data.events.length" class="card"><h2>申请记录</h2><ol class="registration-history"><li v-for="event in data.events" :key="event.id"><strong>{{ operations[event.operation] || event.operation }}</strong><span> · {{ time(event.created_at) }}</span><p v-if="event.reason">{{ event.reason }}</p></li></ol></section>
    </template>
  </div>
</template>
<script setup>
import AcademicScreenshotExample from '../../../shared-ui/AcademicScreenshotExample.vue'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { confirmDraftLeave } from '../../../shared-ui/interaction.js'
import { api, messageOf } from '../session'
import AcademicImage from '../components/AcademicImage.vue'
const data = ref(null), loading = ref(false), busy = ref(false), error = ref(''), success = ref(''), input = ref(null), selected = ref(null), preview = ref(''), selectedFile = ref(null)
const registrations=ref([]),historyId=ref('')
let requestKey = '', sequence = 0
const labels = { unsubmitted: '未注册', pending: '待审核', approved: '已注册', returned: '已退回', withdrawn: '已撤回', revoked: '资格已撤销' }
const operations = { submitted: '提交材料', withdrawn: '本人撤回', approved: '审核通过', returned: '管理员退回', revoked: '管理员撤销资格' }
const time = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未设置'
const chosenFile = computed(() => data.value?.files.find(f => f.id === selectedFile.value))
function clearFile(resetInput = true) { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = ''; selected.value = null; requestKey = ''; if (resetInput && input.value) input.value.value = '' }
function assign(value) { data.value = value; selectedFile.value = value.files[0]?.id || null }
function changeHistory(event) { if (!confirmDraftLeave()) { event.target.value = historyId.value; return } historyId.value = event.target.value; load() }
async function load() { if(!confirmDraftLeave())return; const current = ++sequence; loading.value = true; error.value = ''; success.value = ''; try { const [value,rows] = await Promise.all([api.get('/season-registration/'+(historyId.value||'current')),api.get('/season-registration/history')]); if (current === sequence) { registrations.value=rows;assign(historyId.value?{...value,status:value.registration.status,can_submit:false,can_withdraw:false,message:'历史学籍记录，只读。'}:value); clearFile() } } catch(e) { if (current === sequence) error.value = messageOf(e) } finally { if (current === sequence) loading.value = false } }
// getRandomValues 在普通 HTTP 的局域网测试地址也可用。
function newRequestKey() { const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` }
function selectFile(event) { const file = event.target.files?.[0]; clearFile(false); error.value = ''; success.value = ''; if (!file) return; if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) { clearFile(); error.value = '请选择一张不超过5MB的 JPG/PNG 图片'; return } selected.value = file; preview.value = URL.createObjectURL(file); requestKey = newRequestKey() }
async function submit() {
  if (!selected.value || busy.value) return; busy.value = true; error.value = ''; success.value = ''
  const form = new FormData(); form.append('season_id', String(data.value.season.id)); form.append('account_revision', String(data.value.account.revision)); form.append('academic_image', selected.value)
  try { assign(await api.post('/season-registration/submit', form, { headers: { 'If-Match': String(data.value.revision), 'Idempotency-Key': requestKey } })); clearFile(); success.value = '材料已提交，等待管理员审核。' }
  catch(e) { error.value = messageOf(e) } finally { busy.value = false }
}
async function withdraw() { if(!window.confirm('确认撤回学籍申请？再次提交需在注册窗口内，原截图历史会保留。'))return; busy.value = true; error.value = ''; success.value = ''; try { assign(await api.post('/season-registration/withdraw', { season_id: data.value.season.id }, { headers: { 'If-Match': String(data.value.revision) } })); clearFile(); success.value = '申请已撤回。' } catch(e) { error.value = messageOf(e) } finally { busy.value = false } }
onMounted(load); onBeforeUnmount(() => { sequence++; clearFile() })
</script>
<style scoped>
@layer legacy {

.registration-page{max-width:950px}.page-title{display:flex;justify-content:space-between;align-items:center;gap:20px;margin:25px 0}.page-title h1{margin:0}.registration-page>.card{margin-bottom:24px}.registration-status>.status{display:inline-block;margin-bottom:18px}.registration-status h2{font-size:19px}.status.approved{background:#e4f4ea;color:#226a41}.status.revoked,.status.returned{background:#fff1df;color:#8c5b20}.review-reason p{margin:8px 0 0;white-space:pre-wrap}.profile-preview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;background:#f4f7fb;border-radius:8px;padding:16px;margin-bottom:14px}.profile-preview span{display:block;color:#70829a;font-size:12px}.profile-preview strong{font-size:15px;overflow-wrap:anywhere}.submission-card input{font-size:14px;padding:12px}.local-preview{display:block;width:100%;max-height:400px;object-fit:contain;border-radius:8px;margin-bottom:18px}.material-card select{font:inherit;padding:10px;width:100%;border:1px solid #cbd8e5;border-radius:6px;margin-top:7px}.registration-history{padding-left:20px}.registration-history li{padding:12px 0;border-top:1px solid #e5ebf2}.registration-history span{font-size:13px;color:#7b8999}.registration-history p{margin:8px 0 0;white-space:pre-wrap}@media(max-width:600px){.page-title{align-items:flex-start;flex-direction:column}.profile-preview{grid-template-columns:1fr;gap:9px}.registration-page>.card{padding:20px}.page-title h1{font-size:25px}}

}
</style>
