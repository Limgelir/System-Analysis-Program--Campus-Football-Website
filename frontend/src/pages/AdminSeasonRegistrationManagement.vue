<template>
  <div class="page-shell">
    <header class="header-bar">
      <div>
        <h1>赛季注册裁判</h1>
        <p>审核赛季注册申请；这里只代表当季选派资格，不是登录账号列表。</p>
      </div>
      <nav class="header-actions">
        <button @click="$router.push('/admin-referees')">裁判账号管理</button>
        <button @click="$router.push('/admin-dashboard')">返回管理员首页</button>
      </nav>
    </header>

    <main class="page-body">
      <div v-if="pageError" class="alert error">{{ pageError }}</div>
      <div v-if="pageSuccess" class="alert success">{{ pageSuccess }}</div>
      <div class="season-filter"><label>查看赛季 <select v-model="viewSeasonId" @change="applyFilters"><option value="">跟随当前启用赛季</option><option v-for="s in seasons" :key="s.id" :value="String(s.id)">{{s.season_name}}{{s.is_active?'（当前启用）':'（历史）'}}</option></select></label><button :disabled="loading || exporting || !season" @click="exportApproved">{{exporting?'导出中…':'导出筛选下已通过名单'}}</button></div>

      <section v-if="!loading || season" class="season-card">
        <template v-if="season">
          <div>
            <span class="eyebrow">{{ season.is_active ? '当前启用赛季' : '正在查看历史赛季（不改变启用状态）' }}</span>
            <h2>{{ season.season_name }}</h2>
          </div>
          <div class="season-meta">
            <strong>{{ season.season_code }}</strong>
            <span>{{ formatDate(season.start_date) }} 至 {{ formatDate(season.end_date) }}</span>
          </div>
        </template>
        <div v-else class="no-season">当前没有启用赛季，暂时没有可审核的赛季注册申请。</div>
      </section>

      <section class="stats-grid" aria-label="赛季注册统计">
        <article v-for="stat in summaryCards" :key="stat.key" class="stat-card" :class="stat.tone">
          <div class="stat-label">{{ stat.label }}</div>
          <div class="stat-value">{{ loading && !loaded ? '—' : stat.value }}</div>
          <div class="stat-hint">{{ stat.hint }}</div>
        </article>
      </section>

      <section class="list-card">
        <div class="tabs" role="tablist" aria-label="审核状态">
          <button
            v-for="tab in statusTabs"
            :key="tab.value"
            type="button"
            :class="{ active: activeStatus === tab.value }"
            @click="selectStatus(tab.value)"
          >
            {{ tab.label }} <span>{{ tabCount(tab.value) }}</span>
          </button>
        </div>

        <div class="filters">
          <label class="search-field">
            <span>搜索</span>
            <input
              v-model.trim="filters.query"
              placeholder="输入姓名或学号"
              @input="scheduleSearch"
            />
          </label>
          <label>
            <span>当前级别</span>
            <select v-model="filters.grade" @change="applyFilters">
              <option value="">全部级别</option>
              <option v-for="grade in gradeOptions" :key="grade" :value="grade">{{ grade }}</option>
            </select>
          </label>
          <label>
            <span>比赛类型</span>
            <select v-model="filters.match_type" @change="applyFilters">
              <option value="">全部类型</option>
              <option v-for="type in matchTypeOptions" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <button class="clear-btn" type="button" @click="clearFilters">清空筛选</button>
        </div>

        <div v-if="loading" class="empty-state">正在加载申请列表…</div>
        <div v-else-if="!season" class="empty-state">请先在赛季管理中启用赛季。</div>
        <div v-else-if="items.length === 0" class="empty-state">当前条件下没有赛季注册申请。</div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名 / 学号</th>
                <th>当季资料</th>
                <th>执法经历</th>
                <th>状态</th>
                <th>提交 / 审核时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in items" :key="item.id">
                <td>
                  <strong>{{ item.name_snapshot }}</strong>
                  <small>{{ item.student_id }}</small>
                  <small v-if="!item.account_is_active" class="danger-text">账号已停用</small>
                </td>
                <td>
                  {{ item.grade_snapshot }} · {{ item.college_snapshot }}
                  <small>{{ item.height_cm_snapshot }} cm / {{ item.weight_kg_snapshot }} kg</small>
                </td>
                <td class="types-cell">{{ formatTypes(item.match_types_snapshot) }}</td>
                <td>
                  <span class="status-badge" :class="item.status">{{ statusLabel(item.status) }}</span>
                </td>
                <td>
                  <small>提交：{{ formatDateTime(item.submitted_at) }}</small>
                  <small v-if="item.reviewed_at">审核：{{ formatDateTime(item.reviewed_at) }}</small>
                </td>
                <td>
                  <div class="row-actions">
                    <button class="link-btn" type="button" @click="openDetail(item.id)">查看对比</button>
                    <button v-if="item.status === 'pending'" class="approve-btn" type="button" @click="openReview(item, 'approve')">通过</button>
                    <button v-if="item.status === 'pending'" class="reject-btn" type="button" @click="openReview(item, 'reject')">驳回</button>
                    <button v-if="item.status === 'approved'" class="return-btn" type="button" @click="openReview(item, 'return')">退回</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ListPagination :pagination="pagination" :loading="loading" @page="changePage" @size="pagination.page_size=$event;applyFilters()" />
      </section>
    </main>

    <div v-if="detailVisible" class="modal-mask" @click.self="closeDetail">
      <section class="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div class="modal-head">
          <div>
            <h2 id="detail-title">赛季注册资料对比</h2>
            <p v-if="detail?.registration">{{ detail.registration.name_snapshot }} · {{ detail.account?.student_id }}</p>
          </div>
          <button class="close-icon" type="button" @click="closeDetail">×</button>
        </div>
        <div v-if="detailLoading" class="empty-state">正在读取详情…</div>
        <template v-else-if="detail">
          <div class="compare-grid">
            <div class="compare-column">
              <h3>长期账号主资料</h3>
              <dl>
                <template v-for="field in comparisonFields" :key="field.key">
                  <dt>{{ field.label }}</dt>
                  <dd>{{ displayField(detail.account, field.accountKey) }}</dd>
                </template>
              </dl>
            </div>
            <div class="compare-column snapshot-column">
              <h3>本赛季申请快照</h3>
              <dl>
                <template v-for="field in comparisonFields" :key="field.key">
                  <dt>{{ field.label }}</dt>
                  <dd :class="{ changed: isDifferent(field) }">{{ displayField(detail.registration, field.snapshotKey) }}</dd>
                </template>
              </dl>
            </div>
          </div>
          <div v-if="detail.registration.review_reason" class="reason-box">
            <strong>最近审核意见：</strong>{{ detail.registration.review_reason }}
          </div>
          <div class="history-section">
            <h3>申请与审核历史</h3>
            <ol v-if="detail.events?.length" class="history-list">
              <li v-for="event in detail.events" :key="event.id">
                <strong>{{ eventLabel(event.event_type) }}</strong>
                <span>{{ formatDateTime(event.created_at) }}</span>
                <span>操作者：{{ event.actor_admin_username || event.actor_referee_name || event.actor_referee_student_id || event.actor_type }}</span>
                <p v-if="event.reason">意见：{{ event.reason }}</p>
              </li>
            </ol>
            <div v-else class="empty-state compact">暂无历史记录</div>
          </div>
        </template>
      </section>
    </div>

    <div v-if="reviewVisible" class="modal-mask" @click.self="closeReview">
      <form v-draft="{ value: reviewReason }" class="review-modal" @submit.prevent="submitReview">
        <div class="modal-head">
          <div>
            <h2>{{ reviewTitle }}</h2>
            <p>{{ reviewTarget?.name_snapshot }} · {{ reviewTarget?.student_id }}</p>
          </div>
          <button class="close-icon" type="button" :disabled="reviewSubmitting" @click="closeReview">×</button>
        </div>
        <label class="review-field">
          <span>{{ reviewAction === 'approve' ? '审核意见（可选）' : '原因（必填）' }}</span>
          <textarea v-model.trim="reviewReason" maxlength="500" rows="5" :required="reviewAction !== 'approve'" />
          <small>{{ reviewReason.length }} / 500</small>
        </label>
        <div v-if="reviewError" class="alert error">{{ reviewError }}</div>
        <div class="review-actions">
          <button type="button" :disabled="reviewSubmitting" @click="closeReview">取消</button>
          <button class="confirm-review" :class="reviewAction" type="submit" :disabled="reviewSubmitting">
            {{ reviewSubmitting ? '处理中…' : reviewTitle }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
import { REFEREE_GRADES } from '../constants/refereeOptions'
import { seasonRegistrationAPI } from '../api/index.js'
import ListPagination from '../components/ListPagination.vue'
import {downloadBlob,exportError} from '../utils/download'

const EMPTY_SUMMARY = Object.freeze({
  total_accounts: 0, active_accounts: 0, inactive_accounts: 0,
  unsubmitted_accounts: 0, pending: 0, approved: 0, rejected: 0, returned: 0,
  eligible_system_referees: 0, external_referees: 0
})

export default {
  name: 'AdminSeasonRegistrationManagement',
  components:{ListPagination},
  data() {
    return {
      loaded: false,
      seasons:[],viewSeasonId:'',requestId:0,exporting:false,detailRequestId:0,
      loading: false,
      pageError: '',
      pageSuccess: '',
      season: null,
      summary: { ...EMPTY_SUMMARY },
      items: [],
      activeStatus: 'pending',
      filters: { query: '', grade: '', match_type: '' },
      pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 },
      searchTimer: null,
      detailVisible: false,
      detailLoading: false,
      detail: null,
      reviewVisible: false,
      reviewTarget: null,
      reviewAction: '',
      reviewReason: '',
      reviewSubmitting: false,
      reviewError: '',
      statusTabs: [
        { value: 'pending', label: '待审核' },
        { value: 'approved', label: '已通过' },
        { value: 'rejected', label: '已驳回' },
        { value: 'returned', label: '已退回' },
        { value: 'all', label: '全部' }
      ],
      gradeOptions: REFEREE_GRADES,
      matchTypeOptions: ['院内赛', '足协杯', '大联赛', '新生杯', '区级及以上比赛'],
      comparisonFields: [
        { key: 'name', label: '姓名', accountKey: 'name', snapshotKey: 'name_snapshot' },
        { key: 'height', label: '身高（cm）', accountKey: 'height_cm', snapshotKey: 'height_cm_snapshot' },
        { key: 'weight', label: '体重（kg）', accountKey: 'weight_kg', snapshotKey: 'weight_kg_snapshot' },
        { key: 'college', label: '学院', accountKey: 'college', snapshotKey: 'college_snapshot' },
        { key: 'grade', label: '当前级别', accountKey: 'grade', snapshotKey: 'grade_snapshot' },
        { key: 'types', label: '执法经历', accountKey: 'match_types', snapshotKey: 'match_types_snapshot' }
      ]
    }
  },
  computed: {
    summaryCards() {
      return [
        { key: 'total', label: '裁判账号总数', value: this.summary.total_accounts, hint: '长期登录账号', tone: 'blue' },
        { key: 'active', label: '已启用账号', value: this.summary.active_accounts, hint: '当前可登录', tone: 'green' },
        { key: 'inactive', label: '已停用账号', value: this.summary.inactive_accounts, hint: '不能新选派', tone: 'gray' },
        { key: 'unsubmitted', label: '本赛季未提交', value: this.summary.unsubmitted_accounts, hint: '尚无当季申请', tone: 'gray' },
        { key: 'pending', label: '审核中', value: this.summary.pending, hint: '等待逐人审核', tone: 'orange' },
        { key: 'approved', label: '已通过', value: this.summary.approved, hint: '含停用账号', tone: 'green' },
        { key: 'rejected', label: '已驳回', value: this.summary.rejected, hint: '可修改后重交', tone: 'red' },
        { key: 'returned', label: '已退回', value: this.summary.returned, hint: '需重新提交', tone: 'purple' },
        { key: 'eligible', label: '可选派系统裁判', value: this.summary.eligible_system_referees, hint: '通过且账号启用', tone: 'blue' },
        { key: 'external', label: '非系统裁判', value: this.summary.external_referees, hint: '独立统计（阶段 6 建库）', tone: 'gray' }
      ]
    },
    reviewTitle() {
      return { approve: '通过申请', reject: '驳回申请', return: '退回修改' }[this.reviewAction] || '审核申请'
    }
  },
  mounted() {
    this.loadList()
  },
  beforeUnmount() {
    this.requestId++;this.detailRequestId++
    if (this.searchTimer) window.clearTimeout(this.searchTimer)
  },
  methods: {
    async exportApproved(){if(this.exporting)return;this.exporting=true;try{downloadBlob(await seasonRegistrationAPI.exportApproved({...this.filters,season_id:this.viewSeasonId||undefined}),'赛季已通过裁判.csv')}catch(e){this.pageError=await exportError(e)}finally{this.exporting=false}},
    extractData(response) { return response?.data ?? response ?? {} },
    async loadList() {
      const requestId=++this.requestId
      this.loading = true
      this.pageError = ''
      try {
        const response = await seasonRegistrationAPI.getAdminList({
          season_id:this.viewSeasonId||undefined,
          status: this.activeStatus === 'all' ? undefined : this.activeStatus,
          query: this.filters.query || undefined,
          grade: this.filters.grade || undefined,
          match_type: this.filters.match_type || undefined,
          page: this.pagination.page,
          page_size: this.pagination.page_size
        })
        const data = this.extractData(response)
        if(requestId!==this.requestId)return
        this.seasons=data.seasons||[]
        this.season = data.season || null
        this.summary = { ...EMPTY_SUMMARY, ...(data.summary || {}) }
        this.items = Array.isArray(data.items) ? data.items : []
        this.pagination = { ...this.pagination, ...(data.pagination || {}) }
      } catch (error) {
        if(requestId!==this.requestId)return
        this.pageError = error?.response?.data?.message || error?.message || '加载赛季注册申请失败'
        this.items = []
      } finally {
        if(requestId===this.requestId){this.loaded = true;this.loading = false}
      }
    },
    selectStatus(status) { this.activeStatus = status; this.pagination.page = 1; this.loadList() },
    applyFilters() { this.pagination.page = 1; this.loadList() },
    scheduleSearch() {
      if (this.searchTimer) window.clearTimeout(this.searchTimer)
      this.searchTimer = window.setTimeout(() => this.applyFilters(), 350)
    },
    clearFilters() { this.filters = { query: '', grade: '', match_type: '' }; this.applyFilters() },
    changePage(page) { this.pagination.page = page; this.loadList() },
    tabCount(status) {
      if (status === 'all') return this.summary.pending + this.summary.approved + this.summary.rejected + this.summary.returned
      return this.summary[status] || 0
    },
    statusLabel(status) { return { pending: '审核中', approved: '已通过', rejected: '已驳回', returned: '已退回' }[status] || status },
    formatTypes(value) { return Array.isArray(value) ? (value.join('、') || '-') : (value || '-') },
    formatDate(value) { return value ? String(value).slice(0, 10) : '-' },
    formatDateTime(value) {
      if (!value) return '-'
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
    },
    async openDetail(id) {
      const requestId=++this.detailRequestId
      this.detailVisible = true
      this.detailLoading = true
      this.detail = null
      try {
        const response = await seasonRegistrationAPI.getAdminDetail(id)
        if(requestId!==this.detailRequestId)return
        this.detail = this.extractData(response)
      } catch (error) {
        if(requestId!==this.detailRequestId)return
        this.pageError = error?.response?.data?.message || error?.message || '读取申请详情失败'
        this.detailVisible = false
      } finally {
        if(requestId===this.detailRequestId)this.detailLoading = false
      }
    },
    closeDetail() { this.detailRequestId++;this.detailVisible = false; this.detail = null },
    displayField(target, key) {
      const value = target?.[key]
      if (Array.isArray(value)) return value.join('、') || '-'
      return value === null || value === undefined || value === '' ? '-' : value
    },
    isDifferent(field) {
      const left = this.displayField(this.detail?.account, field.accountKey)
      const right = this.displayField(this.detail?.registration, field.snapshotKey)
      return left !== right
    },
    eventLabel(type) {
      return { submitted: '提交申请', resubmitted: '重新提交', approved: '审核通过', rejected: '审核驳回', returned: '管理员退回' }[type] || type
    },
    openReview(item, action) {
      this.reviewTarget = item
      this.reviewAction = action
      this.reviewReason = action === 'approve' ? '审核通过' : ''
      this.reviewError = ''
      this.reviewVisible = true
    },
    closeReview() {
      if (this.reviewSubmitting) return
      this.reviewVisible = false
      this.reviewTarget = null
      this.reviewAction = ''
      this.reviewReason = ''
      this.reviewError = ''
    },
    async submitReview() {
      if (!this.reviewTarget) return
      if (this.reviewAction !== 'approve' && !this.reviewReason) {
        this.reviewError = '驳回或退回时必须填写原因'
        return
      }
      this.reviewSubmitting = true
      this.reviewError = ''
      try {
        const id = this.reviewTarget.id
        if (this.reviewAction === 'approve') await seasonRegistrationAPI.approve(id, this.reviewReason)
        if (this.reviewAction === 'reject') await seasonRegistrationAPI.reject(id, this.reviewReason)
        if (this.reviewAction === 'return') await seasonRegistrationAPI.returnForRevision(id, this.reviewReason)
        this.pageSuccess = `${this.reviewTarget.name_snapshot}：${this.reviewTitle}成功`
        this.closeReview()
        await this.loadList()
      } catch (error) {
        this.reviewError = error?.response?.data?.message || error?.message || '审核操作失败'
      } finally {
        this.reviewSubmitting = false
        if (!this.reviewError) this.closeReview()
      }
    }
  }
}
</script>

