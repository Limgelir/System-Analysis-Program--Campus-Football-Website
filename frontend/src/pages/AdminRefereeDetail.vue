<template>
  <div class="detail-container">
    <div class="header-bar admin-header">
      <div>
        <div class="title">裁判详情</div>
      </div>
      <button class="btn-back" @click="goBack">返回</button>
    </div>

    <PageState v-if="loading && !referee" kind="loading" message="正在读取裁判资料…" />
    <PageState v-else-if="error && !referee" kind="error" :message="error" @retry="loadReferee" />
    <div v-else-if="referee" class="content">
      <p v-if="error" class="alert error">{{ error }}</p>
      <div class="card">
        <div class="card-heading">
          <h3>账号主资料</h3>
          <button v-if="!editingProfile" class="btn-secondary small" @click="startProfileEdit">编辑资料</button>
        </div>
        <div class="grid two-columns">
          <div><span class="label">学号：</span>{{ referee.student_id || '-' }}</div>
          <div><span class="label">姓名：</span>{{ referee.name || '-' }}</div>
          <div><span class="label">当前级别：</span>{{ referee.grade || '-' }}</div>
          <div><span class="label">目标级别：</span>{{ referee.target_level || '-' }}</div>
          <div><span class="label">是否在上海足协注册：</span>{{ referee.shanghai_fa_registered ? '是' : '否' }}（本人填报）</div>
          <div><span class="label">升入当前级别时间：</span>{{ formatDate(referee.level_promoted_at) }}</div>
          <div><span class="label">账号状态：</span>{{ referee.is_active ? '已启用' : '已停用' }}</div>
          <div><span class="label">密码状态：</span>{{ referee.must_change_password ? '登录后必须改密' : '正常' }}</div>
        </div>
        <div class="button-row">
          <button
            :class="referee.is_active ? 'btn-danger' : 'btn-secondary'"
            :disabled="savingAccountState"
            @click="toggleAccountActive"
          >
            {{ savingAccountState ? '处理中...' : (referee.is_active ? '停用账号' : '重新启用账号') }}
          </button>
          <button class="btn-secondary" :disabled="resettingPassword" @click="resetPassword">
            {{ resettingPassword ? '重置中...' : '重置密码' }}
          </button>
        </div>
        <div v-if="temporaryPassword" class="temporary-password-box">
          <strong>一次性临时密码：</strong><code>{{ temporaryPassword }}</code>
          <button class="btn-secondary small" @click="copyTemporaryPassword">复制</button>
          <p>请立即安全交给该裁判；离开本页后不会再次显示，裁判首次登录必须修改密码。</p>
        </div>
      </div>

      <div v-if="editingProfile" v-draft="{ value: { editForm, selectedPhoto } }" class="card editor-card">
        <h3>编辑账号主资料</h3>
        <p class="editor-hint">裁判本人可修改当前级别、升入时间和上海足协注册情况，其他资料由管理员维护；赛季注册资料独立保留。</p>
        <div class="edit-grid">
          <label>姓名<input v-model.trim="editForm.name" type="text" maxlength="100" /></label>
          <label>当前级别
            <select v-model="editForm.grade">
              <option v-for="grade in gradeOptions" :key="grade" :value="grade">{{ grade }}</option>
            </select>
          </label>
          <label>目标级别
            <select v-model="editForm.target_level">
              <option v-for="grade in gradeOptions" :key="grade" :value="grade">{{ grade }}</option>
            </select>
          </label>
          <label>升入当前级别时间{{ editForm.grade === '裁判学员' ? '（选填）' : ' *' }}<input v-model="editForm.level_promoted_at" type="date" :required="editForm.grade !== '裁判学员'" /></label>
          <label>性别
            <select v-model="editForm.gender">
              <option value="男">男</option>
              <option value="女">女</option>
              <option value="其他">其他</option>
            </select>
          </label>
          <label>学院<input v-model.trim="editForm.college" type="text" maxlength="100" /></label>
          <label>身高（cm）<input v-model.number="editForm.height_cm" type="number" min="1" step="1" /></label>
          <label>体重（kg）<input v-model.number="editForm.weight_kg" type="number" min="1" step="0.1" /></label>
        </div>
        <div class="form-section">
          <div class="label">执法比赛种类</div>
          <div class="checkbox-grid">
            <label v-for="matchType in matchTypeOptions" :key="matchType" class="checkbox-item">
              <input v-model="editForm.match_types" type="checkbox" :value="matchType" />
              <span>{{ matchType }}</span>
            </label>
          </div>
        </div>
        <div class="form-section">
          <label>更换证件照（不选择则保留当前照片）</label>
          <input type="file" accept="image/jpeg,image/png" @change="handlePhotoChange" />
          <div v-if="selectedPhoto" class="file-hint">已选择：{{ selectedPhoto.name }}</div>
        </div>
        <div class="button-row">
          <button class="btn-primary" :disabled="savingProfile" @click="saveProfile">
            {{ savingProfile ? '保存中...' : '保存全部资料' }}
          </button>
          <button class="btn-secondary" :disabled="savingProfile" @click="cancelProfileEdit">取消</button>
        </div>
      </div>

      <div class="card">
        <h3>扩展信息</h3>
        <div v-if="actionError" class="alert error">{{ actionError }}</div>
        <div v-if="actionSuccess" class="alert success">{{ actionSuccess }}</div>
        <div class="grid two-columns">
          <div><span class="label">性别：</span>{{ referee.gender || '-' }}</div>
          <div><span class="label">学院：</span>{{ referee.college || '-' }}</div>
          <div><span class="label">身高：</span>{{ referee.height_cm ? referee.height_cm + ' cm' : '-' }}</div>
          <div><span class="label">体重：</span>{{ referee.weight_kg ? referee.weight_kg + ' kg' : '-' }}</div>
          <div v-draft="{ value: baseCountDraft, resetKey: referee.officiated_count_base }" class="base-count-editor">
            <label class="label" for="officiated-count-base">已执法场次（基础值）：</label>
            <input
              id="officiated-count-base"
              v-model.number="baseCountDraft"
              type="number"
              min="0"
              step="1"
            />
            <button class="btn-secondary small" :disabled="savingBaseCount" @click="saveBaseCount">
              {{ savingBaseCount ? '保存中...' : '保存' }}
            </button>
          </div>
          <div><span class="label">系统统计场次：</span>{{ referee.officiated_count_system ?? 0 }}</div>
          <div><span class="label">已执法场次（总计）：</span>{{ referee.officiated_count_total ?? 0 }}</div>
        </div>
      </div>

      <div class="card" v-if="referee.id_photo_path">
        <h3>证件照</h3>
        <img class="photo" :src="photoUrl" alt="证件照" />
      </div>

      <div class="card">
        <h3>执法比赛种类</h3>
        <div v-if="matchTypes.length > 0" class="tag-list">
          <span v-for="item in matchTypes" :key="item" class="tag">{{ item }}</span>
        </div>
        <div v-else class="empty">未填写</div>
      </div>

      <div class="card">
        <h3>执法比赛记录</h3>
        <div v-if="refereeMatches.length === 0" class="empty">暂无执法记录</div>
        <div v-else class="matches-list">
          <div v-for="match in refereeMatches" :key="match.id" class="match-item">
            <div class="match-header">
              <div class="match-title">{{ match.display_teams }}</div>
              <div class="match-date">{{ String(match.match_date || '').slice(0, 10) || '-' }} · {{ match.match_time ? match.match_time + (match.match_end_time ? '-' + match.match_end_time : '') : '时间待定' }}</div>
            </div>
            <div class="match-details">
              <div class="detail-row">
                <span class="label">赛程ID：</span>{{ match.id }}
              </div>
              <div class="detail-row">
                <span class="label">场序：</span>{{ match.field_order }}
              </div>
              <div class="detail-row">
                <span class="label">比赛类型：</span>{{ match.match_type }}
              </div>
              <div class="detail-row">
                <span class="label">执法角色：</span>{{ (match.my_role_codes?.length ? match.my_role_codes : [match.my_role_code]).map(getRoleDisplayName).join('、') }}
              </div>
              <div class="detail-row">
                <span class="label">报告状态：</span>{{ getReportStatus(match) }}
              </div>
            </div>
            <div class="match-actions">
              <button class="btn-secondary small" @click="viewMatchDetail(match.id)">
                查看赛程详情
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="card summary-card">
        <h3>操作</h3>
        <div class="button-row">
          <button class="btn-secondary" @click="goToScheduleCenter">前往赛程管理</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { REFEREE_GRADES } from '../constants/refereeOptions'
