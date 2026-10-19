<template>
  <div class="stats-container">
    <div class="header-bar">
      <div class="referee-header-left">
        <img class="brand-logo-sm" :src="logoUrl" alt="徽标" />
        <div>
          <div class="referee-header-title">我的执法统计</div>
          <div class="referee-header-subtitle">校园足球裁判执裁管理系统</div>
        </div>
      </div>
      <button class="btn-header" @click="goBack">返回</button>
    </div>

    <PageState v-if="loading" kind="loading" title="正在加载历史执法记录…" />
    <PageState v-else-if="error" kind="error" :message="error" @retry="loadStats" />
    <div v-else class="content">
      <div class="summary-grid">
        <div class="summary-card primary-card">
          <div class="summary-label">已形成记录场次</div>
          <div class="summary-value">{{ summary.total }}</div>
          <div class="summary-hint">仅统计裁判员区或裁判监督区已开始填写的比赛</div>
        </div>
        <div
          v-for="item in roleSummary"
          :key="item.key"
          class="summary-card"
        >
          <div class="summary-label">{{ item.label }}</div>
          <div class="summary-value">{{ item.count }}</div>
        </div>
      </div>

      <div class="list-card trend-wrapper">
        <div class="list-head">
          <div>
            <h2>我的执法变化</h2>
            <p class="list-desc">按比赛日期排序，仅统计已提交报告的执法数据。</p>
          </div>
          <button class="text-btn" @click="loadTrends" :disabled="trendLoading">
            {{ trendLoading ? '刷新中...' : '刷新图表' }}
          </button>
        </div>

        <div v-if="trendLoading" class="status compact-status">正在加载执法变化数据...</div>
        <div v-else-if="trendError" class="status error compact-status">{{ trendError }}</div>
        <div v-else-if="trendSorted.length === 0" class="empty-state compact-status">暂无可用统计数据</div>

        <div v-else class="trend-grid">
          <button
            v-for="metric in metricDefs"
            :key="metric.key"
            type="button"
            class="trend-card"
            @click="openMetric(metric.key)"
          >
            <div class="trend-title">{{ metric.label }}</div>
            <div class="trend-chart">
              <svg
                v-if="smallChart(metric.key).hasData"
                class="trend-svg"
                :viewBox="`0 0 ${smallChart(metric.key).width} ${smallChart(metric.key).height}`"
                preserveAspectRatio="none"
              >
                <path :d="smallChart(metric.key).areaPath" class="trend-area" />
                <path :d="smallChart(metric.key).linePath" class="trend-line" />
              </svg>
              <div v-else class="trend-empty">暂无数据</div>
            </div>
          </button>
        </div>
      </div>

      <div class="list-card">
        <div class="list-head">
          <div>
            <h2>历史执法列表</h2>
            <p class="list-desc">数据源已切换为赛程选派结果，仅展示已有报告数据的比赛。</p>
          </div>
          <button class="text-btn" @click="loadStats" :disabled="loading">
            {{ loading ? '刷新中...' : '刷新列表' }}
          </button>
        </div>

        <div v-if="records.length === 0" class="empty-state">暂无已形成记录的执法比赛</div>

        <div v-else class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>身份</th>
                <th>场序</th>
                <th>对阵</th>
                <th>比赛日期</th>
                <th>比分</th>
                <th>裁判员区进度</th>
                <th>裁判监督区进度</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in records" :key="item.id">
                <td>{{ roleLabel(item) }}</td>
                <td>{{ item.field_order ?? '-' }}</td>
                <td>{{ displayTeams(item) }}</td>
                <td>{{ formatDate(item.match_date) }} · {{ displayMatchTime(item.match_time, item.match_end_time) }}</td>
                <td><strong>{{ item.score_display }}</strong></td>
                <td>{{ formatProgress(item.report?.main_report_status, item.report?.main_report_started_at, item.report?.main_report_submitted_at) }}</td>
                <td>{{ item.supervisor_required === false ? '无需裁判监督报告' : formatProgress(item.report?.supervisor_review_status, item.report?.supervisor_review_started_at, item.report?.supervisor_review_submitted_at) }}</td>
                <td>
                  <button class="small" @click="goToReport(item)">查看报告</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mobile-list">
          <div v-for="item in records" :key="`mobile-${item.id}`" class="mobile-card">
            <div class="mobile-head">
              <span class="mobile-role">{{ roleLabel(item) }}</span>
              <span class="mobile-score">{{ item.score_display }}</span>
            </div>
            <div class="mobile-title">{{ displayTeams(item) }}</div>
            <div class="mobile-meta">场序：{{ item.field_order ?? '-' }}</div>
            <div class="mobile-meta">日期：{{ formatDate(item.match_date) }} · {{ displayMatchTime(item.match_time, item.match_end_time) }}</div>
            <div class="mobile-meta">裁判员区：{{ formatProgress(item.report?.main_report_status, item.report?.main_report_started_at, item.report?.main_report_submitted_at) }}</div>
            <div class="mobile-meta">裁判监督区：{{ item.supervisor_required === false ? '无需裁判监督报告' : formatProgress(item.report?.supervisor_review_status, item.report?.supervisor_review_started_at, item.report?.supervisor_review_submitted_at) }}</div>
            <div class="mobile-actions">
              <button class="small" @click="goToReport(item)">查看报告</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="metricModalVisible" class="modal-overlay" @click.self="closeMetric">
      <div class="modal-panel">
        <div class="modal-head">
          <div class="modal-title">{{ activeMetric?.label || '执法变化' }}</div>
          <button type="button" class="modal-close" @click="closeMetric">×</button>
        </div>
        <div class="modal-body">
          <div v-if="activeMetricChart.hasData" class="modal-chart-scroll">
            <svg
              class="modal-svg"
              :width="activeMetricChart.width"
              :height="activeMetricChart.height"
              :viewBox="`0 0 ${activeMetricChart.width} ${activeMetricChart.height}`"
            >
              <line
                :x1="activeMetricChart.paddingLeft"
                :y1="activeMetricChart.height - activeMetricChart.paddingBottom"
                :x2="activeMetricChart.width - activeMetricChart.paddingRight"
                :y2="activeMetricChart.height - activeMetricChart.paddingBottom"
                class="axis-line"
              />
              <line
                :x1="activeMetricChart.paddingLeft"
                :y1="activeMetricChart.paddingTop"
                :x2="activeMetricChart.paddingLeft"
                :y2="activeMetricChart.height - activeMetricChart.paddingBottom"
                class="axis-line"
              />

              <g v-for="tick in activeMetricChart.yTicks" :key="`y-${tick.key}`">
                <line
                  :x1="activeMetricChart.paddingLeft"
                  :y1="tick.y"
                  :x2="activeMetricChart.width - activeMetricChart.paddingRight"
                  :y2="tick.y"
                  class="grid-line"
                />
                <text
                  :x="activeMetricChart.paddingLeft - 10"
                  :y="tick.y + 4"
                  class="axis-text"
                  text-anchor="end"
                >
                  {{ formatMetricValue(activeMetric.key, tick.value) }}
                </text>
              </g>

              <path :d="activeMetricChart.areaPath" class="modal-area" />
              <path :d="activeMetricChart.linePath" class="modal-line" />

              <g v-for="point in activeMetricChart.points" :key="point.key">
                <circle
                  v-if="point.hasValue"
                  :cx="point.x"
                  :cy="point.y"
                  r="4"
                  class="point-dot"
                >
                  <title>{{ formatMetricValueWithUnit(activeMetric.key, point.value) }}</title>
                </circle>
                <text
                  :x="point.x"
                  :y="activeMetricChart.height - 14"
                  class="axis-text x-axis-text"
                  text-anchor="middle"
                >
                  <tspan v-for="(line, idx) in point.labelLines" :key="`${point.key}-l-${idx}`" :x="point.x" :dy="idx === 0 ? 0 : 14">
                    {{ line }}
                  </tspan>
                </text>
              </g>
            </svg>
          </div>
          <div v-else class="empty-state">暂无可用统计数据</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { displayMatchTime, displayMatchDate, compareMatchSchedule } from '../utils/matchTime.js'
