<template>
  <main class="board">
    <header class="page-head"><div><p class="eyebrow">赛事工作</p><h1>裁判选派</h1><p>按比赛类型和比赛日查看报名，再逐场确定裁判组。</p></div><RouterLink to="/admin-schedule">赛程管理</RouterLink></header>
    <div class="toolbar"><button :aria-pressed="view==='week'" :disabled="loading" @click="switchView('week')">未来7天可报名比赛</button><button :aria-pressed="view==='all'" :disabled="loading" @click="switchView('all')">全部赛程</button><label v-if="view==='all'">赛季 <select :value="seasonId" :disabled="loading" @change="changeSeason($event)"><option v-for="s in data?.seasons" :key="s.id" :value="s.id">{{s.season_name}}</option></select></label><button :disabled="loading" @click="reload">刷新报名与选派</button></div>
    <p v-if="view==='week'&&data?.window" class="hint">中国标准时间 · {{data.window.from}} 至 {{data.window.to}} · 当前启用赛季；已开球或时间待定的比赛可在“全部赛程”查看。</p>
    <PageState v-if="error" kind="error" :message="error" @retry="load"/><PageState v-if="loading" kind="loading" title="正在读取报名与选派…"/>
    <template v-else-if="data&&!error">
      <p class="totals">{{data.selected_season?.season_name||'暂无启用赛季'}} · {{data.groups.length}} 类比赛 · {{matchCount}} 场比赛</p>
      <PageState v-if="!data.groups.length" title="当前范围暂无比赛" message="可以前往赛程管理添加比赛，或切换查看范围。"/>
      <nav class="type-tabs" aria-label="比赛类型"><a v-for="(group,index) in data.groups" :key="group.match_type" :href="'#competition-'+index">{{group.match_type}} <span>{{group.days.length}} 个比赛日</span></a></nav>
      <section v-for="(group,index) in data.groups" :key="group.match_type" :id="'competition-'+index" class="competition">
        <h2>{{group.match_type}}</h2>
        <section v-for="day in group.days" :key="day.match_date" class="match-day">
          <div class="day-head"><h3>比赛日 · {{day.match_date}}</h3><span>{{day.matches.length}} 场比赛 · {{day.registrants.length}} 人已报名</span></div>
          <section class="registrants"><h4>本比赛日已报名裁判员</h4><p v-if="!day.registrants.length" class="hint">暂无裁判员报名，仍可在下方直接选派。</p>
            <article v-for="referee in day.registrants" :key="referee.id" class="registrant"><div class="ref-head"><strong>{{referee.name}}</strong><small>{{referee.student_id}}</small><span class="badge" :class="{invalid:!referee.eligible}">{{referee.eligible?'已报名':'已报名 · 当前资格失效'}}</span></div>
              <p>已报名该日：<a v-for="match in referee.matches" :key="match.id" :href="'#match-'+match.id">场序 {{match.field_order}}（{{match.team_a}} VS {{match.team_b}}）<small>报名职位：{{intentionText(match.intentions)}}{{match.changed?' · 时间或场地变更待核对':''}}</small></a></p>
              <p>报名职位：<strong>{{intentionText(referee.intentions)}}</strong></p><p class="teams">该赛事已加入队伍：{{referee.membership_confirmed?(referee.teams.map(t=>t.team_name).join('、')||'未参加队伍'):'尚未填写'}}</p>
            </article>
          </section>
          <h4 class="assignment-title">本比赛日比赛选派</h4><MatchAssignmentEditor v-for="match in day.matches" :key="match.id" :schedule="match" @updated="updateMatch"/>
        </section>
      </section>
    </template>
  </main>