import { adminAPI, fileAPI } from '../api'

export default {
  name: 'AdminRefereeDetail',
  data() {
    return {
      referee: null,
      loading: true,
      error: '',
      baseCountDraft: 0,
      savingBaseCount: false,
      actionError: '',
      actionSuccess: '',
      photoObjectUrl: '',
      editingProfile: false,
      savingProfile: false,
      savingAccountState: false,
      resettingPassword: false,
      temporaryPassword: '',
      selectedPhoto: null,
      gradeOptions: REFEREE_GRADES,
      matchTypeOptions: ['院内赛', '足协杯', '大联赛', '新生杯', '区级及以上比赛'],
      editForm: {
        name: '',
        grade: '',
        target_level: '',
        level_promoted_at: '',
        match_types: [],
        gender: '',
        college: '',
        height_cm: '',
        weight_kg: ''
      }
    }
  },
  computed: {
    matchTypes() {
      if (!this.referee) return []
      if (Array.isArray(this.referee.match_types)) return this.referee.match_types
      if (typeof this.referee.match_types === 'string' && this.referee.match_types.length > 0) {
        return this.referee.match_types.split(',').map(item => item.trim()).filter(Boolean)
      }
      return []
    },
    refereeMatches() {
      return this.referee?.matches || []
    },
    photoUrl() {
      return this.photoObjectUrl
    }
  },
  async mounted() {
    await this.loadReferee()
  },
  beforeUnmount() {
    this.releasePhotoPreview()
  },
  methods: {
    async loadReferee() {
      this.loading = true
      this.error = ''
      try {
        const refereeId = this.$route.params.refereeId
        const response = await adminAPI.getRefereeDetail(refereeId)

        // 简化数据处理逻辑
        let refereeData = response
        if (response && typeof response === 'object' && response.data) {
          refereeData = response.data
        }

        this.referee = refereeData
        this.baseCountDraft = Number(this.referee?.officiated_count_base || 0)
        await this.loadPhotoPreview()

        if (!this.referee) {
          this.error = '裁判信息不存在'
        }
      } catch (error) {
        console.error('Load error:', error)
        this.error = error?.response?.data?.message || error?.message || '加载失败'
      } finally {
        this.loading = false
      }
    },
    goBack() {
      this.$router.back()
    },
    startProfileEdit() {
      this.actionError = ''
      this.actionSuccess = ''
      this.selectedPhoto = null
      this.editForm = {
        name: this.referee?.name || '',
        grade: this.referee?.grade || '',
        target_level: this.referee?.target_level || '',
        level_promoted_at: this.referee?.level_promoted_at ? String(this.referee.level_promoted_at).slice(0, 10) : '',
        match_types: [...this.matchTypes],
        gender: this.referee?.gender || '其他',
        college: this.referee?.college || '',
        height_cm: this.referee?.height_cm || '',
        weight_kg: this.referee?.weight_kg || ''
      }
      this.editingProfile = true
    },
    cancelProfileEdit() {
      if (!this.$confirmLeave(this.$el.querySelector('.editor-card'))) return
      this.editingProfile = false
      this.selectedPhoto = null
    },
    handlePhotoChange(event) {
      const [file] = event?.target?.files || []
      if (!file) {
        this.selectedPhoto = null
        return
      }
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        this.actionError = '证件照只支持 JPG 或 PNG'
        event.target.value = ''
        this.selectedPhoto = null
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        this.actionError = '证件照不能超过 10MB'
        event.target.value = ''
        this.selectedPhoto = null
        return
      }
      this.actionError = ''
      this.selectedPhoto = file
    },
    async saveProfile() {
      if (!this.$confirmLeave(this.$el.querySelector('.base-count-editor'))) return
      this.actionError = ''
      this.actionSuccess = ''
      const height = Number(this.editForm.height_cm)
      const weight = Number(this.editForm.weight_kg)
      if (!this.editForm.name || !this.editForm.grade || !this.editForm.target_level || (this.editForm.grade !== '裁判学员' && !this.editForm.level_promoted_at)) {
        this.actionError = '姓名、当前级别和目标级别不能为空；非裁判学员还须填写升入当前级别时间'
        return
      }
      if (!this.editForm.gender || !this.editForm.college || !Number.isInteger(height) || height <= 0 || !Number.isFinite(weight) || weight <= 0) {
        this.actionError = '请填写有效的性别、学院、身高和体重'
        return
      }
      if (this.editForm.match_types.length === 0) {
        this.actionError = '请至少选择一种执法比赛种类'
        return
      }

      const formData = new FormData()
      formData.append('name', this.editForm.name)
      formData.append('grade', this.editForm.grade)
      formData.append('target_level', this.editForm.target_level)
      formData.append('level_promoted_at', this.editForm.level_promoted_at)
      formData.append('match_types', JSON.stringify(this.editForm.match_types))
      formData.append('gender', this.editForm.gender)
      formData.append('college', this.editForm.college)
      formData.append('height_cm', String(height))
      formData.append('weight_kg', String(weight))
      if (this.selectedPhoto) formData.append('id_photo', this.selectedPhoto)

      this.savingProfile = true
      try {
        await adminAPI.updateReferee(this.referee.id, formData)
        this.editingProfile = false
        this.selectedPhoto = null
        await this.loadReferee()
        this.actionSuccess = '裁判账号主资料已保存'
      } catch (error) {
        this.actionError = error?.response?.data?.message || error?.message || '保存失败'
      } finally {
        this.savingProfile = false
      }
    },
    async saveBaseCount() {
      const value = Number(this.baseCountDraft)
      this.actionError = ''
      this.actionSuccess = ''
      if (!Number.isInteger(value) || value < 0) {
        this.actionError = '基础值必须是大于等于 0 的整数'
        return
      }

      this.savingBaseCount = true
      try {
        await adminAPI.updateReferee(this.referee.id, { officiated_count_base: value })
        await this.loadReferee()
        this.actionSuccess = '已执法场次基础值已保存'
      } catch (error) {
        this.actionError = error?.response?.data?.message || error?.message || '保存失败'
      } finally {
        this.savingBaseCount = false
      }
    },
    async toggleAccountActive() {
      if (!this.$confirmLeave(this.$el.querySelector('.base-count-editor'))) return
      const nextActive = !Boolean(this.referee?.is_active)
      const actionLabel = nextActive ? '重新启用' : '停用'
      if (!window.confirm(`确定要${actionLabel}裁判账号“${this.referee?.name || ''}”吗？`)) return

      this.actionError = ''
      this.actionSuccess = ''
      this.savingAccountState = true
      try {
        await adminAPI.setRefereeActive(this.referee.id, nextActive)
        await this.loadReferee()
        this.actionSuccess = `裁判账号已${nextActive ? '启用' : '停用'}，此前签发的登录令牌已失效`
      } catch (error) {
        this.actionError = error?.response?.data?.message || error?.message || '账号状态更新失败'
      } finally {
        this.savingAccountState = false
      }
    },
    async resetPassword() {
      if (!this.$confirmLeave(this.$el.querySelector('.base-count-editor'))) return
      if (!window.confirm(`确定要重置裁判账号“${this.referee?.name || ''}”的密码吗？所有旧登录令牌会立即失效。`)) return
      this.actionError = ''
      this.actionSuccess = ''
      this.temporaryPassword = ''
      this.resettingPassword = true
      try {
        const response = await adminAPI.resetRefereePassword(this.referee.id)
        this.temporaryPassword = response?.data?.temporary_password || ''
        await this.loadReferee()
        this.actionSuccess = '密码已重置；请立即保存并安全传递下方临时密码'
      } catch (error) {
        this.actionError = error?.response?.data?.message || error?.message || '密码重置失败'
      } finally {
        this.resettingPassword = false
      }
    },
    async copyTemporaryPassword() {
      if (!this.temporaryPassword) return
      try {
        await navigator.clipboard.writeText(this.temporaryPassword)
        this.actionSuccess = '临时密码已复制'
      } catch {
        this.actionError = '复制失败，请手动选择临时密码复制'
      }
    },
    releasePhotoPreview() {
      if (this.photoObjectUrl) {
        URL.revokeObjectURL(this.photoObjectUrl)
        this.photoObjectUrl = ''
      }
    },
    async loadPhotoPreview() {
      this.releasePhotoPreview()
      if (!this.referee?.id || !this.referee?.id_photo_path) return
      try {
        const blob = await fileAPI.getRefereePhoto(this.referee.id)
        this.photoObjectUrl = URL.createObjectURL(blob)
      } catch (error) {
        console.error('证件照加载失败:', error)
      }
    },
    goToScheduleCenter() {
      this.$router.push('/admin-schedule')
    },
    getRoleDisplayName(roleCode) {
      const roleMap = {
        main: '裁判员',
        assistant1: '第一助理裁判员',
        assistant2: '第二助理裁判员',
        fourth: '第四官员',
        second: '第二裁判员', timekeeper: '计时员', second_referee_id:'第二裁判员',timekeeper_id:'计时员',
  supervisor: '裁判监督'
      }
      return roleMap[roleCode] || roleCode
    },
    getReportStatus(match) {
      if (match.my_role_codes?.includes('supervisor') && match.my_role_codes.length > 1) return `裁判员区：${({submitted:'已提交',returned:'已退回'})[match.report_main_status] || '未提交'}；裁判监督区：${({submitted:'已提交',returned:'已退回'})[match.report_supervisor_status] || '未提交'}`
      const status = match.my_role_code === 'supervisor'
        ? match.report_supervisor_status
        : match.report_main_status
      const statusMap = {
        draft: '未提交',
        submitted: '已提交'
      }
      return statusMap[status] || '未开始'
    },
    viewMatchDetail(matchId) {
      this.$router.push(`/admin-schedule/${matchId}`)
    },
    formatDate(dateStr) {
      if (!dateStr) return '-'
      const date = new Date(dateStr)
      if (Number.isNaN(date.getTime())) return '-'
      return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    }
  }
}
</script>

