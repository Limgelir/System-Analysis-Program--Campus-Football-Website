<template><div class="ui-app"><AppShell v-if="$route.meta.requiresAuth || ($studioEnabled && $route.path !== '/glass-preview')" :role="admin ? '管理员端' : '裁判端'" :home="$route.meta.requiresAuth ? (admin ? '/admin-dashboard' : '/referee-dashboard') : '/'" :groups="groups"><RouterView :key="$route.path" /></AppShell><RouterView v-else /></div></template>
<script>
import AppShell from '../../shared-ui/AppShell.vue'
const adminGroups = [
  {title:'赛事工作',items:[{label:'待处理工作台',to:'/admin-dashboard'},{label:'裁判选派',to:'/admin-assignments'},{label:'赛程管理',to:'/admin-schedule',match:r=>r.path.startsWith('/admin-schedule')},{label:'赛季设置',to:'/admin-seasons'},{label:'红黄牌与停赛',to:'/admin-discipline'},{label:'正式球队与名单',to:'/admin-teams'}]},
  {title:'资格与申请',items:[{label:'裁判赛季注册',to:'/admin-season-registrations'},{label:'球员学籍审核',to:'/admin-player-registrations'},{label:'球员修改学院审核',to:'/admin-player-college-changes'},{label:'球队报名与变更',to:'/admin-team-applications'}]},
  {title:'人员管理',items:[{label:'裁判账号',to:'/admin-referees',match:r=>r.path==='/admin-referees'||r.path.startsWith('/admin-referee/')},{label:'非系统裁判',to:'/admin-external-referees'},{label:'球员账号',to:'/admin-players'}]}
]
const refereeGroups = [{title:'我的赛季',items:[{label:'裁判首页',to:'/referee-dashboard',match:r=>r.path==='/referee-dashboard'&&!r.hash},{label:'赛季注册',to:'/referee-dashboard#season-registration'},{label:'选派报名',to:'/referee-signups'}]},{title:'我的执法',items:[{label:'执法与报告',to:'/referee-dashboard#assignments',match:r=>r.hash==='#assignments'||r.path.startsWith('/referee-report/')},{label:'个人统计',to:'/referee-stats'},{label:'账号设置',to:'/referee-dashboard#settings'}]}]
export default {components:{AppShell},computed:{admin(){return this.$route.meta.role==='admin'||this.$route.path==='/admin-login'},groups(){return !this.$route.meta.requiresAuth ? [{title:'校园足球',items:[{label:'欢迎首页',to:'/'},{label:'裁判登录',to:'/referee-login'},{label:'管理员登录',to:'/admin-login'},{label:'注册裁判账号',to:'/referee-register'}]}] : this.admin?adminGroups:refereeGroups}}}
</script>
