<template>
  <div class="signup-page">
    <header><div><img src="/brand-logo.png" alt="同济校徽"><h1>选派报名</h1></div><RouterLink to="/referee-dashboard">返回裁判首页</RouterLink></header>
    <main v-draft="{ value: drafts, dirty: hasDrafts }">
      <p>报名只表达执法意向，正式选派由管理员决定。开球前可修改或撤回，撤回不会取消已选派的岗位。</p>
      <div class="toolbar"><button :aria-pressed="view==='week'" @click="switchView('week')">未来7天</button><button :aria-pressed="view==='mine'" @click="switchView('mine')">我的报名</button><button :disabled="loading||busy!==null" @click="load(true)">刷新比赛状态</button></div>
      <p v-if="windowRange">中国标准时间 · {{ windowRange.from }} 至 {{ windowRange.to }}</p>
      <p v-if="!loading && !currentSeason" class="notice">暂无启用赛季；已有记录可在“我的报名”中查看。</p>
      <p v-else-if="currentSeason?.ended_at" class="notice">当前赛季已结束，报名已关闭。</p>
      <p v-else-if="currentSeason?.registration_status!=='approved'" class="notice">{{ registrationText }}，审核通过后才能报名。<RouterLink to="/referee-dashboard">前往赛季注册</RouterLink></p>
      <PageState v-if="error" kind="error" :message="error" @retry="error='';load(true)" /><p v-if="message" role="status">{{ message }}</p>
      <PageState v-if="loading" kind="loading" title="正在加载比赛…" />
      <PageState v-else-if="!error && !items.length" :title="view==='week'?'未来7天暂无比赛':'暂无报名记录'" message="可以稍后刷新，或切换列表查看。" />
      <nav v-if="groups.length" class="competition-tabs" aria-label="选择报名赛事"><button v-for="group in groups" :key="group.key" :aria-pressed="selectedKey===group.key" @click="selectCompetition(group.key)"><strong>{{group.match_type}}</strong><span>{{group.season_name}} · {{group.items.length}} 场 · 已报名 {{group.items.filter(i=>i.signup_status==='active').length}} 场</span></button></nav>
      <p v-if="groups.length&&!selectedGroup" class="notice">请选择赛事，查看比赛并填写参队信息。</p>
      <template v-if="selectedGroup">
      <h2>{{selectedGroup.match_type}}</h2>
      <RefereeCompetitionTeams v-if="selectedGroup.competition_id" :key="selectedKey" :competition-id="selectedGroup.competition_id" @ready="membershipReady=$event" />
      <article v-for="item in selectedGroup.items" :key="item.id" :data-schedule-id="item.id">
        <div class="match-head"><h2>{{ item.team_a_name_snapshot }} vs {{ item.team_b_name_snapshot }}</h2><strong>{{ item.match_time||'时间待定' }}</strong></div>
        <p>{{ item.match_date }} · {{ item.match_type }} · 场序 {{ item.field_order }} · {{ venueText(item) }}</p>
        <p class="muted">{{ item.season_name }}</p>
        <p><span class="badge">{{ item.signup_status==='active'?'已报名':item.signup_status==='withdrawn'?'已撤回':'未报名' }}</span><span v-if="item.assigned_role" class="badge">已选派：{{ roleText(item.assigned_role) }}</span></p>
        <p v-if="item.venue_changed" class="notice">比赛场地已变化，请核对当前场地后保存意向确认。</p>
        <p v-if="item.time_changed" class="notice">比赛时间已变更。上次报名时为 {{ item.match_date_snapshot }} {{ item.match_time_snapshot }}，请核对当前时间，再保存意向确认。</p>
        <p v-if="item.signup_status==='active'">当前意向：{{ intentionText(item.intentions) }}</p>
        <p v-if="item.reason || closed(item)" class="notice">{{ closed(item)?'已开球，报名、修改和撤回已关闭':item.reason }}</p>
        <fieldset :disabled="loading||busy!==null || closed(item) || !(item.can_apply||item.can_change)"><legend>意向位置（可多选）</legend>
          <label v-for="intent in intentions.filter(i => (i.value !== 'supervisor' || item.supervisor_required !== 0) && (i.value !== 'fourth' || item.fourth_required !== 0))" :key="intent.value"><input v-model="drafts[item.id]" type="checkbox" :value="intent.value">{{ intent.label }}</label>
        </fieldset>
        <div class="actions"><button class="primary" :disabled="loading||busy!==null||closed(item)||!(item.can_apply||item.can_change)||!drafts[item.id]?.length||!membershipReady" @click="save(item,'save')">{{ busy===item.id?'提交中…':item.signup_status==='active'?'保存意向':item.signup_status==='withdrawn'?'重新报名':'提交报名' }}</button><button v-if="item.signup_status==='active'" :disabled="loading||busy!==null||closed(item)||!item.can_change" @click="save(item,'withdraw')">撤回报名</button></div>
      </article>
      </template>
      <div v-if="false" class="toolbar"><button :disabled="page<=1||loading||busy!==null" @click="changePage(-1)">上一页</button><span>{{ page }} / {{ pagination.total_pages }}</span><button :disabled="page>=pagination.total_pages||loading||busy!==null" @click="changePage(1)">下一页</button></div>
    </main>
  </div>
