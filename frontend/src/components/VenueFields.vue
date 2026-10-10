<template>
  <div class="venue-fields">
    <label>比赛场地{{ required ? ' *' : '' }}
      <select :value="venue || ''" :required="required" :disabled="disabled" @change="changeVenue($event.target.value)">
        <option value="">{{ required?'请选择场地':'场地待定' }}</option>
        <option v-for="value in venues" :key="value">{{ value }}</option>
      </select>
    </label>
    <label v-if="venue==='其它'">具体地点 *<input :value="detail||''" :disabled="disabled" required maxlength="120" placeholder="请填写具体地点" @input="$emit('update:detail',$event.target.value)"></label>
  </div>
</template>
<script>
export default {props:{venue:String,detail:String,required:Boolean,disabled:Boolean},emits:['update:venue','update:detail'],data:()=>({venues:['樱花人草','129运动场','铁笼','嘉定人草','嘉定天然草','其它']}),methods:{changeVenue(value){this.$emit('update:venue',value);this.$emit('update:detail','')}}}
</script>
<style scoped>
@layer legacy {
.venue-fields{display:flex;flex-wrap:wrap;gap:16px;margin:12px 0}.venue-fields label{display:flex;flex:1 1 220px;min-width:0;flex-direction:column;gap:6px}.venue-fields select,.venue-fields input{min-height:44px;width:100%;box-sizing:border-box;padding:8px;border:1px solid #cbd5e1;border-radius:6px}
}
</style>
