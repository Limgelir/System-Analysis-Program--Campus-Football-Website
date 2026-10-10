<template>
  <nav class="list-pagination" aria-label="分页">
    <span>共 {{ pagination.total }} 条 · 第 {{ pagination.page }} / {{ Math.max(1,pagination.total_pages) }} 页</span>
    <label v-if="!fixedSize">每页 <select aria-label="每页数量" :value="pagination.page_size" :disabled="loading" @change="$emit('size',Number($event.target.value))"><option :value="10">10</option><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select> 条</label>
    <button type="button" :disabled="loading || pagination.page<=1" @click="$emit('page',pagination.page-1)">上一页</button>
    <button type="button" :disabled="loading || pagination.page>=pagination.total_pages" @click="$emit('page',pagination.page+1)">下一页</button>
  </nav>
</template>
<script setup>
defineProps({pagination:{type:Object,required:true},loading:Boolean,fixedSize:Boolean});defineEmits(['page','size']);
</script>
<style scoped>
@layer legacy {

.list-pagination{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 0;color:#475569;font-size:14px}
button,select{background:#fff;color:#1f3b73;border:1px solid #cbd5e1;border-radius:6px;padding:7px 10px}
button:disabled{opacity:.45;cursor:not-allowed}

}
</style>
