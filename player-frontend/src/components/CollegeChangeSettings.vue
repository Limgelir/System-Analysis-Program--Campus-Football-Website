<template>
  <section class="card college-change-settings">
    <div class="college-heading"><h2>修改学院</h2><button class="secondary" :disabled="busy || loading" @click="refresh">刷新申请状态</button></div>
    <p class="field-help">修改学院需上传1系统信息截图，经管理员审核通过后生效。待审核、退回或撤回时仍使用原学院，已有学籍资格和球队记录保留。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="success" class="notice" role="status">{{ success }}</p>
    <p v-if="loading && !data" class="muted">正在加载学院及申请记录…</p>
    <template v-if="data">
      <p class="old-college">原学院（当前生效）：<strong>{{ data.account.college || '未填写' }}</strong></p>
      <p v-if="!colleges.includes(data.account.college)" class="notice college-legacy">你的学院尚未匹配，请选择新学院并上传截图申请审核。原填写：{{ data.account.college || '未填写' }}</p>
      <div v-if="data.pending" class="notice pending-college" role="status"><strong>学院修改待审核</strong><p>{{ data.pending.old_college || '未填写' }} → {{ data.pending.new_college }}</p><button class="secondary" :disabled="busy || loading" @click="withdraw">撤回学院申请</button></div>
      <form v-else ref="formElement" v-draft="{ value: { newCollege, selected }, resetKey: formVersion }" @submit.prevent="submit">
        <label>新学院<CollegeSelect v-model="newCollege" label="新学院" :disabled="busy || loading" /></label>
        <AcademicScreenshotExample/>
        <label for="college-change-file">1系统学籍信息截图</label><input id="college-change-file" ref="fileInput" type="file" accept="image/jpeg,image/png" :disabled="busy || loading" required @change="selectFile">
        <p class="field-help">每次提交一张 JPG/PNG 图片，不超过5MB。截图仅本人和管理员可查看。</p>
        <img v-if="preview" class="local-preview" :src="preview" alt="待提交学院修改截图预览">
        <button class="primary" :disabled="busy || loading || !selected || !newCollege || newCollege === data.account.college">{{ busy ? '正在提交…' : '提交学院修改审核' }}</button>
      </form>
      <div v-if="data.items.length" class="college-history"><h3>学院修改记录</h3><ul><li v-for="item in data.items" :key="item.id"><strong>{{ labels[item.status] }}</strong> · {{ time(item.submitted_at) }}<p>{{ item.old_college || '未填写' }} → {{ item.new_college }}</p><p v-if="item.review_reason">审核说明：{{ item.review_reason }}</p><button class="secondary" :disabled="busy" @click="open(item.id)">查看申请详情</button></li></ul>
        <div class="history-pages"><button class="secondary" :disabled="busy || loading || page <= 1" @click="page--; load()">上一页</button><span>共 {{ data.pagination.total }} 条 · 第 {{ page }} 页</span><button class="secondary" :disabled="busy || loading || page >= data.pagination.total_pages" @click="page++; load()">下一页</button></div>
      </div>
      <div v-if="detail" class="college-detail"><h3>学院修改申请详情</h3><p>{{ labels[detail.change.status] }} · {{ detail.change.old_college || '未填写' }} → {{ detail.change.new_college }}</p><AcademicImage :source-path="`/college-changes/${detail.change.id}/image`"/><ol><li v-for="event in detail.events" :key="event.id">{{ operations[event.operation] }} · {{ time(event.created_at) }} · {{ event.actor_admin_id ? '管理员 #' + event.actor_admin_id : '本人' }}<p v-if="event.reason">{{ event.reason }}</p></li></ol><button class="secondary" @click="detail = null; detailSequence++">关闭申请详情</button></div>
    </template>
  </section>
