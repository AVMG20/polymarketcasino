<script setup lang="ts">
// Nuxt UI's UInput (coins icon, trailing preview) and soft neutral UButtons,
// rebuilt as plain elements with the same sizes and colours.
import { CoinsIcon } from 'lucide-vue-next'

defineProps<{
    disabled?: boolean
}>()

const bet = defineModel<number>({ required: true })
const betText = useAmountInput(bet)
</script>

<template>
  <div>
    <label class="mb-1.5 block text-xs font-medium tracking-wide text-muted-foreground uppercase">Bet Amount</label>
    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        <CoinsIcon class="pointer-events-none absolute top-1/2 left-2.5 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="betText"
          placeholder="e.g. 10k"
          autocomplete="off"
          :disabled="disabled"
          class="w-full rounded-md border-0 bg-background py-2 pr-3 pl-10 font-mono text-sm text-foreground ring ring-input outline-none ring-inset placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-75"
          :class="{ 'pr-24': amountPreview(betText) }"
        >
        <span
          v-if="amountPreview(betText)"
          class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
        >{{ amountPreview(betText) }}</span>
      </div>
      <div class="flex gap-1">
        <button
          type="button"
          class="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-75"
          :disabled="disabled"
          @click="bet = Math.max(1, Math.floor(bet / 2))"
        >
          ½
        </button>
        <button
          type="button"
          class="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-75"
          :disabled="disabled"
          @click="bet = bet * 2"
        >
          2×
        </button>
      </div>
    </div>
  </div>
</template>
