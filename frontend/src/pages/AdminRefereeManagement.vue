<template>
  <div class="account-page">
    <header class="header-bar admin-header"><div><h1>裁判账号管理</h1><p>长期账号与赛季资格分开管理；有历史记录的账号请停用。</p></div><nav><button @click="$router.push('/admin-season-registrations')">赛季注册裁判</button><button @click="$router.push('/admin-dashboard')">返回管理员首页</button></nav></header>
    <main>
      <div v-if="error" class="alert error" role="alert">{{ error }}</div><div v-if="success" class="alert success" role="status">{{ success }}</div>
      <section class="stats"><div>账号总数 <strong>{{ summary.total_accounts }}</strong></div><div>已启用 <strong>{{ summary.active_accounts }}</strong></div><div>已停用 <strong>{{ summary.inactive_accounts }}</strong></div></section>
      <section class="card">
        <form class="filters" @submit.prevent="search"><label>姓名或学号<input v-model="query" maxlength="100" placeholder="输入姓名或学号"></label><label>账号状态<select v-model="active"><option value="">全部</option><option value="1">启用</option><option value="0">停用</option></select></label><button :disabled="loading">查询</button><button type="button" @click="clearFilters">清空筛选</button><button type="button" :disabled="exporting || loading" @click="exportAccounts">{{ exporting?'导出中…':'导出筛选账号' }}</button><button type="button" @click="createVisible=!createVisible">{{createVisible?'收起新增':'新增裁判账号'}}</button></form>
        <div v-if="loading" role="status">正在加载账号…</div><p v-else-if="!referees.length">没有符合条件的账号。</p>
        <div v-else class="table-scroll"><p>当前赛季：{{ currentSeason?.season_name || '未启用赛季' }}</p><table><thead><tr><th>姓名</th><th>学号</th><th>级别</th><th>账号状态</th><th>是否在上海足协注册</th><th>当前赛季注册状态</th><th>执法经历</th><th>操作</th></tr></thead><tbody><tr v-for="r in referees" :key="r.id"><td>{{r.name}}</td><td>{{r.student_id}}</td><td>{{r.grade}}</td><td>{{r.is_active?'启用':'停用'}}{{r.must_change_password?' · 待改密':''}}</td><td>{{r.shanghai_fa_registered?'是':'否'}}</td><td>{{r.season_registration_label}}</td><td>{{r.match_types.join('、')}}</td><td><button @click="$router.push({path:`/admin-referee/${r.id}`,query:$route.query})">详情</button></td></tr></tbody></table></div>
        <ListPagination :pagination="pagination" :loading="loading" @page="changePage" @size="changeSize" />
      </section>
      <section v-if="createVisible" class="card"><h2>新增裁判账号</h2><p>生成一次性显示的随机临时密码；首次登录必须改密。账号创建不会自动取得赛季资格。</p>
        <form v-draft="{ value: { form, photo } }" class="create-form" @submit.prevent="createAccount">
          <label>学号<input v-model.trim="form.student_id" required maxlength="20"></label><label>姓名<input v-model.trim="form.name" required maxlength="100"></label>
          <label>当前级别<select v-model="form.grade"><option v-for="g in grades" :key="g">{{g}}</option></select></label><label>目标级别<select v-model="form.target_level"><option v-for="g in grades" :key="g">{{g}}</option></select></label>
          <label>升入当前级别时间{{ form.grade === '裁判学员' ? '（选填）' : ' *' }}<input v-model="form.level_promoted_at" type="date" :required="form.grade !== '裁判学员'"></label><label>性别<select v-model="form.gender"><option>男</option><option>女</option><option>其他</option></select></label>
          <label>学院<input v-model.trim="form.college" required maxlength="100"></label><label>身高（cm）<input v-model="form.height_cm" type="number" min="1" max="300" required></label><label>体重（kg）<input v-model="form.weight_kg" type="number" min="1" max="500" step="0.1" required></label>
          <fieldset><legend>执法经历</legend><label v-for="t in types" :key="t"><input v-model="form.match_types" type="checkbox" :value="t">{{t}}</label></fieldset><label>证件照<input type="file" accept="image/jpeg,image/png" required @change="photo=$event.target.files[0]"></label>
          <button :disabled="creating">{{creating?'创建中…':'创建账号'}}</button>
        </form>
      </section>
      <section v-if="temporaryPassword" class="card credential" role="status"><h2>请单独交付临时密码</h2><p>账号：{{createdStudentId}}</p><code>{{temporaryPassword}}</code><p>关闭后不会再次显示；丢失请在账号详情重置。不要公开截图或加入导出文件。</p><button @click="temporaryPassword=''">已记录，隐藏密码</button></section>
    </main>
  </div>
