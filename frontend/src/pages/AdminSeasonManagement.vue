<template>
  <div class="page-container">
    <div class="header-bar admin-header">
      <div class="title">赛季管理</div>
      <div class="header-actions">
        <button class="btn-header" @click="goDashboard">返回管理员首页</button>
        <button class="btn-header" @click="goTeams">前往队伍管理</button>
      </div>
    </div>

    <div class="season-page">
      <div v-if="error" class="alert error" style="display: block;">
        {{ error }}
      </div>
      <div v-if="success" class="alert success" style="display: block;">
        {{ success }}
      </div>

      <div class="summary-grid">
        <div class="summary-card current-card">
          <div class="summary-label">当前启用赛季</div>
          <template v-if="currentSeason">
            <div class="summary-title">{{ currentSeason.season_name }}</div>
            <div class="summary-subtitle">{{ currentSeason.season_code }}</div>
            <div class="summary-meta">
              {{ formatDate(currentSeason.start_date) }} ～ {{ formatDate(currentSeason.end_date) }}
            </div>
          </template>
          <template v-else>
            <div class="summary-title empty">当前没有启用赛季</div>
            <div class="summary-subtitle">请先新增并启用赛季</div>
          </template>
        </div>

        <div class="summary-card stat-card">
          <div class="summary-label">赛季总数</div>
          <div class="summary-number">{{ seasons.length }}</div>
          <div class="summary-subtitle">仅允许 1 个赛季处于启用状态</div>
        </div>
      </div>

      <div class="content-grid">
        <div class="card form-card">
          <div class="card-header">
            <h2 class="card-title">新增赛季</h2>
          </div>

          <form v-draft="{ value: form }" @submit.prevent="handleCreateSeason">
            <div class="form-grid">
              <div class="form-group">
                <label>赛季编码 *</label>
                <input
                  v-model.trim="form.season_code"
                  type="text"
                  class="form-control"
                  placeholder="例如：2025-fall"
                  maxlength="20"
                  required
                />
                <small class="field-help">最多20个字符，例如2026-fall。</small>
              </div>

              <div class="form-group">
                <label>赛季名称 *</label>
                <input
                  v-model.trim="form.season_name"
                  type="text"
                  class="form-control"
                  placeholder="例如：2025秋"
                  maxlength="20"
                  required
                />
                <small class="field-help">最多20个字符。</small>
              </div>

              <div class="form-group">
                <label>开始日期 *</label>
                <input
                  v-model="form.start_date"
                  type="date"
                  class="form-control"
                  required
                />
              </div>

              <div class="form-group">
                <label>结束日期 *</label>
                <input
                  v-model="form.end_date"
                  type="date"
                  class="form-control"
                  required
                />
              </div>
            </div>

            <label class="checkbox-line">
              <input v-model="form.is_active" type="checkbox" />
              <span>创建后立即启用该赛季</span>
            </label>

            <div class="form-actions">
              <button type="button" class="secondary" :disabled="submitting" @click="resetForm">
                重置
              </button>
              <button type="submit" :disabled="submitting || loading">
                {{ submitting ? '创建中...' : '创建赛季' }}
              </button>
            </div>
          </form>
        </div>

        <div class="card list-card">
          <div class="card-header card-header-inline">
            <h2 class="card-title">赛季列表</h2>
            <button class="secondary btn-refresh" :disabled="loading" @click="loadData">
              {{ loading ? '刷新中...' : '刷新列表' }}
            </button>
          </div>

          <div v-if="loading" class="empty-block">加载中...</div>
          <div v-else-if="seasons.length === 0" class="empty-block">暂无赛季，请先新增。</div>
          <div v-else class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>赛季名称</th>
                  <th>赛季编码</th>
                  <th>日期范围</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="season in seasons" :key="season.id">
                  <td>
                    <div class="season-name">{{ season.season_name }}</div>
                  </td>
                  <td>{{ season.season_code }}</td>
                  <td>{{ formatDate(season.start_date) }} ～ {{ formatDate(season.end_date) }}</td>
                  <td>
                    <span :class="['status-badge', season.is_active ? 'active' : 'inactive']">
                      {{ season.is_active ? '启用中' : '已停用' }}
                    </span>
                  </td>
                  <td>
                    <div class="action-group">
                      <button
                        v-if="!season.is_active"
                        class="small"
                        :disabled="actionLoadingId === season.id"
                        @click="handleActivate(season)"
                      >
                        {{ actionLoadingId === season.id ? '处理中...' : '启用' }}
                      </button>
                      <button
                        v-else
                        class="small danger"
                        :disabled="actionLoadingId === season.id"
                        @click="handleDeactivate(season)"
                      >
                        {{ actionLoadingId === season.id ? '处理中...' : '停用' }}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <PlayerSeasonSettings :seasons="seasons" :current-season-id="currentSeason?.id || null" />
    </div>
  </div>
</template>

<script>
import { seasonAPI } from '../api'
import PlayerSeasonSettings from '../components/PlayerSeasonSettings.vue'

function extractMessage(error, fallback) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    fallback
  )
}

