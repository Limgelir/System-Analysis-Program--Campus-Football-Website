<template>
  <section class="history-panel">
    <h3>报告版本与操作历史</h3>
    <p>每次保存、提交、退回、修订和图片操作均追加记录。提交与管理员修订生成新版本；历史只读。旧报告仅保留升级时可证明的内容。</p>
    <div class="history-actions">
      <button @click="openHistory('main')" :disabled="loading">查看裁判员区历史</button>
      <button v-if="supervisorRequired" @click="openHistory('supervisor')" :disabled="loading">查看裁判监督区历史</button>
      <button v-if="section" @click="close" :disabled="loading">收起历史</button>
    </div>
    <p v-if="error" class="history-error" role="alert">{{ error }}</p>
    <p v-if="loading">正在读取历史…</p>
    <template v-if="section">
      <h4>{{ section === 'main' ? '裁判员区' : '裁判监督区' }} · {{ total }} 条操作记录</h4>
      <p v-if="!loading && !items.length">暂无操作历史</p>
      <ol class="entries">
        <li v-for="entry in items" :key="entry.id">
          <strong>V{{ entry.version_no }} · {{ operationLabel(entry.operation) }}</strong>
          <span> · {{ date(entry.created_at) }} · {{ entry.actor_name_snapshot || '系统保留旧基线（不是原始提交人）' }} · {{ sourceLabel(entry.source_type) }}</span>
          <p v-if="entry.reason">原因：{{ entry.reason }}</p>
          <button @click="viewEntry(entry.id)" :disabled="detailLoading">查看前后内容</button>
        </li>
      </ol>
      <div class="history-actions"><button @click="loadPage(page-1)" :disabled="loading || page<=1">上一页</button><span>第 {{ page }} / {{ Math.max(1,Math.ceil(total/20)) }} 页</span><button @click="loadPage(page+1)" :disabled="loading || page*20>=total">下一页</button></div>
      <div v-if="detail" class="history-detail">
        <h4>V{{ detail.version_no }} · {{ operationLabel(detail.operation) }} · {{ detail.actor_name_snapshot || '旧基线' }}</h4>
        <p>原因：{{ detail.reason || '普通保存或提交，无管理员修订原因' }}</p>
        <div class="snapshot-grid">
          <div v-for="side in ['before','after']" :key="side" class="snapshot-cell">
            <h4>{{ side === 'before' ? '操作前' : '操作后' }}</h4>
            <ReportSnapshot :snapshot="detail[`${side}_snapshot`]" />
            <button v-if="detail[`${side}_snapshot`]?.data?.fourth_official_image_path" @click="loadImage(side)" :disabled="imageLoading">查看{{ side === 'before' ? '操作前' : '操作后' }}图片</button>
            <img v-if="imageUrls[side]" :src="imageUrls[side]" :alt="`${side === 'before' ? '操作前' : '操作后'}第四官员记录单历史图片`" />
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script>
import {reportAPI,fileAPI} from '../api'
import ReportSnapshot from './ReportSnapshot.vue'
export default {
  components:{ReportSnapshot},
  props:{scheduleId:{type:Number,required:true},supervisorRequired:{type:Boolean,default:true}},
  data(){return {section:null,page:1,total:0,items:[],loading:false,error:'',detail:null,detailLoading:false,imageLoading:false,imageUrls:{},requestId:0,detailRequestId:0}},
  beforeUnmount(){this.requestId++;this.detailRequestId++;this.clearImages()},
  methods:{
    operationLabel(op){return ({baseline:'升级基线',save:'保存草稿',submit:'提交',return:'管理员退回',revise:'管理员修订',upload_image:'上传/替换图片',remove_image:'移除当前图片'})[op] || op},
    sourceLabel(source){return ({legacy:'历史基线',referee:'裁判本人',admin_proxy:'管理员代填',admin_revision:'管理员退回/修订'})[source] || source},
    date(value){return value?new Date(value).toLocaleString('zh-CN'):'-'},
    clearImages(){Object.values(this.imageUrls).forEach(url=>URL.revokeObjectURL(url));this.imageUrls={}},
    close(){this.requestId++;this.detailRequestId++;this.section=null;this.detail=null;this.detailLoading=false;this.imageLoading=false;this.clearImages()},
    async openHistory(section){this.section=section;this.detail=null;this.detailRequestId++;this.detailLoading=false;this.imageLoading=false;this.clearImages();await this.loadPage(1)},
    async loadPage(page){
      const requestId=++this.requestId;this.loading=true;this.error=''
      try{const response=await reportAPI.getHistory(this.scheduleId,this.section,page);if(requestId!==this.requestId)return;const data=response.data;this.items=data.items;this.page=data.page;this.total=data.total}
      catch(error){if(requestId===this.requestId)this.error=error?.response?.data?.message||'读取历史失败，请重试'}
      finally{if(requestId===this.requestId)this.loading=false}
    },
    async viewEntry(id){
      const requestId=++this.detailRequestId;this.detailLoading=true;this.clearImages();this.detail=null;this.error=''
      try{const response=await reportAPI.getHistoryDetail(this.scheduleId,id);if(requestId===this.detailRequestId)this.detail=response.data}
      catch(error){if(requestId===this.detailRequestId)this.error=error?.response?.data?.message||'读取历史详情失败'}
      finally{if(requestId===this.detailRequestId)this.detailLoading=false}
    },
    async loadImage(side){
      const id=this.detail.id,requestId=this.detailRequestId;this.imageLoading=true;this.error=''
      try{const blob=await fileAPI.getHistoryImage(this.scheduleId,id,side);if(requestId!==this.detailRequestId)return;if(this.imageUrls[side])URL.revokeObjectURL(this.imageUrls[side]);this.imageUrls[side]=URL.createObjectURL(blob)}
      catch(error){if(requestId===this.detailRequestId)this.error='读取历史图片失败，请确认网络或联系管理员检查文件'}
      finally{if(requestId===this.detailRequestId)this.imageLoading=false}
    }
  }
}
</script>

<style scoped>
@layer legacy {

.history-panel{background:#fff;border:1px solid #dbe4f0;border-radius:12px;padding:20px;margin-bottom:20px;color:#1f2937;min-width:0}
.history-panel p{line-height:1.6;overflow-wrap:anywhere}.history-panel h3{margin-top:0}
.history-panel button{width:auto;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;padding:8px 12px;margin:4px 0;cursor:pointer}
.history-panel button:hover{background:#dbeafe}.history-panel button:disabled{opacity:.55;cursor:not-allowed}
.history-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.entries{padding-left:20px}.entries li{padding:12px 0;border-bottom:1px solid #e2e8f0}
.snapshot-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.snapshot-cell{padding:12px;background:#f8fafc;border-radius:8px;min-width:0}.snapshot-cell img{display:block;max-width:100%;height:auto;margin-top:12px}
.history-error{color:#991b1b;background:#fef2f2;padding:10px}.history-detail{margin-top:20px;border-top:2px solid #dbeafe}
@media(max-width:760px){.snapshot-grid{grid-template-columns:1fr}.history-panel{padding:12px}}

}
</style>
