<script setup lang="ts">
import { ChevronsLeft, ChevronsRight } from 'lucide-vue-next'
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { DICE_MAX_CHANCE, DICE_MIN_CHANCE, diceMultiplier, type DiceResult } from '#shared/games/dice'
import { findGame } from '#shared/games/registry'
import { formatCoins, formatCoinsExact, payFor } from '#shared/money'
import type { WinShow } from '~/components/game/WinBurst.vue'

const info = findGame('dice')!
const round = useGameRound<DiceResult>('dice')

const bet = ref(info.minBet)
const chance = ref(50)
const over = ref(false)
const shown = ref<number | null>(null)
const rolling = ref(false)
const last = ref<DiceResult | null>(null)
const win = ref<WinShow | null>(null)
const history = ref<{ id: string, label: string, won: boolean }[]>([])

const presets = [
    { value: 10, face: '#a855f7', edge: '#6b21a8' },
    { value: 25, face: '#3b82f6', edge: '#1e40af' },
    { value: 50, face: '#22c55e', edge: '#15803d' },
    { value: 75, face: '#f59e0b', edge: '#b45309' },
    { value: 90, face: '#ef4444', edge: '#991b1b' }
]
const multiplier = computed(() => diceMultiplier(chance.value))
const payout = computed(() => payFor(bet.value, multiplier.value))
const target = computed(() => (over.value ? 100 - chance.value : chance.value))
const winBand = computed(() => (over.value ? { left: `${target.value}%`, width: `${chance.value}%` } : { left: '0%', width: `${chance.value}%` }))
const multiplierFormat = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const multiplierText = computed(() => `×${multiplierFormat.format(multiplier.value)}`)
const chanceFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 })
// The fill and its head move with transforms only.
const progress = computed(() => Math.max(0, Math.min(100, shown.value ?? 0)))
const landed = computed(() => (last.value ? (last.value.won ? 'won' : 'lost') : null))
/**
 * One hero in the middle of the felt at a time: the condition before a roll
 * (dimmed while the roll races along the track), nothing after a win (the
 * win itself holds the centre), a quiet ×0 after a loss.
 */
const hero = computed(() => (landed.value === 'won' ? 'win' : landed.value === 'lost' ? 'loss' : 'target'))

let frame = 0
/**
 * The bar fills from 0 to the roll, speeding up as it goes (constant
 * acceleration): a low roll lands almost at once, a high one a little later,
 * and even 99 takes under a second.
 */
function fill(to: number): Promise<void> {
    return new Promise((resolve) => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const duration = reduced ? 0 : 700 * Math.sqrt(Math.max(0, to) / 100)
        const start = performance.now()
        const step = (now: number) => {
            const t = duration ? Math.min(1, (now - start) / duration) : 1
            shown.value = Math.round(to * t * t * 100) / 100
            if (t < 1) frame = requestAnimationFrame(step)
            else resolve()
        }
        shown.value = 0
        frame = requestAnimationFrame(step)
    })
}
onBeforeUnmount(() => cancelAnimationFrame(frame))

