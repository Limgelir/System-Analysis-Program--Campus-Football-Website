<template>
  <div class="schedule-container">
    <div class="header-bar admin-header">
      <div>
        <div class="title">赛程管理</div>
      </div>
      <div class="header-actions">
        <button class="btn-secondary" :disabled="scheduleLoading || exporting || !pagination.total" @click="exportSchedules">{{exporting?'导出中…':'导出当前筛选 CSV'}}</button>
        <button class="btn-secondary" @click="goToSeasonManagement">赛季管理</button>
        <button class="btn-secondary" @click="goToTeamManagement">队伍管理</button>
        <button class="btn-secondary" @click="goBack">返回仪表板</button>
      </div>
    </div>

    <div class="page-body">
      <div v-if="pageError" class="alert error">
        {{ pageError }}
      </div>

      <div v-if="pageSuccess" class="alert success">
        {{ pageSuccess }}
      </div>

      <div v-if="teamWarning" class="alert warning">
        {{ teamWarning }}
      </div>

      <div v-if="scheduleWarning" class="alert warning">
        {{ scheduleWarning }}
      </div>


      <div v-if="scheduleLoading" class="status" role="status">正在读取赛季与赛程...</div>
      <div class="info-card" v-else-if="currentSeason">
        <div class="info-title">当前启用赛季</div>
        <div class="info-value">
          {{ currentSeason.season_name || currentSeason.season_code || `赛季 #${currentSeason.id}` }}
        </div>
        <div class="info-desc info-subline">新建比赛归属当前启用赛季。查看历史赛季不会改变当前启用赛季。</div>
        <div class="info-desc info-subline">先创建比赛，再选派裁判；在“裁判选派”按比赛日查看报名，报告进度可从赛程列表查看。</div>
      </div>

      <div class="info-card empty-state" v-else-if="scheduleWarning">
        <div class="info-title">赛季状态暂不可用</div>
        <div class="info-desc">请重新选择赛季或点击刷新；加载失败时不会展示其他赛季的数据。</div>
      </div>
      <div class="info-card empty-state" v-else>
        <div class="info-title">当前没有启用赛季</div>
        <div class="info-desc">请先前往赛季管理启用赛季，再依次进行建队、名单导入与赛程创建。</div>
      </div>

      <div class="content-grid">
        <div class="card">
          <h3>新建赛程</h3>

          <div v-if="scheduleLoading" class="inline-tip">正在确认当前赛季，请稍候。</div>
          <div v-else-if="scheduleWarning" class="inline-tip">请先成功加载当前赛季，再创建赛程。</div>
          <div v-else-if="!currentSeason" class="inline-tip">
            没有启用赛季，当前不允许创建赛程。
          </div>
          <div v-else-if="!canCreateSchedule" class="inline-tip">
            新建赛程仅面向当前启用赛季。查看历史不会切换启用赛季。
            <button type="button" class="btn-secondary" @click="changeViewedSeason('')">查看当前赛季后新建</button>
          </div>

          <form v-else v-draft="{ value: formData }" @submit.prevent="handleAddSchedule" class="form">
            <div class="form-row form-row-three">
              <div class="form-group">
                <label>比赛类型 *</label>
                <select v-model="formData.match_type" required>
                  <option value="">-- 请选择 --</option>
                  <CompetitionOptions :season-id="currentSeason?.id" />
                </select>
              </div>

              <div class="form-group">
                <label>主队 *</label>
                <select v-model="formData.team_a_id" required>
                  <option value="">-- 请选择主队 --</option>
                  <option
                    v-for="team in filteredTeams"
                    :key="team.id"
                    :value="team.id"
                  >
                    {{ team.team_name }}
                  </option>
                </select>
              </div>

              <div class="form-group">
                <label>客队 *</label>
                <select v-model="formData.team_b_id" required>
                  <option value="">-- 请选择客队 --</option>
                  <option
                    v-for="team in awayFilteredTeams"
                    :key="`away-${team.id}`"
                    :value="team.id"
                  >
                    {{ team.team_name }}
                  </option>
                </select>
              </div>
            </div>

            <div class="form-row form-row-two">
              <div class="form-group">
                <label>比赛日期 *</label>
                <input
                  v-model="formData.match_date"
                  type="date"
                  required
                >
              </div>
              <div class="form-group">
                <label for="formData-match-time">开球时间 *</label>
                <input id="formData-match-time" v-model="formData.match_time" type="text" inputmode="text" maxlength="5" placeholder="17:35" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" :required="true" :disabled="false" aria-describedby="formData-time-help">
                <small id="formData-time-help" class="cell-meta">中国标准时间 · 24小时制 HH:mm</small>
              </div>

              <div class="form-group">
                <label>场序 *</label>
                <input
                  v-model="formData.field_order"
                  type="text" maxlength="50" placeholder="例如 A1、J1、1"
                  required
                >
              </div>
            </div>

            <label class="supervision-choice"><input type="checkbox" v-model="formData.fourth_required"> 本场需要第四官员</label>
            <label class="supervision-choice"><input type="checkbox" v-model="formData.supervisor_required"> 本场需要裁判监督</label>
            <div class="inline-tip">
              赛程创建后会自动生成对应空报告；所需岗位可稍后补派，未派满时会在列表中持续显示“待选派”提醒。
            </div>

            <VenueFields v-model:venue="formData.venue" v-model:detail="formData.venue_detail" required />
          <div class="form-actions">
              <button type="submit" class="btn-primary" :disabled="submitting || teamLoading || !!teamWarning">
                {{ submitting ? '提交中...' : '添加赛程' }}
              </button>
              <button type="button" class="btn-secondary" @click="resetForm">
                重置
              </button>
            </div>
          </form>
        </div>

        <div class="card">
          <div class="section-header">
            <h3>赛程列表</h3>
            <select v-model="filterType" class="small-select" aria-label="比赛类型筛选">
              <option value="">全部类型</option>
              <CompetitionOptions :season-id="selectedSeason?.id" />
            </select>
          </div>
          <p class="viewing-season">仅开球前可删除比赛，已有报名、选派及报告会一并删除。时间待定的比赛需先补齐开球时间。</p>

          <div class="season-filter">
            <label for="schedule-season">查看赛季</label>
            <select id="schedule-season" :value="viewSeasonId" @change="changeViewedSeason($event.target.value)"
              :disabled="submitting || editSubmitting || !!assignmentSubmittingId">
              <option value="">{{ scheduleWarning ? '回到当前赛季（重新读取）' : currentSeason ? `跟随当前赛季（${seasonLabel(currentSeason)}）` : '当前没有启用赛季，请选择历史赛季' }}</option>
              <option v-for="season in seasons" :key="season.id" :value="String(season.id)">
                {{ seasonLabel(season) }}{{ Number(season.is_active) === 1 ? '（当前启用）' : '（历史）' }}
              </option>
            </select>
            <button type="button" class="btn-secondary btn-inline" @click="loadSchedules"
              :disabled="scheduleLoading || submitting || editSubmitting || !!assignmentSubmittingId">刷新</button>
          </div>
          <p v-if="!scheduleLoading && selectedSeason" class="viewing-season">
            正在查看：{{ seasonLabel(selectedSeason) }}（{{ isViewingCurrentSeason ? '当前赛季' : '历史赛季' }}）
            · 本赛季共 {{ seasonTotal }} 场 · 当前筛选 {{ pagination.total }} 场
          </p>
          <form class="schedule-filters" @submit.prevent="applyListFilters">
            <label>开始日期<input v-model="listFilters.date_from" type="date"></label><label>结束日期<input v-model="listFilters.date_to" type="date"></label>
            <label>岗位来源<select v-model="listFilters.source_type"><option value="">全部</option><option value="system">全系统</option><option value="external">含非系统</option><option value="mixed">混合选派</option></select></label>
            <label>报告状态<select v-model="listFilters.report_status"><option value="">全部</option><option value="main_pending">裁判员未提交</option><option value="supervisor_pending">裁判监督未提交</option><option value="submitted">所需报告已提交</option><option value="returned">已退回</option><option value="proxy">管理员代填</option><option value="proxy_pending">待管理员代填</option><option value="attention">未来7天选派待核查</option></select></label>
            <button class="btn-secondary">查询</button><button class="btn-secondary" type="button" @click="clearListFilters">清空筛选</button>
          </form>
          <ListPagination :pagination="pagination" :loading="scheduleLoading" @page="changeListPage" @size="changeListSize" />

          <div v-if="scheduleLoading" class="status">赛程加载中...</div>
          <div v-else-if="scheduleWarning" class="empty">加载失败，请检查赛季选择或重试。</div>
          <div v-else-if="filteredScheduleList.length === 0" class="empty">
            {{ !selectedSeason ? '当前没有启用赛季，请选择历史赛季查看。' : seasonTotal ? '该赛季没有符合当前筛选条件的赛程。' : '该赛季暂无赛程；历史比赛可通过“查看赛季”选择查看。' }}
          </div>

          <div v-else class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>比赛类型</th>
                  <th>对阵</th>
                  <th>比赛日期 / 开球时间</th>
                  <th>场序</th>
                  <th>当前状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="item in filteredScheduleList" :key="item.id">
                  <tr>
                    <td>{{ item.match_type || '-' }}</td>
                    <td>
                      <div>{{ getDisplayTeams(item) }}</div>
                      <div class="cell-meta" v-for="official in item.officials" :key="official.id">{{ ({main:'裁判员',assistant1:'第一助理裁判员',assistant2:'第二助理裁判员',fourth:'第四官员',supervisor:'裁判监督'})[official.role] }}：{{ official.name_snapshot }} · {{ official.source_type === 'external' ? '非系统裁判' : '系统裁判' }}</div>
                      <div class="cell-meta" v-if="item.season_name || item.season_code">
                        {{ item.season_name || item.season_code }}
                      </div>
                    </td>
                    <td>{{ getDisplayDate(item) }}<div class="cell-meta">{{ displayMatchTime(item.match_time) }}</div><div class="cell-meta">{{ venueText(item) }}</div><div class="cell-meta">有效报名 {{ item.signup_count }}人</div></td>
                    <td>{{ item.field_order || '-' }}</td>
                    <td>
                      <div class="status-stack">
                        <span>{{ getDisplayStatus(item) }}</span>
                        <span v-if="isPendingAssignment(item)" class="status-tag pending">待选派</span>
                        <span v-else class="status-tag success">已选派</span>
                        <span v-if="item.assignment_needs_attention" class="status-tag pending">岗位或资格待核查</span>
                      </div>
                    </td>
                    <td class="action-cell">
                      <button
                        type="button"
                        class="btn-secondary btn-inline"
                        @click="goToScheduleDetail(item.id)"
                      >
                        查看详情
                      </button>
                      <button
                        type="button"
                        class="btn-secondary btn-inline"
                        @click="openQuickEdit(item)"
                        :disabled="isScheduleLocked(item) || (editDialogLoading && editingScheduleId === item.id)"
                        :title="isScheduleLocked(item) ? '报告已开始填写，赛程已锁定' : ''"
                      >
                        {{ editDialogLoading && editingScheduleId === item.id ? '读取中...' : '轻量编辑' }}
                      </button>
                      <button
                        type="button"
                        class="btn-danger btn-inline"
                        @click="handleDeleteSchedule(item)"
                        :disabled="submitting || !canDeleteSchedule(item)"
                        :title="deleteScheduleReason(item)"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card team-card">
        <div class="section-header">
          <h3>当前赛季队伍</h3>
          <span class="team-count">共 {{ teams.length }} 支</span>
        </div>

        <div v-if="teamLoading" class="status">队伍加载中...</div>
        <div v-else-if="scheduleWarning || teamWarning" class="empty">队伍数据暂不可用，请刷新重试。</div>
        <div v-else-if="!currentSeason" class="empty">没有启用赛季，不显示当季队伍；仍可查看历史赛程。</div>
        <div v-else-if="teams.length === 0" class="empty">
          当前赛季暂无队伍，请先前往队伍管理建队。
        </div>
        <div v-else class="team-list">
          <div class="team-item" v-for="team in teams.slice((teamPage-1)*20,teamPage*20)" :key="team.id">
            <div class="team-name">{{ team.team_name }}</div>
            <div class="team-meta">
              <span>{{ team.league_type || '未分类' }}</span>
              <span v-if="team.season_name">· {{ team.season_name }}</span>
              <span v-else-if="team.season_code">· {{ team.season_code }}</span>
            </div>
          </div>
        </div>
        <ListPagination fixed-size :pagination="{page:teamPage,page_size:20,total:teams.length,total_pages:Math.ceil(teams.length/20)}" :loading="teamLoading" @page="teamPage=$event" />
      </div>
    </div>

    <div v-if="editDialogVisible" class="modal-mask" @click.self="closeQuickEdit">
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <h3>轻量编辑赛程</h3>
            <div class="modal-subtitle">与详情页共用 scheduleAPI.update()；用于快速调整赛程主数据。</div>
          </div>
          <button type="button" class="icon-btn" @click="closeQuickEdit">×</button>
        </div>

        <div v-if="editDialogLoading" class="status">正在读取赛程详情...</div>
        <template v-else>
          <div v-if="editError" class="alert error compact-alert">{{ editError }}</div>
          <div v-if="editSuccess" class="alert success compact-alert">{{ editSuccess }}</div>
          <div v-if="isScheduleLocked(editingScheduleRecord)" class="alert error compact-alert">
            报告开始后锁定比赛信息和场上裁判岗位；裁判监督设置在裁判监督报告开始后锁定。裁判监督可兼任任一场上岗位。 如需单独调整裁判监督，请前往“裁判选派”模块。
          </div>

          <form v-draft="{ value: editForm, ready: !editDialogLoading, resetKey: editingScheduleId }" class="form modal-form" @submit.prevent="handleQuickEditSave">
            <div class="form-row form-row-three">
              <div class="form-group">
                <label>比赛类型 *</label>
                <select v-model="editForm.match_type" :disabled="isScheduleLocked(editingScheduleRecord)" required>
                  <option value="">-- 请选择 --</option>
                  <CompetitionOptions :season-id="selectedSeason?.id" />
                </select>
              </div>
              <div class="form-group">
                <label>主队 *</label>
                <select v-model="editForm.team_a_id" :disabled="isScheduleLocked(editingScheduleRecord)" required>
                  <option value="">-- 请选择主队 --</option>
                  <option v-for="team in editFilteredTeams" :key="team.id" :value="String(team.id)">
                    {{ team.team_name }}
                  </option>
                </select>
              </div>
              <div class="form-group">
                <label>客队 *</label>
                <select v-model="editForm.team_b_id" :disabled="isScheduleLocked(editingScheduleRecord)" required>
                  <option value="">-- 请选择客队 --</option>
                  <option v-for="team in editAwayFilteredTeams" :key="`edit-away-${team.id}`" :value="String(team.id)">
                    {{ team.team_name }}
                  </option>
                </select>
              </div>
            </div>

            <div class="form-row form-row-two">
              <div class="form-group">
                <label>比赛日期 *</label>
                <input v-model="editForm.match_date" type="date" :disabled="isScheduleLocked(editingScheduleRecord)" required>
              </div>
              <div class="form-group">
                <label for="editForm-match-time">开球时间</label>
                <input id="editForm-match-time" v-model="editForm.match_time" type="text" inputmode="text" maxlength="5" placeholder="17:35" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" :required="Boolean(editingScheduleRecord?.match_time)" :disabled="isScheduleLocked(editingScheduleRecord)" aria-describedby="editForm-time-help">
                <small id="editForm-time-help" class="cell-meta">中国标准时间 · 24小时制 HH:mm；旧比赛尚未填写时可保留待定</small>
              </div>
              <div class="form-group">
                <label>场序 *</label>
                <input v-model="editForm.field_order" type="text" maxlength="50" placeholder="例如 A1、J1、1" :disabled="isScheduleLocked(editingScheduleRecord)" required>
              </div>
            </div>

            <VenueFields v-model:venue="editForm.venue" v-model:detail="editForm.venue_detail" :required="Boolean(editingScheduleRecord?.venue)" :disabled="isScheduleLocked(editingScheduleRecord)" />
            <p>裁判组请在“裁判选派”模块调整。</p>

            <div class="inline-tip">
              报告开始后锁定比赛信息和场上裁判岗位；裁判监督设置在裁判监督报告开始后锁定。裁判监督可兼任任一场上岗位。 如需单独调整裁判监督，请前往“裁判选派”模块。
            </div>

            <div class="form-actions">
              <button type="submit" class="btn-primary" :disabled="editSubmitting || isScheduleLocked(editingScheduleRecord)">
                {{ editSubmitting ? '保存中...' : '保存轻量编辑' }}
              </button>
              <button type="button" class="btn-secondary" @click="resetQuickEdit" :disabled="editSubmitting">
                重置为当前值
              </button>
              <button type="button" class="btn-secondary" @click="goToScheduleDetail(editingScheduleId)" :disabled="!editingScheduleId || editSubmitting">
                前往详情页完整编辑
              </button>
              <button type="button" class="btn-secondary" @click="closeQuickEdit" :disabled="editSubmitting">
                关闭
              </button>
            </div>
          </form>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import CompetitionOptions from '../components/CompetitionOptions.vue'
