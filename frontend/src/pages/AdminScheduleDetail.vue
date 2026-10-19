<template>
  <div class="schedule-detail-container">
    <div class="header-bar admin-header">
      <div>
        <div class="title">赛程详情</div>
      </div>
      <div class="header-actions">
        <button class="btn-secondary" :disabled="loading" @click="goBack">返回赛程列表</button>
        <RouterLink v-if="schedule" :to="{path:'/admin-assignments',query:{view:'all',season_id:schedule.season_id,match:schedule.id}}">前往裁判选派</RouterLink>
        <button class="btn-secondary" @click="goToDashboard">仪表板</button>
      </div>
    </div>

    <div class="page-body">
      <PageState v-if="loading" kind="loading" />
      <PageState v-else-if="error" kind="error" :message="error" @retry="initPage" />
      <div v-else-if="schedule"><MatchDiscipline :schedule-id="schedule.id" />
        <div v-if="pageSuccess" class="alert success">{{ pageSuccess }}</div>
        <div v-if="auxWarning" class="alert warning">{{ auxWarning }}</div>

        <div class="info-card">
          <div class="card-header">
            <div>
              <h3>赛程基础信息</h3>
              <div class="card-subtitle">展示当前赛程数据与报告进度摘要。</div>
            </div>
            <div class="card-actions">
              <button class="btn-primary" @click="scrollToEdit" :disabled="supervisorLocked" :title="supervisorLocked ? '报告已开始填写，赛程已锁定' : ''">编辑赛程</button>
              <button class="btn-secondary" @click="goToSchedule">返回赛程中心</button>
            </div>
          </div>

          <div class="info-grid">
            <div><span class="label">赛程ID：</span>{{ schedule.id }}</div>
            <div><span class="label">赛季：</span>{{ schedule.season_name || schedule.season_code || '-' }}</div>
            <div><span class="label">比赛类型：</span>{{ schedule.match_type || '-' }}</div>
            <div><span class="label">主队 / 客队：</span>{{ schedule.team_a_name_snapshot || '-' }} vs {{ schedule.team_b_name_snapshot || '-' }}</div>
            <div><span class="label">比赛日期：</span>{{ displayDate(schedule.match_date) }} · {{ displayMatchTime(schedule.match_time, schedule.match_end_time) }}</div>
            <div><span class="label">场地：</span>{{ venueText(schedule) }}</div><div><span class="label">有效报名：</span>{{ schedule.signup_count }}人</div>
            <div><span class="label">场序：</span>{{ schedule.field_order || '-' }}</div>
            <div><span class="label">指派状态：</span>{{ schedule.is_assignment_complete ? '已完成' : `未完成（缺 ${pendingAssignmentText}）` }}</div>

          </div>

          <div class="progress-grid">
            <div class="progress-card">
              <div class="progress-label">裁判员进度</div>
              <div class="progress-value">{{ formatReportProgress(schedule.report_main_status, schedule.report?.main_report_started_at) }}</div>
              <div class="progress-meta" v-if="schedule.report?.main_report_started_at">开始时间：{{ displayDateTime(schedule.report.main_report_started_at) }}</div>
            </div>
            <div class="progress-card">
              <div class="progress-label">裁判监督进度</div>
              <div class="progress-value">{{ schedule.supervisor_required ? formatReportProgress(schedule.report_supervisor_status, schedule.report?.supervisor_review_started_at) : '无需裁判监督报告' }}</div>
              <div class="progress-meta" v-if="schedule.report?.supervisor_review_started_at">开始时间：{{ displayDateTime(schedule.report.supervisor_review_started_at) }}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3>裁判配置信息</h3>
              <div class="card-subtitle">报告开始后比赛信息保持锁定；裁判人员和岗位配置可随时在“裁判选派”模块调整。</div>
            </div>
            <div class="status-tag" :class="schedule.is_assignment_complete ? 'success' : 'pending'">
              {{ schedule.is_assignment_complete ? '所需岗位已选派' : `仍缺：${pendingAssignmentText}` }}
            </div>
          </div>
          <div class="info-grid">
            <div><span class="label">裁判安排：</span>{{schedule.futsal?'五人制':'普通'}}</div>
            <div v-for="role in rolesFor(schedule)" :key="role.code"><span class="label">{{role.label}}：</span>{{schedule[role.name]||'待选派'}} <small v-if="schedule[role.code+'_source_type']">{{schedule[role.code+'_source_type']==='external'?'（非系统裁判）':'（系统裁判）'}}</small></div>
            <div v-if="!schedule.supervisor_required">无需裁判监督</div>
          </div>
        </div>

        <AdminMatchSignups :schedule-id="schedule.id" />
        <AdminMatchRosterSelection :key="schedule.id+':'+schedule.match_date+':'+schedule.team_a_id+':'+schedule.team_b_id" :schedule-id="schedule.id"/>
        <div ref="editCard" class="card">
          <div class="card-header">
            <div>
              <h3>赛程编辑</h3>
              <div class="card-subtitle">在此更新赛程的基础信息。</div>
            </div>
            <div class="card-actions">
              <button class="btn-secondary" @click="resetEditForm" :disabled="saving">重置为当前值</button>
            </div>
          </div>

          <div v-if="formError" class="alert error compact-alert">{{ formError }}</div>
          <div v-if="scheduleLocked" class="alert warning compact-alert">
            报告开始后比赛信息保持锁定；裁判人员和岗位配置可随时在“裁判选派”模块调整。
          </div>

          <form v-draft="{ value: formData, resetKey: schedule }" class="form" @submit.prevent="handleSave">
            <div class="form-row form-row-three">
              <div class="form-group">
                <label>比赛类型 *</label>
                <select v-model="formData.match_type" :disabled="scheduleLocked" required>
                  <option value="">-- 请选择 --</option>
                  <CompetitionOptions :season-id="schedule?.season_id" />
                </select>
              </div>
              <div class="form-group">
                <label>主队 *</label>
                <select v-model="formData.team_a_id" :disabled="scheduleLocked" required>
                  <option value="">-- 请选择主队 --</option>
                  <option v-for="team in filteredTeams" :key="team.id" :value="String(team.id)">
                    {{ team.team_name }}
                  </option>
                </select>
              </div>
              <div class="form-group">
                <label>客队 *</label>
                <select v-model="formData.team_b_id" :disabled="scheduleLocked" required>
                  <option value="">-- 请选择客队 --</option>
                  <option v-for="team in awayFilteredTeams" :key="`away-${team.id}`" :value="String(team.id)">
                    {{ team.team_name }}
                  </option>
                </select>
              </div>
            </div>

            <div class="form-row form-row-two">
              <div class="form-group">
                <label>比赛日期 *</label>
                <input v-model="formData.match_date" type="date" :disabled="scheduleLocked" required>
              </div>
              <div class="form-group">
                <label for="formData-match-time">比赛时间</label>
                <input id="formData-match-time" v-model="formData.match_time" type="text" inputmode="text" maxlength="11" placeholder="15:00或15:00-16:00" :required="Boolean(schedule?.match_time)" :disabled="scheduleLocked" aria-describedby="formData-time-help">
                <small id="formData-time-help" class="cell-meta">中国标准时间 · 24小时制，如15:00或15:00-16:00；结束时间仅展示，不支持跨午夜；旧比赛尚未填写时可保留待定</small>
              </div>
              <div class="form-group">
                <label>场序 *</label>
                <input v-model="formData.field_order" type="text" maxlength="50" placeholder="例如 A1、J1、1" :disabled="scheduleLocked" required>
              </div>
            </div>

            <label class="supervision-choice"><input type="checkbox" v-model="formData.futsal" :disabled="scheduleLocked"> 五人制裁判安排</label>
            <VenueFields v-model:venue="formData.venue" v-model:detail="formData.venue_detail" :required="Boolean(schedule.venue)" :disabled="scheduleLocked" />
            <p>裁判组请在“裁判选派”模块调整。</p>

            <div class="inline-tip">
              报告开始后比赛信息保持锁定；裁判人员和岗位配置可随时在“裁判选派”模块调整。
            </div>

            <div class="form-actions">
              <button type="submit" class="btn-primary" :disabled="saving || auxLoading || supervisorLocked">
                {{ saving ? '保存中...' : '保存赛程更新' }}
              </button>
              <button type="button" class="btn-secondary" @click="resetEditForm" :disabled="saving">
                重置
              </button>
              <button type="button" class="btn-secondary" @click="goToReport">
                {{ (schedule.main_source_type === 'external' || schedule.supervisor_source_type === 'external') ? '非系统裁判报告（代填 / 修订）' : '查看 / 退回 / 修订裁判报告' }}
              </button>
            </div>
          </form>
        </div>

        <div class="card action-card">
          <h3>操作</h3>
          <div class="button-group primary-actions">
            <button class="btn-primary" @click="goToSchedule">返回赛程管理</button>
            <button class="btn-secondary" @click="goToReport">{{ (schedule.main_source_type === 'external' || schedule.supervisor_source_type === 'external') ? '代非系统裁判填写' : '查看裁判报告' }}</button>
            <button class="btn-secondary" @click="scrollToEdit" :disabled="supervisorLocked" :title="supervisorLocked ? '报告已开始填写，赛程已锁定' : ''">编辑赛程</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { formatChangeMessage, rolesFor } from '../utils/officialRoles.js'
