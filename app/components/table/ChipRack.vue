<script setup lang="ts">
import { CHIPS } from '#shared/tables/chips'
import { formatCoins } from '#shared/money'

/** Pick the chip the next tap on a bet spot places. Chips you can't cover are off. */
const props = defineProps<{ available: number, disabled?: boolean }>()
const model = defineModel<number>({ required: true })

watch(() => props.available, (available) => {
    // Step down to the biggest chip still affordable.
    if (model.value > available) model.value = [...CHIPS].reverse().find(chip => chip.value <= available)?.value ?? CHIPS[0]!.value
}, { immediate: true })
</script>

<template>
  <div class="flex gap-2 overflow-x-auto px-2 pt-2.5 pb-2 [scrollbar-width:thin]">
    <button
      v-for="chip in CHIPS"
      :key="chip.value"
      type="button"
      class="grid size-11 shrink-0 place-items-center rounded-full border-4 border-dashed font-mono text-[11px] font-bold shadow-[0_3px_0_rgba(0,0,0,.35)] transition-transform duration-150 disabled:opacity-35 disabled:shadow-none"
      :class="model === chip.value ? '-translate-y-1 scale-110 ring-2 ring-star ring-offset-2 ring-offset-card' : 'hover:-translate-y-0.5'"
      :style="{ background: chip.face, borderColor: chip.rim, color: chip.text }"
      :disabled="disabled || chip.value > available"
      :aria-pressed="model === chip.value"
      :title="`${formatCoins(chip.value, false)} coins`"
      @click="model = chip.value"
    >
      {{ formatCoins(chip.value) }}
    </button>
  </div>
</template>
