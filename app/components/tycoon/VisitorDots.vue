<script setup lang="ts">
import type { VisitorCounts } from '#shared/visitors'

/**
 * Guests per tier as coloured dots with their count, cheapest tier first.
 * Only tiers with someone on the floor show; an empty floor shows one dim 0.
 */
const props = withDefaults(defineProps<{ counts: VisitorCounts, size?: 'sm' | 'md' }>(), { size: 'md' })

const shown = computed(() => TIERS.filter(t => (props.counts[t.id] ?? 0) > 0).map(t => ({ ...t, n: props.counts[t.id] })))
const label = computed(() => (shown.value.length ? shown.value.map(t => `${t.n} ${tierPlural(t.id, t.n)}`).join(', ') : 'No guests'))
</script>

<template>
  <span class="inline-flex items-center" :class="size === 'sm' ? 'gap-1.5' : 'gap-2'" :aria-label="label">
    <template v-if="shown.length">
      <span v-for="t in shown" :key="t.id" class="inline-flex items-center gap-[3px]" aria-hidden="true">
        <span
          class="shrink-0 rounded-full border border-black/50"
          :class="size === 'sm' ? 'size-2' : 'size-2.5'"
          :style="{ background: t.color, boxShadow: t.id === 'whale' ? `0 0 6px 1px ${t.color}` : undefined }"
        />
        <span class="g-num leading-none">{{ t.n }}</span>
      </span>
    </template>
    <span v-else class="g-num leading-none opacity-60" aria-hidden="true">0</span>
  </span>
</template>
