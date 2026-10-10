<template>
  <div class="referee-auth-page"><div class="referee-auth-card"><div class="brand-slot"><img class="brand-logo" src="/brand-logo.png" alt="同济大学校徽"><div class="brand-title">同济校园足球</div><div class="brand-subtitle">管理员端</div></div>
    <h2>管理员登录</h2>

    <div class="alert error" v-if="error" style="display: block;">
      {{ error }}
    </div>

    <form class="referee-form" @submit.prevent="handleLogin">
      <div>
        <label>用户名 *</label>
        <input autocomplete="username" v-model="username" type="text" placeholder="请输入用户名" required>
      </div>

      <div>
        <label>密码 *</label>
        <input autocomplete="current-password" v-model="password" type="password" placeholder="请输入密码" required>
      </div>

      <div class="button-group" style="margin-top: 20px;">
        <button class="btn-primary" type="submit" :disabled="loading">
          {{ loading ? '登录中...' : '登录' }}
        </button>
        <button type="button" @click="$router.push('/')" class="secondary">
          返回
        </button>
      </div>
    </form>
  </div>
</div></template>

<script>
import { adminAPI } from '../api'

export default {
  name: 'AdminLogin',
  data() {
    return {
      username: '',
      password: '',
      loading: false,
      error: ''
    }
  },
  methods: {
    clearRefereeAuth() {
      localStorage.removeItem('refereeToken')
      localStorage.removeItem('refereeInfo')
    },

    async handleLogin() {
      if (this.loading) return

      this.username = String(this.username || '').trim()

      this.loading = true
      this.error = ''

      try {
        const response = await adminAPI.login({
          username: this.username,
          password: this.password
        })

        if (response?.success && response?.data?.token) {
          const adminInfo = {
            admin_id: response.data.admin_id ?? null,
            username: response.data.username ?? this.username,
            must_change_password: Boolean(response.data.must_change_password)
          }

          // 避免管理员和裁判双角色 token 并存
          this.clearRefereeAuth()

          localStorage.setItem('adminToken', response.data.token)
          localStorage.setItem('adminInfo', JSON.stringify(adminInfo))

          await this.$router.push('/admin-dashboard')
        } else {
          this.error = response?.message || '登录失败'
        }
      } catch (error) {
        this.error =
          error?.response?.data?.message ||
          error?.message ||
          '登录失败，请检查用户名和密码'
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style scoped>
@layer legacy {

.container {
  max-width: 400px;
  margin: 100px auto;
  padding: 40px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

h2 {
  text-align: center;
  color: #333;
  margin-bottom: 30px;
}

form div {
  margin-bottom: 20px;
}

label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #333;
}

input {
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

input:focus {
  outline: none;
  border-color: #333;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.08);
}

.button-group {
  display: flex;
  gap: 10px;
}

.button-group button {
  flex: 1;
}

}
</style>
