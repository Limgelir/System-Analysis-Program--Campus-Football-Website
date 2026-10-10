<template>
  <section class="workbench"><header><h3>赛程与报告待处理</h3><button :disabled="loading" @click="load">刷新工作台</button></header>
    <p v-if="error" class="alert error" role="alert">{{error}}</p><p v-if="loading" role="status">读取工作台…</p>
    <template v-else-if="data"><p>{{data.selected_season?.season_name||'没有当前启用赛季'}} · {{data.summary.total}} 场；以下计数可交叉，不相加作为总数。</p>
      <div class="tiles"><button v-for="item in tiles" :key="item.key" @click="openList(item.key)" :disabled="!data.selected_season"><span>{{item.label}}</span><strong>{{data.summary[item.key]}}</strong></button></div>
      <h4>未来 7 天选派待核查（含今天）</h4><p>缺岗、已选人员停用或系统裁判赛季资格失效时提醒；不自动替换岗位，已锁定比赛仍不可改派。</p>
      <p v-if="!data.items.length">暂无需要核查的临近比赛。</p>
      <ul v-else><li v-for="s in data.items" :key="s.id"><span>{{String(s.match_date).slice(0,10)}} · {{s.match_time ?? '时间待定'}} · {{s.team_a_name_snapshot}} vs {{s.team_b_name_snapshot}}</span><button @click="openDetail(s)">前往选派</button></li></ul>
      <button v-if="data.summary.attention>data.items.length" @click="openList('attention')">查看全部待核查比赛</button>
    </template>
  </section>
</template>
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue'
import {useRouter} from 'vue-router'
import {adminAPI} from '../api'
const router=useRouter(),data=ref(null),loading=ref(false),error=ref('');let requestId=0
const tiles=[{key:'main_pending',label:'裁判员未提交'},{key:'supervisor_pending',label:'裁判监督未提交'},{key:'submitted',label:'所需报告已提交'},{key:'returned',label:'已退回'},{key:'proxy_pending',label:'待管理员代填'},{key:'attention',label:'临近选派待核查'}]
async function load(){const id=++requestId;loading.value=true;error.value='';try{const r=await adminAPI.getWorkbench();if(id===requestId)data.value=r.data}catch(e){if(id===requestId){error.value=e.response?.data?.message||e.message;data.value=null}}finally{if(id===requestId)loading.value=false}}
function openList(status){if(status==='attention'){router.push('/admin-assignments');return}router.push({path:'/admin-schedule',query:{season_id:String(data.value.selected_season.id),report_status:status}})}
function openDetail(s){router.push({path:'/admin-assignments',query:{view:'all',season_id:String(s.season_id),match:s.id}})}
onMounted(load);onBeforeUnmount(()=>requestId++)
</script>
<style scoped>
@layer legacy {

.workbench{background:white;padding:22px;border-radius:12px;margin-bottom:24px;box-shadow:0 4px 14px #0f172a14}.workbench header{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.workbench p{color:#64748b;font-size:13px;line-height:1.7}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}button{padding:10px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;color:#1f3b73;cursor:pointer}.tiles button{text-align:left;display:flex;flex-direction:column;gap:8px}.tiles strong{font-size:24px}ul{padding:0;list-style:none}li{padding:12px 0;display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid #e2e8f0}li span{overflow-wrap:anywhere}button:disabled{opacity:.5}

}
</style>
