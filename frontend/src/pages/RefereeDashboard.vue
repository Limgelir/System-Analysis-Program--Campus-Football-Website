<template>
  <div class="dashboard-container">
    <div v-if="$studioEnabled" class="studio-dashboard-toolbar"><button id="settings" @click="openSettings">账号设置</button><button @click="logout">退出登录</button></div>
    <div v-else class="header-bar">
      <div class="referee-header-left">
        <img class="brand-logo-sm" :src="logoUrl" alt="徽标" />
        <div>
          <div class="referee-header-title">
            <span v-if="refereeInfo">{{ refereeInfo.name }}</span>
            <span v-else>裁判首页</span>
          </div>
          <div class="referee-header-subtitle">校园足球裁判执裁管理系统</div>
        </div>
      </div>
      <div class="header-actions">
        <button id="settings" @click="openSettings" class="settings-btn">设置</button>
        <button @click="logout" class="logout-btn">退出登录</button>
      </div>
    </div>

    <div class="main-content">
      <template v-if="$studioEnabled">
        <StudioHero title="裁判首页" :badge="[refereeInfo?.name, refereeInfo?.grade, refereeInfo?.college].filter(Boolean).join(' · ')" />
        <p v-if="refereeInfo?.must_change_password" class="password-warning">当前账号必须先修改密码，完成后请重新登录。</p>
        <p v-if="refereeInfo && !collegeOptions.includes(refereeInfo.college)" class="college-notice" role="status">你的学院尚未匹配，请重新选择。原填写：{{ refereeInfo.college || '未填写' }}。<button class="text-btn" @click="openSettings">去选择学院</button></p>
        <section class="studio-stats" aria-label="我的执法概览"><div><span>累计执法</span><strong>{{ refereeInfo?.officiated_count_total ?? '—' }}</strong></div><div><span>正式选派</span><strong>{{ assignmentsLoading || assignmentsError ? '—' : myAssignments.length }}</strong></div><div><span>赛季注册</span><strong class="studio-stat-text">{{ seasonSummary?.status || '读取中…' }}</strong></div></section>
      </template>
      <div v-else class="welcome-section">
        <h1>我的赛季与执法</h1>
        <p v-if="refereeInfo?.must_change_password" class="password-warning">当前账号必须先修改密码，完成后请重新登录。</p>
        <p>欢迎{{ refereeInfo ? refereeInfo.name : '用户' }}。先完成赛季注册，再报名心仪的比赛。</p>
        <p v-if="refereeInfo" class="stat-hint">
          当前级别：{{ refereeInfo.grade || '-' }} · 已执法场次：{{ refereeInfo.officiated_count_total ?? '-' }}
        </p>
      </div>

      <div v-if="!$studioEnabled" class="action-section">
        <p v-if="refereeInfo && !collegeOptions.includes(refereeInfo.college)" class="college-notice" role="status">你的学院尚未匹配，请重新选择。原填写：{{ refereeInfo.college || '未填写' }}。<button class="text-btn" @click="openSettings">去选择学院</button></p>
        <button @click="$router.push('/referee-signups')" class="secondary-btn large">选派报名</button>
        <button @click="goToStats" class="secondary-btn large">我的执法统计</button>
      </div>

      <SeasonRegistrationCard ref="seasonRegistration" id="season-registration" @summary="seasonSummary = $event" />

      <div id="assignments" class="records-section">
        <div class="section-head">
          <div>
            <h2>我的执法列表 <small v-if="$studioEnabled && !assignmentsLoading && !assignmentsError">{{ myAssignments.length }}</small></h2>
            <p class="section-desc">
              这里展示正式选派给你的比赛，可进入报告保存草稿或提交。
            </p>
          </div>
          <button class="text-btn" @click="loadMyAssignments" :disabled="assignmentsLoading">
            {{ assignmentsLoading ? '刷新中...' : '刷新列表' }}
          </button>
        </div>

        <PageState v-if="assignmentsLoading" kind="loading" title="正在加载执法列表…" />
        <PageState v-else-if="assignmentsError" kind="error" :message="assignmentsError" @retry="loadMyAssignments" />
        <PageState v-else-if="myAssignments.length === 0" title="暂无执法场次" message="正式选派后比赛会显示在这里。你可以先查看未来7天的报名比赛。"><RouterLink class="secondary" to="/referee-signups">查看可报名比赛</RouterLink></PageState>

        <div v-else-if="$studioEnabled" class="studio-match-list">
          <article v-for="schedule in myAssignments" :key="schedule.id" class="studio-match">
            <div class="studio-match-meta"><span>{{ formatMatchDate(schedule.match_date) }} / {{ displayMatchTime(schedule.match_time) }}</span><span>{{ schedule.match_type || '正式选派' }}</span></div>
            <div class="studio-match-teams"><span>{{ schedule.team_a_name_snapshot || schedule.teams?.home?.display_name || schedule.teams?.home?.name_snapshot || '主队' }}</span><strong>{{ schedule.score_display === '-' ? 'VS' : schedule.score_display }}</strong><span>{{ schedule.team_b_name_snapshot || schedule.teams?.away?.display_name || schedule.teams?.away?.name_snapshot || '客队' }}</span></div>
            <div class="studio-match-bottom"><div><span>{{ venueText(schedule) }}</span><span>{{ getRoleLabel(schedule) }}</span><span>场序 {{ schedule.field_order ?? '—' }}</span></div><button @click="goToReport(schedule)">报告详情 ↗</button></div>
            <p v-if="schedule.report_main_status === 'returned' || schedule.report_supervisor_status === 'returned'" class="password-warning">{{ schedule.report_main_status === 'returned' ? '裁判员区已退回' : '' }} {{ schedule.report_supervisor_status === 'returned' ? '裁判监督区已退回' : '' }}，进入报告查看原因</p>
          </article>
        </div>
        <div v-else class="match-list">
          <div
            v-for="schedule in myAssignments"
            :key="schedule.id"
            class="match-item"
          >
            <div class="match-header">
              <span class="team-info">{{ getDisplayTeams(schedule) }}</span>
              <span class="score">{{ schedule.score_display }}</span>
            </div>

            <div class="match-details">
              <span>身份：{{ getRoleLabel(schedule) }}</span>
              <span>场序：{{ schedule.field_order ?? '-' }}</span>
              <span>日期：{{ formatMatchDate(schedule.match_date) }} · {{ displayMatchTime(schedule.match_time) }}</span>
              <span>场地：{{ venueText(schedule) }}</span><span>类型：{{ schedule.match_type || '-' }}</span>
              <span v-if="schedule.report_main_status === 'returned' || schedule.report_supervisor_status === 'returned'" class="password-warning">{{ schedule.report_main_status === 'returned' ? '裁判员区已退回' : '' }} {{ schedule.report_supervisor_status === 'returned' ? '裁判监督区已退回' : '' }}，进入报告查看原因</span>
            </div>

            <div class="match-actions">
              <button class="small" @click="goToReport(schedule)">报告详情</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showSettings" class="modal-overlay" @click.self="closeSettings">
      <div class="modal-content">
        <div class="modal-header">
          <h2>裁判设置</h2>
          <button class="close-btn" @click="closeSettings">×</button>
        </div>

        <div class="modal-body">
          <RefereeGradeSettings v-if="!refereeInfo?.must_change_password && getRefereeId()" :referee-id="getRefereeId()" @saved="gradeSaved" @saving="gradeSaving = $event" />
          <RefereeCollegeSettings v-if="!refereeInfo?.must_change_password && getRefereeId()" :referee-id="getRefereeId()" @saved="collegeSaved" @saving="collegeSaving = $event" />
          <form v-if="!refereeInfo?.must_change_password" v-draft="{ value: associationValue, ready: associationLoaded, resetKey: refereeInfo?.shanghai_fa_registered }" class="association-settings" @submit.prevent="saveAssociation">
            <h3>上海足协注册情况</h3>
            <p class="association-hint">由本人填报，与本站赛季注册无关，不影响本站审核或选派资格。</p>
            <label for="settings-shanghai-fa">是否在上海足协注册</label>
            <select id="settings-shanghai-fa" v-model="associationValue" :disabled="associationLoading || associationSaving || !associationLoaded" @change="associationMessage = ''">
              <option value="false">否</option>
              <option value="true">是</option>
            </select>
            <p v-if="associationLoading" role="status">正在读取当前信息...</p>
            <p v-if="associationMessage" :class="['association-message', { 'association-error': associationError }]" :role="associationError ? 'alert' : 'status'">{{ associationMessage }}</p>
            <button type="submit" class="primary-btn full-width" :disabled="associationLoading || associationSaving || !associationLoaded">
              {{ associationSaving ? '保存中...' : '保存上海足协注册情况' }}
            </button>
            <button v-if="!associationLoaded && !associationLoading" type="button" class="text-btn" @click="loadAssociation">重新读取</button>
          </form>
          <div class="settings-form" v-draft="{ value: passwordForm }">
            <h3>修改密码</h3><p v-if="passwordError" class="error" role="alert">{{ passwordError }}</p>
            <div class="form-group">
              <label>旧密码</label>
              <input v-model="passwordForm.oldPassword" type="password" placeholder="请输入旧密码" required />
            </div>
            <div class="form-group">
              <label>新密码</label>
              <input v-model="passwordForm.newPassword" type="password" minlength="8" placeholder="请输入新密码（至少8位）" required />
            </div>
            <div class="form-group">
              <label>确认新密码</label>
              <input v-model="passwordForm.confirmPassword" type="password" placeholder="请再次输入新密码" required />
            </div>
            <div class="form-actions-single">
              <button :disabled="passwordSaving" @click="submitPasswordChange" class="primary-btn full-width">确认修改</button>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script>
