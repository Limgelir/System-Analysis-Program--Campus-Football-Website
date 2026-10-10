<template>
  <section class="player-settings card">
    <header><div><h2>球员注册与球队报名设置</h2><p>设置北京时间；只有当前启用且未结束的赛季会实际开放。</p></div><RouterLink to="/admin-player-registrations">前往球员学籍审核 →</RouterLink></header>
    <div class="selector"><label>配置赛季<select :value="selectedSeason" @change="changeSeason" :disabled="saving"><option value="">请选择赛季</option><option v-for="s in seasons" :key="s.id" :value="String(s.id)">{{ s.season_name }}{{ s.is_active ? '（启用中）' : '' }}</option></select></label><button :disabled="loading || saving || !selectedSeason" @click="load">刷新设置</button></div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div><div v-if="success" class="notice success" role="status">{{ success }}</div><p v-if="loading">正在加载设置…</p>
    <form v-draft="{ value: form, resetKey: config }" v-if="config && !loading" @submit.prevent="save">
      <fieldset :disabled="saving || !!config.ended_at"><legend>个人学籍注册</legend><div class="time-grid"><label>个人注册开放时间<input v-model="form.registration_opens_at" type="datetime-local"></label><label>个人注册截止时间<input v-model="form.registration_closes_at" type="datetime-local"></label></div><p class="help">两项均留空表示尚未开放。退回或资格撤销后的补正不受正常截止时间限制。</p></fieldset>
      <fieldset :disabled="saving || !!config.ended_at"><legend>添加比赛类型</legend>
        <p class="help">只配置本赛季已添加的赛事。选择类型后点击“添加赛事”，填写停赛规则并保存，报名、球队、赛程及统计页面才会出现该赛事。</p>
        <div class="time-grid"><label>比赛类型<select v-model="newType" aria-label="比赛类型"><option value="">请选择</option><option v-for="type in availablePresets" :key="type">{{ type }}</option><option>其它</option></select></label><label v-if="newType==='其它'">赛事名称<input v-model="newName" maxlength="50"></label></div>
        <button type="button" @click="addCompetition">添加赛事</button>
      </fieldset>
      <p v-if="!form.competitions.length" class="help">本赛季尚未添加赛事。</p>
      <fieldset v-for="(competition,index) in form.competitions" :key="competition.league_type" :disabled="saving || !!config.ended_at" class="competition-settings"><legend>{{ competition.league_type }}</legend><label class="checkbox"><input v-model="competition.is_enabled" type="checkbox">本赛季举办{{ competition.league_type }}</label>
        <fieldset :disabled="competition.rules_locked"><legend>红黄牌停赛规则</legend><div class="time-grid"><label>黄牌累计张数<input type="number" v-model.number="competition.yellow_threshold" min="1" max="100" required :aria-label="competition.league_type+'黄牌累计张数'"></label><label>黄牌停赛场数<input type="number" v-model.number="competition.yellow_suspension" min="1" max="100" required :aria-label="competition.league_type+'黄牌停赛场数'"></label><label>红牌累计张数<input type="number" v-model.number="competition.red_threshold" min="1" max="100" required :aria-label="competition.league_type+'红牌累计张数'"></label><label>红牌停赛场数<input type="number" v-model.number="competition.red_suspension" min="1" max="100" required :aria-label="competition.league_type+'红牌停赛场数'"></label></div></fieldset>
        <p class="help">{{ competition.rules_locked?'已有正式报告，停赛规则已锁定。':'规则将在首份正式报告后锁定。' }} 两黄变红只计红牌；同时触发时停赛取较长场数；服满后只清触发牌种。</p>
        <fieldset><legend>球队标签</legend><label class="checkbox"><input v-model="competition.enable_sports_training" type="checkbox" @change="tagsChanged(competition)">使用运训标签</label><label class="checkbox"><input v-model="competition.enable_football_specialty" type="checkbox" @change="tagsChanged(competition)">使用足球特长生标签</label><p class="help">关闭后，该赛事的报名、审核、正式名单和公开查询均不显示此标签，也不参与人数限制。旧标记留档，重新启用后恢复显示。</p></fieldset>
        <fieldset><legend>球队报名自动审核限制（均可留空）</legend>
          <div class="time-grid"><label v-for="field in visibleLimits(competition)" :key="field.key">{{ field.label }}<input v-model.number="competition[field.key]" type="number" min="0" max="2147483647" step="1" placeholder="不限" :aria-label="competition.league_type+field.label"></label></div>
          <p class="help">最低和最高人数可分别留空；上限填0表示不允许，留空表示不限。学院以账号最新选择为准，旧账号未匹配的学院仍按原名称去除首尾空格后分别统计；全部队员均计入学院数。线上首次报名和名单变更均检查，管理员特殊导入保留例外。</p>
          <h3>合并人数限制</h3><p class="help">选择两个或三个已启用标签，设置合计上限；同一球员即使有多个标签，也只算1人。多组限制与单项限制同时生效。</p>
          <fieldset v-for="(group,gi) in competition.combined_player_limits" :key="gi"><legend>第{{ gi+1 }}组合并限制</legend><label v-for="tag in playerTags.filter(t=>tagEnabled(competition,t.key))" :key="tag.key" class="checkbox"><input v-model="group.tags" type="checkbox" :value="tag.key" :aria-label="competition.league_type+'第'+(gi+1)+'组'+tag.label">{{ tag.label }}</label><label>合计最多人数<input v-model.number="group.max" type="number" min="0" max="2147483647" step="1" required :aria-label="competition.league_type+'第'+(gi+1)+'组合计最多人数'"></label><button type="button" @click="competition.combined_player_limits.splice(gi,1)">移除此组合</button></fieldset>
          <button type="button" :disabled="competition.combined_player_limits.length>=4 || playerTags.filter(t=>tagEnabled(competition,t.key)).length<2" @click="competition.combined_player_limits.push({tags:[],max:null})">添加合并人数限制</button>
          <p class="help">报名限制可以修改。待审申请批准前按最新规则重查；已通过球队和已有赛程保留。截止后需要增删人数时，须统一重开窗口。</p>
        </fieldset>
        <button v-if="!config.competitions.some(c=>c.league_type===competition.league_type)" type="button" @click="form.competitions.splice(index,1)">移除尚未保存的赛事</button>
        <div class="time-grid"><label>{{ competition.league_type }}球队报名开放时间<input v-model="competition.registration_opens_at" type="datetime-local"></label><label>{{ competition.league_type }}球队报名截止时间<input v-model="competition.registration_closes_at" type="datetime-local"></label></div>
        <label>赛事报名规则说明<textarea v-model="competition.rules_text" rows="2" maxlength="10000" :aria-label="competition.league_type + '规则说明'"></textarea></label>
        <div class="windows-header"><h3>名单修改时间段</h3><button type="button" @click="addWindow(index)">添加{{ competition.league_type }}修改时间段</button></div>
        <p v-if="!competition.change_windows.length" class="help">未设置名单修改时间段。可按赛季进程添加多轮统一窗口。</p>
        <div v-for="(window,wi) in competition.change_windows" :key="window.key" class="window-row"><label>第{{ wi + 1 }}轮开放<input v-model="window.opens_at" type="datetime-local" required :aria-label="competition.league_type + '第' + (wi + 1) + '轮开放'"></label><label>第{{ wi + 1 }}轮截止<input v-model="window.closes_at" type="datetime-local" required :aria-label="competition.league_type + '第' + (wi + 1) + '轮截止'"></label><button type="button" @click="competition.change_windows.splice(wi,1)">移除此时间段</button></div>
      </fieldset>
      <button class="primary" :disabled="saving || !!config.ended_at">{{ saving ? '保存中…' : '保存球员报名设置' }}</button><p v-if="config.ended_at" class="help">该赛季已结束，设置只读。</p>
    </form>
    <details v-if="events.length" class="settings-history"><summary>查看最近的设置操作记录</summary><ol><li v-for="event in events" :key="event.revision"><strong>设置版本 {{ event.revision }}</strong> · 管理员 #{{ event.actor_admin_id }} · {{ time(event.created_at) }}<p>个人注册：{{ time(event.after_snapshot.registration_opens_at) }} 至 {{ time(event.after_snapshot.registration_closes_at) }}</p><p>举办赛事：{{ event.after_snapshot.competitions.filter(c => c.is_enabled).map(c => c.league_type).join('、') || '未启用' }}</p></li></ol></details>
    <PlayerSeasonCleanup v-if="selectedSeason" :season-id="selectedSeason" @busy="saving=$event" @ended="load"/>
  </section>
