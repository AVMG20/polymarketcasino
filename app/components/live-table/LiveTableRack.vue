<script setup lang="ts">
import { CHIPS } from '#shared/tables/chips'
import { formatCoins } from '#shared/money'
import { chip } from '~/utils/live-table/art'

/** The chip rack: pick the chip the next click on a bet spot places. Chips you can't cover are off. */
const props = defineProps<{ available: number, muted?: boolean, ladder?: readonly number[] }>()
const model = defineModel<number>({ required: true })
const values = computed(() => props.ladder ?? CHIPS.map(c => c.value))

watch(() => props.available, (available) => {
    // Step down to the biggest chip still affordable.
    if (model.value > available) model.value = [...values.value].reverse().find(v => v <= available) ?? values.value[0]!
}, { immediate: true })
</script>

<template>
  <div class="lt-rack" :class="{ muted }">
    <button
      v-for="value in values"
      :key="value"
      type="button"
      :class="{ sel: model === value }"
      :disabled="value > available"
      :aria-pressed="model === value"
      :title="`${formatCoins(value, false)} coins`"
      @click="model = value"
      v-html="chip(value)"
    />
  </div>
</template>