import RefereeGradeSettings from '../components/RefereeGradeSettings.vue'
import RefereeCollegeSettings from '../components/RefereeCollegeSettings.vue'
import collegeCatalog from '../../../shared-data/colleges.json'
import { venueText } from '../utils/matchSignup.js'
import { displayMatchTime, compareMatchSchedule } from '../utils/matchTime.js'
import { refereeAPI, scheduleAPI } from '../api/index.js'
import { clearAuth } from '../utils/auth'
import SeasonRegistrationCard from '../components/SeasonRegistrationCard.vue'

const ROLE_LABEL_MAP = Object.freeze({
  main: '裁判员',
  fourth: '第四官员',
  main_referee: '裁判员',
  assistant1: '第一助理裁判员',
  assistant2: '第二助理裁判员',
  fourth_official: '第四官员',
  supervisor: '裁判监督',
  main_referee_id: '裁判员',
  assistant1_id: '第一助理裁判员',
  assistant2_id: '第二助理裁判员',
  fourth_official_id: '第四官员',
  supervisor_id: '裁判监督'
})

function extractSuccess(response, validCodes = [200, 201]) {
  if (!response) return false
  if (response.success === true) return true
  if (validCodes.includes(response.code)) return true
  if (response.data && typeof response.data === 'object') {
    return extractSuccess(response.data, validCodes)
  }
  return false
}

