<template>
  <div class="ui-page-state" :class="'state-' + kind" :role="kind === 'error' ? 'alert' : 'status'" :aria-busy="kind === 'loading'">
    <span v-if="kind === 'loading'" class="ui-spinner" aria-hidden="true"></span>
    <strong>{{ title || ({ loading: '正在加载…', empty: '暂无记录', error: '暂时无法加载' })[kind] }}</strong>
    <p v-if="message">{{ message }}</p><button v-if="$attrs.onRetry" class="secondary" @click="$emit('retry')">重新加载</button><slot />
  </div>
</template>
<script>export default { name: 'PageState', props: { kind: { type: String, default: 'empty' }, title: String, message: String } }</script>
