<script setup lang="ts">
import { formatCoins, formatCoinsExact } from '#shared/money'

/** A coin/chip amount that rolls to its new value. */
const props = defineProps<{ value: number, compact?: boolean }>()
const shown = ref(props.value)
let frame = 0

watch(() => props.value, (to) => {
    cancelAnimationFrame(frame)
    const from = shown.value
    if (from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        shown.value = to
        return
    }
    const start = performance.now()
    const step = (now: number) => {
        const t = Math.min(1, (now - start) / 700)
        shown.value = t < 1 ? Math.floor((from + (to - from) * (1 - (1 - t) ** 3)) * 100) / 100 : to
        if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
})
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <span :title="formatCoinsExact(value)">{{ formatCoins(shown, compact) }}</span>
</template>