import MatchDiscipline from '../components/MatchDiscipline.vue'
import CompetitionOptions from '../components/CompetitionOptions.vue'
import VenueFields from '../components/VenueFields.vue'
import AdminMatchSignups from '../components/AdminMatchSignups.vue'
import { venueText } from '../utils/matchSignup.js'
import { displayMatchTime, matchTimeError } from '../utils/matchTime.js'
import { scheduleReturnQuery } from '../utils/scheduleNavigation.js'
import { scheduleAPI, teamAPI } from '../api/index.js'
import AdminMatchRosterSelection from '../components/AdminMatchRosterSelection.vue'
import SearchableRefereeSelect from '../components/SearchableRefereeSelect.vue'

const ROLE_OPTIONS = Object.freeze([
  { field: 'main_referee_id', nameField: 'main_referee_name', label: '裁判员' },
  { field: 'assistant1_id', nameField: 'assistant1_name', label: '第一助理裁判员' },
  { field: 'assistant2_id', nameField: 'assistant2_name', label: '第二助理裁判员' },
  { field: 'fourth_official_id', nameField: 'fourth_official_name', label: '第四官员' },
  { field: 'supervisor_id', nameField: 'supervisor_name', label: '裁判监督' }
])

function createEmptyForm() {
  return {
    match_type: '',
    team_a_id: '',
    team_b_id: '',
    match_date: '',
    match_time: '', venue:'',venue_detail:'',
    field_order: '',
    main_referee_id: '',
    assistant1_id: '',
    assistant2_id: '',
    fourth_official_id: '',
    supervisor_required: true, supervisor_id: ''
  }
}