export default {
  name: 'AdminSeasonManagement',
  components: { PlayerSeasonSettings },
  data() {
    return {
      loading: false,
      submitting: false,
      actionLoadingId: null,
      seasons: [],
      currentSeason: null,
      error: '',
      success: '',
      form: {
        season_code: '',
        season_name: '',
        start_date: '',
        end_date: '',
        is_active: false
      }
    }
  },
  mounted() {
    this.loadData()
  },
  methods: {
    goDashboard() {
      this.$router.push('/admin-dashboard')
    },
    goTeams() {
      this.$router.push('/admin-teams')
    },
    clearMessages() {
      this.error = ''
      this.success = ''
    },
    resetForm() {
      this.form = {
        season_code: '',
        season_name: '',
        start_date: '',
        end_date: '',
        is_active: false
      }
    },
    formatDate(value) {
      if (!value) return '-'
      const str = String(value)
      return str.length >= 10 ? str.slice(0, 10) : str
    },
    async loadCurrentSeason() {
      try {
        const response = await seasonAPI.getCurrentSeason()
        if (response?.success) {
          this.currentSeason = response.data || null
          return
        }
        this.currentSeason = null
      } catch (error) {
        if (error?.response?.status === 404) {
          this.currentSeason = null
          return
        }
        throw error
      }
    },
    async loadAllSeasons() {
      const response = await seasonAPI.getAllSeasons()
      this.seasons = Array.isArray(response?.data) ? response.data : []
    },
    async loadData() {
      this.loading = true
      this.clearMessages()

      try {
        await Promise.all([
          this.loadAllSeasons(),
          this.loadCurrentSeason()
        ])
      } catch (error) {
        this.error = extractMessage(error, '加载赛季数据失败')
      } finally {
        this.loading = false
      }
    },
    validateForm() {
      if (!this.form.season_code) {
        this.error = '请填写赛季编码'
        return false
      }
      if (!this.form.season_name) {
        this.error = '请填写赛季名称'
        return false
      }
      if ([...this.form.season_code].length > 20 || [...this.form.season_name].length > 20) {
        this.error = '赛季编码和名称均不能超过20个字符'
        return false
      }
      if (!this.form.start_date || !this.form.end_date) {
        this.error = '请填写开始日期和结束日期'
        return false
      }
      if (this.form.start_date > this.form.end_date) {
        this.error = '开始日期不能晚于结束日期'
        return false
      }
      return true
    },
    async handleCreateSeason() {
      if (this.submitting || this.loading) return

      this.clearMessages()
      if (!this.validateForm()) return

      this.submitting = true
      try {
        const response = await seasonAPI.createSeason({
          season_code: this.form.season_code,
          season_name: this.form.season_name,
          start_date: this.form.start_date,
          end_date: this.form.end_date,
          is_active: this.form.is_active
        })

        this.success = response?.message || '赛季创建成功'
        this.resetForm()
        await this.loadData()
      } catch (error) {
        this.error = extractMessage(error, '创建赛季失败')
      } finally {
        this.submitting = false
      }
    },
    async handleActivate(season) {
      if (!season?.id || this.actionLoadingId) return

      this.clearMessages()
      this.actionLoadingId = season.id
      try {
        const response = await seasonAPI.activateSeason(season.id)
        this.success = response?.message || '赛季启用成功'
        await this.loadData()
      } catch (error) {
        this.error = extractMessage(error, '启用赛季失败')
      } finally {
        this.actionLoadingId = null
      }
    },
    async handleDeactivate(season) {
      if (!season?.id || this.actionLoadingId) return

      const confirmed = window.confirm(`确定停用赛季「${season.season_name}」吗？`)
      if (!confirmed) return

      this.clearMessages()
      this.actionLoadingId = season.id
      try {
        const response = await seasonAPI.deactivateSeason(season.id)
        this.success = response?.message || '赛季停用成功'
        await this.loadData()
      } catch (error) {
        this.error = extractMessage(error, '停用赛季失败')
      } finally {
        this.actionLoadingId = null
      }
    }
  }
}
</script>

<style scoped>
@layer legacy {

.season-page {
  width: 100%;
  min-width: 0;
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.summary-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

.summary-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}

.summary-label {
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 10px;
}

.summary-title {
  font-size: 24px;
  font-weight: 700;
  color: #111827;
}

.summary-title.empty {
  font-size: 20px;
  color: #dc2626;
}

.summary-subtitle {
  margin-top: 8px;
  color: #4b5563;
}

.summary-meta {
  margin-top: 10px;
  color: #6b7280;
  font-size: 14px;
}

.summary-number {
  font-size: 40px;
  font-weight: 700;
  color: #111827;
}

.content-grid {
  display: grid;
  grid-template-columns: 400px 1fr;
  gap: 20px;
  align-items: start;
}

.card {
  min-width: 0;
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}

.card-header {
  margin-bottom: 20px;
}

.card-header-inline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.card-title {
  margin: 0;
  font-size: 20px;
}

.table-wrapper {
  max-width: 100%;
  overflow-x: auto;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
}

.checkbox-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 18px;
  color: #374151;
  font-weight: 500;
}

.checkbox-line input {
  width: auto;
  margin: 0;
}

.form-actions {
  display: flex;
  gap: 12px;
}

.form-actions button,
.btn-refresh {
  width: auto;
  min-width: 110px;
}

.empty-block {
  text-align: center;
  color: #6b7280;
  padding: 36px 20px;
  background: #f9fafb;
  border-radius: 10px;
}

.season-name {
  font-weight: 600;
  color: #111827;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
}

.status-badge.active {
  background: #dcfce7;
  color: #166534;
}

.status-badge.inactive {
  background: #f3f4f6;
  color: #4b5563;
}

.action-group {
  display: flex;
  gap: 8px;
}

.action-group button {
  width: auto;
  min-width: 86px;
  margin: 0;
}

@media (max-width: 960px) {
  .summary-grid,
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .season-page {
    padding: 16px;
  }

  .header-bar {
    padding: 14px 16px;
    align-items: flex-start;
  }

  .header-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .card {
    padding: 18px;
  }

  .card-header-inline,
  .form-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .action-group {
    justify-content: center;
  }
}

}
</style>
