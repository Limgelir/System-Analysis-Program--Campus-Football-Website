<template>
  <StudioShell v-if="$studioEnabled" :role="role" :home="home" :groups="groups"><template #account><slot name="account" /></template><slot /></StudioShell>
  <div v-else class="ui-shell" :class="{ 'has-navigation': groups.length }">
    <a class="skip-link" href="#page-content">跳到主要内容</a>
    <header class="ui-brandbar">
      <RouterLink :to="home" class="ui-brand"><img src="/brand-logo.png" alt="同济大学校徽"><span>同济校园足球<small>{{ role }}</small></span></RouterLink>
      <span class="ui-system-label">赛场上的每一份热爱</span>
      <button v-if="groups.length" ref="menuButton" class="ui-menu-toggle" :aria-expanded="menuOpen" aria-controls="role-navigation" @click="menuOpen = !menuOpen">{{ menuOpen ? '收起导航' : '展开导航' }}</button>
      <slot name="account" />
    </header>
    <div class="ui-workspace">
      <aside v-if="groups.length" id="role-navigation" class="ui-navigation" :class="{ 'is-open': menuOpen }" @keydown.esc="closeMenu">
        <nav :aria-label="role + '导航'">
          <section v-for="group in groups" :key="group.title"><p class="ui-nav-group">{{ group.title }}</p><RouterLink v-for="item in group.items" :key="item.to" :to="item.to" :class="{ 'is-current': isCurrent(item) }" :aria-current="isCurrent(item) ? 'page' : undefined">{{ item.label }}</RouterLink></section>
        </nav>
      </aside>
      <main id="page-content" class="ui-content" tabindex="-1"><slot /></main>
    </div>
    <footer class="ui-footer">同济校园足球 · {{ role }}</footer>
  </div>
</template>
<script>
export default {
  name: 'AppShell',
  props: { role: String, home: { type: String, default: '/' }, groups: { type: Array, default: () => [] } },
  data: () => ({ menuOpen: false }),
  watch: { '$route.fullPath'() { this.menuOpen = false } },
  methods: {
    isCurrent(item) { return item.match ? item.match(this.$route) : this.$route.path === item.to.split('#')[0] && (!item.to.includes('#') || this.$route.hash === '#' + item.to.split('#')[1]) },
    closeMenu() { this.menuOpen = false; this.$refs.menuButton?.focus() }
  }
}
</script>
