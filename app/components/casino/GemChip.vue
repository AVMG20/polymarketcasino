<script setup lang="ts">
import { formatCoins } from '#shared/money'

defineProps<{ amount: number | null }>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5 rounded-full bg-gem/15 px-2.5 py-1 font-game text-[0.95rem] tracking-wide tabular-nums text-gem" :title="amount === null ? 'Gems unavailable' : `${amount} gems`">
    <CasinoGemIcon class="size-4" />
    {{ amount === null ? '–' : formatCoins(amount) }}
  </span>
</template>