export default {
  name: 'AdminScheduleDetail',
  components: { MatchDiscipline, CompetitionOptions, VenueFields, AdminMatchSignups, SearchableRefereeSelect, AdminMatchRosterSelection },
  data() {
    return {
      schedule: null,
      loading: false,
      saving: false,
      auxLoading: false,
      error: '',
      formError: '',
      pageSuccess: '',
      auxWarning: '',
      currentSeason: null,
      teams: [],
      formData: createEmptyForm(),
      roleOptions: ROLE_OPTIONS
    }
  },
  computed: {
    supervisorLocked() { return Boolean(this.schedule?.supervisor_locked) },
    visibleRoleOptions() { return this.roleOptions.filter(r => r.field !== 'supervisor_id' || this.formData.supervisor_required) },
    filteredTeams() {
      if (!this.formData.match_type) return this.teams
      return this.teams.filter(team => {
        if (!team.league_type) return true
        return team.league_type === this.formData.match_type
      })
    },
    awayFilteredTeams() {
      return this.filteredTeams.filter(team => String(team.id) !== String(this.formData.team_a_id))
    },
    pendingAssignmentText() {
      const pendingRoles = Array.isArray(this.schedule?.pending_assignment_roles)
        ? this.schedule.pending_assignment_roles
        : Array.isArray(this.schedule?.assignment?.pending_roles)
          ? this.schedule.assignment.pending_roles
          : []
      return pendingRoles.length > 0 ? pendingRoles.join('、') : '无'
    },
    scheduleLocked() {
      const report = this.schedule?.report || {}
      return Boolean(
        this.schedule?.main_report_started_at ||
        this.schedule?.supervisor_review_started_at ||
        this.schedule?.main_report_submitted_at ||
        this.schedule?.supervisor_review_submitted_at ||
        report.main_report_started_at ||
        report.supervisor_review_started_at ||
        report.main_report_submitted_at ||
        report.supervisor_review_submitted_at
      )
    },
  },
  mounted() {
    this.initPage()
  },
  methods: {
    rolesFor,
    venueText(value) { return venueText(value) },
    displayMatchTime(value, endTime) { return displayMatchTime(value, endTime) },
    async initPage() {
      this.loading = true
      this.error = ''
      this.auxWarning = ''

      await this.loadScheduleDetail()
      if (this.schedule?.id) await this.loadTeams()

      this.loading = false
    },

    async loadScheduleDetail() {
      const scheduleId = this.$route.params.scheduleId
      if (!scheduleId) {
        this.error = '无效的赛程ID'
        return
      }

      try {
        const response = await scheduleAPI.getDetail(scheduleId)
        const payload = this.extractScheduleDetailPayload(response?.data ?? response)
        this.schedule = payload

        if (!this.schedule || !this.schedule.id) {
          this.error = '赛程不存在或已被删除'
          return
        }

        this.formData = this.buildFormFromSchedule(this.schedule)
      } catch (err) {
        this.error = err?.response?.data?.message || err?.message || '读取赛程详情失败'
      }
    },

    async loadTeams() {
      this.auxLoading = true
      try {
        const res = await teamAPI.getSeasonTeams(this.schedule.season_id)
        const data = res?.data

        if (Array.isArray(data)) {
          this.teams = data
          this.currentSeason = null
          return
        }

        if (data && typeof data === 'object') {
          this.currentSeason = data.current_season || null
          this.teams = Array.isArray(data.teams) ? data.teams : []
          return
        }

        this.teams = []
      } catch (error) {
        const message =
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          '未知错误'
        this.auxWarning = `队伍数据加载失败：${message}`
      } finally {
        for (const side of ['a','b']) {
          const id = this.schedule['team_'+side+'_id']
          if (id && !this.teams.some(team => team.id === id)) this.teams.push({ id, team_name: this.schedule['team_'+side+'_name_snapshot'] || '原赛程球队 #'+id, league_type: this.schedule.match_type })
        }
        this.auxLoading = false
      }
    },

    extractScheduleDetailPayload(payload) {
      if (payload && typeof payload === 'object' && payload.data && !Array.isArray(payload.data)) {
        return payload.data
      }
      return payload
    },

    buildFormFromSchedule(schedule = {}) {
      return {
        futsal: Boolean(schedule.futsal),
        match_type: schedule.match_type || '',
        team_a_id: schedule.team_a_id ? String(schedule.team_a_id) : '',
        team_b_id: schedule.team_b_id ? String(schedule.team_b_id) : '',
        match_date: schedule.match_date ? String(schedule.match_date).slice(0, 10) : '',
        match_time: schedule.match_time ? displayMatchTime(schedule.match_time, schedule.match_end_time) : '', venue:schedule.venue||'',venue_detail:schedule.venue_detail||'',schedule_revision:schedule.schedule_revision,
        field_order: schedule.field_order || '',
        main_referee_id: schedule.main_referee_id_selection || (schedule.main_referee_id ? String(schedule.main_referee_id) : ''),
        assistant1_id: schedule.assistant1_id_selection || (schedule.assistant1_id ? String(schedule.assistant1_id) : ''),
        assistant2_id: schedule.assistant2_id_selection || (schedule.assistant2_id ? String(schedule.assistant2_id) : ''),
        fourth_official_id: schedule.fourth_official_id_selection || (schedule.fourth_official_id ? String(schedule.fourth_official_id) : ''),
        fourth_required: schedule.fourth_required, supervisor_required: schedule.supervisor_required,
        supervisor_id: schedule.supervisor_id_selection || (schedule.supervisor_id ? String(schedule.supervisor_id) : '')
      }
    },

    buildUpdatePayload(form) {
      form = {...form}
      for (const field of ['main_referee_id','assistant1_id','assistant2_id','fourth_official_id','supervisor_id','supervisor_required','fourth_required']) delete form[field]
      if (scheduleAPI.buildPayload) {
        return scheduleAPI.buildPayload(form)
      }

      return {
        match_type: form.match_type || null,
        team_a_id: form.team_a_id || null,
        team_b_id: form.team_b_id || null,
        match_date: form.match_date || null,
        match_time: form.match_time || null,
        field_order: form.field_order || null,
        main_referee_id: form.main_referee_id || null,
        assistant1_id: form.assistant1_id || null,
        assistant2_id: form.assistant2_id || null,
        fourth_official_id: form.fourth_official_id || null,
        supervisor_required: form.supervisor_required, supervisor_id: form.supervisor_required ? form.supervisor_id || null : null
      }
    },

    validateForm() {
      if (!this.formData.match_type || !this.formData.team_a_id || !this.formData.team_b_id) {
        return '请完整填写比赛类型、主队、客队'
      }

      if (!this.formData.match_date) {
        return '请填写比赛日期'
      }

      const timeError = matchTimeError(this.formData.match_time, Boolean(this.schedule?.match_time))
      if (timeError) return timeError

      const fieldOrder = String(this.formData.field_order ?? '').trim()
      if (!fieldOrder || [...fieldOrder].length > 50 || /[\u0000-\u001f\u007f]/u.test(fieldOrder)) {
        return '场序须为1—50个字符，可填写 A1、J1 等'
      }

      if (String(this.formData.team_a_id) === String(this.formData.team_b_id)) {
        return '主队和客队不能相同'
      }

      const selected = new Map()
      for (const role of this.roleOptions.filter(r => r.field !== 'supervisor_id')) {
        const value = this.formData[role.field]
        if (!value) continue
        const id = String(value)
        if (selected.has(id)) {
          if(selected.get(id).field==='main_referee_id'&&role.field==='fourth_official_id')continue
          return `场上裁判岗位不能重复指派同一人：${selected.get(id).label} 与 ${role.label} 冲突`
        }
        selected.set(id, role)
      }

      return ''
    },

    isRoleLocked(field) {
      return field === 'supervisor_id' ? this.supervisorLocked : this.scheduleLocked
    },

    getRoleLockText(field) {
      return this.isRoleLocked(field)
        ? (field === 'supervisor_id' ? '裁判监督报告已开始，裁判监督不可更换。' : '报告已开始，此场上岗位不可更换。')
        : ''
    },

    selectedOtherRefereeIds(currentField) {
      if (currentField === 'supervisor_id') return []
      return this.roleOptions
        .filter(role => role.field !== currentField && role.field !== 'supervisor_id')
        .filter(role => !(['main_referee_id','fourth_official_id'].includes(currentField) && ['main_referee_id','fourth_official_id'].includes(role.field)))
        .map(role => this.formData[role.field])
        .filter(Boolean)
    },

    currentRoleOption(role) {
      if (!role || !(this.schedule?.[role.field] || this.schedule?.[role.field + '_selection'])) return null
      return {
        id: this.schedule[role.field + '_selection'] || this.schedule[role.field],
        source_type: String(this.schedule[role.field + '_selection'] || '').startsWith('external:') ? 'external' : 'system',
        name: this.schedule[role.nameField] || `裁判 #${this.schedule[role.field]}`
      }
    },

    async handleSave() {
      if (!this.schedule?.id) return
      if (this.supervisorLocked) {
        this.formError = '本场报告已开始填写，赛程主数据与裁判配置均已锁定。'
        return
      }

      const validationError = this.validateForm()
      if (validationError) {
        this.formError = validationError
        this.pageSuccess = ''
        return
      }

      this.saving = true
      this.formError = ''
      this.pageSuccess = ''

      try {
        const formatChanged=Boolean(this.formData.futsal)!==Boolean(this.schedule.futsal)
        if(formatChanged&&!window.confirm(formatChangeMessage))return
        const payload = this.buildUpdatePayload(this.formData)
        payload.confirm_format_change=formatChanged
        const response = await scheduleAPI.update(this.schedule.id, payload)
        const detail = this.extractScheduleDetailPayload(response?.data ?? response)
        this.schedule = detail
        this.formData = this.buildFormFromSchedule(detail)
        this.pageSuccess = '赛程已保存。'
      } catch (err) {
        this.formError = err?.response?.data?.message || err?.message || '保存赛程主数据失败'
      } finally {
        this.saving = false
      }
    },

    resetEditForm() {
      if (this.$confirmLeave?.(this.$el) === false) return
      this.formData = this.buildFormFromSchedule(this.schedule || {})
      this.formError = ''
      this.pageSuccess = ''
    },

    formatReportProgress(status, startedAt) {
      if (status === 'returned') return '已退回，待重填'
      if (status === 'submitted') return '已提交'
      if (startedAt) return '填写中'
      return '未开始'
    },

    displayDate(date) {
      if (!date) return '-'
      return String(date).slice(0, 10)
    },

    displayDateTime(date) {
      if (!date) return '-'
      try {
        return new Date(date).toLocaleString('zh-CN')
      } catch {
        return String(date)
      }
    },

    scrollToEdit() {
      this.$refs.editCard?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },

    goBack() {
      this.goToSchedule()
    },

    goToDashboard() {
      this.$router.push('/admin-dashboard')
    },

    goToSchedule() {
      this.$router.push({ path: '/admin-schedule', query: scheduleReturnQuery(this.$route.query, this.schedule?.season_id) })
    },

    goToReport() {
      if (!this.schedule || !this.schedule.id) return
      this.$router.push({ path: `/admin-schedule/${this.schedule.id}/report`, query: scheduleReturnQuery(this.$route.query, this.schedule.season_id) })
    },
  }
}
</script>

