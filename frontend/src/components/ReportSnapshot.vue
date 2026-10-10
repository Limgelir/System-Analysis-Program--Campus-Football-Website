<template>
  <div class="snapshot">
    <p v-if="!snapshot">没有更早的可证明版本（升级基线）。</p>
    <template v-else>
      <p>{{ snapshot.match.team_a_name_snapshot }} vs {{ snapshot.match.team_b_name_snapshot }} · {{ String(snapshot.match.match_date).slice(0,10) }} · {{ displayMatchTime(snapshot.match.match_time) }} · {{ venueText(snapshot.match) }} · 场序 {{ snapshot.match.field_order }}</p>
      <p>负责：{{ snapshot.owner?.name_snapshot || '未选派' }}（{{ snapshot.owner?.source_type === 'external' ? '非系统裁判' : '系统裁判' }}）</p>
      <p>状态：{{ statusLabel(snapshot.status) }} · 提交时间：{{ date(snapshot.submitted_at) }}</p>
      <template v-if="snapshot.section === 'main'">
        <p class="score">比分 {{ snapshot.data.home_score }} : {{ snapshot.data.away_score }}；点球 {{ snapshot.data.home_penalty_score }} : {{ snapshot.data.away_penalty_score }}</p>
        <h5>执法数据</h5>
        <p v-if="!snapshot.data.stats.length">无执法数据</p>
        <div v-for="stat in snapshot.data.stats" :key="stat.role" class="stat-block">
          <strong>{{ officialName(stat.role) }}</strong>
          <dl><template v-for="[field,label] in metricFields" :key="field"><template v-if="stat[field] !== undefined && stat[field] !== null"><dt>{{ label }}</dt><dd>{{ stat[field] }}</dd></template></template></dl>
        </div>
        <h5>进球（{{ snapshot.data.goals.length }} 条）</h5>
        <p v-for="goal in snapshot.data.goals" :key="goal.id">{{ goal.minute_label }}′ · {{ goal.player_name || `球员${goal.team_player_id}` }} · {{ ({normal:'普通进球',penalty:'点球',own_goal:'乌龙球'})[goal.goal_type] }} · 计入{{ teamName(goal.credited_team_id) }} · {{ goal.description || '无说明' }}</p>
        <h5>红黄牌（{{ snapshot.data.cards.length }} 条）</h5>
        <p v-for="card in snapshot.data.cards" :key="card.id">{{ card.minute_label }}′ · {{ teamName(card.team_id) }} · {{ card.player_name || `球员${card.team_player_id}` }} · {{ card.card_type === 'second_yellow_red' ? '两黄变红' : card.card_type === 'red' ? '红牌' : '黄牌' }} · {{ card.description || '无说明' }}</p>
        <p>第四官员记录单：{{ snapshot.data.fourth_official_image_path ? '有历史图片（可在下方查看）' : '无' }}</p>
      </template>
      <template v-else>
        <h5>裁判监督评分（仅展示有权查看的岗位）</h5>
        <p v-if="!snapshot.data.reviews.length">无可查看评分</p>
        <p v-for="review in snapshot.data.reviews" :key="review.target_role">{{ officialName(review.target_role) }}：{{ review.score }} 分 · {{ review.advice || '无建议' }}</p>
      </template>
    </template>
  </div>
</template>

<script>
import { venueText } from '../utils/matchSignup.js'
import { displayMatchTime } from '../utils/matchTime.js'
export default {
  props:{snapshot:{type:Object,default:null}},
  data(){return {metricFields:[['running_distance_m','跑动距离(m)'],['max_heart_rate','最大心率'],['sprint_count','冲刺次数'],['high_intensity_distance_m','高强度跑动(m)'],['avg_heart_rate','平均心率'],['avg_speed_mps','平均速度(m/s)'],['red_card_count','红牌数'],['red_card_accuracy','红牌准确率(%)'],['yellow_card_count','黄牌数'],['yellow_card_accuracy','黄牌准确率(%)'],['penalty_count','点球判罚数'],['penalty_accuracy','点球准确率(%)'],['offside_flag_count','越位举旗'],['assist_count','协助次数']]}},
  methods: {venueText(value) { return venueText(value) },
    displayMatchTime(value) { return displayMatchTime(value) },
    officialName(role){const a=this.snapshot.officials.find(a=>a.role===role); return `${({main:'裁判员',assistant1:'第一助理裁判员',assistant2:'第二助理裁判员',fourth:'第四官员',supervisor:'裁判监督'})[role]} · ${a?.name_snapshot || '未选派'}`},
    teamName(id){return Number(id) === Number(this.snapshot.match.team_a_id)?this.snapshot.match.team_a_name_snapshot:this.snapshot.match.team_b_name_snapshot},
    statusLabel(status){return ({draft:'草稿',submitted:'已提交',returned:'已退回'})[status] || status},
    date(value){return value?new Date(value).toLocaleString('zh-CN'):'-'}
  }
}
</script>

<style scoped>
@layer legacy {

.snapshot{font-size:14px;line-height:1.7;color:#1f2937;overflow-wrap:anywhere}
.snapshot h5{font-size:14px;margin:14px 0 6px;color:#1e3a8a}
.snapshot p{margin:5px 0}.score{font-weight:700}.stat-block{border-bottom:1px solid #e2e8f0;padding:8px 0}
dl{display:grid;grid-template-columns:minmax(100px,1fr) 1fr;gap:3px;margin:4px 0}dd{margin:0}

}
</style>
