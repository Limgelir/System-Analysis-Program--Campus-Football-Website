<template>
  <div class="players-page">
    <header><div><RouterLink to="/admin-dashboard">← 返回管理员工作台</RouterLink><h1>球员账号管理</h1><p>查询球员资料，协助找回密码及纠正登录学号。赛季学籍审核可从管理员工作台进入。</p></div></header>
    <div v-if="error" class="alert error" role="alert">{{ error }} <button v-if="conflict" @click="refreshDetail">刷新最新资料</button></div>
    <form class="filters" @submit.prevent="search"><label>搜索球员<input v-model="query" placeholder="姓名、学号或学院" maxlength="100"></label><label>账号状态<select v-model="active"><option value="">全部</option><option value="1">启用</option><option value="0">停用</option></select></label><button :disabled="loading || saving">查询</button></form>
    <div class="table-wrap"><table><thead><tr><th>球员编号</th><th>姓名</th><th>学号</th><th>学院</th><th>性别</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="p in players" :key="p.id"><td>{{ p.id }}</td><td>{{ p.name }}</td><td>{{ p.student_id }}</td><td>{{ p.college }}</td><td>{{ genderLabel(p.gender) }}</td><td>{{ p.is_active ? '启用' : '停用' }}<small v-if="p.must_change_password"> · 需改密码</small></td><td><button :disabled="saving" @click="open(p.id)">管理</button></td></tr><tr v-if="!players.length"><td colspan="7">{{ loading ? '加载中…' : '暂无符合条件的球员账号' }}</td></tr></tbody></table></div>
    <div class="pagination"><span>共 {{ pagination.total }} 个账号 · 第 {{ page }} 页</span><button :disabled="page <= 1 || loading || saving" @click="page--; load()">上一页</button><button :disabled="page >= pagination.total_pages || loading || saving" @click="page++; load()">下一页</button></div>
    <section v-if="detail" class="detail">
      <div class="detail-title"><h2>{{ detail.player.name }} · 球员编号 {{ detail.player.id }}</h2><button :disabled="saving" @click="close">关闭详情</button></div>
      <p>当前学号：{{ detail.player.student_id }}　学院：{{ detail.player.college }}　性别：{{ genderLabel(detail.player.gender) }}　账号：{{ detail.player.is_active ? '启用' : '停用' }}</p>
      <div v-if="temporary" class="alert success" role="status">临时密码仅在本次显示，请通过管理员核实后的渠道交给本人。<label>临时密码<input :value="temporary" readonly autocomplete="off"></label>球员登录后必须先修改密码。</div>
      <div v-if="success" class="alert success" role="status">{{ success }}</div>
      <form v-draft="{ value: { reason, newStudentId, newGender }, resetKey: detail?.player.id }" class="action-form" @submit.prevent="perform">
        <label>管理操作<select v-model="action" :disabled="saving"><option value="reset-password">重置密码</option><option value="status">{{ detail.player.is_active ? '停用账号' : '启用账号' }}</option><option value="student-id">纠正学号</option><option value="gender">修改性别</option></select></label>
        <label v-if="action === 'student-id'">新学号<input v-model="newStudentId" maxlength="50" required :disabled="saving"></label>
        <p v-if="action === 'student-id'">请先核实身份；历史仍归原球员编号，旧学号立即释放。系统不会合并两个账号。</p>
        <label v-if="action === 'gender'">新性别<select v-model="newGender" aria-label="新性别" required :disabled="saving"><option value="" disabled>请选择</option><option value="male">男</option><option value="female">女</option></select></label>
        <label>核实／操作原因<textarea v-model="reason" required maxlength="500" rows="3" :disabled="saving" placeholder="填写核实情况和操作原因"></textarea></label>
        <button class="primary" :disabled="saving">{{ saving ? '处理中…' : action === 'reset-password' ? '确认重置密码' : action === 'student-id' ? '确认纠正学号' : action === 'gender' ? '确认修改性别' : detail.player.is_active ? '确认停用账号' : '确认启用账号' }}</button>
      </form>
      <h3>最近 100 条操作记录</h3>
      <ol class="history"><li v-for="event in detail.history" :key="event.id"><strong>{{ operations[event.operation] || event.operation }}</strong><span> · {{ formatDate(event.created_at) }} · {{ event.actor_admin_id ? '管理员 #' + event.actor_admin_id : '球员本人' }}</span><p v-if="event.reason">{{ event.reason }}</p><p v-if="event.before_snapshot">变更前：{{ summary(event.before_snapshot) }}</p><p>变更后：{{ summary(event.after_snapshot) }}</p></li></ol>
    </section>
  </div>