import VenueFields from '../components/VenueFields.vue'
import AdminMatchSignups from '../components/AdminMatchSignups.vue'
import { venueText } from '../utils/matchSignup.js'
import { displayMatchTime, matchTimeError } from '../utils/matchTime.js'
import { scheduleAPI, teamAPI } from '../api/index.js'
import SearchableRefereeSelect from '../components/SearchableRefereeSelect.vue'
import ListPagination from '../components/ListPagination.vue'
import {downloadBlob,exportError} from '../utils/download'

const ASSIGNMENT_ROLE_OPTIONS = Object.freeze([
  { field: 'main_referee_id', nameField: 'main_referee_name', label: '裁判员' },
  { field: 'assistant1_id', nameField: 'assistant1_name', label: '第一助理裁判员' },
  { field: 'assistant2_id', nameField: 'assistant2_name', label: '第二助理裁判员' },
  { field: 'fourth_official_id', nameField: 'fourth_official_name', label: '第四官员' },
  { field: 'supervisor_id', nameField: 'supervisor_name', label: '裁判监督' }
])

function createEmptyAssignmentForm() {
  return {
    main_referee_id: '',
    assistant1_id: '',
    assistant2_id: '',
    fourth_official_id: '',
    supervisor_required: true, supervisor_id: ''
  }
}

