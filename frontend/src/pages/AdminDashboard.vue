<template>
  <div class="page-container">
    <div v-if="$studioEnabled" class="studio-dashboard-toolbar"><button @click="openPasswordDialog">修改密码</button><button @click="goHome">返回首页</button><button @click="handleLogout">退出登录</button></div>
    <div v-else class="header-bar admin-header">
      <div>
        <div class="title">管理员仪表板</div>
      </div>
      <div class="header-actions">
        <button class="btn-secondary" @click="openPasswordDialog">修改密码</button>
        <button class="btn-secondary" @click="goHome">返回首页</button>
        <button class="btn-logout" @click="handleLogout">退出登录</button>
      </div>
    </div>

    <div class="main-content">
      <StudioHero v-if="$studioEnabled" title="管理工作台" :badge="adminName" />
      <div v-else class="welcome-card">
        <div class="welcome-text">
          <h2>欢迎进入管理员工作台</h2>
          <p>
            先处理待审核申请和待选派比赛。左侧导航可随时进入赛事设置、资格审核或人员管理。
          </p>
        </div>
        <div class="admin-meta">
          <div class="meta-label">当前管理员</div>
          <div class="meta-value">{{ adminName }}</div>
        </div>
      </div>

      <section class="registration-overview">
        <div class="overview-head">
          <div>
            <div class="overview-eyebrow">赛季注册概览</div>
            <h3>{{ registrationSeason ? registrationSeason.season_name : '暂无启用赛季' }}</h3>
          </div>
          <button class="btn-secondary" type="button" @click="loadRegistrationSummary" :disabled="registrationSummaryLoading">
            {{ registrationSummaryLoading ? '刷新中…' : '刷新统计' }}
          </button>
        </div>
        <div class="overview-grid">
          <div v-for="stat in registrationStats" :key="stat.label" class="overview-stat">
            <span>{{ stat.label }}</span>
            <strong>{{ registrationSummaryLoading && !registrationSummary ? '—' : stat.value }}</strong>
          </div>
        </div>
      </section>

      <AdminWorkbench v-if="!mustChangePassword" />
      <div class="entry-grid"><div class="entry-card entry-card-primary"><div class="entry-title">裁判选派</div><div class="entry-desc">按比赛类型和比赛日查看已报名裁判员、参队信息，逐场确定裁判组。</div><button class="btn-primary" @click="$router.push('/admin-assignments')">前往裁判选派</button></div><div class="entry-card"><div class="entry-title">红黄牌与停赛</div><div class="entry-desc">按球队查看累计、核对停赛，阶段结束后清零。</div><button class="btn-primary" @click="$router.push('/admin-discipline')">前往红黄牌与停赛</button></div>
        <div class="entry-card"><div class="entry-title">球队报名与角色审核</div><div class="entry-desc">审核球员线上组队、指定退回补正人员，处理负责人和场上队长变更。</div><button class="btn-primary" @click="$router.push('/admin-team-applications')">前往球队报名审核</button></div>
        <div class="entry-card"><div class="entry-title">球员学籍审核</div><div class="entry-desc">查看球员提交的学籍信息截图，审核球员当季基础资格，退回补正或撤销资格。</div><button class="btn-primary" @click="$router.push('/admin-player-registrations')">前往球员学籍审核</button></div>
        <div class="entry-card"><div class="entry-title">球员修改学院审核</div><div class="entry-desc">核对原学院、新学院和1系统信息截图，通过后更新球员账号学院。</div><button class="btn-primary" @click="$router.push('/admin-player-college-changes')">前往球员修改学院审核</button></div>
        <div class="entry-card"><div class="entry-title">球员账号管理</div><div class="entry-desc">查询球员姓名、学号和学院，核实后重置密码、启停账号及纠正学号。</div><button class="btn-primary" @click="$router.push('/admin-players')">前往球员账号管理</button></div>
        <div class="entry-card"><div class="entry-title">非系统裁判名单</div><div class="entry-desc">维护无登录账号的校外/临时裁判，跨赛季复用；可担任所有裁判岗位，裁判员或裁判监督报告由管理员代填。</div><button class="btn-primary" @click="$router.push('/admin-external-referees')">前往非系统裁判名单</button></div>
        <div class="entry-card entry-card-primary">
          <div class="entry-title">赛程管理</div>
          <div class="entry-desc">
            创建和编辑比赛、管理名单并跟进报告。
          </div>
          <button class="btn-primary" @click="goToScheduleManagement">
            前往赛程管理
          </button>
        </div>

        <div class="entry-card">
          <div class="entry-title">赛季管理</div>
          <div class="entry-desc">
            查看全部赛季、新增赛季、启用/停用当前赛季。未启用赛季时，后续建队、导名单、建赛程都会被统一拦截。
          </div>
          <button class="btn-primary" @click="goToSeasonManagement">
            前往赛季管理
          </button>
        </div>

        <div class="entry-card">
          <div class="entry-title">队伍管理</div>
          <div class="entry-desc">
            新建队伍、上传名单、查看当前名单与历史批次，为赛程对阵与球员选择准备当前赛季上下文。
          </div>
          <button class="btn-primary" @click="goToTeamManagement">
            前往队伍管理
          </button>
        </div>

        <div class="entry-card">
          <div class="entry-title">裁判账号管理</div>
          <div class="entry-desc">
            维护所有长期登录账号、账号主资料、启停状态和密码，不等同于本赛季可选派裁判。
          </div>
          <button class="btn-primary" @click="goToRefereeManagement">
            前往账号管理
          </button>
        </div>

        <div class="entry-card">
          <div class="entry-title">当前赛季注册裁判</div>
          <div class="entry-desc">
            查看当季申请、对比账号资料并逐人通过、驳回或退回；只有审核通过且账号启用的裁判可被选派。
          </div>
          <button class="btn-primary" @click="goToSeasonRegistrations">
            前往注册审核
          </button>
        </div>
      </div>

      <div class="tips-card">
        <h3>当前建议操作顺序</h3>
        <ol>
          <li>进入“赛季管理”，启用当前赛季</li>
          <li>进入“当前赛季注册裁判”，审核裁判当季申请</li>
          <li>进入“队伍管理”，完成建队与名单导入</li>
          <li>进入“赛程管理”，创建赛程并从已通过的裁判中完成选派</li>
          <li>从赛程详情进入裁判报告，查看后续填写进度</li>
        </ol>
      </div>
    </div>

    <div v-if="passwordDialogVisible" class="modal-overlay" @click.self="closePasswordDialog">
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">修改管理员密码</div>
          <button v-if="!mustChangePassword" class="modal-close" type="button" @click="closePasswordDialog">×</button>
        </div>

        <form v-draft="{ value: passwordForm }" @submit.prevent="submitPasswordChange">
          <div v-if="mustChangePassword" class="password-required-notice">
            此账号必须先设置安全密码，完成后才能使用其他管理功能。
          </div>
          <div class="form-group">
            <label>当前密码</label>
            <input v-model="passwordForm.oldPassword" type="password" autocomplete="current-password" required />
          </div>
          <div class="form-group">
            <label>新密码</label>
            <input v-model="passwordForm.newPassword" type="password" autocomplete="new-password" minlength="12" required />
          </div>
          <div class="form-group">
            <label>确认新密码</label>
            <input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" minlength="12" required />
          </div>

          <div v-if="passwordError" class="password-error">{{ passwordError }}</div>

          <div class="modal-actions">
            <button v-if="!mustChangePassword" class="btn-secondary" type="button" @click="closePasswordDialog">取消</button>
            <button class="btn-primary" type="submit" :disabled="passwordSaving">
              {{ passwordSaving ? '修改中...' : '确认修改' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { adminAPI, seasonRegistrationAPI } from '../api'
import { clearAuth } from '../utils/auth'
import AdminWorkbench from '../components/AdminWorkbench.vue'

export default {
  name: 'AdminDashboard',
  components:{AdminWorkbench},
  data() {
    return {
      passwordDialogVisible: false,
      passwordSaving: false,
      passwordError: '',
      registrationSummaryLoading: false,
      registrationSummary: null,
      registrationSeason: null,
      passwordForm: {
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
      }
    }
  },
  computed: {
    mustChangePassword() {
      try {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}')
        return Boolean(adminInfo.must_change_password)
      } catch {
        return false
      }
    },
    adminName() {
      try {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}')
        return adminInfo.username || adminInfo.admin_name || 'admin'
      } catch {
        return 'admin'
      }
    },
    registrationStats() {
      const summary = this.registrationSummary || {}
      return [
        { label: '账号总数', value: summary.total_accounts ?? 0 },
        { label: '已启用', value: summary.active_accounts ?? 0 },
        { label: '已停用', value: summary.inactive_accounts ?? 0 },
        { label: '未提交', value: summary.unsubmitted_accounts ?? 0 },
        { label: '待审核', value: summary.pending ?? 0 },
        { label: '已通过', value: summary.approved ?? 0 },
        { label: '已驳回', value: summary.rejected ?? 0 },
        { label: '已退回', value: summary.returned ?? 0 },
        { label: '可选派', value: summary.eligible_system_referees ?? 0 },
        { label: '非系统裁判', value: summary.external_referees ?? 0 }
      ]
    }
  },
  async mounted() {
    if (this.mustChangePassword) {
      this.openPasswordDialog()
      return
    }
    await this.loadRegistrationSummary()
  },
  methods: {
    async loadRegistrationSummary() {
      this.registrationSummaryLoading = true
      try {
        const response = await seasonRegistrationAPI.getAdminList({ page: 1, page_size: 1 })
        const data = response?.data ?? response ?? {}
        this.registrationSummary = data.summary || null
        this.registrationSeason = data.season || null
      } catch (error) {
        console.error('读取赛季注册统计失败:', error)
      } finally {
        this.registrationSummaryLoading = false
      }
    },
    openPasswordDialog() {
      this.passwordError = ''
      this.passwordDialogVisible = true
    },
    closePasswordDialog() {
      if (this.passwordSaving || this.mustChangePassword) return
      if (!this.$confirmLeave(this.$el)) return
      this.passwordDialogVisible = false
      this.passwordError = ''
      this.passwordForm = { oldPassword: '', newPassword: '', confirmPassword: '' }
    },
    async submitPasswordChange() {
      this.passwordError = ''

      if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
        this.passwordError = '两次输入的新密码不一致'
        return
      }

      if (this.passwordForm.newPassword.length < 12) {
        this.passwordError = '管理员密码长度不能少于12位'
        return
      }

      this.passwordSaving = true
      try {
        await adminAPI.updatePassword({
          oldPassword: this.passwordForm.oldPassword,
          newPassword: this.passwordForm.newPassword
        })
        this.$markDraftSaved(this.$el)
        clearAuth()
        alert('密码修改成功，请使用新密码重新登录')
        this.$router.push('/admin-login')
      } catch (error) {
        this.passwordError = error?.response?.data?.message || error?.message || '密码修改失败'
      } finally {
        this.passwordSaving = false
      }
    },
    goHome() {
      this.$router.push('/')
    },
    goToSeasonManagement() {
      this.$router.push('/admin-seasons')
    },
    goToTeamManagement() {
      this.$router.push('/admin-teams')
    },
    goToScheduleManagement() {
      this.$router.push('/admin-schedule')
    },
    goToRefereeManagement() {
      this.$router.push('/admin-referees')
    },
    goToSeasonRegistrations() {
      this.$router.push('/admin-season-registrations')
    },
    handleLogout() {
      if (!this.$confirmLeave(this.$el)) return
      clearAuth()
      this.$router.push('/admin-login')
    }
  }
}
</script>