import { scheduleAPI } from '../api/index.js'

const ROLE_LABEL_MAP = Object.freeze({
  main_referee: '裁判员',
  assistant1: '第一助理裁判员',
  assistant2: '第二助理裁判员',
  fourth_official: '第四官员',
  second: '第二裁判员', timekeeper: '计时员', second_referee_id:'第二裁判员',timekeeper_id:'计时员',
  supervisor: '裁判监督',
  main: '裁判员',
  assistant1_id: '第一助理裁判员',
  assistant2_id: '第二助理裁判员',
  fourth: '第四官员',
  fourth_official_id: '第四官员',
  supervisor_id: '裁判监督'
})

const METRIC_DEFS = Object.freeze([
  { key: 'running_distance_m', label: '跑动距离(m)' },
  { key: 'max_heart_rate', label: '最大心率' },
  { key: 'avg_heart_rate', label: '平均心率' },
  { key: 'sprint_count', label: '冲刺次数' },
  { key: 'high_intensity_distance_m', label: '高强度跑动距离(m)' },
  { key: 'avg_speed_mps', label: '平均速度(m/s)' },
  { key: 'red_card_accuracy', label: '红牌准确率(%)' },
  { key: 'yellow_card_accuracy', label: '黄牌准确率(%)' },
  { key: 'penalty_accuracy', label: '点球准确率(%)' }
])

function coerceNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function formatDateLong(dateString) { return displayMatchDate(dateString) }

function buildMatchLabel(item = {}) {
  const orderText = item.field_order ? `场序${item.field_order}` : '场序-'
  const typeText = item.match_type || ''
  const dateText = formatDateLong(item.match_date) + " " + displayMatchTime(item.match_time, item.match_end_time)
  const head = `${orderText}${typeText}，`
  return `${head}\n${dateText}`
}

function computeScale(points = []) {
  const values = points.filter(value => typeof value === 'number' && Number.isFinite(value))
  if (values.length === 0) {
    return { hasData: false, min: 0, max: 1 }
  }

  let min = Math.min(...values)
  let max = Math.max(...values)

  if (min === max) {
    const padding = min === 0 ? 1 : Math.abs(min) * 0.15
    min -= padding
    max += padding
  } else {
    const padding = (max - min) * 0.1
    min -= padding
    max += padding
  }

  return { hasData: true, min, max }
}

function buildLinePath(points, xPositions, yForValue) {
  let path = ''
  let started = false
  for (let i = 0; i < points.length; i += 1) {
    const value = points[i]
    const x = xPositions[i]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      started = false
      continue
    }

    const y = yForValue(value)
    if (!started) {
      path += `M ${x} ${y}`
      started = true
    } else {
      path += ` L ${x} ${y}`
    }
  }
  return path
}

function buildAreaPath(linePath, xPositions, baselineY) {
  if (!linePath) return ''
  const startX = xPositions[0]
  const endX = xPositions[xPositions.length - 1]
  return `${linePath} L ${endX} ${baselineY} L ${startX} ${baselineY} Z`
}

