<template>
  <section class="signup-summary">
    <button type="button" @click="toggle">{{ open?'收起报名名单':'查看报名名单与变化记录' }}</button>
    <div v-if="open">
      <p>报名只表示意向，正式岗位请在“裁判选派”模块保存。资格失效或已撤回者不会获得报名优先。</p>
      <button type="button" :disabled="loading" @click="load">刷新报名名单</button>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="loading">加载中…</p><p v-else-if="!items.length">暂无报名历史</p>
      <article v-for="item in items" :key="item.id">
        <strong>{{ item.name }}</strong> · {{ item.student_id }}
        <p>{{ item.status==='active'?'已报名':'已撤回' }} · {{ item.eligible?'当季资格有效':'资格失效或账号停用' }} · 意向：{{ intentionText(item.intentions) }}<span v-if="item.assigned_role"> · 已选派{{ roleText(item.assigned_role) }}</span></p>
        <p v-if="item.venue_changed" class="warning">比赛场地已变化，请联系报名裁判核对。</p>
        <p v-if="item.time_changed" class="warning">时间已变化，请联系核对。报名时：{{ item.match_date_snapshot }} {{ item.match_time_snapshot }}</p>
        <button type="button" @click="showHistory(item.id)">变化记录</button>
        <ol v-if="histories[item.id]"><li v-for="event in histories[item.id]" :key="event.id">{{ formatDate(event.created_at) }} · {{ operations[event.operation] }} · {{ intentionText(event.after_snapshot.intentions) }} · 当时比赛：{{ event.after_snapshot.match_date_snapshot }} {{ event.after_snapshot.match_time_snapshot }}</li></ol>
      </article>
      <div v-if="pagination.total_pages>1"><button :disabled="page<=1||loading" @click="page--;load()">上一页</button> {{ page }} / {{ pagination.total_pages }} <button :disabled="page>=pagination.total_pages||loading" @click="page++;load()">下一页</button></div>
    </div>
  </section>
</template>
<script setup>
import {ref,watch,onBeforeUnmount} from 'vue'
import {matchSignupAPI} from '../api/index.js'
import {intentionText,roleText} from '../utils/matchSignup.js'
const props=defineProps({scheduleId:{type:[Number,String],required:true}})
const open=ref(false),items=ref([]),page=ref(1),pagination=ref({}),histories=ref({}),loading=ref(false),error=ref('')
const operations={signup:'报名',update:'修改意向 / 确认改期',withdraw:'撤回',reapply:'重新报名'}
let sequence=0
const formatDate=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})
async function load(){const seq=++sequence;loading.value=true;error.value='';try{const {data}=await matchSignupAPI.adminList(props.scheduleId,{page:page.value,page_size:20});if(seq===sequence){items.value=data.items;pagination.value=data.pagination;histories.value={}}}catch(e){if(seq===sequence)error.value=e?.response?.data?.message||'报名列表读取失败'}finally{if(seq===sequence)loading.value=false}}
function toggle(){open.value=!open.value;if(open.value)load()}
async function showHistory(id){const seq=sequence;try{const {data}=await matchSignupAPI.history(props.scheduleId,id);if(seq===sequence)histories.value[id]=data}catch(e){if(seq===sequence)error.value=e?.response?.data?.message||'历史读取失败'}}
watch(()=>props.scheduleId,()=>{sequence++;items.value=[];histories.value={};page.value=1;if(open.value)load()})
onBeforeUnmount(()=>sequence++)
</script>
<style scoped>
@layer legacy {
.signup-summary{margin:14px 0;padding:14px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#172b45;overflow-wrap:anywhere}.signup-summary button{width:auto;margin:0;min-height:44px;border:1px solid #cbd5e1;background:white;color:#1e5ca8;border-radius:6px;padding:8px 12px;cursor:pointer}.signup-summary article{border-top:1px solid #dce5ef;padding:14px 0}.warning{color:#875400}.signup-summary li{margin:8px 0}
}
</style>