async function roll() {
    if (round.busy.value) return
    // The next roll clears the last result at once.
    win.value = null
    last.value = null
    rolling.value = true
    const response = await round.play({ bet: bet.value, options: { chance: chance.value, over: over.value } })
    if (!response) {
        rolling.value = false
        return
    }
    await fill(response.result.roll)
    rolling.value = false
    last.value = response.result
    win.value = { id: response.roundId, payout: response.payout, multiplier: response.result.won ? response.result.multiplier : 0 }
    history.value = [{ id: response.roundId, label: formatFixed(response.result.roll, 2), won: response.result.won }, ...history.value].slice(0, 20)
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
    <div class="@container">
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <GameWinBurst :show="win" class="rounded-[1.5rem] [--wb-lift:8rem] sm:[--wb-lift:8.5rem]">
          <GameFelt tone="green" class="h-full">
            <div class="flex h-full min-h-[19.5rem] flex-col p-3 sm:p-5 @3xl:min-h-[30rem]">
              <!-- One hero at a time: the condition, or a quiet ×0 (a win shows itself on top). -->
              <div class="grid min-h-0 flex-1 place-items-center py-2" aria-live="polite">
                <Transition name="dice-hero" mode="out-in">
                  <div v-if="hero === 'target'" key="target" class="text-center transition-opacity duration-200" :class="rolling ? 'opacity-30' : ''">
                    <p class="g-title inline-flex items-center gap-1 text-sm tracking-wide text-white/70 uppercase sm:text-base">
                      <component :is="over ? ChevronsRight : ChevronsLeft" class="size-4" /> Roll {{ over ? 'over' : 'under' }}
                    </p>
                    <p class="dice-target leading-[.95] tabular-nums">{{ formatFixed(target, 2) }}</p>
                  </div>
                  <div v-else-if="hero === 'loss'" key="loss" class="dice-zero text-center">
                    <p class="dice-loss leading-none">×0</p>
                    <p class="mt-1 text-xs font-semibold text-white/55 sm:text-sm">needed {{ over ? 'over' : 'under' }} {{ formatFixed(target, 2) }}</p>
                  </div>
                  <span v-else key="win" />
                </Transition>
              </div>

              <!-- The track: win zone, target line, and the fill racing to the roll. -->
              <div class="px-1 pt-11 pb-1">
                <div class="relative">
                  <div class="rounded-full bg-black/45 p-1.5 shadow-[inset_0_3px_6px_rgba(0,0,0,.5),0_1px_0_rgba(255,255,255,.12)]">
                    <div class="relative h-9 overflow-hidden rounded-full bg-[#ff5470]/45 sm:h-11 @3xl:h-12">
                      <div class="dice-zone absolute inset-y-0" :style="winBand" />
                      <div
                        class="absolute inset-0 origin-left bg-white/35"
                        :class="landed === 'won' ? 'bg-white/45' : landed === 'lost' ? 'bg-black/30' : ''"
                        :style="{ transform: `scaleX(${progress / 100})` }"
                      />
                      <span v-for="tick in [25, 50, 75]" :key="tick" class="absolute inset-y-2 w-px bg-white/25" :style="{ left: `${tick}%` }" />
                      <div class="absolute inset-y-0 w-1 -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(255,255,255,.9)]" :style="{ left: `${target}%` }" />
                    </div>
                  </div>

                  <!-- The head: rides the fill, with the roll on a puck above the track. -->
                  <div v-if="shown !== null" class="pointer-events-none absolute inset-x-1.5 inset-y-0">
                    <div class="absolute inset-0" :style="{ transform: `translateX(${progress}%)` }">
                      <span class="absolute -inset-y-1 left-0 w-2 -translate-x-1/2 rounded-full bg-white shadow-[0_0_14px_4px_rgba(255,255,255,.65)]" />
                      <span class="absolute bottom-full left-0 mb-0.5 size-0 -translate-x-1/2 border-x-[7px] border-t-[8px] border-x-transparent" :class="landed === 'won' ? 'border-t-[#3fd25a]' : landed === 'lost' ? 'border-t-[#ff5470]' : 'border-t-white'" />
                      <span
                        class="dice-puck g-num absolute bottom-full left-0 mb-2 rounded-xl px-2.5 py-0.5 text-xl whitespace-nowrap shadow-[0_3px_0_rgba(0,0,0,.35)] sm:text-2xl"
                        :class="landed === 'won' ? 'bg-[#3fd25a] text-white' : landed === 'lost' ? 'bg-[#ff5470] text-white' : 'bg-white text-[#14532d] [text-shadow:none]'"
                        :style="{ transform: `translateX(-${progress}%)` }"
                      >{{ formatFixed(shown, 2) }}</span>
                    </div>
                  </div>
                </div>
                <div class="relative mt-1.5 h-6 font-mono text-xs text-white/55">
                  <span class="absolute left-1">0</span>
                  <span class="absolute right-1">100</span>
                  <span
                    class="g-num absolute top-0 -translate-x-1/2 rounded-md bg-white px-1.5 text-sm text-[#14532d] [text-shadow:none]"
                    :style="{ left: `clamp(1.75rem, ${target}%, calc(100% - 1.75rem))` }"
                  >{{ formatFixed(target, 2) }}</span>
                </div>
              </div>
              <GameRoundHistory :items="history" compact class="mt-1 px-1" />
            </div>
          </GameFelt>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="round.busy.value" />

          <div role="radiogroup" aria-label="Side" class="grid grid-cols-2 gap-2">
            <button
              type="button" role="radio" :aria-checked="!over" :disabled="round.busy.value"
              class="g-btn h-12 rounded-2xl text-lg" :class="over ? 'g-dark opacity-70' : 'g-purple'"
              @click="over = false"
            >
              <ChevronsLeft class="size-5" /> Under
            </button>
            <button
              type="button" role="radio" :aria-checked="over" :disabled="round.busy.value"
              class="g-btn h-12 rounded-2xl text-lg" :class="over ? 'g-purple' : 'g-dark opacity-70'"
              @click="over = true"
            >
              Over <ChevronsRight class="size-5" />
            </button>
          </div>

          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Chance</p>
              <p class="g-num truncate text-2xl">{{ chanceFormat.format(chance) }}%</p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Payout</p>
              <p class="g-num truncate text-[var(--g-gold)]" :class="multiplierText.length > 5 ? 'text-lg leading-8' : 'text-2xl'" :title="`${formatFixed(multiplier, 4)}×`">{{ multiplierText }}</p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Win</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl text-[var(--g-green)]" :title="`${formatCoinsExact(payout)} chips`">
                <CasinoChipIcon class="size-4" />{{ formatCoins(payout) }}
              </p>
            </div>
          </div>

          <SliderRoot
            :model-value="[chance]"
            :min="DICE_MIN_CHANCE"
            :max="DICE_MAX_CHANCE"
            :step="0.5"
            :disabled="round.busy.value"
            aria-label="Win chance"
            class="relative flex h-11 w-full touch-none items-center select-none data-[disabled]:opacity-60"
            @update:model-value="value => (chance = value?.[0] ?? chance)"
          >
            <SliderTrack class="g-well relative h-3 grow overflow-hidden rounded-full">
              <SliderRange class="absolute h-full rounded-full bg-[var(--g-green)]" />
            </SliderTrack>
            <SliderThumb class="block size-7 rounded-full border-[3px] border-[var(--g-green-edge)] bg-white shadow-[0_3px_0_rgba(0,0,0,.4)] outline-none focus-visible:ring-4 focus-visible:ring-white/50" />
          </SliderRoot>

          <div class="flex items-center justify-between gap-1">
            <button
              v-for="p in presets" :key="p.value"
              type="button"
              class="dice-chip grid size-12 shrink-0 place-items-center rounded-full font-[family-name:var(--font-game)] text-sm text-white transition disabled:opacity-40"
              :class="chance === p.value ? 'dice-chip-on' : ''"
              :style="{ '--face': p.face, '--edge': p.edge }"
              :disabled="round.busy.value || p.value > DICE_MAX_CHANCE"
              :aria-pressed="chance === p.value"
              :aria-label="`${p.value}% chance`"
              @click="chance = p.value"
            >
              {{ p.value }}%
            </button>
          </div>

          <!-- Sticks to the bottom of the sheet, so Roll never scrolls out of reach on a phone. -->
          <div class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto rounded-b-[1.4rem] bg-[var(--g-panel)] px-3 pt-1 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            <button type="button" class="g-btn g-green h-16 w-full rounded-2xl text-3xl uppercase" :disabled="round.busy.value" @click="roll">
              {{ rolling ? 'Rolling…' : 'Roll' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Pick a win chance and a side. The roll is a number from 0.00 to 99.99; roll under the line (or over it) to win.</p>
      <p>The payout multiplier is 98 ÷ win chance, so every setting returns 98%. Space rolls.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.dice-target {
    font-family: var(--font-game);
    letter-spacing: 0.01em;
    font-size: clamp(3rem, 16cqw, 6rem);
    color: #fff;
    text-shadow: 0 5px 0 rgb(0 0 0 / 0.35);
}
.dice-loss {
    font-family: var(--font-game);
    font-size: clamp(2.25rem, 10cqw, 3.5rem);
    color: #ffc2cc;
    text-shadow: 0 4px 0 rgb(0 0 0 / 0.35);
}
.dice-zero { animation: dice-thud 0.35s ease-out; }
.dice-hero-enter-active, .dice-hero-leave-active { transition: opacity 0.15s ease, transform 0.2s ease; }
.dice-hero-enter-from, .dice-hero-leave-to { opacity: 0; transform: scale(0.94); }
.dice-zone {
    background: repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.1) 0 8px, transparent 8px 16px), linear-gradient(180deg, #5ef07a, #2fb84b);
    box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.35);
}
.dice-chip {
    background: radial-gradient(circle, var(--face) 0 52%, transparent 53%), repeating-conic-gradient(#fff 0 15deg, var(--face) 15deg 45deg);
    border: 2px solid var(--edge);
    box-shadow: 0 3px 0 var(--edge), inset 0 0 0 3px var(--face);
    text-shadow: 0 1.5px 0 rgb(0 0 0 / 0.45);
}
.dice-chip:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 var(--edge), inset 0 0 0 3px var(--face); }
.dice-chip-on { transform: translateY(-3px) scale(1.08); box-shadow: 0 5px 0 var(--edge), 0 0 0 3px #fff, 0 0 16px rgb(255 255 255 / 0.5); }
@keyframes dice-thud { 0% { transform: translateX(0); } 25% { transform: translateX(-6px); } 50% { transform: translateX(5px); } 75% { transform: translateX(-2px); } 100% { transform: translateX(0); } }
@media (prefers-reduced-motion: reduce) {
    .dice-zero { animation: none; }
    .dice-hero-enter-active, .dice-hero-leave-active { transition: none; }
    .dice-chip, .dice-chip-on { transition: none; }
}
</style>
