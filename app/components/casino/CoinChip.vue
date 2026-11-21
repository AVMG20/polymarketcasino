<script setup lang="ts">
import { formatCoins } from '#shared/money'

const props = withDefaults(defineProps<{ amount: number, compact?: boolean }>(), { compact: true })
const full = computed(() => formatCoins(props.amount, false))
</script>

<template>
  <span class="inline-flex items-center gap-1.5 rounded-full bg-coin/15 px-2.5 py-1 font-mono text-sm font-semibold tabular-nums" :title="`${full} coins`">
    <CasinoCoinIcon class="size-4" />
    {{ formatCoins(amount, compact) }}
  </span>
</template>