</template>
<script>
import {adminAPI} from '../api'
import ListPagination from '../components/ListPagination.vue'
import {REFEREE_GRADES} from '../constants/refereeOptions'
import {downloadBlob,exportError} from '../utils/download'
const emptyForm=()=>({student_id:'',name:'',grade:'三级',target_level:'二级',level_promoted_at:'',gender:'男',college:'',height_cm:'',weight_kg:'',match_types:[]})
export default {
  name:'AdminRefereeManagement',components:{ListPagination},
  data(){return {currentSeason:null,referees:[],summary:{total_accounts:0,active_accounts:0,inactive_accounts:0},pagination:{page:1,page_size:20,total:0,total_pages:0},query:'',active:'',loading:false,exporting:false,error:'',success:'',requestId:0,createVisible:false,form:emptyForm(),photo:null,creating:false,temporaryPassword:'',createdStudentId:'',grades:REFEREE_GRADES,types:['院内赛','足协杯','大联赛','新生杯','区级及以上比赛']}},
  mounted(){this.loadReferees()},watch:{'$route.query'(){this.loadReferees()}},beforeUnmount(){this.requestId++;this.temporaryPassword=''},
  methods:{
    search(){this.$router.replace({query:{...this.$route.query,query:this.query||undefined,is_active:this.active||undefined,page:undefined}})},
    clearFilters(){this.query='';this.active='';this.$router.replace({query:{}})},
    changePage(page){this.$router.replace({query:{...this.$route.query,page:String(page)}})},
    changeSize(size){this.$router.replace({query:{...this.$route.query,page:undefined,page_size:String(size)}})},
    async loadReferees(){const id=++this.requestId;this.loading=true;this.error='';this.query=this.$route.query.query||'';this.active=this.$route.query.is_active||'';
      try{const r=await adminAPI.getAllReferees(this.$route.query);if(id!==this.requestId)return;this.referees=r.data||[];this.pagination=r.meta.pagination;this.summary=r.meta.summary;this.currentSeason=r.meta.current_season;}
      catch(e){if(id===this.requestId){this.referees=[];this.error=e.response?.data?.message||e.message}}
      finally{if(id===this.requestId)this.loading=false}},
    async exportAccounts(){if(this.exporting)return;this.exporting=true;try{downloadBlob(await adminAPI.exportReferees(this.$route.query),'裁判账号-筛选结果.csv')}catch(e){this.error=await exportError(e)}finally{this.exporting=false}},
    async createAccount(){if(this.creating)return;this.error='';this.success='';this.temporaryPassword='';this.creating=true;
      try{if(!this.form.match_types.length)throw new Error('请至少选择一种执法经历');const data=new FormData();for(const[k,v]of Object.entries(this.form))data.append(k,Array.isArray(v)?JSON.stringify(v):v);data.append('id_photo',this.photo);const r=await adminAPI.createReferee(data);this.temporaryPassword=r.data.temporary_password;this.createdStudentId=r.data.student_id;this.createVisible=false;this.form=emptyForm();this.photo=null;await this.loadReferees();this.success='账号创建成功，请交付下方临时密码。';}
      catch(e){this.error=e.response?.data?.message||e.message}finally{this.creating=false}}
  }
}
</script>
<style scoped>
@layer legacy {

.account-page{min-height:100vh;background:#f5f7fb}.header-bar{background:#1f3b73;color:white;padding:20px 28px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}h1{font-size:24px;margin:0}header p{font-size:13px;color:#dbeafe}nav{display:flex;gap:8px;flex-wrap:wrap}main{max-width:1280px;margin:auto;padding:24px;min-width:0}.card,.stats>div{background:white;padding:20px;border-radius:10px;margin-bottom:18px}.stats{display:flex;gap:16px;flex-wrap:wrap}.stats strong{font-size:25px;margin-left:20px;color:#1f3b73}.filters,.create-form{display:flex;align-items:end;gap:12px;flex-wrap:wrap}label{display:flex;flex-direction:column;gap:6px;color:#334155}input,select,button{border:1px solid #cbd5e1;border-radius:6px;padding:9px 12px;font:inherit;background:white;color:#1f3b73;max-width:100%;box-sizing:border-box}button{cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}.table-scroll{overflow-x:auto;margin-top:16px}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #e2e8f0;white-space:nowrap}th{background:#f8fafc}.create-form fieldset{border:1px solid #cbd5e1}.create-form fieldset label{display:inline-flex;flex-direction:row;margin:6px}.credential{border:2px solid #d97706}.credential code{overflow-wrap:anywhere;font-size:20px}@media(max-width:600px){main{padding:12px}.header-bar{padding:16px}.filters label,.create-form>label{width:100%}}

}
</style>
