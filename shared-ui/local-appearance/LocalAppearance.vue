<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DEFAULT_APPEARANCE, STORAGE_KEY, normalizeAppearance, readAppearance, saveAppearance } from './settings.js'

const props = defineProps({ storageKey: { type: String, default: STORAGE_KEY }, localPreview: { type: Boolean, default: false } })

let storage
try { storage = window.localStorage } catch { /* Adjustments still work without storage. */ }
const settings = ref(readAppearance(storage, props.storageKey))
const open = ref(false)
const launcher = ref(null)
const closeButton = ref(null)
const saved = ref(true)
const supported = CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')

watch(settings, value => {
  document.documentElement.dataset.localAppearance = value.mode
  document.documentElement.dataset.localCards = value.cards
  document.documentElement.style.setProperty('--local-glass-blur', `${value.blur}px`)
  document.documentElement.style.setProperty('--local-glass-tint', `${value.tint}%`)
  saved.value = saveAppearance(storage, value, props.storageKey)
}, { deep: true, immediate: true })

async function togglePanel() {
  open.value = !open.value
  await nextTick()
  if (open.value) closeButton.value?.focus()
}
async function closePanel() {
  open.value = false
  await nextTick()
  launcher.value?.focus()
}
function updateNumber(key, event) {
  settings.value = normalizeAppearance({ ...settings.value, [key]: Number(event.target.value) })
}
function syncSettings(event) {
  if (event.key !== props.storageKey && event.key !== null) return
  const next = readAppearance(storage, props.storageKey)
  if (JSON.stringify(next) !== JSON.stringify(settings.value)) settings.value = next
}
onMounted(() => window.addEventListener('storage', syncSettings))
onBeforeUnmount(() => {
  window.removeEventListener('storage', syncSettings)
  delete document.documentElement.dataset.localAppearance
  delete document.documentElement.dataset.localCards
  document.documentElement.style.removeProperty('--local-glass-blur')
  document.documentElement.style.removeProperty('--local-glass-tint')
})
</script>

<template>
  <div class="local-appearance-tools" @keydown.stop @keydown.esc.prevent="closePanel">
    <section v-if="open" id="local-appearance-panel" class="local-appearance-panel" role="region" aria-labelledby="local-appearance-title">
      <header><div><small>{{ localPreview ? '本地预览' : '新版体验' }}</small><h2 id="local-appearance-title">外观调节</h2></div><button ref="closeButton" type="button" aria-label="收起外观调节" @click="closePanel">×</button></header>
      <div class="local-appearance-modes" role="group" aria-label="全站表面效果">
        <button type="button" :aria-pressed="settings.mode === 'original'" @click="settings.mode = 'original'">实色</button>
        <button type="button" :aria-pressed="settings.mode === 'frosted'" @click="settings.mode = 'frosted'">磨砂</button>
      </div>
      <p id="local-card-mode-label" class="local-appearance-section-label">卡片表面</p>
      <div class="local-appearance-modes" role="group" aria-labelledby="local-card-mode-label">
        <button type="button" :aria-pressed="settings.cards === 'solid'" @click="settings.cards = 'solid'">实底</button>
        <button type="button" :aria-pressed="settings.cards === 'glass'" @click="settings.cards = 'glass'">跟随磨砂</button>
      </div>
      <label for="local-glass-blur">模糊 <output>{{ settings.blur }} px</output></label>
      <input id="local-glass-blur" type="range" min="0" max="20" step="1" :value="settings.blur" :disabled="settings.mode === 'original'" @input="updateNumber('blur', $event)">
      <label for="local-glass-tint">底色 <output>{{ settings.tint }}%</output></label>
      <input id="local-glass-tint" type="range" min="0" max="100" step="1" :value="settings.tint" :disabled="settings.mode === 'original'" @input="updateNumber('tint', $event)">
      <p class="local-appearance-hint">底色越低越通透。顶栏、底部快捷栏、弹窗及选择“跟随磨砂”的卡片共用参数，立即生效。表格和输入框保留实底。</p>
      <p v-if="settings.mode === 'original' && settings.cards === 'glass'" class="local-appearance-hint">当前为全站实色；切换上方“磨砂”即可显示卡片效果。</p>
      <button class="local-appearance-reset" type="button" @click="settings = { ...DEFAULT_APPEARANCE }">恢复选定效果 · 3px / 8%</button>
      <p v-if="!supported" class="local-appearance-status" role="status">当前浏览器不支持背景模糊，已使用实色表面。</p>
      <p class="local-appearance-status" role="status">{{ saved ? '已自动保存到当前浏览器的本站设置。' : '当前浏览器无法保存设置，刷新后将恢复默认。' }}</p>
      <p class="local-appearance-footnote">{{ localPreview ? '管理／裁判端和球员端分别记忆。仅本地预览。' : '设置按账号、浏览器和站点分别保存。' }}</p>
    </section>
    <button ref="launcher" class="local-appearance-launcher" type="button" :aria-expanded="open" aria-controls="local-appearance-panel" @click="togglePanel">外观调节 <span>{{ localPreview ? '本地' : '体验版' }}</span></button>
  </div>
</template>