export default {
  name: 'RefereeStats',
  data() {
    return {
      loading: true,
      error: '',
      records: [],
      trendLoading: true,
      trendError: '',
      trendItems: [],
      activeMetricKey: '',
      metricModalVisible: false
    }
  },
  computed: {
    logoUrl() {
      return '/brand-logo.png'
    },
    metricDefs() {
      return METRIC_DEFS
    },
    trendSorted() {
      return [...this.trendItems].sort((a, b) => compareMatchSchedule(a, b, false))
    },
    trendLabels() {
      return this.trendSorted.map(item => buildMatchLabel(item))
    },
    activeMetric() {
      return this.metricDefs.find(item => item.key === this.activeMetricKey) || null
    },
    activeMetricSeries() {
      if (!this.activeMetric) return []
      const key = this.activeMetric.key
      return this.trendSorted.map(item => coerceNumberOrNull(item[key]))
    },
    activeMetricChart() {
      const labels = this.trendLabels
      const points = this.activeMetricSeries
      const paddingLeft = 70
      const paddingRight = 36
      const paddingTop = 22
      const paddingBottom = 110
      const width = Math.max(900, labels.length * 140)
      const height = 360

      const scale = computeScale(points)
      const usableWidth = Math.max(1, width - paddingLeft - paddingRight)
      const usableHeight = Math.max(1, height - paddingTop - paddingBottom)
      const xPositions = labels.map((_, idx) => {
        if (labels.length === 1) return paddingLeft + usableWidth / 2
        return paddingLeft + (usableWidth * idx) / (labels.length - 1)
      })

      const yForValue = (value) => {
        const ratio = (value - scale.min) / (scale.max - scale.min)
        return paddingTop + usableHeight * (1 - ratio)
      }

      const linePath = scale.hasData ? buildLinePath(points, xPositions, yForValue) : ''
      const baselineY = height - paddingBottom
      const areaPath = scale.hasData ? buildAreaPath(linePath, xPositions, baselineY) : ''

      const tickCount = 5
      const yTicks = Array.from({ length: tickCount }, (_, idx) => {
        const ratio = idx / (tickCount - 1)
        const value = scale.min + (scale.max - scale.min) * (1 - ratio)
        return {
          key: `t-${idx}`,
          value,
          y: paddingTop + usableHeight * ratio
        }
      })

      const pointRecords = labels.map((label, idx) => {
        const value = points[idx]
        const hasValue = typeof value === 'number' && Number.isFinite(value)
        const labelLines = String(label).split('\n').filter(Boolean)
        return {
          key: `p-${idx}`,
          x: xPositions[idx],
          y: hasValue ? yForValue(value) : baselineY,
          hasValue,
          value,
          labelLines
        }
      })

      return {
        width,
        height,
        paddingLeft,
        paddingRight,
        paddingTop,
        paddingBottom,
        hasData: Boolean(this.activeMetric) && scale.hasData,
        linePath,
        areaPath,
        yTicks,
        points: pointRecords
      }
    },
    summary() {
      const counts = {
        total: this.records.length,
        main_referee: 0,
        second: 0, timekeeper: 0,
        assistant1: 0,
        assistant2: 0,
        fourth_official: 0,
        supervisor: 0
      }

      this.records.forEach(item => {
        const keys = item.my_role_codes?.length ? item.my_role_codes.map(r => ({main:'main_referee',fourth:'fourth_official'})[r] || r) : [this.resolveRoleKey(item)]
        for (const key of keys) if (counts[key] !== undefined) counts[key] += 1
      })

      return counts
    },
    roleSummary() {
      return [
        { key: 'main_referee', label: '裁判员', count: this.summary.main_referee },
        {key:'second',label:'第二裁判员',count:this.summary.second},
        {key:'timekeeper',label:'计时员',count:this.summary.timekeeper},
        { key: 'assistant1', label: '第一助理裁判员', count: this.summary.assistant1 },
        { key: 'assistant2', label: '第二助理裁判员', count: this.summary.assistant2 },
        { key: 'fourth_official', label: '第四官员', count: this.summary.fourth_official },
        { key: 'supervisor', label: '裁判监督', count: this.summary.supervisor }
      ]
    }
  },
  async mounted() {
    await Promise.all([this.loadStats(), this.loadTrends()])
  },
  methods: {
    displayMatchTime(value, endTime) { return displayMatchTime(value, endTime) },
    formatMetricValue(metricKey, value) {
      if (value === null || value === undefined) return '-'
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) return '-'

      if (metricKey === 'avg_speed_mps') return numeric.toFixed(2)
      if (String(metricKey).endsWith('_accuracy')) return numeric.toFixed(1)
      return Math.round(numeric).toString()
    },
    formatMetricValueWithUnit(metricKey, value) {
      const formatted = this.formatMetricValue(metricKey, value)
      if (formatted === '-') return '-'

      const key = String(metricKey || '')
      let unit = ''
      if (key === 'running_distance_m' || key === 'high_intensity_distance_m') unit = 'm'
      else if (key === 'avg_speed_mps') unit = 'm/s'
      else if (key === 'max_heart_rate' || key === 'avg_heart_rate') unit = '次/分'
      else if (key === 'sprint_count') unit = '次'
      else if (key.endsWith('_accuracy')) unit = '%'

      return unit ? `${formatted} ${unit}` : formatted
    },
    smallChart(metricKey) {
      const points = this.trendSorted.map(item => coerceNumberOrNull(item[metricKey]))
      const width = 240
      const height = 80
      const padding = 8
      const scale = computeScale(points)
      if (!scale.hasData) {
        return { width, height, hasData: false, linePath: '', areaPath: '' }
      }

      const usableWidth = Math.max(1, width - padding * 2)
      const usableHeight = Math.max(1, height - padding * 2)
      const xPositions = points.map((_, idx) => {
        if (points.length === 1) return padding + usableWidth / 2
        return padding + (usableWidth * idx) / (points.length - 1)
      })

      const yForValue = (value) => {
        const ratio = (value - scale.min) / (scale.max - scale.min)
        return padding + usableHeight * (1 - ratio)
      }

      const linePath = buildLinePath(points, xPositions, yForValue)
      const baselineY = height - padding
      const areaPath = buildAreaPath(linePath, xPositions, baselineY)

      return { width, height, hasData: true, linePath, areaPath }
    },
    openMetric(metricKey) {
      this.activeMetricKey = metricKey
      this.metricModalVisible = true
    },
    closeMetric() {
      this.metricModalVisible = false
      this.activeMetricKey = ''
    },
    extractRawList(response) {
      if (Array.isArray(response)) return response
      if (Array.isArray(response?.data)) return response.data
      if (Array.isArray(response?.schedules)) return response.schedules
      if (Array.isArray(response?.data?.schedules)) return response.data.schedules
      if (Array.isArray(response?.data?.data)) return response.data.data
      return []
    },
    buildRecord(rawRecord = {}) {
      const normalized = scheduleAPI.normalizeRecord
        ? scheduleAPI.normalizeRecord(rawRecord)
        : rawRecord

      const hasReportData = scheduleAPI.buildHasReportData
        ? scheduleAPI.buildHasReportData(rawRecord)
        : Boolean(normalized.has_report_data)

      const scoreDisplay = scheduleAPI.buildScoreDisplay
        ? scheduleAPI.buildScoreDisplay(rawRecord)
        : '-'

      return {
        ...normalized,
        has_report_data: hasReportData,
        score_display: scoreDisplay
      }
    },
    async loadStats() {
      this.loading = true
      this.error = ''

      try {
        const response = await scheduleAPI.getMyAssignments()
        const rawList = this.extractRawList(response)

        this.records = rawList
          .map(item => this.buildRecord(item))
          .filter(item => item.id && item.has_report_data)
          .sort((a, b) => compareMatchSchedule(a, b, true))
      } catch (error) {
        console.error('加载执法统计失败:', error)
        this.records = []
        this.error = '加载执法统计失败，请稍后重试'
      } finally {
        this.loading = false
      }
    },
    async loadTrends() {
      this.trendLoading = true
      this.trendError = ''
      try {
        const response = await scheduleAPI.getMyStatTrends()
        const rawList = Array.isArray(response?.data) ? response.data : []
        this.trendItems = rawList.map(item => ({
          schedule_id: item.schedule_id ?? null,
          match_type: item.match_type ?? null,
          match_date: item.match_date ?? null,
          match_time: item.match_time ?? null,
          match_end_time: item.match_end_time ?? null,
          field_order: item.field_order ?? null,
          role: item.role ?? null,
          running_distance_m: item.running_distance_m ?? null,
          max_heart_rate: item.max_heart_rate ?? null,
          avg_heart_rate: item.avg_heart_rate ?? null,
          sprint_count: item.sprint_count ?? null,
          high_intensity_distance_m: item.high_intensity_distance_m ?? null,
          avg_speed_mps: item.avg_speed_mps ?? null,
          red_card_accuracy: item.red_card_accuracy ?? null,
          yellow_card_accuracy: item.yellow_card_accuracy ?? null,
          penalty_accuracy: item.penalty_accuracy ?? null
        }))
      } catch (error) {
        console.error('加载执法变化数据失败:', error)
        this.trendItems = []
        this.trendError = '加载执法变化数据失败，请稍后重试'
      } finally {
        this.trendLoading = false
      }
    },
    resolveRoleKey(item = {}) {
      const key = item.my_role_key || item.my_assignment?.role_key || ''
      const code = item.my_role_code || item.my_assignment?.role_code || ''
      const role = item.my_role || item.my_assignment?.role || ''

      if (key === 'main_referee_id' || code === 'main' || role === '裁判员') return 'main_referee'
      if (key === 'second_referee_id' || code === 'second') return 'second'
      if (key === 'timekeeper_id' || code === 'timekeeper') return 'timekeeper'
      if (key === 'assistant1_id' || code === 'assistant1' || role === '第一助理裁判员') return 'assistant1'
      if (key === 'assistant2_id' || code === 'assistant2' || role === '第二助理裁判员') return 'assistant2'
      if (key === 'fourth_official_id' || code === 'fourth' || role === '第四官员') return 'fourth_official'
      if (key === 'supervisor_id' || code === 'supervisor' || role === '裁判监督' || role === '裁判监督') return 'supervisor'
      return ''
    },
    roleLabel(item = {}) {
      if (item.my_role_codes?.length) return item.my_role_codes.map(code => ROLE_LABEL_MAP[code] || code).join('、')
      const role = item.my_role || item.my_assignment?.role || ''
      if (role === '裁判监督') return '裁判监督'
      if (['裁判员', '第一助理裁判员', '第二助理裁判员', '第四官员', '裁判监督'].includes(role)) return role

      const key = item.my_role_key || item.my_assignment?.role_key || ''
      const code = item.my_role_code || item.my_assignment?.role_code || ''
      return ROLE_LABEL_MAP[key] || ROLE_LABEL_MAP[code] || '-'
    },
    displayTeams(item = {}) {
      const homeName = item.team_a_name_snapshot
        || item.teams?.home?.display_name
        || item.teams?.home?.name_snapshot
        || '主队'

      const awayName = item.team_b_name_snapshot
        || item.teams?.away?.display_name
        || item.teams?.away?.name_snapshot
        || '客队'

      return `${homeName} vs ${awayName}`
    },
    formatDate(dateString) {
      return dateString ? String(dateString).slice(0, 10) : '-'
    },
    formatProgress(status, startedAt, submittedAt) {
      if (status === 'submitted' || submittedAt) return '已提交'
      if (startedAt) return '填写中'
      return '未开始'
    },
    goToReport(item) {
      if (!item?.id) {
        window.alert('无法获取赛程 ID')
        return
      }
      this.$router.push(`/referee-report/${item.id}`)
    },
    goBack() {
      this.$router.back()
    }
  }
}
</script>

