<template>
  <div class="referee-auth-page">
    <div class="referee-auth-card">
      <div class="brand-slot">
        <img class="brand-logo" :src="logoUrl" alt="徽标" />
        <div class="brand-title">校园足球裁判执裁管理系统</div>
      </div>

      <h2>裁判登录</h2>

      <div class="alert error" v-if="error" style="display: block;">
        {{ error }}
      </div>

      <form class="referee-form" @submit.prevent="handleLogin">
        <div class="form-group">
          <label>学号 *</label>
          <input v-model="student_id" type="text" placeholder="请输入学号" required>
        </div>

        <div class="form-group">
          <label>密码 *</label>
          <input v-model="password" type="password" placeholder="请输入密码" required>
        </div>

        <div class="referee-actions">
          <button type="submit" class="btn-primary" :disabled="loading">
            {{ loading ? '登录中...' : '登录' }}
          </button>
          <button type="button" class="btn-secondary" @click="$router.push('/')">
            返回
          </button>
        </div>
      </form>

      <div class="referee-link-row">
        没有账号？
        <router-link to="/referee-register">去注册</router-link>
      </div>
    </div>
  </div>
</template>

<script>
import { refereeAPI } from '../api'

export default {
  name: 'RefereeLogin',
  data() {
    return {
      student_id: '',
      password: '',
      loading: false,
      error: ''
    }
  },
  computed: {
    logoUrl() {
      return '/brand-logo.png'
    }
  },
  methods: {
    clearAdminAuth() {
      localStorage.removeItem('adminToken')
      localStorage.removeItem('adminInfo')
    },

    async handleLogin() {
      if (this.loading) return

      this.loading = true
      this.error = ''

      try {
        const response = await refereeAPI.login({
          student_id: this.student_id,
          password: this.password
        })

        if (response?.success && response?.data?.token) {
          const refereeInfo = {
            id: response.data.id ?? null,
            referee_id: response.data.id ?? null,
            student_id: response.data.student_id ?? this.student_id,
            name: response.data.name ?? '',
            level: response.data.level ?? '',
            grade: response.data.grade ?? '',
            target_level: response.data.target_level ?? '',
            shanghai_fa_registered: response.data.shanghai_fa_registered === true,
            college: response.data.college ?? '',
            gender: response.data.gender ?? '',
            height_cm: response.data.height_cm ?? '',
            weight_kg: response.data.weight_kg ?? '',
            experience: response.data.experience ?? [],
            officiated_count_base: response.data.officiated_count_base ?? 0,
            id_photo_path: response.data.id_photo_path ?? '',
            must_change_password: Boolean(response.data.must_change_password)
          }

          // 避免裁判和管理员双角色 token 并存
          this.clearAdminAuth()

          localStorage.setItem('refereeToken', response.data.token)
          localStorage.setItem('refereeInfo', JSON.stringify(refereeInfo))

          await this.$router.push('/referee-dashboard')
        } else {
          this.error = response?.message || '登录失败，请重试'
        }
      } catch (error) {
        console.error('登录错误:', error)
        this.error =
          error?.response?.data?.message ||
          error?.message ||
          '登录失败，请检查学号和密码'
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style scoped>
@layer legacy {


}
</style>
