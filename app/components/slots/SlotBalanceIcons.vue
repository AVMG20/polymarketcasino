<script setup lang="ts">
import { formatCoinsExact } from '#shared/money'

/**
 * Marks a slot's Balance meter as coins and chips together: a coin and a chip
 * icon, sized to the label, with the split in the tooltip. Bets take coins
 * first, then chips; wins pay chips.
 */
const session = useCasinoSession()
const tycoon = useTycoon()
const title = computed(() => `${formatCoinsExact(session.coins.value)} coins + ${formatCoinsExact(tycoon.chips.value)} chips. Bets take coins first, then chips; wins pay chips.`)
</script>

<template>
  <span class="slot-bal" :title="title" :aria-label="title">
    <CasinoCoinIcon class="slot-bal__icon" />
    <CasinoChipIcon class="slot-bal__icon slot-bal__icon--chip" />
  </span>
</template>

<style scoped>
.slot-bal {
  display: inline-flex;
  flex: none;
  align-items: center;
  margin-right: 0.3em;
  vertical-align: -0.2em;
  filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.45));
}

.slot-bal__icon {
  width: 1.25em;
  height: 1.25em;
}

.slot-bal__icon--chip {
  margin-left: -0.4em;
}
</style>
