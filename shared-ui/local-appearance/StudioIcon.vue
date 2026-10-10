<script setup>
defineProps({ name: { type: String, default: 'grid' } })
const paths = {
  home: 'm3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7',
  calendar: 'M5 5h14v15H5V5Zm3-3v6m8-6v6M5 11h14',
  users: 'M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m14-7a4 4 0 0 1 4 4v3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm4-3a4 4 0 0 1 0 7',
  list: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
  chart: 'M4 3v17h17M9 15V9m5 6V5m5 10v-4',
  settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
  shield: 'm12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-6',
  plus: 'M12 4v16M4 12h16',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7'
}
</script>
<template><svg class="studio-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.grid" /></svg></template>
