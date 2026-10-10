<template>
  <div class="page-container">
    <header class="header-bar"><h1>非系统裁判名单</h1><button class="btn-secondary" @click="$router.push('/admin-dashboard')">返回工作台</button></header>
    <main class="external-main">
      <p>跨赛季复用的独立名单，无登录账号，不计入裁判账号或当季注册人数；可担任所有裁判岗位，裁判员或裁判监督报告由管理员代填。改名、停用不改变已有比赛的姓名快照。</p>
      <form class="toolbar" @submit.prevent="load(1)"><input v-model="query" type="search" maxlength="100" placeholder="按姓名搜索" /><button class="btn-primary" :disabled="loading">搜索</button><button type="button" class="btn-secondary" @click="edit(null)">新增非系统裁判</button></form>
      <p v-if="error" class="notice error" role="alert">{{ error }}</p><p v-if="success" class="notice" role="status">{{ success }}</p>
      <p>{{ loading ? '读取中…' : '名单总数：' + pagination.total + '（仅当前搜索结果，与账号人数独立）' }}</p>
      <div class="table-wrap"><table><thead><tr><th>编号</th><th>姓名</th><th>备注/来源</th><th>状态</th><th>操作</th></tr></thead>
        <tbody><tr v-for="person in items" :key="person.id"><td>{{ person.id }}</td><td>{{ person.name }}</td><td>{{ person.note || '—' }}</td><td>{{ person.is_active ? '启用' : '停用' }}</td><td><button class="btn-secondary" @click="edit(person)">编辑资料/状态</button></td></tr></tbody>
      </table></div>
      <p v-if="!loading && !items.length">暂无匹配记录。</p>
      <div class="toolbar"><button :disabled="loading || pagination.page <= 1" @click="load(pagination.page - 1)">上一页</button><span>{{ pagination.page }} / {{ Math.max(pagination.total_pages,1) }}</span><button :disabled="loading || pagination.page >= pagination.total_pages" @click="load(pagination.page + 1)">下一页</button></div>
      <div v-if="form" class="external-overlay"><form v-draft="{ value: form }" class="external-dialog" @submit.prevent="save">
        <h2>{{ form.id ? '编辑非系统裁判' : '新增非系统裁判' }}</h2>
        <label>姓名<input v-model="form.name" required maxlength="100" :disabled="saving" /></label>
        <label>备注/来源<input v-model="form.note" maxlength="255" placeholder="可用于区分同名人员" :disabled="saving" /></label>
        <label>状态<select v-model="form.is_active" :disabled="saving"><option :value="true">启用</option><option :value="false">停用</option></select></label>
        <p>停用只阻止今后新选派，不删除历史选派。不会为此人创建登录账号。</p>
        <p v-if="formError" class="notice error" role="alert">{{ formError }}</p>
        <div class="toolbar"><button class="btn-primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button><button type="button" class="btn-secondary" :disabled="saving" @click="form=null">取消</button></div>
      </form></div>
    </main>
  </div>
</template>
<script>
import { officialAPI } from '../api'
export default {
  data: () => ({ query:'',items:[],pagination:{page:1,total:0,total_pages:0},loading:false,error:'',success:'',form:null,formError:'',saving:false,sequence:0 }),
  mounted() { this.load(1) },
  beforeUnmount() { this.sequence++ },
  methods: {
    async load(page) {
      const seq=++this.sequence; this.loading=true; this.error=''
      try { const r=await officialAPI.list({query:this.query.trim(),page}); if(seq!==this.sequence) return; this.items=r.data.items; this.pagination=r.data.pagination }
      catch(e) { if(seq===this.sequence) { this.items=[]; this.error=e.response?.data?.message || e.message } }
      finally { if(seq===this.sequence) this.loading=false }
    },
    edit(person) { this.form={id:person?.id || null,name:person?.name || '',note:person?.note || '',is_active:person ? Boolean(person.is_active) : true}; this.formError=''; this.success='' },
    async save() {
      if(this.saving) return
      this.saving=true; this.formError=''
      const {id,...payload}=this.form
      const write=data => id ? officialAPI.update(id,data) : officialAPI.create(data)
      try {
        try { await write(payload) } catch(e) {
          if(e.response?.data?.code!=='DUPLICATE_NAME_CONFIRMATION_REQUIRED' || !window.confirm(e.response.data.message + '\n确认这是同名的不同人吗？')) throw e
          await write({...payload,confirm_duplicate:true})
        }
        this.form=null; this.success='已保存。历史比赛姓名与原有账号不变。'; await this.load(1)
      } catch(e) { this.formError=e.response?.data?.message || e.message }
      finally { this.saving=false }
    }
  }
}
</script>
<style scoped>
@layer legacy {

.external-main{max-width:1100px;margin:auto;padding:24px}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:16px 0}.toolbar input{flex:1;min-width:160px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}input,select{padding:10px;border:1px solid #b6becb;border-radius:5px;box-sizing:border-box}.notice{padding:12px;background:#e9f8ee;color:#17613b}.notice.error{background:#fff0ed;color:#a82c25}.external-overlay{position:fixed;inset:0;background:#0006;display:grid;place-items:center;z-index:1000;padding:16px}.external-dialog{background:white;border-radius:12px;padding:24px;width:min(480px,100%);max-height:90vh;overflow:auto}.external-dialog label{display:grid;gap:8px;margin-bottom:16px}

}
</style>
