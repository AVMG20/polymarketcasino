<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { DICE_MAX_CHANCE, DICE_MIN_CHANCE, diceMultiplier, type DiceResult } from '#shared/games/dice'
import { findGame } from '#shared/games/registry'
import { formatCoins, formatCoinsExact, payFor } from '#shared/money'

const info = findGame('dice')!
const round = useGameRound<DiceResult>('dice')

const bet = ref(info.minBet)
const chance = ref(50)
const over = ref(false)
const shown = ref<number | null>(null)
const last = ref<DiceResult | null>(null)
const lastPayout = ref(0)
const history = ref<{ id: string, label: string, won: boolean }[]>([])

const multiplier = computed(() => diceMultiplier(chance.value))
const target = computed(() => (over.value ? 100 - chance.value : chance.value))
const winBand = computed(() => (over.value ? { left: `${target.value}%`, width: `${chance.value}%` } : { left: '0%', width: `${chance.value}%` }))

let frame = 0
function animate(to: number): Promise<void> {
    return new Promise((resolve) => {
        const start = performance.now()
        const from = shown.value ?? 50
        const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450
        const step = (now: number) => {
            const t = duration ? Math.min(1, (now - start) / duration) : 1
            const ease = 1 - (1 - t) ** 3
            shown.value = Math.round((from + (to - from) * ease) * 100) / 100
            if (t < 1) frame = requestAnimationFrame(step)
            else resolve()
        }
        frame = requestAnimationFrame(step)
    })
}
onBeforeUnmount(() => cancelAnimationFrame(frame))

async function roll() {
    const response = await round.play({ bet: bet.value, options: { chance: chance.value, over: over.value } })
    if (!response) return
    last.value = null
    await animate(response.result.roll)
    last.value = response.result
    lastPayout.value = response.payout
    history.value = [{ id: response.roundId, label: response.result.roll.toFixed(2), won: response.result.won }, ...history.value].slice(0, 20)
    round.settle()
}

function onKey(event: KeyboardEvent) {
    if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault()
        void roll()
    }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <GameFrame slug="dice">
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div class="order-2 space-y-4 rounded-2xl border bg-card p-4 lg:order-1">
        <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="round.busy.value" />
        <div class="grid grid-cols-2 gap-2">
          <Button size="lg" :variant="over ? 'outline' : 'default'" :disabled="round.busy.value" @click="over = false">Roll under</Button>
          <Button size="lg" :variant="over ? 'default' : 'outline'" :disabled="round.busy.value" @click="over = true">Roll over</Button>
        </div>
        <div class="space-y-3">
          <div class="flex justify-between text-xs text-muted-foreground">
            <span>Win chance</span>
            <span class="font-mono font-semibold text-foreground">{{ chance.toFixed(1) }}%</span>
          </div>
          <Slider
            :model-value="[chance]"
            :min="DICE_MIN_CHANCE"
            :max="DICE_MAX_CHANCE"
            :step="0.5"
            :disabled="round.busy.value"
            class="py-2"
            @update:model-value="value => (chance = value?.[0] ?? chance)"
          />
          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="rounded-xl bg-muted p-2">
              <p class="text-xs text-muted-foreground">Multiplier</p>
              <p class="font-mono font-semibold">{{ multiplier.toFixed(4) }}×</p>
            </div>
            <div class="rounded-xl bg-muted p-2">
              <p class="text-xs text-muted-foreground">Win</p>
              <p class="font-mono font-semibold" :title="`${formatCoinsExact(payFor(bet, multiplier))} coins`">{{ formatCoins(payFor(bet, multiplier)) }}</p>
            </div>
          </div>
        </div>
        <Button size="lg" class="h-12 w-full font-display text-base shadow-[0_3px_0_0_color-mix(in_oklch,var(--primary)_60%,black)] active:translate-y-[2px] active:shadow-none" :disabled="round.busy.value" @click="roll">
          Roll
        </Button>
      </div>

      <div class="order-1 space-y-6 rounded-2xl border bg-card p-4 sm:p-8 lg:order-2">
        <GameRoundHistory :items="history" />
        <div class="py-4 text-center sm:py-8">
          <p
            class="font-display text-6xl font-extrabold tabular-nums transition-colors sm:text-8xl"
            :class="last ? (last.won ? 'text-success' : 'text-destructive') : 'text-foreground'"
          >
            {{ shown === null ? '–' : shown.toFixed(2) }}
          </p>
          <p class="mt-2 h-5 text-sm text-muted-foreground">
            <template v-if="last">{{ last.won ? `Won ${formatCoins(lastPayout)}` : 'No win' }}</template>
          </p>
        </div>
        <div class="relative h-4 rounded-full bg-destructive/25">
          <div class="absolute inset-y-0 rounded-full bg-success/70" :style="winBand" />
          <div
            v-if="shown !== null"
            class="absolute -top-2 h-8 w-1.5 -translate-x-1/2 rounded-full bg-foreground transition-[left] duration-75"
            :style="{ left: `${shown}%` }"
          />
        </div>
        <div class="flex justify-between font-mono text-xs text-muted-foreground">
          <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Pick a win chance and a side. The roll is a number from 0.00 to 99.99; roll under the line (or over it) to win.</p>
      <p>The payout multiplier is 98 ÷ win chance, so every setting returns 98%. Space rolls.</p>
    </template>
  </GameFrame>
</template>