<style scoped>
@layer legacy {

.page-container {
  min-height: 100vh;
  background: #f5f7fb;
}

.header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 28px;
  background: #1f3b73;
  color: #fff;
}

.title {
  font-size: 24px;
  font-weight: 700;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.55);
}

.modal-card {
  width: min(440px, 100%);
  padding: 24px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
}

.modal-header,
.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-header {
  margin-bottom: 20px;
}

.modal-title {
  font-size: 20px;
  font-weight: 700;
  color: #1f2937;
}

.modal-close {
  border: 0;
  background: transparent;
  color: #64748b;
  font-size: 28px;
  cursor: pointer;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  color: #334155;
  font-weight: 600;
}

.form-group input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
}

.password-error {
  margin-bottom: 16px;
  color: #b91c1c;
}

.password-required-notice {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 8px;
  background: #fff7ed;
  color: #9a3412;
  line-height: 1.6;
}

.modal-actions {
  justify-content: flex-end;
  margin-top: 20px;
}

.subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.82);
}

.header-actions {
  display: flex;
  gap: 12px;
}

.main-content {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px;
}

.welcome-card,
.tips-card,
.entry-card,
.registration-overview {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
}

.registration-overview {
  margin-bottom: 24px;
  padding: 20px 22px;
}

.overview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.overview-head h3 {
  margin: 4px 0 0;
  color: #1f2937;
}