</template>
<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { api, session, messageOf } from '../session'
import { confirmDraftLeave } from '../../../shared-ui/interaction.js'
import CollegeSelect from '../../../shared-ui/CollegeSelect.vue'
import AcademicScreenshotExample from '../../../shared-ui/AcademicScreenshotExample.vue'
import AcademicImage from './AcademicImage.vue'
import catalog from '../../../shared-data/colleges.json'
const colleges=catalog.map(c=>c.name),data=ref(null),detail=ref(null),page=ref(1),busy=ref(false),loading=ref(false),error=ref(''),success=ref('')
const newCollege=ref(''),selected=ref(null),preview=ref(''),fileInput=ref(null),formElement=ref(null),formVersion=ref(0)
const labels={pending:'待审核',approved:'已通过',returned:'已退回',withdrawn:'已撤回'},operations={submitted:'提交申请',approved:'审核通过',returned:'退回补正',withdrawn:'撤回申请'}
const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—'
let requestKey='',sequence=0,detailSequence=0
watch([newCollege,selected,()=>data.value?.account.revision],()=>{requestKey=''}, {flush:'sync'})
function clearFile(){if(preview.value)URL.revokeObjectURL(preview.value);preview.value='';selected.value=null;if(fileInput.value)fileInput.value.value=''}
function selectFile(e){clearFileSelection();error.value='';const file=e.target.files?.[0];if(!file)return;if(!['image/jpeg','image/png'].includes(file.type)||file.size>5*1024*1024){error.value='请提供不超过5MB的 JPG/PNG 图片。';e.target.value='';return}selected.value=file;preview.value=URL.createObjectURL(file)}
function clearFileSelection(){if(preview.value)URL.revokeObjectURL(preview.value);preview.value='';selected.value=null}
async function load(){const n=++sequence;loading.value=true;try{const value=await api.get('/college-changes/current',{params:{page:page.value}});if(n!==sequence)return;data.value=value;Object.assign(session.player,value.account)}catch(e){if(n===sequence)error.value=messageOf(e)}finally{if(n===sequence)loading.value=false}}
async function refresh(){if(!confirmDraftLeave(formElement.value))return;clearFile();newCollege.value='';formVersion.value++;detail.value=null;detailSequence++;error.value='';success.value='';await load()}
async function submit(){if(!selected.value)return;busy.value=true;error.value='';success.value='';const form=new FormData();form.append('new_college',newCollege.value);form.append('account_revision',String(data.value.account.revision));form.append('academic_image',selected.value);requestKey ||= crypto.randomUUID();try{const result=await api.post('/college-changes',form,{headers:{'Idempotency-Key':requestKey}});data.value.pending=result.change;detail.value=null;clearFile();newCollege.value='';formVersion.value++;success.value='学院修改申请已提交，审核通过前仍使用原学院。';page.value=1;await load()}catch(e){error.value=messageOf(e)}finally{busy.value=false}}
async function withdraw(){if(!window.confirm('确认撤回学院修改申请？撤回后可重新选择学院并上传截图。'))return;busy.value=true;error.value='';success.value='';try{await api.post(`/college-changes/${data.value.pending.id}/withdraw`,{}, {headers:{'If-Match':String(data.value.pending.revision)}});detail.value=null;success.value='学院修改申请已撤回。';page.value=1;await load()}catch(e){error.value=messageOf(e)}finally{busy.value=false}}
async function open(id){const n=++detailSequence;detail.value=null;error.value='';try{const value=await api.get(`/college-changes/${id}`);if(n===detailSequence)detail.value=value}catch(e){if(n===detailSequence)error.value=messageOf(e)}}
onMounted(load);onBeforeUnmount(()=>{sequence++;detailSequence++;clearFile()})
</script>
<style scoped>
.college-change-settings{grid-column:1/-1;min-width:0}.college-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.college-heading h2{margin:0}.college-change-settings form{max-width:850px}.college-change-settings p,.college-history li{overflow-wrap:anywhere;white-space:pre-wrap}.college-history ul{list-style:none;padding:0}.college-history li{padding:16px 0;border-top:1px solid #dbe3ed}.college-detail{padding-top:20px;border-top:1px solid #dbe3ed}.history-pages{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.local-preview{display:block;width:100%;max-height:400px;object-fit:contain;margin-bottom:16px}.college-change-settings input[type=file]{width:100%;min-width:0}.college-detail li{padding:8px 0}@media(max-width:600px){.college-heading{align-items:flex-start;flex-direction:column}}
</style>
