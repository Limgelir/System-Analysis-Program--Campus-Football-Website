<template>
  <div class="page-container">
    <div class="header-bar admin-header">
      <div class="title">队伍管理</div>
      <div class="header-actions">
        <button class="btn-header" @click="goDashboard">返回管理员首页</button>
        <button class="btn-header" @click="goSeasons">前往赛季管理</button>
      </div>
    </div>

    <div class="team-page">
      <div v-if="error" class="alert error">{{ error }}</div>
      <div v-if="success" class="alert success">{{ success }}</div>

      <div class="summary-grid">
        <div class="summary-card current-season-card">
          <div class="summary-label">当前启用赛季</div>
          <template v-if="currentSeason">
            <div class="summary-number">{{ currentSeason.season_name }}</div>
            <div class="summary-subtitle">
              {{ currentSeason.season_code }} ｜ {{ formatDate(currentSeason.start_date) }} ～ {{ formatDate(currentSeason.end_date) }}
            </div>
          </template>
          <template v-else>
            <div class="summary-number empty-text">未启用</div>
            <div class="summary-subtitle">请先前往赛季管理启用赛季，否则无法建队与导入名单。</div>
          </template>
        </div>

        <div class="summary-card stat-card">
          <div class="summary-label">当前赛季队伍数</div>
          <div class="summary-number">{{ teams.length }}</div>
          <div class="summary-subtitle">按当前启用赛季统计</div>
        </div>

        <div class="summary-card stat-card">
          <div class="summary-label">当前选中队伍</div>
          <div class="summary-number team-name-line">{{ selectedTeam ? selectedTeam.team_name : '未选择' }}</div>
          <div class="summary-subtitle">{{ selectedTeam ? selectedTeam.league_type : '请从左侧列表选择队伍' }}</div>
        </div>
      </div>

      <div class="content-grid">
        <div class="left-column">
          <AdminTeamImport :season-id="currentSeason?.id" @confirmed="imported"/>

          <div class="card list-card">
            <div class="card-header card-header-inline">
              <h2 class="card-title">当前赛季队伍列表</h2>
              <button class="secondary btn-refresh" :disabled="loading" @click="loadData">
                {{ loading ? '刷新中...' : '刷新列表' }}
              </button>
            </div>

            <div v-if="!currentSeason" class="empty-block">请先启用赛季后再查看队伍列表。</div>
            <div v-else-if="loading" class="empty-block">加载中...</div>
            <div v-else-if="teams.length === 0" class="empty-block">当前赛季暂无队伍，请先新建队伍。</div>
            <div v-else class="team-list">
              <button
                v-for="team in teams.slice((teamPage-1)*20,teamPage*20)"
                :key="team.id"
                type="button"
                class="team-item"
                :class="{ active: selectedTeamId === team.id }"
                @click="selectTeam(team)"
              >
                <div class="team-item-main">
                  <div class="team-item-title">{{ team.team_name }}</div>
                  <div class="team-item-meta">{{ team.league_type }} ｜ 第 {{ team.current_roster_version || 0 }} 版名单</div>
                </div>
                <div class="team-item-side">
                  <div class="team-player-count">{{ team.current_roster_player_count || 0 }} 人</div>
                </div>
              </button>
            </div>
            <ListPagination fixed-size :pagination="{page:teamPage,page_size:20,total:teams.length,total_pages:Math.ceil(teams.length/20)}" :loading="loading" @page="teamPage=$event" />
          </div>
        </div>

        <div class="right-column">
          <div class="card detail-card">
            <div class="card-header card-header-inline">
              <h2 class="card-title">队伍详情与名单管理</h2>
              <button
                class="secondary btn-refresh"
                :disabled="detailLoading || !selectedTeamId"
                @click="refreshSelectedTeamData"
              >
                {{ detailLoading ? '加载中...' : '刷新详情' }}
              </button>
            </div>

            <div v-if="!selectedTeam" class="empty-block">请先从左侧选择一支队伍。</div>
            <template v-else>
              <div class="team-detail-summary">
                <div>
                  <div class="team-detail-name">{{ selectedTeam.team_name }}</div>
                  <div class="team-detail-meta">
                    {{ selectedTeam.league_type }} ｜ {{ selectedTeam.season_name || currentSeason?.season_name || '-' }}
                  </div>
                  <div v-if="selectedTeam.description" class="team-detail-desc">{{ selectedTeam.description }}</div>
                </div>
                <div class="team-detail-badges">
                  <span class="badge">当前版本：{{ currentRoster?.roster_batch?.version_no || 0 }}</span>
                  <span class="badge">当前名单：{{ currentRosterPlayers.length }} 人</span>
                </div>
              </div>

              <AdminTeamImport :key="selectedTeamId" :season-id="currentSeason?.id" :team="currentRoster?.team || selectedTeam" @confirmed="imported"/>

              <p v-if="currentRoster?.team">球衣（上衣／裤子／袜子）：{{ currentRoster.team.shirt_color || '/' }} / {{ currentRoster.team.shorts_color || '/' }} / {{ currentRoster.team.socks_color || '/' }}</p>

              <div class="detail-sections">
                <div class="section-card">
                  <div class="section-header">
                    <div class="section-title">当前名单</div>
                    <div class="section-subtitle">
                      {{ currentRoster?.roster_batch ? `版本 ${currentRoster.roster_batch.version_no}` : '暂无名单批次' }}
                    </div>
                  </div>

                  <div v-if="detailLoading" class="empty-block small">加载中...</div>
                  <div v-else-if="currentRosterPlayers.length === 0" class="empty-block small">当前暂无名单。</div>
                  <div v-else class="table-wrapper compact-table">
                    <table>
                      <thead>
                        <tr>
                          <th>号码</th>
                          <th>姓名</th>
                          <th>角色／标记</th><th>备注</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="player in currentRosterPlayers" :key="player.id">
                          <td>{{ player.jersey_number }}</td>
                          <td>{{ player.player_name }}<small v-if="!player.player_account_id">（待关联账号）</small></td>
                          <td>{{ player.is_captain?'队长 ':'' }}{{ player.is_goalkeeper?'守门员 ':'' }}{{ player.is_foreign?'外援 ':'' }}{{ player.is_sports_training?'运训 ':'' }}{{ player.is_football_specialty?'足球特长生':'' }}</td><td>{{ player.remark || '-' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <details :key="selectedTeamId" class="section-card">
                  <summary>历史名单（默认折叠，当前版本不重复列出）</summary>
                  <div class="section-header">
                    <div class="section-title">历史名单批次</div>
                    <div class="section-subtitle">共 {{ historyBatches.length }} 个历史批次</div>
                  </div>

                  <div v-if="detailLoading" class="empty-block small">加载中...</div>
                  <div v-else-if="historyBatches.length === 0" class="empty-block small">暂无历史批次。</div>
                  <div v-else class="batch-list">
                    <button
                      v-for="batch in historyBatches.slice((historyPage-1)*10,historyPage*10)"
                      :key="batch.id"
                      type="button"
                      class="batch-item"
                      :class="{ active: selectedBatchId === batch.id }"
                      @click="handleSelectBatch(batch)"
                    >
                      <div class="batch-item-main">
                        <div class="batch-item-title">第 {{ batch.version_no }} 版名单</div>
                        <div class="batch-item-meta">{{ formatDateTime(batch.uploaded_at || batch.created_at) }}</div>
                      </div>
                      <div class="batch-item-side">{{ batch.player_count || 0 }} 人</div>
                    </button>
                  </div>
                  <ListPagination fixed-size :pagination="{page:historyPage,page_size:10,total:historyBatches.length,total_pages:Math.ceil(historyBatches.length/10)}" :loading="detailLoading" @page="historyPage=$event" />
                </details>
              </div>

              <div v-if="selectedBatchDetail || batchLoading" class="section-card batch-detail-card">
                <div class="section-header">
                  <div class="section-title">历史批次球员明细</div>
                  <div class="section-subtitle">
                    {{ selectedBatchDetail?.roster_batch ? `当前查看：第 ${selectedBatchDetail.roster_batch.version_no} 版` : '请选择左侧一个历史批次' }}
                  </div>
                </div>

                <div v-if="batchLoading" class="empty-block small">加载中...</div>
                <div v-else-if="!selectedBatchDetail" class="empty-block small">请选择一个历史批次查看球员明细。</div>
                <div v-else-if="selectedBatchPlayers.length === 0" class="empty-block small">该批次暂无球员数据。</div>
                <div v-else class="table-wrapper compact-table">
                  <table>
                    <thead>
                      <tr>
                        <th>号码</th>
                        <th>姓名</th>
                        <th>角色／标记</th><th>备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="player in selectedBatchPlayers" :key="player.id">
                        <td>{{ player.jersey_number }}</td>
                        <td>{{ player.player_name }}</td>
                        <td>{{ player.is_captain?'队长 ':'' }}{{ player.is_goalkeeper?'守门员 ':'' }}{{ player.is_foreign?'外援 ':'' }}{{ player.is_sports_training?'运训 ':'' }}{{ player.is_football_specialty?'足球特长生':'' }}</td><td>{{ player.remark || '-' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { seasonAPI, teamAPI } from '../api'
import AdminTeamImport from '../components/AdminTeamImport.vue'
import ListPagination from '../components/ListPagination.vue'

function extractMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback
}

function getPayload(response) {
  return response?.data ?? null
}

export default {
  name: 'AdminTeamManagement',
  components:{ListPagination,AdminTeamImport},
  data() {
    return {
      loading: false,historyPage:1,teamPage:1,detailRequestId:0,batchRequestId:0,
      detailLoading: false,
      batchLoading: false,
      creatingTeam: false,
      uploadingRoster: false,
      error: '',
      success: '',
      currentSeason: null,
      teams: [],
      selectedTeamId: null,
      selectedTeam: null,
      currentRoster: null,
      rosterBatches: [],
      selectedBatchId: null,
      selectedBatchDetail: null,
      reuploadFile: null,
      reuploadFileName: '',
      createForm: {
        team_name: '',
        league_type: '',
        description: '',
        rosterFile: null,
        rosterFileName: ''
      }
    }
  },
  computed: {
    historyBatches(){return this.rosterBatches.filter(b=>Number(b.id)!==Number(this.currentRoster?.roster_batch?.id))},
    currentRosterPlayers() {
      return Array.isArray(this.currentRoster?.players) ? this.currentRoster.players : []
    },
    selectedBatchPlayers() {
      return Array.isArray(this.selectedBatchDetail?.players) ? this.selectedBatchDetail.players : []
    }
  },
  mounted() {
    this.loadData()
  },
  methods: {
    async imported(data){await this.loadData();const team=this.teams.find(t=>t.id===data.team_id);if(team)await this.selectTeam(team)},
    goDashboard() {
      this.$router.push('/admin-dashboard')
    },
    goSeasons() {
      this.$router.push('/admin-seasons')
    },
    clearMessages() {
      this.error = ''
      this.success = ''
    },
    formatDate(value) {
      if (!value) return '-'
      const str = String(value)
      return str.length >= 10 ? str.slice(0, 10) : str
    },
    formatDateTime(value) {
      if (!value) return '-'
      const str = String(value)
      return str.length >= 19 ? str.slice(0, 19).replace('T', ' ') : str.replace('T', ' ')
    },
    resetCreateForm() {
      this.createForm = {
        team_name: '',
        league_type: '',
        description: '',
        rosterFile: null,
        rosterFileName: ''
      }
      if (this.$refs.createRosterInput) {
        this.$refs.createRosterInput.value = ''
      }
    },
    resetReuploadForm() {
      this.reuploadFile = null
      this.reuploadFileName = ''
      if (this.$refs.reuploadRosterInput) {
        this.$refs.reuploadRosterInput.value = ''
      }
    },
    async loadCurrentSeason() {
      try {
        const response = await seasonAPI.getCurrentSeason()
        this.currentSeason = getPayload(response)
      } catch (error) {
        if (error?.response?.status === 404) {
          this.currentSeason = null
          return
        }
        throw error
      }
    },
    async loadTeams() {
      if (!this.currentSeason) {
        this.teams = []
        return
      }

      const response = await teamAPI.getAllTeams()
      const payload = getPayload(response)
      const teams = Array.isArray(payload?.teams) ? payload.teams : []
      this.teams = teams
      this.teamPage=Math.min(this.teamPage,Math.max(1,Math.ceil(teams.length/20)))

      if (teams.length === 0) {
        this.selectedTeamId = null
        this.selectedTeam = null
        this.currentRoster = null
        this.rosterBatches = []
        this.selectedBatchId = null
        this.selectedBatchDetail = null
        this.resetReuploadForm()
        return
      }

      const matched = this.selectedTeamId
        ? teams.find((item) => Number(item.id) === Number(this.selectedTeamId))
        : null

      const targetTeam = matched || teams[0]
      this.selectedTeamId = targetTeam.id
      this.selectedTeam = targetTeam
    },
    async loadData() {
      this.loading = true
      this.clearMessages()

      try {
        await this.loadCurrentSeason()
        if (this.currentSeason) {
          await this.loadTeams()
          if (this.selectedTeamId) {
            await this.loadSelectedTeamDetails(this.selectedTeamId)
          }
        } else {
          this.teams = []
          this.selectedTeamId = null
          this.selectedTeam = null
          this.currentRoster = null
          this.rosterBatches = []
          this.selectedBatchId = null
          this.selectedBatchDetail = null
        }
      } catch (error) {
        this.error = extractMessage(error, '加载队伍管理数据失败')
      } finally {
        this.loading = false
      }
    },
    async loadSelectedTeamDetails(teamId) {
      if (!teamId) return
      const requestId=++this.detailRequestId
      this.batchRequestId++
      this.batchLoading=false
      this.currentRoster=null
      this.rosterBatches=[]
      this.selectedBatchDetail=null
      this.selectedBatchId=null
      this.detailLoading = true
      try {
        const [currentRosterResponse, batchesResponse] = await Promise.all([
          teamAPI.getCurrentRoster(teamId),
          teamAPI.getRosterBatches(teamId)
        ])

        if(requestId!==this.detailRequestId)return
        this.currentRoster = getPayload(currentRosterResponse)

        const batchPayload = getPayload(batchesResponse)
        this.rosterBatches = Array.isArray(batchPayload?.batches) ? batchPayload.batches : []

        this.selectedBatchId = null
        this.selectedBatchDetail = null
        this.historyPage=1
      } catch (error) {
        if(requestId!==this.detailRequestId)return
        this.error = extractMessage(error, '加载队伍详情失败')
      } finally {
        if(requestId===this.detailRequestId)this.detailLoading = false
      }
    },
    async loadBatchDetail(teamId, batchId) {
      if (!teamId || !batchId) return
      const requestId=++this.batchRequestId
      this.batchLoading = true
      try {
        const response = await teamAPI.getRosterBatchPlayers(teamId, batchId)
        if(requestId!==this.batchRequestId)return
        this.selectedBatchId = Number(batchId)
        this.selectedBatchDetail = getPayload(response)
      } catch (error) {
        if(requestId!==this.batchRequestId)return
        this.error = extractMessage(error, '加载历史名单批次失败')
      } finally {
        if(requestId===this.batchRequestId)this.batchLoading = false
      }
    },
    async selectTeam(team) {
      if (!team?.id) return
      this.clearMessages()
      this.selectedTeamId = team.id
      this.selectedTeam = team
      this.resetReuploadForm()
      await this.loadSelectedTeamDetails(team.id)
    },
    async refreshSelectedTeamData() {
      if (!this.selectedTeamId) return
      this.clearMessages()
      await this.loadTeams()
      await this.loadSelectedTeamDetails(this.selectedTeamId)
    },
    async handleSelectBatch(batch) {
      if (!batch?.id || !this.selectedTeamId) return
      this.clearMessages()
      await this.loadBatchDetail(this.selectedTeamId, batch.id)
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
  padding: 16px 24px;
  background: #1f2937;
  color: #fff;
  gap: 16px;
}

.title {
  font-size: 22px;
  font-weight: 700;
}

.header-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn-header {
  width: auto;
  padding: 10px 16px;
  background: #ffffff;
  color: #1f2937;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.team-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px;
}

.alert {
  padding: 12px 16px;
  border-radius: 10px;
  margin-bottom: 16px;
  font-size: 14px;
}

.alert.error {
  background: #fee2e2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}

.alert.success {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.summary-card {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}

.summary-label {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 10px;
}

.summary-number {
  font-size: 24px;
  font-weight: 700;
  color: #111827;
  line-height: 1.3;
}

.summary-subtitle {
  margin-top: 8px;
  font-size: 13px;
  color: #6b7280;
  line-height: 1.6;
}

.team-name-line {
  word-break: break-word;
}

.empty-text {
  color: #9ca3af;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(360px, 420px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.left-column,
.right-column {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card {
  background: #fff;
  border-radius: 18px;
  padding: 20px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

.card-header {
  margin-bottom: 16px;
}

.card-header-inline,
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.card-title,
.section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #111827;
}

.section-subtitle {
  font-size: 13px;
  color: #6b7280;
}

.form-grid {
  display: grid;
  gap: 14px;
}

.single-column {
  grid-template-columns: 1fr;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 14px;
  color: #374151;
  font-weight: 600;
}

.form-control {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  font-size: 14px;
  background: #fff;
  box-sizing: border-box;
}

.textarea {
  min-height: 92px;
  resize: vertical;
}

.form-actions,
.upload-row {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
}

button {
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  background: #2563eb;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

button.secondary {
  background: #e5e7eb;
  color: #111827;
}

button.small {
  padding: 8px 12px;
  font-size: 13px;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.file-hint,
.file-name {
  margin-top: 8px;
  font-size: 13px;
  color: #6b7280;
  line-height: 1.6;
}

.file-name {
  color: #1d4ed8;
}

.empty-block {
  padding: 18px;
  border: 1px dashed #d1d5db;
  border-radius: 12px;
  color: #6b7280;
  background: #f9fafb;
  line-height: 1.7;
}

.empty-block.small {
  padding: 14px;
}

.warning-block {
  border-color: #f59e0b;
  background: #fffbeb;
  color: #92400e;
}

.team-list,
.batch-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.team-item,
.batch-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border: 1px solid #dbe4f0;
  border-radius: 12px;
  background: #fff;
  color: #111827;
  text-align: left;
}

.team-item.active,
.batch-item.active {
  border-color: #2563eb;
  background: #eff6ff;
}

.team-item-title,
.batch-item-title,
.team-detail-name {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.team-item-meta,
.batch-item-meta,
.team-detail-meta,
.team-detail-desc {
  margin-top: 6px;
  font-size: 13px;
  color: #6b7280;
  line-height: 1.6;
}

.team-player-count,
.batch-item-side {
  font-size: 14px;
  font-weight: 700;
  color: #1d4ed8;
  white-space: nowrap;
}

.team-detail-summary {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  padding: 16px;
  border-radius: 14px;
  background: #f8fafc;
  margin-bottom: 18px;
}

.team-detail-badges {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 999px;
  background: #e0f2fe;
  color: #075985;
  font-size: 13px;
  font-weight: 700;
}

.upload-card {
  padding: 16px;
  border-radius: 14px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  margin-bottom: 18px;
}

.detail-sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.section-card {
  padding: 16px;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
  background: #fff;
}

.batch-detail-card {
  margin-top: 18px;
}

.table-wrapper {
  overflow-x: auto;
}

.compact-table table {
  min-width: 100%;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 12px 10px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  font-size: 14px;
  color: #374151;
}

th {
  font-weight: 700;
  color: #111827;
  background: #f9fafb;
}

@media (max-width: 1200px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .summary-grid,
  .detail-sections {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .team-page {
    padding: 16px;
  }

  .header-bar,
  .team-detail-summary,
  .card-header-inline,
  .section-header,
  .upload-row {
    flex-direction: column;
    align-items: stretch;
  }

  .header-actions {
    width: 100%;
  }

  .btn-header,
  button {
    width: 100%;
  }
}

}
</style>