function extractNullableInt(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

export default {
  name: 'RefereeDashboard',
  components: { SeasonRegistrationCard, RefereeGradeSettings, RefereeCollegeSettings },
  computed: {
    logoUrl() {
      return '/brand-logo.png'
    }
  },
  data() {
    return {
      refereeInfo: null,
      seasonSummary: null,
      myAssignments: [],
      assignmentsLoading: false,
      assignmentsError: '',
      showSettings: false, passwordError: '', passwordSaving: false,
      gradeSaving: false,
      collegeSaving: false, collegeOptions: collegeCatalog.map(item => item.name),
      associationValue: 'false',
      associationLoaded: false,
      associationLoading: false,
      associationSaving: false,
      associationError: false,
      associationMessage: '',
      passwordForm: {
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
      }
    }
  },
  watch: { '$route.hash'(value) { if (value === '#settings') this.openSettings() } },
  async mounted() {
    const info = localStorage.getItem('refereeInfo')
    if (info) {
      try {
        this.refereeInfo = JSON.parse(info)
      } catch (error) {
        console.error('解析本地裁判信息失败:', error)
      }
    }

    if (this.refereeInfo?.must_change_password) {
      this.showSettings = true
      return
    }

    await this.refreshRefereeInfo()
    await this.loadMyAssignments()
    if (this.$route.hash === '#settings') this.openSettings()
  },
  methods: {
    collegeSaved(data) {
      this.refereeInfo = { ...this.refereeInfo, ...data }
      localStorage.setItem('refereeInfo', JSON.stringify(this.refereeInfo))
      this.$refs.seasonRegistration?.updateAccountCollege(data.college)
    },
    gradeSaved(data) {
      this.refereeInfo = { ...this.refereeInfo, ...data }
      localStorage.setItem('refereeInfo', JSON.stringify(this.refereeInfo))
      this.$refs.seasonRegistration?.updateAccountGrade(data.grade)
    },
    venueText(value) { return venueText(value) },
    displayMatchTime(value) { return displayMatchTime(value) },
    getRefereeId() {
      return this.refereeInfo?.id || this.refereeInfo?.referee_id || null
    },
    async refreshRefereeInfo() {
      const refereeId = this.getRefereeId()
      if (!refereeId) return

      try {
        const response = await refereeAPI.getInfo(refereeId)
        const data = response?.data || response
        if (data) {
          this.refereeInfo = data
          localStorage.setItem('refereeInfo', JSON.stringify(data))
        }
      } catch (error) {
        console.error('刷新裁判信息失败:', error)
      }
    },
    buildAssignmentRecord(rawRecord = {}) {
      const normalized = scheduleAPI.normalizeRecord
        ? scheduleAPI.normalizeRecord(rawRecord)
        : rawRecord

      const rawReport = rawRecord.report || {}
      const homeScore = extractNullableInt(rawReport.home_score ?? rawRecord.home_score)
      const awayScore = extractNullableInt(rawReport.away_score ?? rawRecord.away_score)
      const scoreDisplay = scheduleAPI.buildScoreDisplay
        ? scheduleAPI.buildScoreDisplay(rawRecord)
        : (homeScore === null || awayScore === null ? '-' : `${homeScore}-${awayScore}`)

      return {
        ...normalized,
        score_display: scoreDisplay,
        report: {
          ...(normalized.report || {}),
          home_score: homeScore,
          away_score: awayScore
        }
      }
    },
    async loadMyAssignments() {
      this.assignmentsLoading = true
      this.assignmentsError = ''

      try {
        const response = await scheduleAPI.getMyAssignments()
        let rawList = []

        if (Array.isArray(response)) {
          rawList = response
        } else if (Array.isArray(response?.data)) {
          rawList = response.data
        } else if (Array.isArray(response?.schedules)) {
          rawList = response.schedules
        }

        this.myAssignments = rawList
          .map(item => this.buildAssignmentRecord(item))
          .sort((a, b) => compareMatchSchedule(a, b, true))
      } catch (error) {
        console.error('加载我的执法列表失败:', error)
        this.myAssignments = []
        this.assignmentsError = '加载执法列表失败，请稍后重试'
      } finally {
        this.assignmentsLoading = false
      }
    },
    getDisplayTeams(schedule) {
      if (!schedule) return '主队 vs 客队'

      const homeName = schedule.team_a_name_snapshot
        || schedule.teams?.home?.display_name
        || schedule.teams?.home?.name_snapshot
        || '主队'

      const awayName = schedule.team_b_name_snapshot
        || schedule.teams?.away?.display_name
        || schedule.teams?.away?.name_snapshot
        || '客队'

      return `${homeName} vs ${awayName}`
    },
    getRoleLabel(schedule) {
      if (!schedule) return '-'
      if (schedule.my_role_codes?.length) return schedule.my_role_codes.map(code => ROLE_LABEL_MAP[code] || code).join('、')
      const myRole = schedule.my_role
      const myRoleCode = schedule.my_role_code
      const myRoleKey = schedule.my_role_key

      if (myRole && ['裁判员', '第一助理裁判员', '第二助理裁判员', '第四官员', '裁判监督', '裁判监督'].includes(myRole)) {
        return myRole === '裁判监督' ? '裁判监督' : myRole
      }

      return ROLE_LABEL_MAP[myRoleKey] || ROLE_LABEL_MAP[myRoleCode] || myRole || '-'
    },
    formatMatchDate(dateString) {
      return dateString ? String(dateString).slice(0, 10) : '-'
    },
    goToReport(schedule) {
      if (!schedule?.id) {
        alert('无法获取赛程ID')
        return
      }
      this.$router.push(`/referee-report/${schedule.id}`)
    },
    goToStats() {
      this.$router.push('/referee-stats')
    },
    async openSettings() {
      this.showSettings = true
      if (!this.refereeInfo?.must_change_password) await this.loadAssociation()
    },
    async loadAssociation() {
      this.associationLoading = true
      this.associationLoaded = false
      this.associationMessage = ''
      this.associationError = false
      try {
        const response = await refereeAPI.getInfo(this.getRefereeId())
        const info = response?.data
        if (typeof info?.shanghai_fa_registered !== 'boolean') throw new Error('未能读取注册情况，请重试')
        this.refereeInfo = { ...this.refereeInfo, shanghai_fa_registered: info.shanghai_fa_registered }
        localStorage.setItem('refereeInfo', JSON.stringify(this.refereeInfo))
        this.associationValue = info.shanghai_fa_registered ? 'true' : 'false'
        this.associationLoaded = true
      } catch (error) {
        this.associationError = true
        this.associationMessage = error.response?.data?.message || error.message || '读取失败，请重试'
      } finally {
        this.associationLoading = false
      }
    },
    async saveAssociation() {
      if (!this.associationLoaded || this.associationLoading || this.associationSaving) return
      this.associationSaving = true
      this.associationMessage = ''
      this.associationError = false
      try {
        const response = await refereeAPI.updateShanghaiFaRegistration(this.getRefereeId(), {
          shanghai_fa_registered: this.associationValue === 'true'
        })
        if (response?.success !== true || typeof response.data?.shanghai_fa_registered !== 'boolean') {
          throw new Error(response?.message || '保存失败，请重试')
        }
        this.refereeInfo.shanghai_fa_registered = response.data.shanghai_fa_registered
        localStorage.setItem('refereeInfo', JSON.stringify(this.refereeInfo))
        this.associationMessage = '已保存。此项不会改变本站赛季注册状态。'
      } catch (error) {
        this.associationError = true
        this.associationMessage = error.response?.data?.message || error.message || '保存失败，请重试'
      } finally {
        this.associationSaving = false
      }
    },
    closeSettings() {
      if (this.gradeSaving || this.collegeSaving) return
      if (this.passwordSaving || this.$confirmLeave?.(this.$el.querySelector('.modal-overlay') || this.$el) === false) return
      if (this.associationSaving || this.associationLoading) return
      this.showSettings = false
      this.passwordForm = {
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
      }
    },
    async submitPasswordChange() {
      if (this.passwordSaving) return
      this.passwordSaving = true; this.passwordError = ''
      try {
        if (!this.passwordForm.oldPassword || !this.passwordForm.newPassword || !this.passwordForm.confirmPassword) {
          this.passwordError = '请填写所有密码字段'
          return
        }
        if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
          this.passwordError = '新密码两次输入不一致'
          return
        }
        if (this.passwordForm.newPassword.length < 8) {
          this.passwordError = '新密码长度至少8位'
          return
        }

        const response = await refereeAPI.updatePassword(this.getRefereeId(), {
          oldPassword: this.passwordForm.oldPassword,
          newPassword: this.passwordForm.newPassword
        })

        if (extractSuccess(response)) {
          this.$markDraftSaved?.(this.$el.querySelector('.settings-form'))
          clearAuth()
          await this.$router.push('/referee-login')
          return
        }

        this.passwordError = response?.message || '密码修改失败'
      } catch (error) {
        console.error('密码修改失败:', error)
        this.passwordError = error?.response?.data?.message || error.message
      } finally { this.passwordSaving = false }
    },
    logout() {
      if (this.$confirmLeave?.(this.$el) === false) return
      if (confirm('确定要退出登录吗?')) {
        clearAuth()
        this.$router.push('/referee-login')
      }
    }
  }
}
</script>

