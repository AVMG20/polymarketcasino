<script setup lang="ts">
import { chip, chipsFor } from '~/utils/live-table/art'

/**
 * A bet drawn as a pile of chips. Keyed by position, so a pile that grows
 * shows only the new chip dropping on.
 */
const props = withDefaults(defineProps<{ amount?: number, size?: number, max?: number, column?: [value: number, count: number], ladder?: readonly number[] }>(), { amount: 0, size: 56, max: 6, column: undefined, ladder: undefined })
const chips = computed(() => {
    // A uniform column of one chip (the house's stacks), or a bet broken into chips.
    if (props.column) return Array.from({ length: props.column[1] }, () => ({ value: props.column![0] }))
    return props.amount > 0 ? chipsFor(props.amount, props.max, props.ladder) : []
})
const lift = computed(() => props.size * 0.152)
</script>

<template>
  <div v-if="chips.length" class="lt-stack" :style="{ width: `${size}px`, height: `${size + lift * (chips.length - 1)}px` }">
    <span
      v-for="(c, i) in chips"
      :key="i"
      :style="{ position: 'absolute', left: `${i % 2 ? 1 : -1}px`, bottom: `${i * lift}px`, width: `${size}px`, height: `${size}px`, zIndex: i }"
      v-html="chip(c.value)"
    />
  </div>
</template>
