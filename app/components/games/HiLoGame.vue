<script setup lang="ts">
import { ArrowBigDown, ArrowBigUp, Equal, SkipForward } from 'lucide-vue-next'
import { HILO_SKIPS, hiloMultiplier, hiloOptions, type HiloCard, type HiloGuess, type HiloOption, type HiloView } from '#shared/games/hilo'
import { findGame } from '#shared/games/registry'
import { formatCoins, formatCoinsExact } from '#shared/money'
import type { WinShow } from '~/components/game/WinBurst.vue'

const info = findGame('hilo')!
const game = useStepRound<HiloView>('hilo')

const bet = ref(info.minBet)
const win = ref<WinShow | null>(null)
/** The card on the table (lags the server while the flip plays). */
const shown = ref<HiloCard | null>(null)
const flipping = ref(false)
/** How the last move went, for the card's glow. */
const verdict = ref<'won' | 'lost' | 'skip' | null>(null)
const history = ref<{ id: string, label: string, won: boolean }[]>([])

const round = computed(() => game.round.value)
const view = computed(() => round.value?.view ?? null)
const playing = computed(() => round.value?.status === 'open')
const lost = computed(() => round.value?.status === 'lost')
const options = computed<HiloOption[]>(() => (shown.value ? hiloOptions(shown.value.rank) : hiloOptions(7)))
const cashValue = computed(() => (playing.value ? round.value!.payout : 0))
/** The trail of cards so far, oldest first (the one on the table is not in it). */
const trail = computed(() => (view.value?.steps ?? []).slice(-12))

const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS = [
    // ♠ ♥ ♦ ♣ as chunky paths (24×24).
    'M12 2C9 6.5 3 9.5 3 14.2a4.6 4.6 0 0 0 7.7 3.4L9.4 22h5.2l-1.3-4.4A4.6 4.6 0 0 0 21 14.2C21 9.5 15 6.5 12 2z',
    'M12 21.5s-7.6-4.7-9.6-9.4C.9 8.5 3 4.5 6.7 4.5c2.2 0 3.7 1.3 5.3 3.3 1.6-2 3.1-3.3 5.3-3.3 3.7 0 5.8 4 4.3 7.6-2 4.7-9.6 9.4-9.6 9.4z',
    'M12 1.8 20.2 12 12 22.2 3.8 12z',
    'M12 2.4a4.6 4.6 0 0 0-4 6.9 4.6 4.6 0 1 0 2.7 7.9L9.4 22h5.2l-1.3-4.8a4.6 4.6 0 1 0 2.7-7.9 4.6 4.6 0 0 0-4-6.9z'
]
const red = (card: HiloCard) => card.suit === 1 || card.suit === 2

const multipleFormat = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function times(value: number) {
    return `×${multipleFormat.format(Math.floor(value * 100) / 100)}`
}
const chanceFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 })

