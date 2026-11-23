<script setup lang="ts">
import type { TableClock } from '~/composables/useLiveTable'

/** Seconds to the next round, ticking on its own. */
const props = defineProps<{ clock: TableClock }>()
const { seconds } = useCountdown(() => props.clock.nextAt, () => props.clock.skew)
</script>

<template>
  <span>{{ seconds }}</span>
</template>