<style scoped>
@layer legacy {

.stats-container {
  min-height: 100vh;
  background: #f6f8fb;
  color: #1f2937;
}

.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 100;
}

.title {
  font-size: 22px;
  font-weight: 700;
}

.btn-header,
.text-btn,
.small {
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.btn-header {
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: #ffffff;
  padding: 10px 16px;
}

.text-btn {
  background: #eef2ff;
  color: #3730a3;
  padding: 9px 14px;
}

.small {
  background: #2563eb;
  color: #ffffff;
  padding: 8px 14px;
}

.btn-header:hover,
.text-btn:hover,
.small:hover {
  opacity: 0.92;
}

.btn-header:disabled,
.text-btn:disabled,
.small:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.content {
  padding: 24px 28px 40px;
}

.status,
.empty-state {
  margin: 28px;
  padding: 28px;
  text-align: center;
  background: #ffffff;
  border-radius: 14px;
  border: 1px solid #e5e7eb;
}

.status.error {
  color: #b91c1c;
  border-color: #fecaca;
  background: #fef2f2;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 18px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
}

.primary-card {
  border-color: #c7d2fe;
  background: linear-gradient(180deg, #ffffff 0%, #eef2ff 100%);
}

.summary-label {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 8px;
}

.summary-value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
}

.summary-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #6b7280;
}

