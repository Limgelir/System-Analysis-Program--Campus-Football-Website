<template><section class="discipline-notice" aria-label="本场停赛名单">
  <h3>双方停赛名单</h3><p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
  <p v-else-if="!data">正在读取停赛名单…</p>
  <template v-else><p v-if="data.completed">本场已有正式报告。停赛预测显示在后续比赛中，执行记录可由管理员在红黄牌与停赛页面查看。</p><p v-else-if="!data.configured">本赛事尚未设置停赛规则，请联系管理员。</p>
    <template v-else><p class="hint">根据当前正式报告和未完成赛程顺序预计；前场未提交报告、改期或报告更正可能改变名单，请赛前刷新核对。</p>
      <p v-if="data.needs_review" class="error">本场球队有停赛执行异常，请管理员核对。</p>
      <div v-for="team in data.teams" :key="team.id"><strong>{{ team.name }}</strong>
        <p v-if="!data.suspensions.some(p=>p.team_id===team.id)">当前预计无停赛球员</p>
        <p v-for="p in data.suspensions.filter(p=>p.team_id===team.id)" :key="p.key">{{ p.jersey_number }}号 {{ p.player_name }} · {{ p.reason }} · 本场前剩余 {{ p.remaining_before }} 场</p>
      </div><button @click="load">刷新停赛名单</button>
    </template>
  </template>
</section></template>
<script setup>
import {ref,watch,onUnmounted} from 'vue'
import api from '../api/http'
const props=defineProps({scheduleId:[Number,String]});const data=ref(null),error=ref('');let sequence=0
async function load(){if(!props.scheduleId)return;const n=++sequence;error.value='';try{const r=await api.get(`/competitions/matches/${props.scheduleId}/discipline`);if(n===sequence)data.value=r.data}catch(e){if(n===sequence)error.value=e.response?.data?.message||'停赛名单读取失败'}}
watch(()=>props.scheduleId,()=>{data.value=null;load()},{immediate:true});onUnmounted(()=>sequence++)
</script>
<style scoped>.discipline-notice{margin:20px 0;padding:20px;border:1px solid #d2deeb;border-radius:12px;background:#f7faff}.discipline-notice h3{margin-bottom:12px}.discipline-notice p{margin:8px 0;line-height:1.7}.hint{font-size:13px;color:#526477}.error{color:#a52d26}.discipline-notice button{padding:8px 12px;margin-top:8px}</style>