</template>
<script setup>
import { confirmDraftLeave } from '../../../shared-ui/interaction.js'
import { onMounted, ref } from 'vue'
import api from '../api/http'
const query = ref(''), active = ref(''), page = ref(1), players = ref([]), pagination = ref({ total: 0, total_pages: 0 })
const loading = ref(false), saving = ref(false), detail = ref(null), error = ref(''), success = ref(''), conflict = ref(false), temporary = ref(''), reason = ref(''), newStudentId = ref(''), action = ref('reset-password')
const newGender = ref('')
const genderLabel = value => ({ male: '男', female: '女' }[value] || '未填写')
const operations = { gender_changed: '设置或修改性别', register: '注册账号', profile_changed: '修改基本资料', college_change_approved: '学院修改审核通过', student_id_changed: '修改学号', password_changed: '修改密码', password_reset: '管理员重置密码', account_enabled: '启用账号', account_disabled: '停用账号', logout: '退出登录' }
const summary = value => { const p = typeof value === 'string' ? JSON.parse(value) : value; return p ? `${p.name} / ${p.student_id} / ${p.college} / ${genderLabel(p.gender)} / ${p.is_active ? '启用' : '停用'}${p.must_change_password ? ' / 需改密码' : ''}` : '无' }
const formatDate = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const fail = e => { error.value = e.response?.data?.message || '操作失败，请稍后重试'; conflict.value = e.response?.data?.code === 'PLAYER_REVISION_CONFLICT' }
let loadSequence = 0, detailSequence = 0
async function load() { const current = ++loadSequence; loading.value = true; try { const r = await api.get('/player-admin', { params: { q: query.value, active: active.value, page: page.value } }); if (current === loadSequence) { players.value = r.data.players; pagination.value = r.data.pagination } } catch(e) { fail(e) } finally { if (current === loadSequence) loading.value = false } }
function search() {if(!confirmDraftLeave(document.querySelector('.action-form')))return; page.value = 1; load() }
function close() {if(!confirmDraftLeave(document.querySelector('.action-form')))return; detailSequence++; detail.value = null; temporary.value = ''; reason.value = ''; success.value = '' }
async function open(id) {if(!confirmDraftLeave(document.querySelector('.action-form')))return; const current = ++detailSequence; temporary.value = ''; error.value = ''; success.value = ''; reason.value = ''; newStudentId.value = ''; newGender.value = ''; conflict.value = false; detail.value = null; try { const r = await api.get(`/player-admin/${id}`); if (current === detailSequence) detail.value = r.data } catch(e) { fail(e) } }
async function refreshDetail() { if (detail.value) await open(detail.value.player.id); await load() }
async function perform() {
  saving.value = true; error.value = ''; success.value = ''; temporary.value = ''; conflict.value = false
  const id = detail.value.player.id, config = { headers: { 'If-Match': String(detail.value.player.revision) } }
  try {
    const body = { reason: reason.value }
    if (action.value === 'status') body.is_active = !detail.value.player.is_active
    if (action.value === 'gender') body.gender = newGender.value
    if (action.value === 'student-id') body.student_id = newStudentId.value
    const r = action.value === 'reset-password' ? await api.post(`/player-admin/${id}/reset-password`, body, config) : await api.put(`/player-admin/${id}/${action.value}`, body, config)
    temporary.value = r.data.temporary_password || ''; success.value = action.value === 'gender' ? '性别已更新，修改记录已保存。' : '操作成功，原登录会话已失效。'; reason.value = ''
    detail.value = (await api.get(`/player-admin/${id}`)).data; await load()
  } catch(e) { fail(e) } finally { saving.value = false }
}
onMounted(load)
</script>
<style scoped>
@layer legacy {

.players-page{max-width:1200px;margin:auto;padding:32px 24px;color:#263c55}h1{margin:16px 0 8px;font-size:28px}header p{color:#6f7e8d}.filters,.pagination,.detail-title{display:flex;gap:16px;align-items:end;justify-content:space-between;margin:24px 0}.filters{justify-content:flex-start}label{display:block;font-size:14px;font-weight:600}input,select,textarea{display:block;margin-top:7px;padding:10px 12px;border:1px solid #cad4df;border-radius:6px;font:inherit;max-width:100%;width:100%;box-sizing:border-box}button{padding:9px 15px;background:white;color:#24588c;border:1px solid #c7d6e7;border-radius:6px;cursor:pointer;font:inherit}button:disabled{opacity:.5;cursor:wait}.primary{background:#245da4;color:white}.table-wrap{overflow:auto;background:white;border:1px solid #dee5ed;border-radius:10px}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{padding:14px 17px;text-align:left;border-bottom:1px solid #e8edf3}th{background:#edf3f9;font-size:14px}.detail{background:white;border:1px solid #dee5ed;border-radius:12px;padding:24px}.detail-title{align-items:center;margin-top:0}.detail-title h2{font-size:21px;margin:0}.action-form{max-width:550px;padding:18px 0}.action-form label,.action-form p{margin-bottom:16px}.alert{padding:14px;border-radius:7px;margin:16px 0;overflow-wrap:anywhere}.error{background:#fff0ef;color:#a12b25}.success{background:#edf7ff;color:#235d8c}.success input{max-width:400px}.history{padding-left:22px}.history li{padding:13px 0;border-top:1px solid #e7edf4;font-size:14px;overflow-wrap:anywhere}.history p{margin:7px 0;color:#667788}.history span{color:#748496}@media(max-width:650px){.players-page{padding:22px 15px}.filters{flex-wrap:wrap}.detail-title{align-items:flex-start;flex-direction:column}.pagination{font-size:13px;gap:8px}.detail{padding:18px}}

}
</style>
