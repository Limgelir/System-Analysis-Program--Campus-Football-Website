<template>
  <form class="grade-settings" v-draft="{ value: form, ready: loaded, resetKey: savedVersion }" @submit.prevent="save">
    <h3>当前级别</h3>
    <p>保存后立即生效，无需审核。已提交的赛季注册保留原级别。</p>
    <fieldset :disabled="loading || saving || !loaded">
      <label for="settings-grade">当前级别</label>
      <select id="settings-grade" v-model="form.grade" required>
        <option v-for="grade in grades" :key="grade" :value="grade">{{ grade }}</option>
      </select>
      <label for="settings-grade-date">升入当前级别时间{{ form.grade === '裁判学员' ? '（选填）' : ' *' }}</label>
      <input id="settings-grade-date" v-model="form.level_promoted_at" type="date" :required="form.grade !== '裁判学员'">
      <button type="submit">{{ saving ? '保存中…' : '保存当前级别' }}</button>
    </fieldset>
    <p v-if="loading" role="status">正在读取当前级别…</p>
    <p v-if="message" :role="error ? 'alert' : 'status'" :class="{ error }">{{ message }}</p>
    <button v-if="!loaded && !loading" type="button" @click="load">重新读取当前级别</button>
  </form>
</template>

<script>
import { refereeAPI } from '../api'
import { REFEREE_GRADES } from '../constants/refereeOptions'
export default {
  props: { refereeId: { type: [Number, String], required: true } },
  emits: ['saved', 'saving'],
  data() {
    return { grades: REFEREE_GRADES, form: { grade: '', level_promoted_at: '' }, loaded: false,
      loading: false, saving: false, error: false, message: '', savedVersion: 0 }
  },
  mounted() { this.load() },
  methods: {
    async load() {
      if (this.loading || this.saving) return
      this.loading = true
      this.loaded = false
      this.message = ''
      try {
        const { data } = await refereeAPI.getInfo(this.refereeId)
        this.form = { grade: data.grade, level_promoted_at: data.level_promoted_at || '' }
        this.loaded = true
        this.error = false
      } catch (error) {
        this.error = true
        this.message = error?.response?.data?.message || error.message || '读取当前级别失败'
      } finally { this.loading = false }
    },
    async save() {
      if (!this.loaded || this.loading || this.saving) return
      this.error = false
      this.message = ''
      if (!this.grades.includes(this.form.grade) || (this.form.grade !== '裁判学员' && !this.form.level_promoted_at)) {
        this.error = true
        this.message = '请选择当前级别；非裁判学员须填写升入当前级别时间'
        return
      }
      this.saving = true
      this.$emit('saving', true)
      try {
        const { data } = await refereeAPI.updateGrade(this.refereeId, { ...this.form })
        this.form = { grade: data.grade, level_promoted_at: data.level_promoted_at || '' }
        this.savedVersion++
        this.message = '当前级别及升入时间已保存'
        this.$emit('saved', data)
      } catch (error) {
        this.error = true
        this.message = error?.response?.data?.message || error.message || '保存当前级别失败'
      } finally {
        this.saving = false
        this.$emit('saving', false)
      }
    }
  }
}
</script>

<style scoped>
.grade-settings{padding-bottom:20px;margin-bottom:20px;border-bottom:1px solid #dbe3ed}
h3{margin:0 0 10px}p{font-size:14px;line-height:1.6;color:#52627a}
fieldset{padding:0;border:0;min-width:0;display:grid;gap:10px}
select,input,button{box-sizing:border-box;width:100%;min-width:0;font:inherit;padding:10px 12px;border:1px solid #cbd5e1;border-radius:6px}
button{background:#245ac7;color:white;cursor:pointer;margin-top:8px}button:disabled{opacity:.5;cursor:not-allowed}
.error{color:#b42318}
</style>