const GUESS_LOOK: Record<HiloGuess, { label: string, short: string, tone: string, icon: typeof ArrowBigUp }> = {
    higher: { label: 'Higher', short: 'Hi', tone: 'g-green', icon: ArrowBigUp },
    lower: { label: 'Lower', short: 'Lo', tone: 'g-red', icon: ArrowBigDown },
    same: { label: 'Same', short: '=', tone: 'g-purple', icon: Equal }
}
/** "Higher or same" on 2..Q, plain "Higher" on an ace. */
function guessLabel(option: HiloOption, rank: number) {
    const base = GUESS_LOOK[option.guess].label
    return option.guess !== 'same' && rank > 1 && rank < 13 ? `${base} or same` : base
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let reduced = false

/** Flips the table card to `card`. */
async function flipTo(card: HiloCard) {
    if (reduced) {
        shown.value = card
        return
    }
    flipping.value = true
    await wait(170)
    shown.value = card
    await wait(190)
    flipping.value = false
}

async function deal() {
    if (game.busy.value || playing.value) return
    win.value = null
    verdict.value = null
    const response = await game.start(bet.value)
    if (response) await flipTo(response.round.view.card)
}

async function guess(choice: HiloGuess) {
    if (!playing.value || game.busy.value || flipping.value) return
    win.value = null
    const response = await game.act({ type: 'guess', guess: choice })
    if (!response) return
    const r = response.round
    const step = r.view.steps[r.view.steps.length - 1]!
    await flipTo(r.view.card)
    verdict.value = step.won ? 'won' : 'lost'
    if (r.status !== 'open') await finish()
}

async function skip() {
    if (!playing.value || game.busy.value || flipping.value || !view.value?.skipsLeft) return
    const response = await game.act({ type: 'skip' })
    if (!response) return
    verdict.value = 'skip'
    await flipTo(response.round.view.card)
}

async function cashOut() {
    if (!round.value?.canCashOut || game.busy.value || flipping.value) return
    const response = await game.cashOut()
    if (response) await finish()
}

async function finish() {
    const r = round.value!
    if (r.status === 'lost') await wait(reduced ? 0 : 350)
    win.value = r.status === 'cashed' ? { id: r.id, payout: r.payout, multiplier: Math.floor(r.multiplier * 100) / 100 } : null
    history.value = [{ id: r.id, label: r.status === 'cashed' ? times(r.multiplier) : '×0', won: r.status === 'cashed' }, ...history.value].slice(0, 20)
    game.settle()
}

onMounted(async () => {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const open = await game.resume()
    if (open) {
        bet.value = open.bet
        shown.value = open.view.card
    }
    window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function onKey(event: KeyboardEvent) {
    if (event.target !== document.body) return
    if (event.code === 'Space') {
        event.preventDefault()
        if (playing.value) void cashOut()
        else void deal()
    } else if (playing.value && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) {
        event.preventDefault()
        const want = event.code === 'ArrowUp' ? 'higher' : 'lower'
        const option = options.value.find(o => o.guess === want) ?? options.value.find(o => o.guess === 'same')
        if (option) void guess(option.guess)
    }
}

/** What a right guess on `option` would make the round worth. */
function after(option: HiloOption): number {
    const wins = [...(playing.value ? winsSoFar.value : []), option.wins]
    return hiloMultiplier(wins)
}
const winsSoFar = computed(() => (view.value?.steps ?? []).filter(s => s.won).map(s => hiloOptions(s.card.rank).find(o => o.guess === s.guess)!.wins))
</script>

<template>
  <GameFrame slug="hilo">
    <div class="@container">
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <GameWinBurst v-slot="{ showing }" :show="win" class="rounded-[1.5rem]">
          <GameFelt tone="plum" class="h-full">
            <div class="flex h-full min-h-[17rem] flex-col gap-2 p-3 sm:p-5 @3xl:min-h-[30rem]">
              <!-- The climb so far: every card, with how the call went. -->
              <div class="flex min-h-12 items-center gap-1 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Cards so far">
                <TransitionGroup name="hilo-trail">
                  <div
                    v-for="(step, i) in trail" :key="`${round?.id}:${(view?.steps.length ?? 0) - trail.length + i}`"
                    class="hilo-mini relative grid h-11 w-8 shrink-0 place-items-center rounded-md bg-white font-[family-name:var(--font-game)] text-base leading-none"
                    :class="red(step.card) ? 'text-[#e11d48]' : 'text-[#2a1b30]'"
                  >
                    {{ RANKS[step.card.rank] }}
                    <span
                      class="absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full text-[11px] text-white ring-2 ring-[#2a1b30]"
                      :class="step.guess === null ? 'bg-[#6b6480]' : step.won ? 'bg-[#3fd25a]' : 'bg-[#ff5470]'"
                    >
                      <component :is="step.guess === null ? SkipForward : GUESS_LOOK[step.guess].icon" class="size-3" :stroke-width="3" />
                    </span>
                  </div>
                </TransitionGroup>
              </div>

              <div class="relative grid flex-1 place-items-center py-2">
                <div class="flex items-center gap-4 sm:gap-8">
                  <!-- The deck. -->
                  <div class="hilo-deck relative hidden h-36 w-24 shrink-0 @sm:block sm:h-44 sm:w-30" aria-hidden="true">
                    <span v-for="i in 3" :key="i" class="hilo-back absolute inset-0 rounded-xl" :style="{ transform: `translate(${(3 - i) * 3}px, ${(3 - i) * -3}px)` }" />
                  </div>

                  <!-- The card on the table: flips on every draw. -->
                  <div class="hilo-stage relative h-48 w-32 shrink-0 sm:h-60 sm:w-40" :class="flipping ? 'hilo-flipping' : ''">
                    <div
                      class="hilo-card absolute inset-0 rounded-2xl"
                      :class="[verdict === 'won' ? 'hilo-won' : verdict === 'lost' && lost ? 'hilo-lost' : '', shown ? '' : 'hilo-blank']"
                    >
                      <template v-if="shown">
                        <div class="absolute top-2 left-2.5 flex flex-col items-center leading-none" :class="red(shown) ? 'text-[#e11d48]' : 'text-[#2a1b30]'">
                          <span class="font-[family-name:var(--font-game)] text-3xl sm:text-4xl">{{ RANKS[shown.rank] }}</span>
                          <svg viewBox="0 0 24 24" class="size-5 sm:size-6" aria-hidden="true"><path :d="SUITS[shown.suit]" fill="currentColor" /></svg>
                        </div>
                        <svg viewBox="0 0 24 24" class="absolute top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_3px_0_rgba(0,0,0,.15)] sm:size-20" :class="red(shown) ? 'text-[#e11d48]' : 'text-[#2a1b30]'" aria-hidden="true">
                          <path :d="SUITS[shown.suit]" fill="currentColor" />
                        </svg>
                        <div class="absolute right-2.5 bottom-2 flex flex-col-reverse items-center leading-none" :class="red(shown) ? 'text-[#e11d48]' : 'text-[#2a1b30]'">
                          <span class="font-[family-name:var(--font-game)] text-3xl sm:text-4xl">{{ RANKS[shown.rank] }}</span>
                          <svg viewBox="0 0 24 24" class="size-5 sm:size-6" aria-hidden="true"><path :d="SUITS[shown.suit]" fill="currentColor" /></svg>
                        </div>
                        <span class="sr-only">{{ RANKS[shown.rank] }}</span>
                      </template>
                      <span v-if="lost && verdict === 'lost'" class="hilo-x g-num absolute inset-0 grid place-items-center rounded-2xl bg-[#ff5470]/25 text-6xl text-[#ff5470]">×0</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- The pot. -->
              <div class="flex h-10 items-center justify-center transition-opacity duration-150" :class="showing ? 'opacity-0' : ''">
                <p
                  v-if="playing && round?.canCashOut"
                  :key="round?.step"
                  class="hilo-pot g-title inline-flex items-center gap-1.5 rounded-full bg-[#3fd25a] px-3 py-0.5 text-base text-white sm:text-lg"
                >
                  {{ times(round.multiplier) }} <span class="opacity-60">·</span> <CasinoChipIcon class="size-4" /> {{ formatCoins(cashValue) }}
                </p>
                <p v-else-if="playing" class="g-title rounded-full bg-black/30 px-3 py-0.5 text-sm text-white/85 sm:text-base">Higher or lower?</p>
                <p v-else-if="!round" class="g-title rounded-full bg-black/30 px-3 py-0.5 text-sm text-white/85 sm:text-base">Deal a card to start the climb</p>
              </div>
            </div>
          </GameFelt>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="playing || game.busy.value" />

          <!-- The two calls on this card, with what each makes the round worth. -->
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="option in options" :key="option.guess"
              type="button"
              class="g-btn h-20 flex-col gap-0 rounded-2xl leading-tight"
              :class="GUESS_LOOK[option.guess].tone"
              :disabled="!playing || game.busy.value || flipping"
              :aria-label="`${guessLabel(option, shown?.rank ?? 7)}, ${chanceFormat.format(option.chance * 100)}% chance`"
              @click="guess(option.guess)"
            >
              <span class="flex items-center gap-1 text-xl"><component :is="GUESS_LOOK[option.guess].icon" class="size-6" :stroke-width="2.75" />{{ GUESS_LOOK[option.guess].label }}</span>
              <span class="font-[family-name:var(--font-round)] text-[11px] font-bold opacity-85">{{ option.guess !== 'same' && (shown?.rank ?? 7) > 1 && (shown?.rank ?? 7) < 13 ? 'or same · ' : '' }}{{ chanceFormat.format(option.chance * 100) }}%</span>
              <span class="g-num text-lg">{{ times(after(option)) }}</span>
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2 text-center">
            <button
              type="button"
              class="g-btn g-dark h-14 flex-col gap-0 rounded-2xl text-lg leading-tight"
              :disabled="!playing || game.busy.value || flipping || !view?.skipsLeft"
              @click="skip"
            >
              <span class="flex items-center gap-1"><SkipForward class="size-5" :stroke-width="2.75" /> Skip</span>
              <span class="font-[family-name:var(--font-round)] text-[11px] font-bold opacity-80">{{ playing ? view?.skipsLeft : HILO_SKIPS }} left</span>
            </button>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Cash out</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl text-[var(--g-green)]" :title="`${formatCoinsExact(cashValue)} chips`">
                <CasinoChipIcon class="size-4" />{{ formatCoins(cashValue) }}
              </p>
            </div>
          </div>

          <!-- Sticks to the bottom of the sheet, so the big button never scrolls out of reach on a phone. -->
          <div class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto rounded-b-[1.4rem] bg-[var(--g-panel)] px-3 pt-1 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            <button
              v-if="playing"
              type="button"
              class="g-btn g-gold h-16 w-full flex-col gap-0 rounded-2xl leading-none"
              :disabled="game.busy.value || flipping || !round?.canCashOut"
              @click="cashOut"
            >
              <span class="text-2xl uppercase">Cash out</span>
              <span v-if="round?.canCashOut" class="flex items-center gap-1 font-[family-name:var(--font-round)] text-sm font-bold"><CasinoChipIcon class="size-3.5" />{{ formatCoins(cashValue) }}</span>
              <span v-else class="font-[family-name:var(--font-round)] text-sm font-bold opacity-80">Make a right call first</span>
            </button>
            <button v-else type="button" class="g-btn g-orange h-16 w-full rounded-2xl text-3xl uppercase" :disabled="game.busy.value" @click="deal">
              Deal
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Deal a card, then call whether the next one is higher or lower. Ranks run from A (low) to K (high); on 2 to Q a call wins on the same rank too, an ace offers higher or same, a king lower or same. Every card comes from a freshly shuffled deck.</p>
      <p>A right call multiplies the round by 13 ÷ the ranks it wins on, a wrong one ends it with nothing. The round starts at ×0,975, so cashing out at any point returns 97,5%. Skip up to {{ HILO_SKIPS }} cards a round. A round you leave stays open; after a day without a move it is cashed out for you (or refunded before the first right call). Space deals and cashes out, the arrow keys call.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.hilo-stage { perspective: 900px; }
.hilo-card {
    background: linear-gradient(180deg, #ffffff, #f3ead8);
    border: 4px solid #2a1b30;
    box-shadow: 0 7px 0 #1a0f22, 0 18px 30px rgb(0 0 0 / 0.4);
    transition: transform 0.17s ease-in, box-shadow 0.2s ease;
    transform-style: preserve-3d;
}
.hilo-blank, .hilo-back {
    background: repeating-linear-gradient(45deg, #c2187a 0 9px, #e0489a 9px 18px);
    border: 4px solid #2a1b30;
}
.hilo-back { box-shadow: 0 5px 0 #1a0f22; }
.hilo-blank::after, .hilo-back::after {
    content: '';
    position: absolute;
    inset: 8px;
    border-radius: 10px;
    border: 3px solid rgb(255 255 255 / 0.7);
}
.hilo-flipping .hilo-card { transform: rotateY(90deg) scale(0.96); }
.hilo-won { box-shadow: 0 7px 0 #1a0f22, 0 0 0 4px #3fd25a, 0 0 32px 6px rgb(63 210 90 / 0.6); }
.hilo-lost { box-shadow: 0 7px 0 #1a0f22, 0 0 0 4px #ff5470, 0 0 32px 6px rgb(255 84 112 / 0.6); animation: hilo-thud 0.35s ease-out; }
.hilo-x { animation: hilo-x 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.5); text-shadow: 0 3px 0 #7a1022; }
.hilo-pot { animation: hilo-pot 0.35s cubic-bezier(0.3, 0.7, 0.4, 1.5); }
.hilo-mini { border: 2px solid #2a1b30; box-shadow: 0 2px 0 #1a0f22; }
.hilo-trail-enter-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.hilo-trail-enter-from { opacity: 0; transform: translateY(-8px) scale(0.8); }
@keyframes hilo-thud { 0% { translate: 0; } 25% { translate: -7px; } 50% { translate: 6px; } 75% { translate: -3px; } 100% { translate: 0; } }
@keyframes hilo-x { from { transform: scale(1.4); opacity: 0; } }
@keyframes hilo-pot { 0% { transform: scale(0.85); } 55% { transform: scale(1.1); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
    .hilo-card { transition: none; }
    .hilo-lost, .hilo-x, .hilo-pot { animation: none; }
    .hilo-trail-enter-active { transition: none; }
}
</style>
