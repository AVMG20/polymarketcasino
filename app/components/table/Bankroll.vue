<script setup lang="ts">
import { formatCoins, formatCoinsExact } from '#shared/money'

/**
 * What the player can stake at a table: coins and chips. Stakes come out of
 * the coins first, then the chips; every win pays chips.
 */
const session = useCasinoSession()
const tycoon = useTycoon()
</script>

<template>
  <span
    class="inline-flex items-center gap-2.5 rounded-full bg-black/40 px-3 py-1 text-sm text-white tabular-nums shadow-[inset_0_2px_0_rgb(0_0_0/0.35)] [font-family:var(--font-game)] tracking-wide"
    :title="`${formatCoinsExact(session.coins.value)} coins + ${formatCoinsExact(tycoon.chips.value)} chips. Bets take coins first, then chips; wins pay chips.`"
  >
    <span class="inline-flex items-center gap-1"><CasinoCoinIcon class="size-4" />{{ formatCoins(session.coins.value) }}</span>
    <span class="inline-flex items-center gap-1"><CasinoChipIcon class="size-4" />{{ formatCoins(tycoon.chips.value) }}</span>
  </span>
</template>
