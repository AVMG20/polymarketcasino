<script setup lang="ts">
import type { TableClock } from '~/composables/useLiveTable'

/** The phase clock: a gold ring that drains around the seconds, red for the last five. It ticks on its own. */
const props = defineProps<{ clock: TableClock }>()
const R = 21
const circumference = 2 * Math.PI * R
const { msLeft, seconds } = useCountdown(() => props.clock.endsAt, () => props.clock.skew)
const progress = computed(() => (msLeft.value === null || !props.clock.duration ? 0 : Math.min(1, msLeft.value / props.clock.duration)))
const urgent = computed(() => seconds.value !== null && seconds.value <= 5)
</script>

<template>
  <span v-if="seconds !== null" class="lt-ring" :class="{ urgent }">
    <svg viewBox="0 0 54 54" aria-hidden="true">
      <circle cx="27" cy="27" :r="R + 2" fill="rgb(0 0 0 / 0.45)" />
      <circle cx="27" cy="27" :r="R" fill="none" stroke="rgb(255 255 255 / 0.14)" stroke-width="5" />
      <circle
        cx="27" cy="27" :r="R" fill="none" stroke-width="5" stroke-linecap="round"
        :stroke="urgent ? '#ff5470' : '#ffc93a'"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="circumference * (1 - progress)"
        style="transition: stroke-dashoffset 0.2s linear"
      />
    </svg>
    <span class="count">{{ seconds }}</span>
  </span>
</template>
