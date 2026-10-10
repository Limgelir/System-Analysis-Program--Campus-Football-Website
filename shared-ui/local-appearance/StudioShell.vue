<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import StudioIcon from './StudioIcon.vue'
import './studio.css'

const props = defineProps({ role: String, home: { type: String, default: '/' }, groups: { type: Array, default: () => [] } })
const route = useRoute(), menuOpen = ref(false), menuButton = ref(null)
watch(() => route.fullPath, () => { menuOpen.value = false })
function closeMenu() { menuOpen.value = false; menuButton.value?.focus() }
function isCurrent(item) { return item.match ? item.match(route) : route.path === item.to.split('#')[0] && route.hash === (item.to.includes('#') ? '#' + item.to.split('#')[1] : '') }
function iconFor(item) {
  if (/首页|主页|工作台/.test(item.label)) return 'home'
  if (/设置|账号/.test(item.label)) return 'settings'
  if (/统计/.test(item.label)) return 'chart'
  if (/赛程|赛季/.test(item.label)) return 'calendar'
  if (/审核|学籍|资格|停赛/.test(item.label)) return 'shield'
  if (/球队|人员|裁判/.test(item.label)) return 'users'
  return 'list'
}
const dock = computed(() => {
  if (props.home === '/admin-dashboard') return [{label:'工作台',to:props.home,icon:'home'}, {label:'赛程管理',to:'/admin-schedule',icon:'calendar'}, {label:'裁判选派',to:'/admin-assignments',icon:'plus'}]
  if (props.home === '/referee-dashboard') return [{label:'回到首页',to:props.home,icon:'home'}, {label:'我的比赛',to:props.home+'#assignments',icon:'list'}, {label:'选派报名',to:'/referee-signups',icon:'plus'}]
  if (props.home === '/dashboard') return [{label:'我的主页',to:props.home,icon:'home'}, {label:'球队与赛程',to:'/public',icon:'calendar'}, {label:'球队报名',to:'/team-applications',icon:'plus'}]
  return props.groups.flatMap(group => group.items).slice(0, 3).map(item => ({...item,icon:iconFor(item)}))
})
</script>

<template>
  <div class="studio-shell" :class="{ 'studio-has-navigation': groups.length }">
    <a class="skip-link" href="#page-content">跳到主要内容</a>
    <header class="studio-topbar studio-glass">
      <RouterLink :to="home" class="studio-brand"><img src="/brand-logo.png" alt="同济大学校徽"><span>同济校园足球<small>{{ role }}</small></span></RouterLink>
      <div class="studio-account"><slot name="account" /></div>
      <button v-if="groups.length" ref="menuButton" class="studio-menu" :aria-expanded="menuOpen" aria-controls="role-navigation" @click="menuOpen = !menuOpen"><StudioIcon name="list" /><span>{{ menuOpen ? '收起' : '导航' }}</span></button>
    </header>
    <div class="studio-workspace">
      <aside v-if="groups.length" id="role-navigation" class="studio-sidebar" :class="{ 'is-open': menuOpen }" @keydown.esc="closeMenu">
        <nav :aria-label="role + '导航'">
          <section v-for="group in groups" :key="group.title"><p class="studio-nav-label">{{ group.title }}</p><RouterLink v-for="item in group.items" :key="item.to" :to="item.to" :class="{ 'is-current': isCurrent(item) }" :aria-current="isCurrent(item) ? 'page' : undefined"><StudioIcon :name="iconFor(item)"/><span>{{ item.label }}</span></RouterLink></section>
        </nav>
      </aside>
      <main id="page-content" class="studio-content" tabindex="-1"><slot /></main>
    </div>
    <nav v-if="dock.length" class="studio-dock studio-glass" aria-label="底部快捷导航"><RouterLink v-for="(item,index) in dock" :key="item.to" :to="item.to" :class="{ 'dock-primary': index === dock.length - 1, 'is-current': isCurrent(item) }" :aria-current="isCurrent(item) ? 'page' : undefined"><StudioIcon :name="item.icon"/><span>{{ item.label }}</span></RouterLink></nav>
  </div>
</template>