<style scoped>
@layer legacy {

.association-settings { display: grid; gap: 12px; padding-bottom: 24px; margin-bottom: 24px; border-bottom: 1px solid #ddd; }
.association-settings h3, .settings-form h3 { margin: 0 0 12px; }
.association-hint { margin: 0; color: #555; font-size: 14px; line-height: 1.6; }
.association-settings select { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; }
.association-message { color: #166534; background: #f0fdf4; padding: 10px; margin: 0; }
.association-error { color: #991b1b; background: #fef2f2; }
.dashboard-container {
  min-height: 100vh;
  background: #f5f5f5;
  display: flex;
  flex-direction: column;
}

.header-bar {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.settings-btn,
.logout-btn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.3s ease;
}

.settings-btn:hover,
.logout-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.5);
}

.main-content {
  flex: 1;
  padding: 2rem;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
}

.welcome-section,
.action-section,
.records-section {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.welcome-section {
  text-align: center;
  padding: 2rem;
}

.welcome-section h1 {
  margin: 0 0 1rem 0;
  color: #333;
}

.welcome-section p {
  margin: 0;
  color: #666;
  font-size: 1.1rem;
}

.stat-hint {
  margin-top: 0.5rem !important;
  color: #555 !important;
  font-size: 0.95rem !important;
}

.password-warning {
  margin: 0.75rem auto !important;
  padding: 0.75rem 1rem;
  max-width: 560px;
  color: #991b1b !important;
  background: #fee2e2;
  border-radius: 6px;
}

.action-section {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.5rem;
  padding: 1.5rem 2rem;
}

.records-section {
  margin-top: 1.5rem;
  padding: 2rem;
}

.section-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.section-head h2 {
  margin: 0;
  color: #333;
}

.section-desc {
  margin: 0.4rem 0 0 0;
  color: #666;
  font-size: 0.95rem;
}

.text-btn {
  border: none;
  background: transparent;
  color: #667eea;
  cursor: pointer;
  padding: 0.25rem 0;
  font-size: 0.95rem;
}

.text-btn:disabled {
  color: #999;
  cursor: not-allowed;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: #999;
}

.error-state {
  color: #c0392b;
}

.match-list {
  display: grid;
  gap: 1rem;
}

.match-item {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 1rem;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: all 0.3s ease;
}

.match-item:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.match-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.team-info {
  font-weight: 500;
  color: #333;
  word-break: break-word;
}

.score {
  min-width: 48px;
  text-align: right;
  font-size: 1.2rem;
  font-weight: bold;
  color: #667eea;
}

.match-details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  color: #666;
  font-size: 0.95rem;
}

.match-actions {
  display: flex;
  justify-content: flex-end;
}

.small {
  padding: 0.45rem 0.9rem;
  font-size: 0.9rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.small:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(102, 126, 234, 0.35);
}

.primary-btn,
.secondary-btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 500;
}

.primary-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.primary-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.secondary-btn {
  background: #f0f0f0;
  color: #333;
  border: 1px solid #ddd;
}

.secondary-btn:hover {
  background: #e0e0e0;
  border-color: #999;
}

.large {
  padding: 1rem 3rem;
  font-size: 1.1rem;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 1000;
}

.modal-content {
  width: min(720px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: white;
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid #eee;
}

.modal-header h2 {
  margin: 0;
  color: #333;
  flex: 1;
}

.close-btn {
  width: auto;
  flex: 0 0 auto;
  padding: 0.25rem 0.5rem;
  border: none;
  background: transparent;
  font-size: 1.8rem;
  line-height: 1;
  color: #666;
  cursor: pointer;
}

.tabs {
  display: flex;
  gap: 0.75rem;
  padding: 1rem 1.5rem 0;
}

.tab-btn {
  border: none;
  background: #f3f3f3;
  color: #555;
  border-radius: 999px;
  padding: 0.55rem 1rem;
  cursor: pointer;
  transition: all 0.25s ease;
}

.tab-btn.active {
  background: #667eea;
  color: white;
}

.modal-body {
  padding: 1.5rem;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
}

.form-group label {
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: #333;
}

.form-group input,
.form-group select {
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  transition: border-color 0.3s ease;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.checkbox-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #444;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.form-actions-single {
  margin-top: 0.5rem;
}

.full-width {
  width: 100%;
}

.file-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #666;
}

@media (max-width: 768px) {
  .header-bar {
    padding: 1rem;
    flex-direction: column;
    gap: 0.75rem;
  }

  .main-content {
    padding: 1rem;
  }

  .action-section,
  .records-section,
  .welcome-section {
    padding: 1.25rem;
  }

  .section-head,
  .match-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .match-actions {
    justify-content: flex-start;
  }

  .score {
    text-align: left;
  }

  .form-row,
  .checkbox-group {
    grid-template-columns: 1fr;
  }
}

}
</style>