</template>
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue'
import {confirmDraftLeave} from '../../../shared-ui/interaction.js'
import RefereeCompetitionTeams from '../components/RefereeCompetitionTeams.vue'
import {matchSignupAPI} from '../api/index.js'
import {intentions,intentionText,roleText,venueText} from '../utils/matchSignup.js'
const view=ref('week'),page=ref(1),items=ref([]),drafts=ref({}),loading=ref(false),busy=ref(null),error=ref(''),message=ref(''),currentSeason=ref(null),windowRange=ref(null),pagination=ref({}),tick=ref(Date.now())
const selectedKey=ref(''),membershipReady=ref(false)
const groups=computed(()=>{const map=new Map();for(const item of items.value){const key=item.season_id+':'+item.match_type;if(!map.has(key))map.set(key,{key,match_type:item.match_type,season_name:item.season_name,competition_id:item.competition_id,items:[]});map.get(key).items.push(item)}return [...map.values()]})
const selectedGroup=computed(()=>groups.value.find(g=>g.key===selectedKey.value))
function selectCompetition(key){if(busy.value!==null||!confirmDraftLeave())return;selectedKey.value=key;membershipReady.value=false}
let sequence=0,timer,serverOffset=0
const hasDrafts=computed(()=>items.value.some(item=>JSON.stringify([...(drafts.value[item.id]||[])].sort())!==JSON.stringify([...item.intentions].sort())))
const registrationText=computed(()=>({pending:'本赛季注册审核中',rejected:'本赛季注册已驳回',returned:'本赛季注册已退回'}[currentSeason.value?.registration_status]||'尚未完成本赛季注册'))
const closed=item=>item.match_time && Date.parse(item.match_date+'T'+item.match_time+':00+08:00')<=tick.value+serverOffset
async function load(preserve=false){
  const request=++sequence;loading.value=true;message.value=''
  try{const {data}=await matchSignupAPI.list({view:view.value,page:1,page_size:100});if(request!==sequence)return
    for(let p=2;p<=data.pagination.total_pages;p++){const next=await matchSignupAPI.list({view:view.value,page:p,page_size:100});if(request!==sequence)return;data.items.push(...next.data.items)}
    items.value=data.items;currentSeason.value=data.current_season;windowRange.value=data.window;pagination.value=data.pagination
    serverOffset=Date.parse(data.server_time.replace(' ','T')+'+08:00')-Date.now();tick.value=Date.now()
    const next={};for(const item of data.items) next[item.id]=preserve&&drafts.value[item.id]?[...drafts.value[item.id]]:[...item.intentions];drafts.value=next
  }catch(e){if(request===sequence)error.value=e?.response?.data?.message||'加载失败，请重试'}finally{if(request===sequence)loading.value=false}
}
function switchView(value){if(busy.value!==null||!confirmDraftLeave())return;selectedKey.value='';membershipReady.value=false;view.value=value;page.value=1;error.value='';message.value='';load()}
function changePage(delta){if(!confirmDraftLeave())return;page.value+=delta;load()}
async function save(item,action){
  if(loading.value||busy.value!==null)return
  if(action==='withdraw'&&!window.confirm('确认撤回本场报名？已选派的岗位不会自动取消。'))return
  busy.value=item.id;error.value='';message.value=''
  try{const {data}=await matchSignupAPI.save(item.id,{action,intentions:(drafts.value[item.id]||[]).filter(i=>(i!=='supervisor'||item.supervisor_required!==0)&&(i!=='fourth'||item.fourth_required!==0)),revision:item.signup_revision,schedule_revision:item.schedule_revision});items.value=items.value.map(r=>r.id===item.id?data:r);drafts.value[item.id]=[...data.intentions];message.value=action==='withdraw'?'报名已撤回；正式选派保持不变':'意向已保存；正式选派以“我的执法”为准'}
  catch(e){error.value=e?.response?.data?.message||'保存失败，请重试';if(e?.response?.status===409)await load(true)}finally{busy.value=null}
}
onMounted(()=>{load();timer=setInterval(()=>tick.value=Date.now(),1000)})
onBeforeUnmount(()=>{sequence++;clearInterval(timer)})
</script>
<style scoped>
@layer legacy {

.competition-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:20px 0}.competition-tabs button{text-align:left}.competition-tabs strong,.competition-tabs span{display:block}.competition-tabs span{font-size:13px;margin-top:6px}.signup-page{min-height:100vh;background:#f3f6fa;color:#172b45}.signup-page header{background:#fff;border-bottom:1px solid #dce5ef;padding:18px max(16px,calc((100% - 1100px)/2));display:flex;justify-content:space-between;align-items:center;gap:16px}.signup-page header div{display:flex;gap:12px;align-items:center}.signup-page img{width:44px;height:44px}.signup-page h1{font-size:24px;margin:0}.signup-page main{max-width:1100px;margin:auto;padding:20px 16px}.signup-page a{color:#1e5ca8}.toolbar,.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.signup-page button{width:auto;margin:0;min-height:44px;padding:10px 16px;background:#fff;color:#123b6d;border:1px solid #c6d3e3;border-radius:8px;cursor:pointer}.signup-page button.primary,.signup-page button[aria-pressed=true]{background:#1e5ca8;color:#fff}.signup-page button:disabled{opacity:.55;cursor:not-allowed}.signup-page article{background:white;border:1px solid #dce5ef;border-radius:12px;padding:20px;margin:18px 0;overflow-wrap:anywhere}.match-head{display:flex;gap:16px;align-items:center;justify-content:space-between}.match-head h2{font-size:20px;margin:0}.match-head strong{white-space:nowrap;color:#123b6d}.muted{color:#52657a}.notice{padding:12px;background:#fff6de;border-radius:6px}.error{color:#a21d25}.badge{display:inline-block;margin-right:8px;background:#edf3fa;color:#123b6d;padding:5px 10px;border-radius:6px}.signup-page fieldset{border:0;padding:12px 0;display:flex;flex-wrap:wrap;gap:8px}.signup-page fieldset label{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;background:#f3f6fa;border-radius:8px}.signup-page input{width:18px;height:18px}@media(max-width:600px){.signup-page header{align-items:flex-start}.signup-page h1{font-size:21px}.signup-page article{padding:16px}.match-head{align-items:flex-start}.match-head h2{font-size:18px}}

}
</style>
