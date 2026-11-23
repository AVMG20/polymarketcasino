<script setup lang="ts">
import { formatCoins, formatCoinsExact } from '#shared/money'

/**
 * The band between your decisions: what you have riding on the hand, as a
 * chip pile and a number, and a word on what happens next (the slot).
 */
defineProps<{ amount: number }>()
</script>

<template>
  <div class="lt-stake">
    <template v-if="amount > 0">
      <LiveTableChipPile :amount="amount" :size="40" :max="4" class="shrink-0" />
      <span class="flex flex-col leading-none" :title="`${formatCoinsExact(amount)} in play`">
        <span class="lt-panel-label">In play</span>
        <span class="amt">{{ formatCoins(amount) }}</span>
      </span>
      <span class="sep" />
    </template>
    <span class="msg"><slot /></span>
  </div>
</template>