<style scoped>
@layer legacy {



.detail-container {
  min-height: 100vh;
  background: #f5f5f5;
  padding: 1.5rem;
}

.admin-header {
  background: #000000 !important;
  border-bottom: 1px solid #e0e0e0;
}

.admin-header .title,
.admin-header .subtitle {
  color: #ffffff;
}

.subtitle {
  margin-top: 4px;
  font-size: 0.9rem;
  opacity: 0.9;
}

.header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  gap: 1rem;
}

.btn-back {
  background: transparent;
  border: 1px solid #ffffff;
  color: #ffffff;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.3s;
}

.btn-back:hover {
  background: #ffffff;
  color: #000000;
}

.status {
  text-align: center;
  padding: 2rem;
  color: #666;
}

.status.error {
  color: #e74c3c;
}

.content {
  display: grid;
  gap: 1rem;
}

.card {
  background: #fff;
  border-radius: 8px;
  padding: 1.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.card h3 {
  margin: 0 0 0.8rem 0;
  color: #333;
}

.grid {
  display: grid;
  gap: 0.5rem;
}

.two-columns {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.label {
  color: #666;
  margin-right: 0.25rem;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.editor-hint {
  margin: -0.25rem 0 1rem;
  color: #666;
  line-height: 1.6;
}

.edit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}

.edit-grid label,
.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.edit-grid input,
.edit-grid select,
.form-section input[type='file'] {
  padding: 0.55rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}

.form-section {
  margin-top: 1rem;
}

.checkbox-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
}

.checkbox-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.file-hint {
  color: #666;
  font-size: 0.9rem;
}

.btn-danger {
  background: #b91c1c;
  color: #fff;
  border: 1px solid #b91c1c;
  border-radius: 4px;
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.temporary-password-box {
  margin-top: 1rem;
  padding: 1rem;
  background: #fff7ed;
  border: 1px solid #fdba74;
  border-radius: 6px;
}

.temporary-password-box code {
  margin: 0 0.75rem;
  font-size: 1rem;
  user-select: all;
}

.temporary-password-box p {
  margin: 0.75rem 0 0;
  color: #9a3412;
}

.base-count-editor {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.base-count-editor input {
  width: 100px;
}

.photo {
  max-width: 100%;
  border-radius: 6px;
  border: 1px solid #eee;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tag {
  background: #eef2ff;
  color: #3f51b5;
  padding: 0.2rem 0.6rem;
  border-radius: 12px;
  font-size: 0.85rem;
}

.empty {
  text-align: center;
  padding: 1rem;
  color: #999;
}

.summary-card {
  border-left: 4px solid #111827;
}

.summary-text {
  color: #4b5563;
  line-height: 1.7;
}

.button-row {
  margin-top: 1rem;
  display: flex;
  gap: 0.75rem;
}

}
</style>