<style scoped>
@layer legacy {



.schedule-detail-container {
  min-height: 100vh;
  background: #f4f6fb;
}

.admin-header {
  background: #1f3b73;
  color: #fff;
  padding: 18px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
}

.title {
  font-size: 24px;
  font-weight: 700;
}

.subtitle {
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
}

.header-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.page-body {
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px;
}

.info-card,
.card {
  background: #fff;
  padding: 18px;
  border-radius: 14px;
  margin-bottom: 18px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.card-header h3 {
  margin: 0;
  color: #111827;
}

.card-subtitle {
  margin-top: 6px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.card-actions,
.button-group,
.form-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.primary-actions {
  margin-bottom: 16px;
}


.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.progress-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.progress-card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 14px;
  background: #fafbff;
}

.progress-label {
  font-size: 13px;
  color: #6b7280;
}

.progress-value {
  margin-top: 8px;
  font-size: 18px;
  font-weight: 700;
  color: #1f3b73;
}

.progress-meta {
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
}

.label {
  font-weight: 600;
  color: #1f3b73;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.status-tag.pending {
  background: #ffedd5;
  color: #c2410c;
}

.status-tag.success {
  background: #dcfce7;
  color: #15803d;
}

.alert {
  display: block;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
  font-size: 14px;
}

.alert.error {
  background: #fff1f2;
  color: #be123c;
  border: 1px solid #fecdd3;
}

.alert.success {
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
}

.alert.warning {
  background: #fffbeb;
  color: #92400e;
  border: 1px solid #fde68a;
}

.compact-alert {
  margin-bottom: 14px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: grid;
  gap: 16px;
}

.form-row-three {
  grid-template-columns: repeat(3, 1fr);
}

.form-row-two {
  grid-template-columns: repeat(2, 1fr);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.form-group input,
.form-group select {
  border: 1px solid #d1d5db;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  background: #fff;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}

.divider-title {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
  padding-top: 4px;
}

.inline-tip {
  background: #eef2ff;
  color: #4338ca;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
}

.lock-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: 999px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 600;
}

.field-hint {
  font-size: 12px;
  line-height: 1.5;
}

.lock-hint {
  color: #b91c1c;
}

.btn-primary,
.btn-secondary {
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: #1f3b73;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #17305d;
}

.btn-secondary {
  background: #e5e7eb;
  color: #111827;
}

.btn-secondary:hover:not(:disabled) {
  background: #d1d5db;
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.status {
  color: #4a5568;
  padding: 16px;
}

@media (max-width: 960px) {
  .form-row-three {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 720px) {
  .admin-header,
  .card-header {
    flex-direction: column;
    align-items: stretch;
  }

  .page-body {
    padding: 16px;
  }

  .form-row-three,
  .form-row-two {
    grid-template-columns: 1fr;
  }
}

}
</style>
