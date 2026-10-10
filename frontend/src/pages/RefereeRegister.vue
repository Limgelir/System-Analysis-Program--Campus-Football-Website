<template>
  <div class="referee-auth-page">
    <div class="referee-auth-card">
      <div class="brand-slot">
        <img class="brand-logo" :src="logoUrl" alt="徽标" />
        <div class="brand-title">校园足球裁判执裁管理系统</div>
      </div>

      <h2>裁判注册</h2>

      <div class="alert" :class="[alertType]" v-if="message" style="display: block;">
        {{ message }}
      </div>

      <form class="referee-form" v-draft="{ value: form }" @submit.prevent="handleRegister">
        <div class="form-group">
          <label>学号 *</label>
          <input v-model="form.student_id" type="text" placeholder="请输入学号" required>
        </div>

        <div class="form-group">
          <label>姓名 *</label>
          <input v-model="form.name" type="text" placeholder="请输入姓名" required>
        </div>

        <div class="form-group">
          <label>性别 *</label>
          <select v-model="form.gender" required>
            <option value="">-- 请选择 --</option>
            <option value="男">男</option>
            <option value="女">女</option>
            <option value="其他">其他</option>
          </select>
        </div>

        <div class="form-group">
          <label for="register-college">学院 *</label>
          <CollegeSelect id="register-college" v-model="form.college" />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>身高(cm) *</label>
            <input v-model.number="form.height_cm" type="number" min="1" step="1" required>
          </div>
          <div class="form-group">
            <label>体重(kg) *</label>
            <input v-model.number="form.weight_kg" type="number" min="1" step="0.1" required>
          </div>
        </div>

      <div>
        <label>当前级别 *</label>
        <select v-model="form.grade" required>
          <option value="">-- 请选择 --</option>
          <option v-for="grade in gradeOptions" :key="grade" :value="grade">{{ grade }}</option>
        </select>
      </div>

      <div>
        <label>升入当前级别时间 {{ form.grade === '裁判学员' ? '（选填）' : '*' }}</label>
        <input v-model="form.level_promoted_at" type="date" :required="form.grade !== '裁判学员'">
      </div>

      <div>
        <label>目标级别 *</label>
        <select v-model="form.target_level" required>
          <option value="">-- 请选择 --</option>
          <option v-for="grade in gradeOptions" :key="grade" :value="grade">{{ grade }}</option>
        </select>
      </div>

      <div>
        <label for="shanghai-fa-register">是否在上海足协注册 *</label>
        <select id="shanghai-fa-register" v-model="form.shanghai_fa_registered" required>
          <option disabled value="">-- 请选择 --</option>
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
        <p class="file-hint">此项由本人填报，与本站赛季注册无关，以后可在“设置”中修改。</p>
      </div>

      <div>
        <label>参加过执法的比赛种类 *</label>
        <div class="referee-checkbox-list">
          <label class="referee-checkbox-item">
            <input type="checkbox" v-model="form.match_types" value="院内赛">
            <span>院内赛</span>
          </label>
          <label class="referee-checkbox-item">
            <input type="checkbox" v-model="form.match_types" value="校足协杯">
            <span>校足协杯</span>
          </label>
          <label class="referee-checkbox-item">
            <input type="checkbox" v-model="form.match_types" value="校大联赛">
            <span>校大联赛</span>
          </label>
          <label class="referee-checkbox-item">
            <input type="checkbox" v-model="form.match_types" value="校新生杯">
            <span>校新生杯</span>
          </label>
          <label class="referee-checkbox-item">
            <input type="checkbox" v-model="form.match_types" value="区级及以上比赛">
            <span>区级及以上比赛</span>
          </label>
        </div>
      </div>

      <div>
        <label>已执法场次 *</label>
        <input v-model.number="form.officiated_count_base" type="number" min="0" step="1" required>
      </div>

      <div>
        <label>证件照 *</label>
        <input type="file" accept="image/jpeg,image/png" @change="handlePhotoChange" required>
        <div v-if="form.id_photo" class="file-hint">已选择: {{ form.id_photo.name }}</div>
      </div>

      <div>
        <label>密码 *</label>
        <input v-model="form.password" type="password" minlength="8" placeholder="至少8位，并包含两类字符" required>
      </div>

      <div>
        <label>确认密码 *</label>
        <input v-model="form.password_confirm" type="password" minlength="8" placeholder="请再次输入密码" required>
      </div>

        <div class="referee-actions">
          <button type="submit" class="btn-primary" :disabled="loading">
            {{ loading ? '注册中...' : '注册' }}
          </button>
          <button type="button" class="btn-secondary" @click="$router.push('/')">
            返回
          </button>
        </div>
      </form>

      <div class="referee-link-row">
        已有账号？
        <router-link to="/referee-login">直接登录</router-link>
      </div>
    </div>
  </div>
