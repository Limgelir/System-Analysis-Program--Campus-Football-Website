<template><section class="season-cleanup">
  <h3>结束赛季与学籍材料清理</h3><p>结束后不能重新开放球员注册、球队报名或名单修改；比赛结果仍可修订。仅临时暂停请使用“停用赛季”。</p>
  <button type="button" :disabled="busy" @click="load">查看待清理材料</button><p v-if="error" class="notice error" role="alert">{{ error }}</p>
  <template v-if="data"><p>赛季：<strong>{{ data.season.season_name }}</strong> · 学籍截图共 {{ data.total }} 张，待清理 {{ data.remaining }} 张。</p><p v-if="data.ended_at">赛季已结束。清理状态：{{ labels[data.cleanup_status] }}</p><p>仅清理网站使用的本赛季学籍截图及历次提交副本；审核记录、比赛图片和已有备份保留。</p>
    <template v-if="!data.ended_at || data.remaining"><label>输入赛季名称确认<input v-model="name" :disabled="busy" autocomplete="off"></label><button type="button" :disabled="busy||name!==data.season.season_name" @click="clean">{{ busy?'正在逐项清理…':data.ended_at?'重试清理剩余材料':'确认结束赛季并清理截图' }}</button></template>
    <p v-if="done" role="status">{{ data.remaining?'部分材料未清理，请查看失败记录并重试。':'本赛季在线学籍材料已全部清理。' }}</p>
    <details v-if="data.events.length"><summary>查看清理操作记录</summary><ul><li v-for="e in data.events" :key="e.id">{{ e.created_at }} · 管理员 #{{ e.actor_admin_id }} · {{ operations[e.operation] }}{{ e.file_id?' · 材料 #'+e.file_id:'' }}<p v-if="e.message">{{ e.message }}</p></li></ul></details>
  </template>
</section></template>
<script setup>
import {ref,watch} from 'vue'
import api from '../api/http'
const props=defineProps({seasonId:{type:String,required:true}}),emit=defineEmits(['ended','busy'])
const data=ref(null),busy=ref(false),error=ref(''),name=ref(''),done=ref(false);let seq=0
const labels={not_requested:'未请求',pending:'清理中／可重试',failed:'有失败项',complete:'已完成'},operations={end_season:'确认结束赛季',retry:'重试清理',cleaned:'已清理',failed:'清理失败'}
async function load(){const n=++seq;error.value='';try{const r=await api.get(`/player-admin/season-settings/${props.seasonId}/cleanup`);if(n===seq)data.value=r.data}catch(e){if(n===seq)error.value=e.response?.data?.message||'读取失败'}}
async function clean(){busy.value=true;emit('busy',true);error.value='';try{const r=await api.post(`/player-admin/season-settings/${props.seasonId}/cleanup`,{confirm_season_name:name.value},{headers:{'If-Match':String(data.value.revision)},timeout:300000});data.value=r.data;done.value=true;emit('ended')}catch(e){error.value=e.response?.data?.message||'连接中断，可刷新后安全重试';await load();emit('ended')}finally{busy.value=false;emit('busy',false)}}
watch(()=>props.seasonId,()=>{seq++;data.value=null;name.value='';error.value='';done.value=false})
</script>
<style scoped>
@layer legacy {
.season-cleanup{margin-top:28px;border-top:1px solid #dce5ee;padding-top:24px;font-size:14px}.season-cleanup p{line-height:1.8}.season-cleanup input{display:block;padding:10px;width:100%;box-sizing:border-box;margin:8px 0 16px}.season-cleanup button{padding:10px;border:1px solid #bccde0;border-radius:6px;color:#254e79;background:white;cursor:pointer}.season-cleanup button:disabled{opacity:.5}.season-cleanup details{margin-top:20px}.season-cleanup li{margin:10px 0;overflow-wrap:anywhere}.error{color:#a52d26}
}
</style>
