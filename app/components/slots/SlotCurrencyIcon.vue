<script setup lang="ts">
import type { Funding } from '#shared/tycoon'

/** A coin or a chip, sized to the text around it: marks which currency a slot meter shows. */
defineProps<{ currency: Funding }>()
</script>

<template>
  <span class="slot-cur" :title="currency === 'chips' ? 'Chips' : 'Coins'">
    <CasinoChipIcon v-if="currency === 'chips'" class="slot-cur__icon" />
    <CasinoCoinIcon v-else class="slot-cur__icon" />
  </span>
</template>

<style scoped>
.slot-cur {
  display: inline-flex;
  flex: none;
  align-items: center;
  vertical-align: -0.12em;
  filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.45));
}

.slot-cur__icon {
  width: 1em;
  height: 1em;
}
</style>
