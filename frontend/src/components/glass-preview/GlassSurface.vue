<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { GlassFilter } from '@wxperia/liquid-glass-vue'

const props = defineProps({
  mode: { type: String, default: 'liquid' },
  strength: { type: Number, default: 45 },
  blur: { type: Number, default: 6 },
  tint: { type: Number, default: 32 },
  supported: { type: Boolean, default: false },
  radius: { type: Number, default: 24 }
})
const host = ref(null)
const size = ref({ width: 1, height: 1 })
const id = `preview-glass-${useId()}`
let observer
const refracts = computed(() => props.mode === 'liquid' && props.supported)
const materialStyle = computed(() => {
  // Filter the backdrop itself, then clip that same layer to the glass outline.
  // A filter on a nested blurred span can escape its parent's rounded overflow.
  const backdrop = props.mode === 'original'
    ? 'none'
    : `blur(${props.blur}px) saturate(135%)${refracts.value ? ` url(#${id})` : ''}`
  return { backdropFilter: backdrop, WebkitBackdropFilter: backdrop }
})
onMounted(() => {
  const measure = () => {
    if (!host.value) return
    const width = Math.max(1, Math.round(host.value.offsetWidth))
    const height = Math.max(1, Math.round(host.value.offsetHeight))
    if (width !== size.value.width || height !== size.value.height) size.value = { width, height }
  }
  measure()
  observer = new ResizeObserver(measure)
  observer.observe(host.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="host" class="preview-glass" :data-material="mode" :style="{ '--glass-radius': `${radius}px` }">
    <GlassFilter v-if="refracts" :id="id" mode="standard" :width="size.width" :height="size.height"
      :displacement-scale="strength" :aberration-intensity="0.45" />
    <div class="preview-glass-material" :style="materialStyle" aria-hidden="true"><span class="preview-glass-tint" :style="{ backgroundColor: mode === 'original' ? '#fff' : `rgb(255 255 255 / ${tint}%)` }" /></div>
    <div class="preview-glass-rim" aria-hidden="true" />
    <div class="preview-glass-content"><slot /></div>
  </div>
</template>

<style scoped>
.preview-glass{position:relative;border-radius:var(--glass-radius);color:inherit;min-width:0}
.preview-glass :deep(>svg){pointer-events:none;position:absolute;inset:0}
.preview-glass-material{position:absolute;inset:0;overflow:hidden;border-radius:inherit;clip-path:inset(0 round var(--glass-radius));contain:paint;pointer-events:none}
.preview-glass-material>span{position:absolute;inset:0;display:block;border-radius:inherit}
.preview-glass-rim{position:absolute;inset:0;pointer-events:none;border-radius:inherit;border:1px solid rgb(255 255 255 / 72%);box-shadow:inset 0 1px 0 #fff,inset 0 -1px 0 #abc4df55,0 8px 30px #23477015;background:linear-gradient(145deg,#ffffff36,transparent 40%,#ffffff0d 70%,#fff4)}
.preview-glass-content{position:relative;z-index:1;min-width:0}
[data-material=original] .preview-glass-rim{background:none;border-color:#d6e0ec;box-shadow:0 2px 8px #23477008}
</style>
