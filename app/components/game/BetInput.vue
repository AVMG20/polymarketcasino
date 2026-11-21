<script setup lang="ts">
import { formatCoins, parseAmount } from '#shared/money'

/**
 * A coin amount field that takes shorthand (10k, 2.5m), shows what it read,
 * and has thumb-sized ½ / 2× / max buttons. The model is always a whole,
 * clamped number of coins.
 */
const props = withDefaults(defineProps<{ min: number, max: number, disabled?: boolean, label?: string }>(), { label: 'Bet' })
const model = defineModel<number>({ required: true })
const { coins } = useCasinoSession()

const text = ref(String(model.value))
const parsed = computed(() => parseAmount(text.value))
const preview = computed(() => {
    if (parsed.value === null || !/[kmbt]/i.test(text.value)) return ''
    return `= ${formatCoins(parsed.value, false)}`
})

watch(model, (value) => {
    if (parseAmount(text.value) !== value) text.value = String(value)
})

function clamp(value: number) {
    return Math.max(props.min, Math.min(props.max, Math.floor(value)))
}

function commit() {
    model.value = clamp(parsed.value ?? model.value)
    text.value = String(model.value)
}

function scale(factor: number) {
    model.value = clamp(model.value * factor)
}

const ceiling = computed(() => clamp(Math.min(props.max, Math.max(props.min, coins.value))))
</script>

<template>
  <div class="min-w-0 space-y-1.5">
    <div class="flex items-baseline justify-between text-xs">
      <span class="font-medium text-muted-foreground">{{ label }}</span>
      <span class="font-mono text-muted-foreground">{{ preview }}</span>
    </div>
    <div class="flex h-11 overflow-hidden rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/50">
      <input
        v-model="text"
        :disabled="disabled"
        inputmode="decimal"
        class="w-full min-w-0 flex-1 bg-transparent px-3 font-mono text-base tabular-nums outline-none disabled:opacity-60"
        @blur="commit"
        @keydown.enter="commit"
      >
      <button type="button" class="w-11 border-l text-sm font-semibold hover:bg-muted disabled:opacity-50" :disabled="disabled" @click="scale(0.5)">½</button>
      <button type="button" class="w-11 border-l text-sm font-semibold hover:bg-muted disabled:opacity-50" :disabled="disabled" @click="scale(2)">2×</button>
      <button type="button" class="w-12 border-l text-xs font-semibold uppercase hover:bg-muted disabled:opacity-50" :disabled="disabled" @click="model = ceiling">Max</button>
    </div>
  </div>
</template>