</template>
<script setup>
import {ref,computed,onMounted,nextTick,onBeforeUnmount} from 'vue'
import {useRoute} from 'vue-router'
import {matchSignupAPI} from '../api/index.js'
import {intentionText} from '../utils/matchSignup.js'
import {confirmDraftLeave} from '../../../shared-ui/interaction.js'
import MatchAssignmentEditor from '../components/MatchAssignmentEditor.vue'
const route=useRoute(),view=ref(route.query.view==='all'?'all':'week'),seasonId=ref(route.query.season_id||''),data=ref(null),loading=ref(false),error=ref('');let sequence=0
const matchCount=computed(()=>data.value?.groups.reduce((n,g)=>n+g.days.reduce((v,d)=>v+d.matches.length,0),0)||0)
async function load(){const id=++sequence;loading.value=true;error.value='';try{const r=await matchSignupAPI.board({view:view.value,...(view.value==='all'&&seasonId.value?{season_id:seasonId.value}:{})});if(id!==sequence)return;data.value=r.data;seasonId.value=r.data.selected_season?.id||''}catch(e){if(id===sequence)error.value=e.response?.data?.message||'读取失败，请重试'}finally{if(id===sequence){loading.value=false;await nextTick();if(route.query.match)document.getElementById('match-'+route.query.match)?.scrollIntoView()}}}
function reload(){if(confirmDraftLeave())load()}
function switchView(value){if(!confirmDraftLeave())return;view.value=value;load()}
function changeSeason(event){if(!confirmDraftLeave()){event.target.value=seasonId.value;return}seasonId.value=event.target.value;load()}
function updateMatch(match){for(const group of data.value.groups)for(const day of group.days){const index=day.matches.findIndex(m=>m.id===match.id);if(index>=0){day.matches.splice(index,1,match);return}}}
onMounted(load);onBeforeUnmount(()=>sequence++)
</script>
<style scoped>
.board{max-width:1280px;margin:0 auto;padding:24px;color:#172b45}.page-head{display:flex;justify-content:space-between;align-items:center;gap:20px}.page-head h1{margin:0;font-size:28px}.page-head p{color:#52657a}.eyebrow{font-size:12px;letter-spacing:2px}.board a{color:#1e5ca8}.toolbar{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}.toolbar button,.toolbar select{min-height:44px;width:auto;margin:0;border:1px solid #becddd;border-radius:8px;padding:10px 14px;color:#123b6d;background:white;cursor:pointer}.toolbar button[aria-pressed=true]{background:#1e5ca8;color:white}.toolbar button:disabled{opacity:.6}.hint,.totals{font-size:14px;color:#52657a;line-height:1.7}.type-tabs{display:flex;flex-wrap:wrap;gap:12px;margin:22px 0}.type-tabs a{background:white;border:1px solid #c7d8e9;border-radius:8px;padding:12px 18px;text-decoration:none}.type-tabs span{margin-left:12px;font-size:12px;color:#52657a}.competition{margin-top:32px;scroll-margin-top:20px}.competition h2{font-size:24px;padding-bottom:12px;border-bottom:3px solid #1e5ca8}.match-day{margin:24px 0 40px}.day-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.day-head h3{font-size:20px}.day-head span{font-size:14px;color:#52657a}.registrants{background:#eaf1fa;border:1px solid #c7d8e9;border-radius:12px;padding:20px}.registrants h4{font-size:17px;margin:0 0 16px}.registrant{padding:16px;background:white;border-radius:8px;margin-top:12px;border-left:4px solid #3f78ad}.ref-head{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.ref-head strong{font-size:18px}.ref-head small{color:#52657a}.badge{font-size:12px;padding:4px 8px;color:#156147;background:#e3f4ec;border-radius:6px}.badge.invalid{background:#fff0d6;color:#805410}.registrant p{margin:10px 0 0;line-height:1.8;overflow-wrap:anywhere}.registrant a{display:inline-block;vertical-align:top;margin:0 16px 6px 0;text-decoration:none}.registrant a small{display:block;color:#52657a}.teams{color:#344f6e}.assignment-title{font-size:17px;margin-top:26px}@media(max-width:600px){.board{padding:16px 10px}.page-head h1{font-size:24px}.registrants{padding:12px}.registrant{padding:12px}.registrant a{display:block}.page-head{align-items:flex-start}.toolbar button{flex:1}}
</style>
