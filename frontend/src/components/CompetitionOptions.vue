<template>
  <option v-if="loading" disabled>正在读取赛事…</option>
  <option v-else-if="error" disabled>{{ error }}</option>
  <option v-else-if="!items.length" disabled>请先在赛季设置中添加赛事</option>
  <option v-for="item in items" :key="item.id" :value="item.league_type">{{ item.league_type }}</option>
</template>
<script setup>
import { ref, watch } from 'vue'
import api from '../api/http'
const props=defineProps({seasonId:[String,Number]})
const items=ref([]),loading=ref(false),error=ref('');let sequence=0
watch(()=>props.seasonId,async id=>{const n=++sequence;items.value=[];error.value='';loading.value=true
  try{const r=await api.get('/competitions',{params:{season_id:id||undefined}});if(n===sequence)items.value=r.data.competitions}
  catch(e){if(n===sequence)error.value=e.response?.data?.message||'赛事读取失败，请刷新'}finally{if(n===sequence)loading.value=false}
},{immediate:true})
</script>