</template>
<script setup>
import { confirmDraftLeave } from '../../../shared-ui/interaction.js'
import { computed, ref, watch } from 'vue'
import api from '../api/http'
import { registrationLimits, visibleLimits, playerTags, tagEnabled } from '../../../shared-ui/teamRegistrationRules.js'
import PlayerSeasonCleanup from './PlayerSeasonCleanup.vue'
const props = defineProps({ seasons: { type: Array, default: () => [] }, currentSeasonId: Number })
const selectedSeason = ref(''), config = ref(null), form = ref(null), events = ref([]), loading = ref(false), saving = ref(false), error = ref(''), success = ref(''); let sequence = 0
const newType=ref(''),newName=ref('')
const ruleFields=['yellow_threshold','yellow_suspension','red_threshold','red_suspension']
const availablePresets=computed(()=>(config.value?.presets||[]).filter(name=>!form.value?.competitions.some(c=>c.league_type===name)))
function addCompetition(){const name=(newType.value==='其它'?newName.value:newType.value).trim();if(!name||name==='其它'){error.value='请填写赛事名称';return}if(form.value.competitions.some(c=>c.league_type===name)){error.value='本赛季已经添加该赛事';return}form.value.competitions.push({league_type:name,is_enabled:true,enable_sports_training:true,enable_football_specialty:false,combined_player_limits:[],rules_text:'',registration_opens_at:'',registration_closes_at:'',change_windows:[],...Object.fromEntries([...ruleFields,...registrationLimits.map(f=>f.key)].map(k=>[k,null]))});newType.value='';newName.value='';error.value=''}
let windowKey = 0
const newWindowKey = () => ++windowKey
const inputTime = value => value ? value.slice(0,16) : '', apiTime = value => value ? value + ':00+08:00' : null
const time = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未设置'
function assign(value) { config.value = value; form.value = { registration_opens_at: inputTime(value.registration_opens_at), registration_closes_at: inputTime(value.registration_closes_at), competitions: value.competitions.map(c => ({ ...Object.fromEntries([...ruleFields,...registrationLimits.map(f=>f.key)].map(k=>[k,c[k]??null])),enable_sports_training:c.enable_sports_training,enable_football_specialty:c.enable_football_specialty,combined_player_limits:(c.combined_player_limits||[]).map(g=>({tags:[...g.tags],max:g.max})),rules_locked:c.rules_locked,league_type: c.league_type, is_enabled: c.is_enabled, registration_opens_at: inputTime(c.registration_opens_at), registration_closes_at: inputTime(c.registration_closes_at), rules_text: c.rules_text, change_windows: c.change_windows.map(w => ({ ...w, key: newWindowKey(), opens_at: inputTime(w.opens_at), closes_at: inputTime(w.closes_at) })) })) } }
function changeSeason(event){if(confirmDraftLeave(document.querySelector('.player-settings')))selectedSeason.value=event.target.value;else event.target.value=selectedSeason.value}
async function load() { if(!confirmDraftLeave(document.querySelector('.player-settings')))return;  const current = ++sequence; config.value = null; events.value = []; error.value = ''; success.value = ''; if (!selectedSeason.value) return; loading.value = true; try { const [r,h] = await Promise.all([api.get(`/player-admin/season-settings/${selectedSeason.value}`), api.get(`/player-admin/season-settings/${selectedSeason.value}/history`)]); if (current === sequence) { assign(r.data); events.value = h.data } } catch(e) { if (current === sequence) error.value = e.response?.data?.message || '读取设置失败' } finally { if (current === sequence) loading.value = false } }
function tagsChanged(c) { for (const f of registrationLimits) if (f.tag && !tagEnabled(c,f.tag)) c[f.key]=null; c.combined_player_limits=c.combined_player_limits.filter(g=>g.tags.every(k=>tagEnabled(c,k))) }
function addWindow(index) { form.value.competitions[index].change_windows.push({ id: null, key: newWindowKey(), opens_at: '', closes_at: '' }) }
async function save() {
  saving.value = true; error.value = ''; success.value = ''
  const payload = { registration_opens_at: apiTime(form.value.registration_opens_at), registration_closes_at: apiTime(form.value.registration_closes_at), competitions: form.value.competitions.map(({rules_locked,...c}) => ({ ...c, registration_opens_at: apiTime(c.registration_opens_at), registration_closes_at: apiTime(c.registration_closes_at), change_windows: c.change_windows.map(w => ({ id: w.id, opens_at: apiTime(w.opens_at), closes_at: apiTime(w.closes_at) })) })) }
  try { const r = await api.put(`/player-admin/season-settings/${selectedSeason.value}`, payload, { headers: { 'If-Match': String(config.value.revision) } }); assign(r.data); success.value = '球员报名设置已保存。'; events.value = (await api.get(`/player-admin/season-settings/${selectedSeason.value}/history`)).data } catch(e) { error.value = e.response?.data?.message || '保存失败，请稍后重试' } finally { saving.value = false }
}
watch(() => props.seasons, rows => { if (!rows.some(s => String(s.id) === selectedSeason.value)) selectedSeason.value = String(props.currentSeasonId || rows[0]?.id || '') }, { immediate: true })
watch(() => props.currentSeasonId, id => { if (id && !saving.value) selectedSeason.value = String(id) })
watch(selectedSeason, load, { immediate: true })
</script>
<style scoped>
@layer legacy {

.player-settings{margin-top:28px;background:white;padding:28px;border:1px solid #dce5ee;border-radius:12px;color:#253c56}.player-settings header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.player-settings h2{font-size:22px;margin:0 0 10px}.player-settings header p,.help{font-size:13px;color:#718294;line-height:1.7}.player-settings a{color:#2464aa}.selector{display:flex;align-items:flex-end;gap:20px;margin:24px 0}.player-settings label{display:block;font-size:14px;font-weight:600}.player-settings input,.player-settings select,.player-settings textarea{display:block;box-sizing:border-box;font:inherit;width:100%;padding:10px;border:1px solid #cbd6e2;border-radius:6px;margin:7px 0 14px}.selector select{margin-bottom:0;min-width:240px}.player-settings button{width:auto;flex-shrink:0;background:white;color:#285e9a;border:1px solid #c3d4e7;border-radius:6px;padding:9px 15px;cursor:pointer;font:inherit}.player-settings button:disabled{opacity:.5;cursor:wait}.player-settings fieldset{padding:20px;margin:0 0 24px;border:1px solid #dce5ee;border-radius:9px;min-width:0}.player-settings legend{padding:0 10px;font-weight:700}.time-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.checkbox{display:flex!important;gap:9px;align-items:center;margin-bottom:20px}.checkbox input{display:inline-block;width:18px;margin:0}.windows-header{display:flex;align-items:center;justify-content:space-between;gap:15px}.windows-header h3{font-size:16px;flex-shrink:0}.window-row{display:grid;grid-template-columns:1fr 1fr auto;gap:16px;align-items:center;margin:15px 0}.notice{padding:13px;border-radius:7px;margin-bottom:16px}.notice.error{background:#fff0ef;color:#a52d26}.notice.success{background:#edf8ef;color:#2a6540}.player-settings .primary{background:#275fa7;color:white}.settings-history{margin-top:24px;font-size:14px}.settings-history summary{cursor:pointer}.settings-history p{color:#708196;font-size:13px;margin:6px 0}.settings-history li{padding:10px 0}@media(max-width:700px){.player-settings{padding:20px}.player-settings header,.selector,.windows-header{flex-direction:column;align-items:flex-start}.selector{align-items:stretch}.selector select{min-width:0}.time-grid,.window-row{grid-template-columns:1fr;gap:5px}.player-settings fieldset{padding:15px}.window-row button{justify-self:start}.player-settings input{min-width:0}}

}
</style>
