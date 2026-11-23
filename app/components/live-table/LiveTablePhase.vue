<script setup lang="ts">
/**
 * The banner across the middle of the felt (stage coordinates): what the
 * table is doing, with the phase clock as a draining ring, or the count to
 * the next round once a hand is over.
 */
import type { TableClock } from '~/composables/useLiveTable'

const props = defineProps<{ label: string, top: number, tone?: string, clock: TableClock, timed?: boolean }>()
const next = computed(() => props.clock.nextAt !== null)
const ticking = computed(() => props.timed !== false && props.clock.endsAt !== null)
</script>

<template>
  <div class="lt-phase" :class="{ untimed: !next && !ticking }" :style="{ top: `${top}px` }">
    <span class="label" :class="tone">{{ label }}</span>
    <template v-if="next">
      <span class="next">NEXT</span>
      <span class="lt-ring"><LiveTableCount class="count" :clock="clock" /></span>
    </template>
    <LiveTableRing v-else-if="ticking" :clock="clock" />
  </div>
</template>
