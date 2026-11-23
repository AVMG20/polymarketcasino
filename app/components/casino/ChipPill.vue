<script setup lang="ts">
import { formatCoins, formatCoinsExact } from '#shared/money'

withDefaults(defineProps<{ amount: number, compact?: boolean }>(), { compact: false })
</script>

<template>
  <span class="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-2.5 py-1 font-game text-[0.95rem] tracking-wide tabular-nums" :title="`${formatCoinsExact(amount)} chips`">
    <CasinoChipIcon class="size-4" />
    {{ formatCoins(amount, compact) }}
  </span>
</template>
