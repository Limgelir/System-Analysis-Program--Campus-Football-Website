<template>
  <section class="registration-card" aria-labelledby="season-registration-title">
    <div v-if="$studioEnabled" class="studio-registration-summary">
      <span class="studio-registration-icon" aria-hidden="true">{{ status === 'approved' ? '✓' : '○' }}</span>
      <div><h2 id="season-registration-title">{{ loading && !loaded ? '正在读取赛季注册…' : loadError ? '注册状态读取失败' : `本赛季 · ${statusLabel}` }}</h2><p>{{ currentSeason?.season_name || '赛季注册信息' }}<span v-if="!loadError && status === 'approved'"> · 可以报名比赛与接受选派</span></p></div>
      <button type="button" :aria-expanded="detailsOpen" aria-controls="registration-details" @click="detailsOpen = !detailsOpen">{{ detailsOpen ? '收起详情' : '查看注册' }} ↗</button>
    </div>
    <div v-show="!$studioEnabled || detailsOpen" id="registration-details">
    <div class="card-head">
      <div>
        <div class="eyebrow">当前赛季</div>
        <h2 :id="$studioEnabled ? undefined : 'season-registration-title'">赛季注册</h2>
      </div>
      <button class="refresh-btn" type="button" :disabled="loading" @click="loadRegistration">
        {{ loading ? '刷新中…' : '刷新状态' }}
      </button>
    </div>

    <div v-if="loading && !loaded" class="state-message">正在读取赛季注册状态…</div>
    <div v-else-if="loadError" class="state-message error-message">
      {{ loadError }}
      <button class="inline-btn" type="button" @click="loadRegistration">重试</button>
    </div>
    <div v-else-if="!currentSeason" class="no-season">
      <div class="status-pill unavailable">暂无启用赛季</div>
      <p>管理员尚未启用赛季，现在不能提交赛季注册。启用后请刷新本页。</p>
    </div>
    <template v-else>
      <div class="season-summary">
        <div>
          <div class="season-name">{{ currentSeason.season_name }}</div>
          <div class="season-code">{{ currentSeason.season_code }}</div>
        </div>
        <div class="season-dates">
          {{ formatDate(currentSeason.start_date) }} 至 {{ formatDate(currentSeason.end_date) }}
        </div>
      </div>

      <div class="status-panel" :class="statusClass">
        <div class="status-row">
          <span class="status-pill" :class="statusClass">{{ statusLabel }}</span>
          <span v-if="registration?.application_version" class="version-label">
            第 {{ registration.application_version }} 次提交
          </span>
        </div>

        <p class="status-description">{{ statusDescription }}</p>
        <p v-if="registration?.submitted_at" class="status-meta">
          提交时间：{{ formatDateTime(registration.submitted_at) }}
        </p>
        <p v-if="status === 'approved' && registration?.reviewed_at" class="status-meta">
          审核通过时间：{{ formatDateTime(registration.reviewed_at) }}
        </p>
        <div v-if="['rejected', 'returned'].includes(status)" class="review-reason">
          <strong>{{ status === 'rejected' ? '驳回原因' : '退回原因' }}：</strong>
          {{ registration?.review_reason || '管理员未填写原因，请联系管理员。' }}
        </div>

        <button
          v-if="canSubmit"
          class="primary-btn"
          type="button"
          @click="openForm"
        >
          {{ status === 'unsubmitted' ? '参加本赛季注册' : '修改后重新提交' }}
        </button>
      </div>
    </template>

    </div>
    <div v-if="showForm" class="modal-overlay" @click.self="closeForm">
      <div class="form-modal" role="dialog" aria-modal="true" aria-labelledby="registration-form-title">
        <div class="modal-head">
          <div>
            <h2 id="registration-form-title">{{ formTitle }}</h2>
            <p>{{ currentSeason.season_name }} · 资料将保存为本赛季独立快照</p>
          </div>
          <button class="close-btn" type="button" :disabled="submitting" @click="closeForm">×</button>
        </div>

        <form v-draft="{ value: form }" class="registration-form" @submit.prevent="submitRegistration">
          <div class="form-grid">
            <label class="field">
              <span>姓名</span>
              <input v-model.trim="form.name" maxlength="100" required />
            </label>
            <label class="field">
              <span>学院</span>
              <CollegeSelect v-model="form.college" show-empty-legacy />
            </label>
            <label class="field">
              <span>身高（cm）</span>
              <input v-model.number="form.height_cm" type="number" min="1" max="300" step="1" required />
            </label>
            <label class="field">
              <span>体重（kg）</span>
              <input v-model.number="form.weight_kg" type="number" min="0.1" max="500" step="0.1" required />
            </label>
            <label class="field full-field">
              <span>当前级别</span>
              <select v-model="form.grade" required>
                <option value="" disabled>请选择当前级别</option>
                <option v-for="option in gradeOptions" :key="option" :value="option">{{ option }}</option>
              </select>
            </label>
          </div>

          <fieldset class="match-types-fieldset">
            <legend>执法过的比赛类型（至少选择一项）</legend>
            <label v-for="option in matchTypeOptions" :key="option" class="check-option">
              <input v-model="form.match_types" type="checkbox" :value="option" />
              <span>{{ option }}</span>
            </label>
          </fieldset>

          <div class="snapshot-notice">
            本次填写只用于 {{ currentSeason.season_name }} 审核，不会覆盖账号主资料。提交后审核期间不能修改。
          </div>
          <div v-if="formError" class="form-error">{{ formError }}</div>

          <div class="form-actions">
            <button class="secondary-btn" type="button" :disabled="submitting" @click="closeForm">取消</button>
            <button class="primary-btn" type="submit" :disabled="submitting">
              {{ submitting ? '提交中…' : '提交审核' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script>
import CollegeSelect from '../../../shared-ui/CollegeSelect.vue'
import { REFEREE_GRADES } from '../constants/refereeOptions'
import { seasonRegistrationAPI } from '../api/index.js'

const STATUS_LABELS = Object.freeze({
  unsubmitted: '未注册',
  pending: '审核中',
  approved: '已注册',
  rejected: '已驳回',
  returned: '已退回',
  unavailable: '暂无启用赛季'
})

const EMPTY_FORM = () => ({
  name: '',
  height_cm: '',
  weight_kg: '',
  college: '',
  grade: '',
  match_types: []
})

export default {
  name: 'SeasonRegistrationCard',
  components: { CollegeSelect },
  data() {
    return {
      loaded: false,
      detailsOpen: false,
      loading: false,
      submitting: false,
      loadError: '',
      formError: '',
      showForm: false,
      currentSeason: null,
      registration: null,
      accountPrefill: null,
      status: 'unavailable',
      form: EMPTY_FORM(),
      gradeOptions: REFEREE_GRADES,
      matchTypeOptions: ['院内赛', '足协杯', '大联赛', '新生杯', '区级及以上比赛']
    }
  },
  computed: {
    statusLabel() {
      return STATUS_LABELS[this.status] || this.status
    },
    statusClass() {
      return `status-${this.status}`
    },
    canSubmit() {
      return Boolean(this.currentSeason) && ['unsubmitted', 'rejected', 'returned'].includes(this.status)
    },
    formTitle() {
      return this.status === 'unsubmitted' ? '参加本赛季注册' : '修改赛季注册资料'
    },
    statusDescription() {
      const messages = {
        unsubmitted: '你尚未参加本赛季注册。提交并经管理员审核通过后，才可以被选派执法。',
        pending: '申请正在等待管理员审核；审核通过前不能被选派执法。',
        approved: '本赛季注册已经审核通过，你现在属于本赛季可选派系统裁判。',
        rejected: '本次申请未通过审核，请根据原因修改资料后重新提交。',
        returned: '管理员已退回已通过的申请，请修改资料并重新提交；重新通过前不能被新选派。'
      }
      return messages[this.status] || ''
    }
  },
  mounted() {
    this.loadRegistration()
  },
  methods: {
    updateAccountCollege(college) {
      if (this.accountPrefill) this.accountPrefill = { ...this.accountPrefill, college }
    },
    updateAccountGrade(grade) {
      if (this.accountPrefill) this.accountPrefill = { ...this.accountPrefill, grade }
    },
    extractData(response) {
      return response?.data ?? response ?? {}
    },
    async loadRegistration() {
      this.loading = true
      this.loadError = ''
      try {
        const response = await seasonRegistrationAPI.getCurrent()
        const data = this.extractData(response)
        this.currentSeason = data.current_season || null
        this.registration = data.registration || null
        this.accountPrefill = data.account_prefill || null
        this.status = data.registration_status || (this.currentSeason ? 'unsubmitted' : 'unavailable')
      } catch (error) {
        this.loadError = error?.response?.data?.message || error?.message || '获取赛季注册状态失败'
      } finally {
        this.loaded = true
        this.loading = false
        this.$emit('summary', { status: this.loadError ? '读取失败' : this.statusLabel, season: this.currentSeason })
      }
    },
    buildFormSource() {
      if (this.registration && ['rejected', 'returned'].includes(this.status)) {
        return {
          name: this.registration.name_snapshot,
          height_cm: this.registration.height_cm_snapshot,
          weight_kg: this.registration.weight_kg_snapshot,
          college: this.registration.college_snapshot,
          grade: this.registration.grade_snapshot,
          match_types: this.registration.match_types_snapshot
        }
      }
      return this.accountPrefill || {}
    },
    normalizeMatchTypes(values) {
      const aliases = {
        '校足协杯': '足协杯',
        '校大联赛': '大联赛',
        '校新生杯': '新生杯'
      }
      return [...new Set((Array.isArray(values) ? values : [])
        .map(item => aliases[item] || item)
        .filter(item => this.matchTypeOptions.includes(item)))]
    },
    openForm() {
      if (!this.canSubmit) return
      const source = this.buildFormSource()
      this.form = {
        name: source.name || '',
        height_cm: source.height_cm ?? '',
        weight_kg: source.weight_kg ?? '',
        college: source.college || '',
        grade: source.grade || '',
        match_types: this.normalizeMatchTypes(source.match_types)
      }
      this.formError = ''
      this.showForm = true
    },
    closeForm() {
      if (this.$confirmLeave?.(this.$el) === false) return
      if (this.submitting) return
      this.showForm = false
      this.formError = ''
    },
    validateForm() {
      if (!this.form.name || !this.form.college || !this.form.grade) return '请完整填写姓名、学院和当前级别'
      if (!Number.isInteger(Number(this.form.height_cm)) || Number(this.form.height_cm) < 1 || Number(this.form.height_cm) > 300) {
        return '身高必须是 1 到 300 之间的整数'
      }
      const weight = Number(this.form.weight_kg)
      if (!Number.isFinite(weight) || weight <= 0 || weight > 500) return '体重必须是 0 到 500 之间的数字'
      if (!Array.isArray(this.form.match_types) || this.form.match_types.length === 0) return '请至少选择一种执法过的比赛类型'
      return ''
    },
    async submitRegistration() {
      this.formError = this.validateForm()
      if (this.formError) return
      this.submitting = true
      try {
        await seasonRegistrationAPI.submitCurrent(this.form)
        this.showForm = false
        await this.loadRegistration()
      } catch (error) {
        this.formError = error?.response?.data?.message || error?.message || '提交赛季注册申请失败'
      } finally {
        this.submitting = false
      }
    },
    formatDate(value) {
      if (!value) return '-'
      return String(value).slice(0, 10)
    },
    formatDateTime(value) {
      if (!value) return '-'
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
    }
  }
}
</script>

<style scoped>
@layer legacy {

.registration-card {
  margin-top: 1.5rem;
  padding: 1.5rem 2rem;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
.card-head, .season-summary, .status-row, .modal-head, .form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.eyebrow { color: #667eea; font-size: .78rem; font-weight: 700; letter-spacing: .12em; }
.card-head h2, .modal-head h2 { margin: .2rem 0 0; color: #24283a; }
.refresh-btn, .inline-btn { border: 0; background: transparent; color: #5b67d8; cursor: pointer; }
.season-summary { margin-top: 1.2rem; padding: 1rem 1.1rem; border: 1px solid #e6e8f2; border-radius: 8px; }
.season-name { color: #24283a; font-size: 1.15rem; font-weight: 700; }
.season-code, .season-dates, .status-meta, .version-label { color: #6b7280; font-size: .9rem; }
.status-panel { margin-top: 1rem; padding: 1rem 1.1rem; border-left: 4px solid #9ca3af; border-radius: 6px; background: #f8fafc; }
.status-panel.status-pending { border-color: #d97706; background: #fffbeb; }
.status-panel.status-approved { border-color: #059669; background: #ecfdf5; }
.status-panel.status-rejected { border-color: #dc2626; background: #fef2f2; }
.status-panel.status-returned { border-color: #7c3aed; background: #f5f3ff; }
.status-pill { display: inline-flex; padding: .3rem .7rem; border-radius: 999px; background: #e5e7eb; color: #374151; font-size: .82rem; font-weight: 700; }
.status-pill.status-pending { background: #fef3c7; color: #92400e; }
.status-pill.status-approved { background: #d1fae5; color: #065f46; }
.status-pill.status-rejected { background: #fee2e2; color: #991b1b; }
.status-pill.status-returned { background: #ede9fe; color: #5b21b6; }
.status-pill.unavailable { background: #e5e7eb; }
.status-description { margin: .8rem 0 .4rem; color: #374151; line-height: 1.65; }
.status-meta { margin: .25rem 0; }
.review-reason { margin: .8rem 0; padding: .7rem .8rem; border-radius: 6px; background: rgba(255,255,255,.75); color: #4b5563; }
.primary-btn, .secondary-btn { margin-top: .8rem; padding: .7rem 1.1rem; border: 0; border-radius: 6px; cursor: pointer; font-weight: 600; }
.primary-btn { color: #fff; background: linear-gradient(135deg, #667eea, #764ba2); }
.secondary-btn { color: #374151; background: #e5e7eb; }
.primary-btn:disabled, .secondary-btn:disabled, .refresh-btn:disabled { opacity: .55; cursor: not-allowed; }
.state-message, .no-season { margin-top: 1rem; padding: 1.2rem; border-radius: 7px; background: #f8fafc; color: #6b7280; }
.error-message, .form-error { color: #b91c1c; background: #fef2f2; }
.no-season p { margin: .8rem 0 0; }
.modal-overlay { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgba(15,23,42,.58); }
.form-modal { width: min(720px, 100%); max-height: 92vh; overflow: auto; border-radius: 12px; background: #fff; box-shadow: 0 24px 70px rgba(15,23,42,.28); }
.modal-head { padding: 1.25rem 1.5rem; border-bottom: 1px solid #e5e7eb; align-items: flex-start; }
.modal-head p { margin: .35rem 0 0; color: #6b7280; }
.close-btn { border: 0; background: transparent; color: #6b7280; cursor: pointer; font-size: 1.8rem; }
.registration-form { padding: 1.5rem; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.field { display: flex; flex-direction: column; gap: .45rem; color: #374151; font-weight: 600; }
.field input, .field select { padding: .7rem .75rem; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; font-weight: 400; }
.full-field { grid-column: 1 / -1; }
.match-types-fieldset { display: grid; grid-template-columns: repeat(2, 1fr); gap: .75rem; margin: 1.2rem 0; padding: 1rem; border: 1px solid #dfe3ee; border-radius: 8px; }
.match-types-fieldset legend { padding: 0 .35rem; color: #374151; font-weight: 600; }
.check-option { display: flex; align-items: center; gap: .5rem; color: #4b5563; }
.snapshot-notice { padding: .8rem; border-radius: 6px; background: #eef2ff; color: #4338ca; line-height: 1.55; }
.form-error { margin-top: .9rem; padding: .7rem .8rem; border-radius: 6px; }
.form-actions { justify-content: flex-end; margin-top: .5rem; }
@media (max-width: 640px) {
  .registration-card { padding: 1.2rem; }
  .card-head, .season-summary { align-items: flex-start; flex-direction: column; }
  .form-grid, .match-types-fieldset { grid-template-columns: 1fr; }
}

}
</style>
