<template>
  <span class="college-select">
    <select :id="id" :aria-label="label" :value="selected" :required="required" :disabled="disabled" @change="$emit('update:modelValue', $event.target.value)">
      <option disabled value="">请选择学院</option>
      <option v-for="college in colleges" :key="college" :value="college">{{ college }}</option>
    </select>
    <span v-if="legacy" class="college-legacy">原填写：{{ modelValue || '未填写' }}。尚未匹配到学院，请重新选择。</span>
  </span>
</template>
<script setup>
import { computed } from 'vue'
import catalog from '../shared-data/colleges.json'
const props = defineProps({ modelValue: { type: String, default: '' }, id: String, label: { type: String, default: '学院' }, required: { type: Boolean, default: true }, disabled: Boolean, showEmptyLegacy: Boolean })
defineEmits(['update:modelValue'])
const colleges = catalog.map(item => item.name)
const selected = computed(() => colleges.includes(props.modelValue) ? props.modelValue : '')
const legacy = computed(() => !selected.value && (props.modelValue || props.showEmptyLegacy))
</script>
<style scoped>
.college-select{display:block;min-width:0;width:100%}
select{box-sizing:border-box;width:100%;max-width:100%;min-width:0;font:inherit;padding:10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:inherit;text-overflow:ellipsis}
.college-legacy{display:block;margin-top:6px;font-size:13px;line-height:1.6;color:#88530e;overflow-wrap:anywhere}
</style>
