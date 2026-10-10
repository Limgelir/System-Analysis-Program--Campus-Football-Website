<script setup>
defineProps({ title: String, badge: String })
</script>
<template>
  <section class="studio-hero">
    <h1>{{ title }}</h1>
    <p v-if="badge" class="studio-hero-meta">{{ badge }}</p>
    <div v-if="$slots.default" class="studio-hero-actions"><slot/></div>
  </section>
</template>