.list-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  padding: 22px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.trend-wrapper {
  margin-bottom: 24px;
}

.compact-status {
  margin: 0;
  padding: 18px;
}

.trend-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.trend-card {
  text-align: left;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 14px;
  background: #ffffff;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.trend-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
}

.trend-title {
  font-weight: 700;
  color: #111827;
  margin-bottom: 10px;
  font-size: 14px;
}

.trend-chart {
  height: 86px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.trend-svg {
  width: 100%;
  height: 100%;
}

.trend-line {
  stroke: #2563eb;
  stroke-width: 2.5;
  fill: none;
}

.trend-area {
  fill: rgba(37, 99, 235, 0.16);
  stroke: none;
}

.trend-empty {
  color: #9ca3af;
  font-size: 13px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  z-index: 50;
}

.modal-panel {
  width: min(1100px, 96vw);
  max-height: min(86vh, 880px);
  background: #ffffff;
  border-radius: 16px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

.modal-title {
  font-weight: 800;
  font-size: 16px;
  color: #111827;
}

.modal-close {
  border: none;
  background: transparent;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  padding: 0 6px;
  color: #111827;
}

.modal-body {
  padding: 16px 18px 20px;
  overflow: auto;
}

.modal-chart-scroll {
  overflow-x: auto;
  padding-bottom: 10px;
}

.modal-svg {
  display: block;
  background: #ffffff;
}

.axis-line {
  stroke: #cbd5e1;
  stroke-width: 1.2;
}

.grid-line {
  stroke: rgba(226, 232, 240, 0.9);
  stroke-width: 1;
}

.axis-text {
  fill: #475569;
  font-size: 12px;
}

.x-axis-text {
  font-size: 12px;
}

.modal-line {
  stroke: #2563eb;
  stroke-width: 3;
  fill: none;
}

.modal-area {
  fill: rgba(37, 99, 235, 0.12);
  stroke: none;
}

.point-dot {
  fill: #2563eb;
  stroke: #ffffff;
  stroke-width: 2;
}

.list-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.list-head h2 {
  margin: 0 0 8px;
  font-size: 20px;
}

.list-desc {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

.table-wrapper {
  overflow-x: auto;
}

.table-wrapper table {
  width: 100%;
  border-collapse: collapse;
  min-width: 860px;
}

.table-wrapper th,
.table-wrapper td {
  padding: 14px 12px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: middle;
  font-size: 14px;
}

.table-wrapper thead th {
  background: #f9fafb;
  color: #4b5563;
  font-weight: 600;
}

.mobile-list {
  display: none;
}

.mobile-card {
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 16px;
  margin-top: 14px;
  background: #fafafa;
}

.mobile-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.mobile-role {
  font-weight: 600;
}

.mobile-score {
  font-weight: 700;
  color: #1d4ed8;
}

.mobile-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 8px;
}

.mobile-meta {
  color: #4b5563;
  font-size: 14px;
  margin-bottom: 6px;
}

.mobile-actions {
  margin-top: 12px;
}

@media (max-width: 1080px) {
  .summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .trend-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .header-bar {
    padding: 16px;
  }

  .content {
    padding: 16px 16px 30px;
  }

  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .table-wrapper {
    display: none;
  }

  .mobile-list {
    display: block;
  }

  .list-head {
    flex-direction: column;
    align-items: stretch;
  }

  .trend-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .title {
    font-size: 18px;
  }
}

}
</style>