function createEmptyScheduleEditForm() {
  return {
    match_type: '',
    team_a_id: '',
    team_b_id: '',
    match_date: '',
    match_time: '', venue:'',venue_detail:'',
    fourth_required: true, supervisor_required: false, field_order: '',
    main_referee_id: '',
    assistant1_id: '',
    assistant2_id: '',
    fourth_official_id: '',
    supervisor_id: ''
  }
}

export default {
  name: 'AdminSchedule',
  components: { CompetitionOptions, VenueFields, AdminMatchSignups, SearchableRefereeSelect, ListPagination },
  data() {
    return {
      loading: false,
      deleteClockTick: 0, deleteClockTimer: null,
      exporting:false,seasonTotal:0,pagination:{page:1,page_size:20,total:0,total_pages:0},listFilters:{date_from:'',date_to:'',source_type:'',report_status:''},
      submitting: false,
      teamLoading: false,
      scheduleLoading: false,
      assignmentSubmittingId: null,

      pageError: '',
      pageSuccess: '',
      teamWarning: '',
      scheduleWarning: '',

      currentSeason: null,
      selectedSeason: null,
      seasons: [],
      listRequestId: 0,
      teamRequestId: 0,
      editRequestId: 0,
      teams: [],teamPage:1,
      editTeams: [],
      schedules: [],
      activeAssignmentScheduleId: null,
      assignmentForm: createEmptyAssignmentForm(),
      assignmentRoleOptions: ASSIGNMENT_ROLE_OPTIONS,

      editDialogVisible: false,
      editDialogLoading: false,
      editSubmitting: false,
      editingScheduleId: null,
      editingScheduleRecord: null,
      editForm: createEmptyScheduleEditForm(),
      editError: '',
      editSuccess: '',

      formData: {
        match_type: '',
        team_a_id: '',
        team_b_id: '',
        match_date: '',
        match_time: '', venue:'',venue_detail:'',
        fourth_required: true, supervisor_required: false, field_order: ''
      }
    }
  },
  computed: {
    viewSeasonId() {
      return this.$route.query.season_id ?? ''
    },
    filterType: {
      get() { return this.$route.query.match_type || '' },
      set(value) {
        this.$router.replace({ query: { ...this.$route.query, match_type: value || undefined, page:undefined } })
      }
    },
    isViewingCurrentSeason() {
      return !!this.selectedSeason && Number(this.selectedSeason.id) === Number(this.currentSeason?.id)
    },
    canCreateSchedule() {
      return this.isViewingCurrentSeason && !this.scheduleLoading && !this.scheduleWarning
    },
    filteredTeams() {
      return this.filterTeamsByMatchType(this.formData.match_type)
    },
    awayFilteredTeams() {
      return this.filteredTeams.filter(team => String(team.id) !== String(this.formData.team_a_id))
    },
    filteredScheduleList() {
      if (!this.filterType) return this.schedules
      return this.schedules.filter(item => item.match_type === this.filterType)
    },
    editFilteredTeams() {
      return this.editTeams.filter(team => !this.editForm.match_type || team.league_type === this.editForm.match_type)
    },
    editAwayFilteredTeams() {
      return this.editFilteredTeams.filter(team => String(team.id) !== String(this.editForm.team_a_id))
    }
  },
  mounted() {
    this.deleteClockTimer = setInterval(() => { this.deleteClockTick++ }, 1000)
    this.initPage()
  },
  watch: {
    '$route.query'() { this.loadSchedules() }
  },
  beforeUnmount() {
    clearInterval(this.deleteClockTimer)
    this.listRequestId++
    this.teamRequestId++
    this.editRequestId++
  },
  methods: {
    venueText(value) { return venueText(value) },
    displayMatchTime(value) { return displayMatchTime(value) },
    async exportSchedules() {if(this.scheduleLoading||this.exporting)return;this.exporting=true;try{downloadBlob(await scheduleAPI.exportFiltered(this.$route.query),`赛程选派-${this.selectedSeason?.id||'当前'}.csv`)}catch(e){this.pageError=await exportError(e)}finally{this.exporting=false}},
    applyListFilters(){this.$router.replace({query:{...this.$route.query,...Object.fromEntries(Object.entries(this.listFilters).map(([k,v])=>[k,v||undefined])),page:undefined}})},
    clearListFilters(){this.$router.replace({query:{season_id:this.$route.query.season_id}})},
    changeListPage(page){this.$router.replace({query:{...this.$route.query,page:String(page)}})},
    changeListSize(size){this.$router.replace({query:{...this.$route.query,page:undefined,page_size:String(size)}})},
    seasonLabel(season) {
      return season?.season_name || season?.season_code || `赛季 #${season?.id}`
    },
    changeViewedSeason(seasonId) {
      this.$router.push({ query: { ...this.$route.query, season_id: seasonId || undefined,page:undefined } })
    },
    async initPage() {
      this.loading = true
      this.pageError = ''

      await this.loadSchedules()

      this.loading = false
    },

    filterTeamsByMatchType(matchType) {
      if (!matchType) return this.teams
      return this.teams.filter(team => {
        if (!team.league_type) return true
        return team.league_type === matchType
      })
    },

    async loadTeams() {
      const requestId = ++this.teamRequestId
      this.teamLoading = true
      this.teamWarning = ''
      this.teams = []

      try {
        if (!this.currentSeason) return
        const res = await teamAPI.getSeasonTeams(this.currentSeason.id)
        if (requestId !== this.teamRequestId) return
        this.teams = res?.data?.teams || []
        this.teamPage=Math.min(this.teamPage,Math.max(1,Math.ceil(this.teams.length/20)))
      } catch (error) {
        if (requestId !== this.teamRequestId) return
        this.teams = []

        const message =
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          ''

        this.teamWarning = `队伍数据加载失败：${message || '未知错误'}`
      } finally {
        if (requestId === this.teamRequestId) this.teamLoading = false
      }
    },

    async loadSchedules() {
      if (this.$confirmLeave?.(this.$el) === false) return
      for(const key of Object.keys(this.listFilters))this.listFilters[key]=this.$route.query[key]||''
      const requestId = ++this.listRequestId
      this.scheduleLoading = true
      this.scheduleWarning = ''
      this.schedules = []
      this.selectedSeason = null
      this.closeAssignmentPanel()
      this.closeQuickEdit()
      this.pageError = ''

      try {
        const res = await scheduleAPI.getAll({ ...this.$route.query })
        if (requestId !== this.listRequestId) return
        const data = res?.data
        this.selectedSeason = res.meta?.selected_season || null
        if (Number(this.currentSeason?.id) !== Number(res.meta?.current_season?.id)) this.resetForm()
        this.currentSeason = res.meta?.current_season || null
        this.seasons = res.meta?.seasons || []
        this.pagination=res.meta?.pagination||{page:1,page_size:20,total:res.meta?.total||0,total_pages:1}
        this.seasonTotal=res.meta?.season_total??res.meta?.total??0
        this.schedules = scheduleAPI.normalizeListResponse
          ? scheduleAPI.normalizeListResponse(data)
          : this.normalizeScheduleListFallback(data)
        this.schedules = this.schedules.map(item => ({ ...item, deleteReceivedAt: performance.now() }))
        this.loadTeams()
      } catch (error) {
        if (requestId !== this.listRequestId) return
        this.schedules = []

        const message =
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          '未知错误'

        this.scheduleWarning = `赛程数据加载失败：${message}`
      } finally {
        if (requestId === this.listRequestId) this.scheduleLoading = false
      }
    },

    normalizeScheduleListFallback(data) {
      const rawList = Array.isArray(data)
        ? data
        : Array.isArray(data?.schedules)
          ? data.schedules
          : Array.isArray(data?.data)
            ? data.data
            : []

      return rawList.map(item => (scheduleAPI.normalizeRecord ? scheduleAPI.normalizeRecord(item) : item))
    },

    buildAssignmentFormFromItem(item = {}) {
      return {
        schedule_revision:item.schedule_revision,
        main_referee_id: item.main_referee_id_selection || (item.main_referee_id ? String(item.main_referee_id) : ''),
        assistant1_id: item.assistant1_id_selection || (item.assistant1_id ? String(item.assistant1_id) : ''),
        assistant2_id: item.assistant2_id_selection || (item.assistant2_id ? String(item.assistant2_id) : ''),
        fourth_official_id: item.fourth_official_id_selection || (item.fourth_official_id ? String(item.fourth_official_id) : ''),
        fourth_required: item.fourth_required, supervisor_required: item.supervisor_required,
        supervisor_id: item.supervisor_id_selection || (item.supervisor_id ? String(item.supervisor_id) : '')
      }
    },

    buildScheduleEditFormFromItem(item = {}) {
      return {
        match_type: item.match_type || '',
        team_a_id: item.team_a_id ? String(item.team_a_id) : '',
        team_b_id: item.team_b_id ? String(item.team_b_id) : '',
        match_date: item.match_date ? String(item.match_date).slice(0, 10) : '',
        match_time: item.match_time || '', venue:item.venue||'',venue_detail:item.venue_detail||'',schedule_revision:item.schedule_revision,
        field_order: item.field_order || '',
        main_referee_id: item.main_referee_id_selection || (item.main_referee_id ? String(item.main_referee_id) : ''),
        assistant1_id: item.assistant1_id_selection || (item.assistant1_id ? String(item.assistant1_id) : ''),
        assistant2_id: item.assistant2_id_selection || (item.assistant2_id ? String(item.assistant2_id) : ''),
        fourth_official_id: item.fourth_official_id_selection || (item.fourth_official_id ? String(item.fourth_official_id) : ''),
        supervisor_required: item.supervisor_required,
        supervisor_id: item.supervisor_id_selection || (item.supervisor_id ? String(item.supervisor_id) : '')
      }
    },

    async toggleAssignmentPanel(item) {
      if (this.activeAssignmentScheduleId && this.$confirmLeave?.(this.$el.querySelector('.assignment-panel') || this.$el) === false) return
      if (item.supervisor_locked) {
        this.pageError = '裁判监督报告已开始，裁判配置均已锁定。'
        return
      }

      if (this.activeAssignmentScheduleId === item.id) {
        this.closeAssignmentPanel()
        return
      }

      this.pageSuccess = ''
      this.assignmentForm = this.buildAssignmentFormFromItem(item)
      this.activeAssignmentScheduleId = item.id
      this.pageError = ''
    },

    closeAssignmentPanel(force = false) {
      if (!force && this.$confirmLeave?.(this.$el.querySelector('.assignment-panel') || this.$el) === false) return
      this.activeAssignmentScheduleId = null
      this.assignmentForm = createEmptyAssignmentForm()
    },

    resetAssignmentForm(item) {
      if (this.$confirmLeave?.(this.$el.querySelector('.assignment-panel') || this.$el) === false) return
      this.assignmentForm = this.buildAssignmentFormFromItem(item)
      this.pageError = ''
    },

    selectedOtherRefereeIds(form, currentField) {
      if (currentField === 'supervisor_id') return []
      return this.assignmentRoleOptions
        .filter(role => role.field !== currentField && role.field !== 'supervisor_id')
        .filter(role => !(['main_referee_id','fourth_official_id'].includes(currentField) && ['main_referee_id','fourth_official_id'].includes(role.field)))
        .map(role => form?.[role.field])
        .filter(Boolean)
    },

    currentRoleOption(record, role) {
      if (!record || !role || !(record[role.field] || record[role.field + '_selection'])) return null
      return {
        id: record[role.field + '_selection'] || record[role.field],
        source_type: String(record[role.field + '_selection'] || '').startsWith('external:') ? 'external' : 'system',
        name: record[role.nameField] || `裁判 #${record[role.field]}`
      }
    },

    extractScheduleDetailPayload(payload) {
      if (payload && typeof payload === 'object' && payload.data && !Array.isArray(payload.data)) {
        return payload.data
      }
      return payload
    },

    replaceScheduleItem(updatedItem) {
      if (Number(updatedItem?.season_id) !== Number(this.selectedSeason?.id)) return
      const normalized = scheduleAPI.normalizeRecord
        ? scheduleAPI.normalizeRecord(updatedItem)
        : updatedItem

      const index = this.schedules.findIndex(item => String(item.id) === String(normalized.id))
      if (index === -1) {
        this.schedules = [normalized, ...this.schedules]
        return
      }

      const next = [...this.schedules]
      next.splice(index, 1, normalized)
      this.schedules = next
    },

    async handleSaveAssignment(item) {
      if (!item?.id) return
      if (item.supervisor_locked) {
        this.pageError = '裁判监督报告已开始，裁判配置均已锁定。'
        return
      }

      this.pageSuccess = ''
      this.pageError = ''
      this.assignmentSubmittingId = item.id

      try {
        const response = await scheduleAPI.assignReferees(item.id, this.assignmentForm)
        const payload = this.extractScheduleDetailPayload(response?.data ?? response)
        this.replaceScheduleItem(payload)
        this.pageSuccess = '裁判选派已更新。'
        this.closeAssignmentPanel(true)
      } catch (error) {
        const message =
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          '裁判选派失败'

        this.pageError = `裁判选派失败：${message}`
      } finally {
        this.assignmentSubmittingId = null
      }
    },

    validateScheduleForm(form, { checkCurrentSeason = false } = {}) {
      if (checkCurrentSeason && !this.currentSeason) {
        return '请先启用赛季'
      }

      if (!form.match_type || !form.team_a_id || !form.team_b_id) {
        return '请完整填写比赛类型、主队、客队'
      }

      if (!form.match_date) {
        return '请填写比赛日期'
      }

      const timeError = matchTimeError(form.match_time, checkCurrentSeason || Boolean(this.editingScheduleRecord?.match_time))
      if (timeError) return timeError

      const fieldOrder = String(form.field_order ?? '').trim()
      if (!fieldOrder || [...fieldOrder].length > 50 || /[\u0000-\u001f\u007f]/u.test(fieldOrder)) {
        return '场序须为1—50个字符，可填写 A1、J1 等'
      }

      if (String(form.team_a_id) === String(form.team_b_id)) {
        return '主队和客队不能相同'
      }

      const selectedRoles = this.assignmentRoleOptions.filter(r => r.field !== 'supervisor_id')
        .map(role => ({ role, value: form[role.field] }))
        .filter(item => item.value !== null && item.value !== undefined && item.value !== '')

      const seen = new Map()
      for (const item of selectedRoles) {
        const value = String(item.value)
        if (seen.has(value)) {
          if(seen.get(value).field==='main_referee_id'&&item.role.field==='fourth_official_id')continue
          return `场上裁判岗位不能重复指派同一人：${seen.get(value).label} 与 ${item.role.label} 冲突`
        }
        seen.set(value, item.role)
      }

      return ''
    },

    buildScheduleUpdatePayload(form) {
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

    async handleAddSchedule() {
      if (!this.canCreateSchedule) {
        this.pageError = '请先查看当前启用赛季，再新建赛程。'
        return
      }
      const validationError = this.validateScheduleForm(this.formData, { checkCurrentSeason: true })
      if (validationError) {
        this.pageError = validationError
        return
      }

      this.pageSuccess = ''
      this.pageError = ''
      this.submitting = true

      try {
        await scheduleAPI.create({
          match_type: this.formData.match_type,
          team_a_id: this.formData.team_a_id,
          team_b_id: this.formData.team_b_id,
          match_date: this.formData.match_date,
          match_time: this.formData.match_time, venue:this.formData.venue,venue_detail:this.formData.venue_detail,
          fourth_required: this.formData.fourth_required, supervisor_required: this.formData.supervisor_required, field_order: this.formData.field_order
        })

        this.$markDraftSaved?.(this.$el.querySelector('form'))
        this.resetForm()
        this.pageSuccess = '赛程已创建，并自动生成了空报告。'
        await this.loadSchedules()
      } catch (error) {
        const message =
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          '添加赛程失败'

        this.pageError = `添加赛程失败：${message}`
      } finally {
        this.submitting = false
      }
    },

    async openQuickEdit(item) {
      if (!item?.id) return
      if (this.isScheduleLocked(item)) {
        this.pageError = '本场报告已开始填写，赛程主数据与裁判配置均已锁定。'
        return
      }

      this.editDialogVisible = true
      this.editDialogLoading = true
      this.editSubmitting = false
      this.editingScheduleId = item.id
      this.editError = ''
      this.editSuccess = ''
      this.pageError = ''
      this.pageSuccess = ''
      const requestId = ++this.editRequestId
      this.editTeams = []

      try {
        const [response, teamResponse] = await Promise.all([
          scheduleAPI.getDetail(item.id), teamAPI.getSeasonTeams(item.season_id)
        ])
        if (requestId !== this.editRequestId) return
        this.editTeams = teamResponse?.data?.teams || []
        const detail = this.extractScheduleDetailPayload(response?.data ?? response)
          this.editingScheduleRecord = detail || item
          for (const side of ['a','b']) {
            const id = this.editingScheduleRecord['team_'+side+'_id']
            if (id && !this.editTeams.some(team => team.id === id)) this.editTeams.push({ id, team_name: this.editingScheduleRecord['team_'+side+'_name_snapshot'] || '原赛程球队 #'+id, league_type: this.editingScheduleRecord.match_type })
          }
          this.editForm = this.buildScheduleEditFormFromItem(this.editingScheduleRecord)
      } catch (error) {
        if (requestId !== this.editRequestId) return
        this.editingScheduleRecord = item
        this.editForm = this.buildScheduleEditFormFromItem(item)
        const message =
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          '读取赛程详情失败'
        this.editError = `读取赛程详情失败：${message}`
      } finally {
        if (requestId === this.editRequestId) this.editDialogLoading = false
      }
    },

    closeQuickEdit() {
      if (this.$confirmLeave?.(this.$el.querySelector('.modal-overlay') || this.$el) === false) return
      if (this.editSubmitting) return
      this.editRequestId++
      this.editDialogVisible = false
      this.editDialogLoading = false
      this.editingScheduleId = null
      this.editingScheduleRecord = null
      this.editForm = createEmptyScheduleEditForm()
      this.editError = ''
      this.editSuccess = ''
    },

    resetQuickEdit() {
      if (this.$confirmLeave?.(this.$el.querySelector('.modal-overlay') || this.$el) === false) return
      if (!this.editingScheduleRecord) {
        this.editForm = createEmptyScheduleEditForm()
        return
      }
      this.editForm = this.buildScheduleEditFormFromItem(this.editingScheduleRecord)
      this.editError = ''
      this.editSuccess = ''
    },

    isQuickEditRoleLocked(field) {
      return this.assignmentRoleOptions.some(role => role.field === field) && this.isScheduleLocked(this.editingScheduleRecord)
    },

    getQuickEditRoleLockText(field) {
      return this.isQuickEditRoleLocked(field)
        ? '报告开始后锁定比赛信息和场上裁判岗位；裁判监督设置在裁判监督报告开始后锁定。裁判监督可兼任任一场上岗位。 如需单独调整裁判监督，请前往“裁判选派”模块。'
        : ''
    },

    async handleQuickEditSave() {
      if (!this.editingScheduleId) return
      if (this.isScheduleLocked(this.editingScheduleRecord)) {
        this.editError = '本场报告已开始填写，赛程主数据与裁判配置均已锁定。'
        return
      }

      const validationError = this.validateScheduleForm(this.editForm)
      if (validationError) {
        this.editError = validationError
        this.editSuccess = ''
        return
      }

      this.editSubmitting = true
      this.editError = ''
      this.editSuccess = ''

      try {
        const payload = this.buildScheduleUpdatePayload(this.editForm)
        const response = await scheduleAPI.update(this.editingScheduleId, payload)
        const detail = this.extractScheduleDetailPayload(response?.data ?? response)
        this.editingScheduleRecord = detail
        this.editForm = this.buildScheduleEditFormFromItem(detail)
        this.replaceScheduleItem(detail)
        this.$markDraftSaved?.(this.$el.querySelector('.modal-overlay'))
        await this.loadSchedules()
        this.editSuccess = '轻量编辑已保存，赛程列表已同步刷新。'
        this.pageSuccess = '赛程主数据已更新。'
      } catch (error) {
        const message =
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          '赛程更新失败'

        this.editError = `赛程更新失败：${message}`
      } finally {
        this.editSubmitting = false
      }
    },

    resetForm(event) {
      if (event?.target && this.$confirmLeave?.(event.target.closest('form')) === false) return
      this.formData = {
        match_type: '',
        team_a_id: '',
        team_b_id: '',
        match_date: '',
        match_time: '', venue:'',venue_detail:'',
        fourth_required: true, supervisor_required: false, field_order: ''
      }
      this.pageError = ''
    },

    getDisplayTeams(item) {
      return (
        item.display_teams ||
        `${item.team_a_name_snapshot || item.team_a_name || '主队待定'} vs ${item.team_b_name_snapshot || item.team_b_name || '客队待定'}`
      )
    },

    getDisplayDate(item) {
      if (!item?.match_date) return '-'
      return String(item.match_date).slice(0, 10)
    },

    isPendingAssignment(item) {
      if (typeof item?.is_assignment_complete === 'boolean') {
        return !item.is_assignment_complete
      }
      return Array.isArray(item?.pending_assignment_roles) && item.pending_assignment_roles.length > 0
    },

    getPendingAssignmentText(item) {
      const pendingRoles = Array.isArray(item?.pending_assignment_roles)
        ? item.pending_assignment_roles
        : Array.isArray(item?.assignment?.pending_roles)
          ? item.assignment.pending_roles
          : []

      return pendingRoles.length > 0 ? pendingRoles.join('、') : '无'
    },

    isScheduleLocked(item) {
      const report = item?.report || {}
      return Boolean(
        item?.main_report_started_at ||
        item?.supervisor_review_started_at ||
        item?.main_report_submitted_at ||
        item?.supervisor_review_submitted_at ||
        report.main_report_started_at ||
        report.supervisor_review_started_at ||
        report.main_report_submitted_at ||
        report.supervisor_review_submitted_at
      )
    },

    getDisplayStatus(item) {
      if (item?.report_exists) {
        if (item.report_main_status === 'returned' || item.report_supervisor_status === 'returned') return '报告已退回，待重填'
        if (item.report_main_status === 'submitted' && (!item.supervisor_required || item.report_supervisor_status === 'submitted')) {
          return '所需报告已提交'
        }
        if (this.isScheduleLocked(item)) {
          return '报告填写中'
        }
        if (this.isPendingAssignment(item)) {
          return `待选派（缺 ${this.getPendingAssignmentText(item)}）`
        }
        return '已生成空报告'
      }

      if (this.isPendingAssignment(item)) {
        return `待选派（缺 ${this.getPendingAssignmentText(item)}）`
      }

      return '已创建'
    },

    goBack() {
      this.$router.push('/admin-dashboard')
    },

    goToScheduleDetail(scheduleId) {
      if (!scheduleId) return
      this.$router.push({ path: `/admin-schedule/${scheduleId}`, query: {
        ...this.$route.query, season_id: String(this.selectedSeason.id)
      } })
    },

    deleteScheduleReason(item) {
      void this.deleteClockTick
      const state = item?.delete_state
      if (!state?.can_delete) return state?.reason_message || '请刷新赛程后重试'
      const checked = Date.parse(state.checked_at), kickoff = Date.parse(state.kickoff_at)
      if (!Number.isFinite(checked) || !Number.isFinite(kickoff)) return '请先补齐开球时间，再判断是否可以删除'
      const elapsed = performance.now() - (item.deleteReceivedAt ?? performance.now())
      return checked + elapsed >= kickoff ? '已到开球时间，不能删除比赛' : ''
    },

    canDeleteSchedule(item) { return !this.deleteScheduleReason(item) },

    async handleDeleteSchedule(item) {
      const blocked = this.deleteScheduleReason(item)
      if (blocked) { this.pageError = blocked; return }
      const confirmMsg = `确定删除这场尚未开球的比赛吗？\n\n比赛：${this.getDisplayTeams(item)}\n日期：${this.getDisplayDate(item)} · ${this.displayMatchTime(item.match_time)}（中国标准时间）\n场序：${item.field_order || '-'}\n\n该场报名及报名历史、选派、报告与附件、比分、统计和红黄牌记录将一并删除。裁判账号和球队名单不受影响。\n删除后不可恢复。`
      if (!window.confirm(confirmMsg)) return
      const expired = this.deleteScheduleReason(item)
      if (expired) { this.pageError = expired; return }
      this.submitting = true
      this.pageError = ''
      this.pageSuccess = ''
      try {
        const result = await scheduleAPI.delete(item.id, item.schedule_revision)
        this.pageSuccess = result?.data?.attachment_cleanup_pending ? '比赛及关联记录已删除，部分报告附件待管理员清理。' : '比赛及该场报名、选派、报告已删除'
        await this.loadSchedules()
      } catch (error) {
        this.pageError = error?.response?.data?.message || '删除赛程失败，请稍后重试'
      } finally { this.submitting = false }
    },

    goToSeasonManagement() {
      this.$router.push('/admin-seasons')
    },

    goToTeamManagement() {
      this.$router.push('/admin-teams')
    }
  }
}
</script>

<style scoped>
@layer legacy {

.schedule-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:16px 0}.schedule-filters label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#475569}.schedule-filters input,.schedule-filters select{max-width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;background:white;color:#1e293b}
.schedule-container {
  min-height: 100vh;
  background: #f5f7fb;
}

.header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  padding: 20px 28px;
  background: #1f3b73;
  color: #fff;
}

