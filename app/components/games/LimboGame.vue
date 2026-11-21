<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LIMBO_MAX_TARGET, LIMBO_MIN_TARGET, limboChance, toCents, type LimboResult } from '#shared/games/limbo'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'

const info = findGame('limbo')!
const round = useGameRound<LimboResult>('limbo')

const bet = ref(info.minBet)
const targetText = ref('2.00')
const shown = ref<number | null>(null)
const last = ref<LimboResult | null>(null)
const lastPayout = ref(0)
const history = ref<{ id: string, label: string, won: boolean }[]>([])

const target = computed(() => {
    const value = toCents(Number(targetText.value))
    return Number.isFinite(value) ? Math.min(LIMBO_MAX_TARGET, Math.max(LIMBO_MIN_TARGET, value)) : 2
})
const chance = computed(() => limboChance(target.value) * 100)
const presets = [1.5, 2, 5, 10, 100]

let frame = 0
function animate(to: number): Promise<void> {
    return new Promise((resolve) => {
        const start = performance.now()
        const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.min(900, 300 + Math.log10(to) * 200)
        const step = (now: number) => {
            const t = duration ? Math.min(1, (now - start) / duration) : 1
            // Climb on a log scale so 1.5× and 5,000× both read as a rise.
            shown.value = Math.floor(10 ** (Math.log10(to) * (1 - (1 - t) ** 2)) * 100) / 100
            if (t < 1) frame = requestAnimationFrame(step)
            else resolve()
        }
        frame = requestAnimationFrame(step)
    })
}
onBeforeUnmount(() => cancelAnimationFrame(frame))

async function play() {
    targetText.value = target.value.toFixed(2)
    const response = await round.play({ bet: bet.value, options: { target: target.value } })
    if (!response) return
    last.value = null
    await animate(response.result.result)
    shown.value = response.result.result
    last.value = response.result
    lastPayout.value = response.payout
    history.value = [{ id: response.roundId, label: `${response.result.result.toFixed(2)}×`, won: response.result.won }, ...history.value].slice(0, 20)
    round.settle()
}
</script>

<template>
  <GameFrame slug="limbo">
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div class="order-2 space-y-4 rounded-2xl border bg-card p-4 lg:order-1">
        <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="round.busy.value" />
        <div class="space-y-1.5">
          <div class="flex justify-between text-xs text-muted-foreground">
            <span class="font-medium">Target multiplier</span>
            <span class="font-mono">{{ chance.toFixed(chance < 1 ? 4 : 2) }}% chance</span>
          </div>
          <Input v-model="targetText" inputmode="decimal" class="h-11 font-mono text-base" :disabled="round.busy.value" @blur="targetText = target.toFixed(2)" />
          <div class="grid grid-cols-5 gap-1.5">
            <Button v-for="preset in presets" :key="preset" variant="outline" size="sm" class="h-9" :disabled="round.busy.value" @click="targetText = preset.toFixed(2)">
              {{ preset }}×
            </Button>
          </div>
        </div>
        <div class="rounded-xl bg-muted p-2 text-center">
          <p class="text-xs text-muted-foreground">Win</p>
          <p class="font-mono font-semibold">{{ formatCoins(Math.floor(bet * target)) }}</p>
        </div>
        <Button size="lg" class="h-12 w-full font-display text-base shadow-[0_3px_0_0_color-mix(in_oklch,var(--primary)_60%,black)] active:translate-y-[2px] active:shadow-none" :disabled="round.busy.value" @click="play">
          Play
        </Button>
      </div>

      <div class="order-1 space-y-6 rounded-2xl border bg-card p-4 sm:p-8 lg:order-2">
        <GameRoundHistory :items="history" />
        <div class="py-6 text-center sm:py-12">
          <p
            class="font-display text-6xl font-extrabold break-all tabular-nums sm:text-8xl"
            :class="last ? (last.won ? 'text-success' : 'text-destructive') : 'text-foreground'"
          >
            {{ shown === null ? '1.00×' : `${shown.toFixed(2)}×` }}
          </p>
          <p class="mt-2 h-5 text-sm text-muted-foreground">
            <template v-if="last">{{ last.won ? `Won ${formatCoins(lastPayout)}` : `Needed ${last.target.toFixed(2)}×` }}</template>
          </p>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Name a target multiplier, then play. The game draws a result; when it reaches your target you win bet × target.</p>
      <p>The chance of reaching target t is 98% ÷ t, so every target returns 98%.</p>
    </template>
  </GameFrame>
</template>
