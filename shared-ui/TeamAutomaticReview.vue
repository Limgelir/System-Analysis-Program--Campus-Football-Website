<template>
  <section class="automatic-review" aria-label="球队自动审核">
    <h3>报名自动审核规则</h3>
    <dl class="automatic-limits"><div v-for="field in visibleLimits(limits)" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ limits?.[field.key] == null ? '不限' : limits[field.key] + field.unit }}</dd></div></dl>
    <p v-for="(group,index) in limits?.combined_player_limits || []" :key="index">{{ group.tags.map(tagLabel).join('＋') }}合计不超过{{ group.max }}人（同一球员只计1人）</p>
    <p v-if="tagEnabled(limits,'football_specialty')" class="automatic-help">足球特长生：指本科阶段未通过足球单招、足球高水平等方式入学的队员</p>
    <p class="automatic-help">学院按账号最新选择统计，包含全部队员。旧账号未匹配的学院在本人重新选择前，仍按原名称去除首尾空格后分别统计。各项均符合后进入人工审核；自动失败后可选择仍然提交申请，由管理员填写原因后人工通过。未填写性别的球员须先补齐信息，才可提交。</p>
    <template v-if="current">
      <p>当前已保存名单：{{ current.counts.total }}人 · {{ current.counts.colleges }}个学院 · 外援{{ current.counts.foreign }}人<template v-if="tagEnabled(limits,'sports_training')"> · 运训{{ current.counts.sports_training }}人</template><template v-if="tagEnabled(limits,'football_specialty')"> · 足球特长生{{ current.counts.football_specialty }}人</template></p>
      <p v-if="current.colleges.length" class="automatic-help">自动审核计入学院（账号最新资料）：{{ current.colleges.join('、') }}</p>
      <ul v-if="aliasGroups(current).length" class="automatic-help college-aliases"><li v-for="group in aliasGroups(current)" :key="group.name">账号学院“{{ group.account_names.join('／') }}”统一计为“{{ group.name }}”</li></ul>
      <p :class="current.passed ? 'automatic-ok' : 'automatic-error'">按当前规则检查：{{ current.passed ? '符合已配置限制' : '不符合以下限制' }}</p>
      <ul v-if="!current.passed"><li v-for="v in current.failures" :key="v.rule">{{ v.message }}</li></ul>
    </template>
    <div v-if="result" class="automatic-result">
      <p v-if="result.manual_requested && !result.override" class="automatic-help">已申请人工审核，等待管理员处理。</p>
      <p v-if="result.override" class="automatic-override"><strong>管理员已人工通过</strong> · 管理员 #{{ result.override.admin_id }} · {{ time(result.override.approved_at) }}<br>原因：{{ result.override.reason }}</p>
      <details v-if="result.override?.failed_review"><summary>查看人工通过前的自动失败记录</summary><p>{{ time(result.override.failed_review.checked_at) }}</p><ul><li v-for="v in result.override.failed_review.failures" :key="v.rule">{{ v.message }}</li></ul></details>
      <strong>上次自动审核：{{ result.exempt ? '管理员特殊导入，免于自动限制' : result.passed ? '通过' : '失败' }}</strong>
      <span v-if="result.checked_at"> · {{ time(result.checked_at) }}</span>
      <p v-if="!result.exempt" class="automatic-help">当次学院依据：{{ result.college_source === 'account_profile' ? '当次检查时的账号学院' : '学籍审核通过时的信息（旧规则留档）' }}<template v-if="result.colleges?.length"> · {{ result.colleges.join('、') }}</template></p>
      <ul v-if="aliasGroups(result).length" class="automatic-help college-aliases"><li v-for="group in aliasGroups(result)" :key="group.name">当次账号学院“{{ group.account_names.join('／') }}”计为“{{ group.name }}”</li></ul>
      <ul v-if="result.failures?.length"><li v-for="v in result.failures" :key="v.rule">{{ v.message }}</li></ul>
      <p v-if="!result.exempt" class="automatic-help">以上保留当次结果；修改账号资料、名单或赛事限制后，以重新提交及人工批准前的检查为准。</p>
    </div>
  </section>
</template>
<script setup>
import { visibleLimits, tagEnabled, tagLabel } from './teamRegistrationRules.js'
defineProps({ limits: Object, result: Object, current: Object })
const time=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})
const aliasGroups=value=>(value?.college_groups||[]).filter(group=>group.account_names.some(name=>name!==group.name))
</script>
<style scoped>
.automatic-review{margin:20px 0;padding:18px;border:1px solid #d7e3ef;border-radius:10px;background:#f7faff;color:#253c56;overflow-wrap:anywhere}.automatic-review h3{margin:0 0 16px;font-size:17px}.automatic-limits{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;margin:0}.automatic-limits dt{font-size:13px;color:#526b82}.automatic-limits dd{margin:5px 0 0;font-weight:700}.automatic-help{font-size:13px;line-height:1.7;color:#526b82}.automatic-error{color:#a52d26;font-weight:600}.automatic-ok{color:#226a41}.automatic-result{padding-top:14px;margin-top:14px;border-top:1px solid #d7e3ef}.automatic-result>span{font-size:13px}.automatic-review ul{padding-left:22px;line-height:1.8}
</style>