.overview-eyebrow {
  color: #4f46e5;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(120px, 1fr));
  gap: 10px;
}

.overview-stat {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
  border-radius: 8px;
  background: #f8fafc;
}

.overview-stat span {
  color: #64748b;
  font-size: 12px;
}

.overview-stat strong {
  color: #1f3b73;
  font-size: 22px;
}

.welcome-card {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 24px;
  margin-bottom: 24px;
  align-items: center;
}

.welcome-text h2 {
  margin: 0 0 10px;
  font-size: 24px;
  color: #1f2937;
}

.welcome-text p {
  margin: 0;
  color: #4b5563;
  line-height: 1.7;
}

.admin-meta {
  min-width: 180px;
  padding: 16px 18px;
  border-radius: 10px;
  background: #eef4ff;
  border: 1px solid #d7e3ff;
}

.meta-label {
  font-size: 12px;
  color: #5b6b8b;
  margin-bottom: 8px;
}

.meta-value {
  font-size: 20px;
  font-weight: 700;
  color: #1f3b73;
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.entry-card {
  padding: 22px;
}

.entry-card-primary {
  border: 1px solid #d7e3ff;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
}

.entry-title {
  font-size: 20px;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 12px;
}

.entry-desc {
  min-height: 72px;
  color: #4b5563;
  line-height: 1.7;
  margin-bottom: 18px;
}

.tips-card {
  padding: 22px 24px;
}

.tips-card h3 {
  margin: 0 0 12px;
  color: #1f2937;
}

.tips-card ol {
  margin: 0;
  padding-left: 20px;
  color: #4b5563;
  line-height: 1.9;
}

.btn-primary,
.btn-secondary,
.btn-logout {
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 14px;
  transition: 0.2s ease;
}

.btn-primary {
  background: #1f3b73;
  color: #fff;
}

.btn-primary:hover {
  background: #17305d;
}

.btn-secondary {
  background: #eef2f7;
  color: #1f2937;
}

.btn-secondary:hover {
  background: #dfe6ef;
}

.btn-logout {
  background: #ef4444;
  color: #fff;
}

.btn-logout:hover {
  background: #dc2626;
}

@media (max-width: 860px) {
  .overview-grid {
    grid-template-columns: repeat(2, minmax(120px, 1fr));
  }

  .overview-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .welcome-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .header-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
  }

  .header-actions {
    width: 100%;
    flex-wrap: wrap;
  }
}

}
</style>
