<script setup lang="ts">
import { formatCoins, formatCoinsExact } from '#shared/money'

/** An amount with its currency icon, for pills and buttons. */
withDefaults(defineProps<{ amount: number, currency?: 'chips' | 'coins' | 'gems', compact?: boolean }>(), { currency: 'chips', compact: false })
</script>

<template>
  <span class="inline-flex items-center gap-1 whitespace-nowrap" :title="`${formatCoinsExact(amount)} ${currency}`">
    <CasinoChipIcon v-if="currency === 'chips'" class="size-[1.2em] drop-shadow-[0_1.5px_0_rgb(0_0_0/0.35)]" />
    <CasinoCoinIcon v-else-if="currency === 'coins'" class="size-[1.2em] drop-shadow-[0_1.5px_0_rgb(0_0_0/0.35)]" />
    <CasinoGemIcon v-else class="size-[1.2em] text-[#2fe0d0] drop-shadow-[0_1.5px_0_rgb(0_0_0/0.35)]" />
    <span class="g-num">{{ formatCoins(amount, compact) }}</span>
  </span>
</template>
