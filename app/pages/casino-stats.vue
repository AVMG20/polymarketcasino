<script setup lang="ts">
/** The old casino stats page: the charts are a panel over the floor now. */
const casinoStats = useCasinoStats()
casinoStats.show()
await navigateTo('/', { replace: true })
</script>

<template>
  <div />
</template>