</template>

<script>
import CollegeSelect from '../../../shared-ui/CollegeSelect.vue'
import { refereeAPI } from '../api'
import { REFEREE_GRADES } from '../constants/refereeOptions'

export default {
  name: 'RefereeRegister',
  components: { CollegeSelect },
  data() {
    return {
      gradeOptions: REFEREE_GRADES,
      form: {
        student_id: '',
        name: '',
        gender: '',
        college: '',
        height_cm: '',
        weight_kg: '',
        grade: '',
        level_promoted_at: '',
        target_level: '',
        shanghai_fa_registered: '',
        match_types: [],
        officiated_count_base: 0,
        id_photo: null,
        password: '',
        password_confirm: ''
      },
      loading: false,
      message: '',
      alertType: 'success'
    }
  },
  computed: {
    logoUrl() {
      return '/brand-logo.png'
    }
  },
  methods: {
    handlePhotoChange(event) {
      const file = event.target.files[0]
      if (!file) {
        this.form.id_photo = null
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        alert('文件大小不能超过 10MB')
        return
      }
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        alert('只支持 JPG 和 PNG 格式的图片')
        return
      }
      this.form.id_photo = file
    },
    async handleRegister() {
      if (!['true', 'false'].includes(this.form.shanghai_fa_registered)) {
        this.message = '请选择是否在上海足协注册'
        this.alertType = 'error'
        return
      }
      // 验证
      if (!this.form.student_id || !this.form.name || !this.form.grade || (this.form.grade !== '裁判学员' && !this.form.level_promoted_at) || !this.form.target_level) {
        this.message = '请填写所有必填项'
        this.alertType = 'error'
        return
      }

      if (!this.form.gender || !this.form.college || !this.form.height_cm || !this.form.weight_kg) {
        this.message = '请填写性别、学院、身高和体重'
        this.alertType = 'error'
        return
      }

      if (this.form.match_types.length === 0) {
        this.message = '请至少选择一种比赛种类'
        this.alertType = 'error'
        return
      }

      if (this.form.password !== this.form.password_confirm) {
        this.message = '两次密码不一致'
        this.alertType = 'error'
        return
      }

      if (this.form.password.length < 8) {
        this.message = '密码长度至少8位'
        this.alertType = 'error'
        return
      }

      if (!this.form.id_photo) {
        this.message = '请上传证件照'
        this.alertType = 'error'
        return
      }

      this.loading = true
      try {
        const formData = new FormData()
        formData.append('student_id', this.form.student_id)
        formData.append('name', this.form.name)
        formData.append('gender', this.form.gender)
        formData.append('college', this.form.college)
        formData.append('height_cm', this.form.height_cm)
        formData.append('weight_kg', this.form.weight_kg)
        formData.append('grade', this.form.grade)
        formData.append('level_promoted_at', this.form.level_promoted_at)
        formData.append('target_level', this.form.target_level)
        formData.append('shanghai_fa_registered', this.form.shanghai_fa_registered)
        formData.append('match_types', JSON.stringify(this.form.match_types))
        formData.append('officiated_count_base', this.form.officiated_count_base)
        formData.append('password', this.form.password)
        formData.append('password_confirm', this.form.password_confirm)
        formData.append('id_photo', this.form.id_photo)

        const response = await refereeAPI.register(formData)

        // 处理响应
        if (response && response.success) {
          this.$markDraftSaved(this.$el)
          this.message = '注册成功，请登录'
          this.alertType = 'success'
          this.$router.push('/referee-login')
        } else {
          this.message = response?.message || '注册失败'
          this.alertType = 'error'
        }
      } catch (error) {
        console.error('注册错误:', error)
        this.message = error.response?.data?.message || '注册失败，请检查网络'
        this.alertType = 'error'
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style scoped>
@layer legacy {

.file-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #666;
}

}
</style>