.title {
  font-size: 24px;
  font-weight: 700;
}

.subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.82);
}

.header-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.page-body {
  max-width: 1240px;
  margin: 0 auto;
  padding: 24px;
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
  margin-bottom: 12px;
}

.info-card,
.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
}

.info-card {
  padding: 18px 20px;
  margin-bottom: 20px;
}

.info-title {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 8px;
}

.info-value {
  font-size: 20px;
  font-weight: 700;
  color: #1f3b73;
}

.info-desc {
  color: #4b5563;
}

.info-subline {
  margin-top: 8px;
  font-size: 13px;
}

.workflow-card {
  margin-bottom: 20px;
}

.workflow-header {
  margin-bottom: 10px;
}

.workflow-desc {
  color: #4b5563;
  line-height: 1.7;
}

.workflow-list {
  margin: 0;
  padding-left: 20px;
  color: #4b5563;
  line-height: 1.9;
}

.empty-state {
  border: 1px dashed #d6dbe5;
  box-shadow: none;
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 20px;
  margin-bottom: 20px;
}

.card {
  padding: 22px;
}

.card h3 {
  margin: 0 0 16px;
  color: #1f2937;
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

.inline-tip {
  background: #eef2ff;
  color: #4338ca;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
}

.form-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-primary,
.btn-secondary,
.icon-btn {
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: #1f3b73;
  color: #fff;
  padding: 10px 16px;
}

.btn-primary:hover:not(:disabled) {
  background: #17305d;
}

.btn-secondary {
  background: #e5e7eb;
  color: #111827;
  padding: 10px 16px;
}

.btn-secondary:hover:not(:disabled) {
  background: #d1d5db;
}

.btn-danger {
  background: #ef4444;
  color: #ffffff;
  padding: 10px 16px;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-primary:disabled,
.btn-secondary:disabled,
.icon-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.small-select {
  border: 1px solid #d1d5db;
  border-radius: 10px;
  padding: 8px 12px;
  background: #fff;
}

.season-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.season-filter select { flex: 1; min-width: 180px; max-width: 100%; }
.season-filter button { width: auto; flex: 0 0 auto; margin: 0; }
.section-header h3 { flex-shrink: 0; }
.section-header .small-select { width: 240px; max-width: 65%; margin: 0; }
.viewing-season { color: #49566b; font-size: 14px; margin-bottom: 16px; }

.status,
.empty {
  padding: 18px 0;
  color: #6b7280;
}

.table-wrapper {
  overflow-x: auto;
}

.table-wrapper table {
  width: 100%;
  border-collapse: collapse;
}

.table-wrapper th,
.table-wrapper td {
  padding: 12px 10px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: top;
  font-size: 14px;
}

.table-wrapper thead th {
  color: #4b5563;
  font-weight: 600;
  background: #f9fafb;
}

.cell-meta {
  margin-top: 4px;
  color: #6b7280;
  font-size: 12px;
}

.status-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.status-tag.pending {
  background: #ffedd5;
  color: #c2410c;
}

.status-tag.success {
  background: #dcfce7;
  color: #15803d;
}

.action-cell {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-inline {
  padding: 8px 12px;
  font-size: 13px;
}

.assignment-row td {
  background: #fafbff;
}

.assignment-panel {
  border: 1px solid #dbeafe;
  border-radius: 12px;
  padding: 16px;
  background: #fff;
}

.assignment-panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.assignment-title {
  font-weight: 700;
  color: #1f2937;
}

.assignment-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: #6b7280;
}

.assignment-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.assignment-tip {
  margin-bottom: 14px;
}

.team-card {
  margin-top: 20px;
}

.team-count {
  color: #6b7280;
  font-size: 13px;
}

.team-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.team-item {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
  background: #fafafa;
}

.team-name {
  font-weight: 700;
  color: #1f2937;
}

.team-meta {
  margin-top: 6px;
  color: #6b7280;
  font-size: 13px;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 50;
}

.modal-card {
  width: min(1040px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
  padding: 22px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.modal-header h3 {
  margin: 0;
}

.modal-subtitle {
  margin-top: 6px;
  color: #6b7280;
  font-size: 13px;
}

.icon-btn {
  background: #eef2ff;
  color: #3730a3;
  width: 36px;
  height: 36px;
  font-size: 20px;
}

.modal-form {
  gap: 18px;
}

.divider-title {
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
  padding-top: 4px;
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

@media (max-width: 1080px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .form-row-three,
  .assignment-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 720px) {
  .header-bar,
  .section-header,
  .assignment-panel-header,
  .modal-header {
    flex-direction: column;
    align-items: stretch;
  }

  .page-body {
    padding: 16px;
  }

  .form-row-three,
  .form-row-two,
  .assignment-grid {
    grid-template-columns: 1fr;
  }

  .action-cell {
    flex-direction: column;
  }

  .modal-mask {
    padding: 12px;
  }
}

}
</style>
