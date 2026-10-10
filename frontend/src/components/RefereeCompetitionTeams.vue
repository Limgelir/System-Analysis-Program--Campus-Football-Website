<template>
  <section class="membership" v-draft="{value:{choice,selected},dirty:editing}">
    <p v-if="loading">正在读取参队信息…</p>
    <p v-if="error" role="alert">{{error}} <button :disabled="busy" @click="load">重新读取</button></p>
    <template v-if="data&&!loading">
      <div class="summary"><strong>已参加该赛事队伍：{{data.confirmed?(names||'未参加队伍'):'尚未填写'}}</strong><button v-if="!editing" @click="editing=true">修改参队信息</button></div>
      <form v-if="editing" @submit.prevent="save">
        <fieldset :disabled="busy"><legend>你是否已报名参加本赛事的队伍？</legend>
          <label><input v-model="choice" type="radio" value="no">未参加</label><label><input v-model="choice" type="radio" value="yes">已参加（可多选，数量不限）</label>
          <div v-if="choice==='yes'" class="team-choices"><label v-for="team in data.teams" :key="team.id"><input v-model="selected" type="checkbox" :value="team.id">{{team.team_name}}</label><p v-if="!data.teams.length">本赛事暂无可选队伍。</p></div>
        </fieldset>
        <p>仅供管理员统计；不会限制报名或选派。保存后会记住你的选择，下次可直接修改。</p>
        <button type="submit" :disabled="busy||!choice||(choice==='yes'&&!selected.length)">{{busy?'保存中…':'保存参队信息'}}</button>
        <button v-if="data.confirmed" type="button" :disabled="busy" @click="reset">取消修改</button>
      </form>
    </template>
  </section>
</template>
<script setup>
import {ref,computed,watch} from 'vue'
import {matchSignupAPI} from '../api/index.js'
const props=defineProps({competitionId:Number}),emit=defineEmits(['ready'])
const data=ref(null),choice=ref(''),selected=ref([]),loading=ref(false),busy=ref(false),error=ref(''),editing=ref(false)
let sequence=0
const names=computed(()=>data.value?.team_ids.map(id=>data.value.teams.find(t=>t.id===id)?.team_name||'已移除队伍 #'+id).join('、'))
function reset(){choice.value=data.value.confirmed?(data.value.team_ids.length?'yes':'no'):'';selected.value=[...data.value.team_ids];editing.value=!data.value.confirmed}
async function load(){const id=++sequence;loading.value=true;error.value='';emit('ready',false);try{const r=await matchSignupAPI.membership(props.competitionId);if(id!==sequence)return;data.value=r.data;reset();emit('ready',data.value.confirmed)}catch(e){if(id===sequence)error.value=e.response?.data?.message||'参队信息读取失败'}finally{if(id===sequence)loading.value=false}}
async function save(){if(busy.value)return;busy.value=true;error.value='';try{const r=await matchSignupAPI.saveMembership(props.competitionId,{revision:data.value.revision,team_ids:choice.value==='yes'?selected.value:[]});data.value=r.data;reset();emit('ready',true)}catch(e){error.value=e.response?.data?.message||'参队信息保存失败'}finally{busy.value=false}}
watch(()=>props.competitionId,load,{immediate:true})
</script>
<style scoped>
.membership{background:#edf4fc;border:1px solid #b8cde5;border-radius:12px;padding:18px;margin:20px 0}.summary{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.membership fieldset{border:0;padding:12px 0}.membership label{display:inline-flex;align-items:center;gap:7px;min-height:44px;margin-right:18px}.membership input{width:18px;height:18px}.membership p{color:#52657a}.membership button{width:auto;padding:10px 16px;margin:0 10px 0 0}.team-choices{display:flex;flex-wrap:wrap;gap:8px;padding:12px;background:white;border-radius:8px}.team-choices label{margin:0;padding:0 10px}
</style>
