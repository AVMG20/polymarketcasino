<script setup lang="ts">
import { CHIPS } from '#shared/tables/chips'
import { formatCoins } from '#shared/money'
import { chip } from '~/utils/live-table/art'

/** The chip rack: pick the chip the next click on a bet spot places. Chips you can't cover are off. */
const props = defineProps<{ available: number, muted?: boolean }>()
const model = defineModel<number>({ required: true })

watch(() => props.available, (available) => {
    // Step down to the biggest chip still affordable.
    if (model.value > available) model.value = [...CHIPS].reverse().find(c => c.value <= available)?.value ?? CHIPS[0]!.value
}, { immediate: true })
</script>

<template>
  <div class="lt-rack" :class="{ muted }">
    <button
      v-for="c in CHIPS"
      :key="c.value"
      type="button"
      :class="{ sel: model === c.value }"
      :disabled="c.value > available"
      :aria-pressed="model === c.value"
      :title="`${formatCoins(c.value, false)} coins`"
      @click="model = c.value"
      v-html="chip(c.value)"
    />
  </div>
</template>