<style scoped>
@layer legacy {

.season-filter{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:16px 0}.season-filter select,.season-filter button{padding:9px;border:1px solid #cbd5e1;border-radius:6px;color:#1f3b73;background:white;max-width:100%}
.page-shell { min-height: 100vh; background: #f4f6fa; color: #1f2937; }
.header-bar { display: flex; justify-content: space-between; gap: 1rem; padding: 20px 28px; background: #1f3b73; color: #fff; }
.header-bar h1 { margin: 0; font-size: 24px; }
.header-bar p { margin: 6px 0 0; color: rgba(255,255,255,.78); font-size: 13px; }
.header-actions { display: flex; align-items: center; gap: .7rem; }
.header-actions button { padding: .65rem .9rem; border: 1px solid rgba(255,255,255,.3); border-radius: 7px; background: rgba(255,255,255,.12); color: #fff; cursor: pointer; }
.page-body { max-width: 1380px; margin: 0 auto; padding: 24px; }
.alert { margin-bottom: 14px; padding: 12px 14px; border-radius: 8px; }
.alert.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
.alert.success { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
.season-card { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-radius: 10px; background: #fff; box-shadow: 0 3px 12px rgba(15,23,42,.07); }
.season-card h2 { margin: 4px 0 0; }
.eyebrow { color: #4f46e5; font-size: 12px; font-weight: 700; letter-spacing: .1em; }
.season-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; color: #6b7280; }
.no-season { color: #92400e; }
.stats-grid { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
.stat-card { min-height: 104px; padding: 15px; border-top: 3px solid #94a3b8; border-radius: 9px; background: #fff; box-shadow: 0 2px 8px rgba(15,23,42,.06); }
.stat-card.blue { border-color: #2563eb; } .stat-card.green { border-color: #059669; } .stat-card.orange { border-color: #d97706; } .stat-card.red { border-color: #dc2626; } .stat-card.purple { border-color: #7c3aed; }
.stat-label { color: #6b7280; font-size: 13px; }
.stat-value { margin: 6px 0 2px; color: #172554; font-size: 27px; font-weight: 750; }
.stat-hint { color: #9ca3af; font-size: 11px; }
.list-card { border-radius: 10px; background: #fff; box-shadow: 0 3px 12px rgba(15,23,42,.07); overflow: hidden; }
.tabs { display: flex; gap: 6px; padding: 16px 18px 0; overflow-x: auto; }
.tabs button { white-space: nowrap; padding: 9px 13px; border: 0; border-radius: 8px 8px 0 0; background: #eef2f7; color: #4b5563; cursor: pointer; }
.tabs button.active { background: #1f3b73; color: #fff; }
.tabs span { margin-left: 4px; opacity: .8; }
.filters { display: grid; grid-template-columns: 2fr 1fr 1.2fr auto; gap: 12px; align-items: end; padding: 16px 18px; border-bottom: 1px solid #e5e7eb; background: #fafbfc; }
.filters label { display: flex; flex-direction: column; gap: 6px; color: #4b5563; font-size: 12px; }
.filters input, .filters select { min-height: 40px; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 7px; background: #fff; }
.clear-btn { min-height: 40px; padding: 0 13px; border: 1px solid #d1d5db; border-radius: 7px; background: #fff; cursor: pointer; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; font-size: 13px; }
th { background: #f8fafc; color: #475569; font-weight: 650; }
td strong, td small { display: block; }
td small { margin-top: 4px; color: #6b7280; }
.types-cell { max-width: 240px; line-height: 1.55; }
.danger-text { color: #b91c1c !important; }
.status-badge { display: inline-flex; padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.status-badge.pending { background: #fef3c7; color: #92400e; } .status-badge.approved { background: #d1fae5; color: #065f46; } .status-badge.rejected { background: #fee2e2; color: #991b1b; } .status-badge.returned { background: #ede9fe; color: #5b21b6; }
.row-actions { display: flex; flex-wrap: wrap; gap: 5px; min-width: 170px; }
.row-actions button { padding: 5px 8px; border: 0; border-radius: 5px; cursor: pointer; font-size: 12px; }
.link-btn { background: #e0e7ff; color: #3730a3; } .approve-btn { background: #d1fae5; color: #065f46; } .reject-btn { background: #fee2e2; color: #991b1b; } .return-btn { background: #ede9fe; color: #5b21b6; }
.empty-state { padding: 38px 20px; text-align: center; color: #6b7280; }
.empty-state.compact { padding: 12px; }
.pagination { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; color: #6b7280; font-size: 13px; }
.pagination button { margin-left: 7px; padding: 7px 11px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; }
.pagination button:disabled { opacity: .45; cursor: not-allowed; }
.modal-mask { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15,23,42,.58); }
.detail-modal, .review-modal { width: min(920px, 100%); max-height: 92vh; overflow: auto; border-radius: 12px; background: #fff; box-shadow: 0 24px 70px rgba(15,23,42,.3); }
.review-modal { width: min(520px, 100%); }
.modal-head { display: flex; justify-content: space-between; gap: 15px; padding: 18px 20px; border-bottom: 1px solid #e5e7eb; }
.modal-head h2 { margin: 0; } .modal-head p { margin: 5px 0 0; color: #6b7280; }
.close-icon { border: 0; background: transparent; color: #6b7280; cursor: pointer; font-size: 26px; }
.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 18px 20px; }
.compare-column { padding: 14px; border: 1px solid #e5e7eb; border-radius: 8px; }
.snapshot-column { border-color: #c7d2fe; background: #fafaff; }
.compare-column h3 { margin: 0 0 12px; color: #1f3b73; }
dl { display: grid; grid-template-columns: 110px 1fr; margin: 0; }
dt, dd { padding: 8px 5px; border-bottom: 1px solid #eef0f4; }
dt { color: #6b7280; } dd { margin: 0; color: #1f2937; }
dd.changed { color: #7c3aed; font-weight: 700; }
.reason-box { margin: 0 20px 16px; padding: 12px; border-radius: 7px; background: #fff7ed; color: #9a3412; }
.history-section { padding: 0 20px 20px; }
.history-list { margin: 0; padding-left: 22px; }
.history-list li { margin: 10px 0; padding-left: 5px; color: #4b5563; }
.history-list span { margin-left: 10px; color: #6b7280; font-size: 12px; }
.history-list p { margin: 5px 0 0; }
.review-field { display: flex; flex-direction: column; gap: 7px; padding: 18px 20px; color: #374151; }
.review-field textarea { padding: 10px; border: 1px solid #d1d5db; border-radius: 7px; resize: vertical; }
.review-field small { align-self: flex-end; color: #9ca3af; }
.review-modal .alert { margin: 0 20px; }
.review-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 20px 20px; }
.review-actions button { padding: 9px 14px; border: 0; border-radius: 6px; background: #e5e7eb; cursor: pointer; }
.review-actions .confirm-review { color: #fff; background: #1f3b73; } .review-actions .confirm-review.reject { background: #b91c1c; } .review-actions .confirm-review.return { background: #6d28d9; }
@media (max-width: 1050px) { .stats-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 720px) {
  .header-bar, .season-card, .pagination { align-items: flex-start; flex-direction: column; }
  .page-body { padding: 14px; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .filters, .compare-grid { grid-template-columns: 1fr; }
  .season-meta { align-items: flex-start; }
}

}
</style>
