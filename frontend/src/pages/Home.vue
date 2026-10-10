<template>
  <div class="referee-auth-page">
    <div class="referee-auth-card">
      <div class="brand-slot">
        <img class="brand-logo" :src="logoUrl" alt="徽标" />
        <div class="brand-title">同济校园足球</div>
        <div class="brand-subtitle">执法、赛程与赛季管理</div>
      </div>

      <div class="referee-actions">
        <button @click="$router.push('/referee-login')" class="btn-primary">
          裁判登录
        </button>
      </div>

      <div class="referee-actions"><RouterLink class="secondary full" to="/admin-login">管理员登录</RouterLink></div>
      <div class="referee-link-row">
        首次使用？请先
        <router-link to="/referee-register">裁判注册</router-link>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Home',
  computed: {
    logoUrl() {
      return '/brand-logo.png'
    }
  }
}
</script>

<style scoped>
@layer legacy {


}
</style>
