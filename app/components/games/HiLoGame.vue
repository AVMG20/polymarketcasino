<script setup lang="ts">
import { ArrowBigDown, ArrowBigUp, Equal, SkipForward } from 'lucide-vue-next'
import type { Rank, Suit } from '#shared/tables/cards'
import { HILO_SKIPS, hiloMultiplier, hiloOptions, hiloWins, type HiloCard, type HiloGuess, type HiloOption, type HiloView } from '#shared/games/hilo'
import { findGame } from '#shared/games/registry'
import { formatCoins, formatCoinsExact, payFor } from '#shared/money'
import type { WinShow } from '~/components/game/WinBurst.vue'
import { cardBack, cardFace } from '~/utils/live-table/art'

const info = findGame('hilo')!
const game = useStepRound<HiloView>('hilo')

const bet = ref(info.minBet)
const win = ref<WinShow | null>(null)
/** The card on the table (lags the server while the deal plays); `deal` bumps for every new card. */
const shown = ref<HiloCard | null>(null)
const deal = ref(0)
const dealing = ref(false)
/** How the last move went, for the card's glow. */
const verdict = ref<'won' | 'lost' | 'skip' | null>(null)
const history = ref<{ id: string, label: string, won: boolean }[]>([])
const sound = useGameSound()

const round = computed(() => game.round.value)
const view = computed(() => round.value?.view ?? null)
const playing = computed(() => round.value?.status === 'open')
const lost = computed(() => round.value?.status === 'lost')
const options = computed<HiloOption[]>(() => (shown.value ? hiloOptions(shown.value.rank) : hiloOptions(7)))
const cashValue = computed(() => (playing.value ? round.value!.payout : 0))
const stakeBet = computed(() => (playing.value ? round.value!.bet : bet.value))
/** The climb so far, oldest first: the card every move was made on (the one on the table is not in it). */
const trail = computed(() => (view.value?.steps ?? []).slice(0, dealing.value ? -1 : undefined))
const skipsLeft = computed(() => (playing.value ? view.value?.skipsLeft ?? 0 : HILO_SKIPS))
const busy = computed(() => game.busy.value || dealing.value)

const RANK_NAMES: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUIT_NAMES: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const BACK = cardBack()
const faceOf = (card: HiloCard) => cardFace(RANK_NAMES[card.rank - 1]!, SUIT_NAMES[card.suit]!)
const rankName = (card: HiloCard) => RANK_NAMES[card.rank - 1]!

const multipleFormat = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function times(value: number) {
    return `×${multipleFormat.format(Math.floor(value * 100) / 100)}`
}
const chanceFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 })

const GUESS_LOOK: Record<HiloGuess, { label: string, face: string, edge: string, icon: typeof ArrowBigUp }> = {
    higher: { label: 'Higher', face: '#3fd25a', edge: '#1b8a33', icon: ArrowBigUp },
    lower: { label: 'Lower', face: '#ff9a2e', edge: '#c25a0b', icon: ArrowBigDown },
    same: { label: 'Same', face: '#a879ff', edge: '#6436c4', icon: Equal }
}
/** "Higher or same" on 2..Q, plain "Higher" on an ace. */
function orSame(option: HiloOption, rank: number) {
    return option.guess !== 'same' && rank > 1 && rank < 13
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let reduced = false

/** Deals `card` onto the table: the old card slides off to the climb, the new one flips over from the deck. */
async function dealTo(card: HiloCard) {
    shown.value = card
    deal.value++
    sound.deal(reduced ? 0 : 0.26)
    if (reduced) return
    dealing.value = true
    await wait(430)
    dealing.value = false
}

async function start() {
    if (busy.value || playing.value) return
    win.value = null
    verdict.value = null
    const response = await game.start(bet.value)
    if (response) await dealTo(response.round.view.card)
}

async function guess(choice: HiloGuess) {
    if (!playing.value || busy.value) return
    verdict.value = null
    const response = await game.act({ type: 'guess', guess: choice })
    if (!response) return
    const r = response.round
    const step = r.view.steps[r.view.steps.length - 1]!
    await dealTo(r.view.card)
    verdict.value = step.won ? 'won' : 'lost'
    if (step.won) sound.ding(r.view.steps.filter(s => s.won && s.guess).length)
    else sound.thud()
    if (r.status !== 'open') await finish()
}

async function skip() {
    if (!playing.value || busy.value || !view.value?.skipsLeft) return
    verdict.value = null
    const response = await game.act({ type: 'skip' })
    if (!response) return
    await dealTo(response.round.view.card)
    verdict.value = 'skip'
}

async function cashOut() {
    if (!round.value?.canCashOut || busy.value) return
    const response = await game.cashOut()
    if (!response) return
    sound.register()
    await finish()
}

async function finish() {
    const r = round.value!
    if (r.status === 'lost') await wait(reduced ? 0 : 450)
    win.value = r.status === 'cashed' ? { id: r.id, payout: r.payout, multiplier: Math.floor(r.multiplier * 100) / 100 } : null
    history.value = [{ id: r.id, label: r.status === 'cashed' ? times(r.multiplier) : '×0', won: r.status === 'cashed' }, ...history.value].slice(0, 20)
    game.settle()
}

/** The table card: deals between rounds, nothing during one. */
function tapCard() {
    if (!playing.value) void start()
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
        else void start()
    } else if (playing.value && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) {
        event.preventDefault()
        const want = event.code === 'ArrowUp' ? 'higher' : 'lower'
        const option = options.value.find(o => o.guess === want) ?? options.value.find(o => o.guess === 'same')
        if (option) void guess(option.guess)
    } else if (playing.value && event.code === 'KeyS') {
        void skip()
    }
}

const winsSoFar = computed(() => (view.value?.steps ?? []).filter(s => s.won && s.guess).map(s => hiloOptions(s.card.rank).find(o => o.guess === s.guess)!.wins))
/** What a right call on `option` would make the round worth. */
function after(option: HiloOption): number {
    return hiloMultiplier([...(playing.value ? winsSoFar.value : []), option.wins])
}

/** Every rank and which call wins on it, for the strip under the calls. */
const rankStrip = computed(() => {
    const rank = shown.value?.rank ?? 7
    return RANK_NAMES.map((name, i) => {
        const r = i + 1
        const wins = options.value.filter(o => hiloWins(rank, o.guess, r)).map(o => o.guess)
        return { name, r, here: r === rank && !!shown.value, wins }
    })
})
function stripFill(wins: HiloGuess[]): string {
    const colours = wins.map(g => GUESS_LOOK[g].face)
    if (!colours.length) return 'rgb(0 0 0 / 0.35)'
    if (colours.length === 1) return colours[0]!
    return `linear-gradient(135deg, ${colours[0]} 0 50%, ${colours[1]} 50% 100%)`
}

// The climb scrolls along with the newest card.
const ladder = ref<HTMLDivElement | null>(null)
watch(() => trail.value.length, () => nextTick(() => ladder.value?.scrollTo({ left: ladder.value.scrollWidth, behavior: reduced ? 'auto' : 'smooth' })))
</script>

<template>
  <GameFrame slug="hilo">
    <template #actions>
      <GameSoundToggle />
    </template>
    <div class="@container/game">
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <GameWinBurst v-slot="{ showing }" :show="win" class="rounded-[1.5rem] [--wb-lift:2rem]">
          <GameFelt tone="plum" class="hilo-stage h-full">
            <div class="flex h-full flex-col gap-2 p-2.5 sm:gap-3 sm:p-4">
              <!-- The climb so far: every card, with how the call on it went. -->
              <div ref="ladder" class="hilo-ladder flex h-[4.25rem] shrink-0 items-center gap-1 overflow-x-auto rounded-2xl bg-black/25 px-2 [scrollbar-width:none] sm:h-[4.75rem]" aria-label="Cards so far">
                <p v-if="!trail.length" class="g-title w-full text-center text-sm text-white/45">{{ playing ? 'Your climb starts here' : 'Call higher or lower, card after card' }}</p>
                <TransitionGroup name="hilo-trail">
                  <div v-for="(step, i) in trail" :key="`${round?.id}:${i}`" class="flex shrink-0 items-center gap-1">
                    <span v-if="i > 0" class="h-0.5 w-2 shrink-0 rounded-full bg-white/25 sm:w-3" aria-hidden="true" />
                    <div class="relative shrink-0" :title="step.guess === null ? 'Skipped' : `${GUESS_LOOK[step.guess].label}: ${step.won ? 'right' : 'wrong'}`">
                      <span class="hilo-mini block" :class="step.guess === null ? 'opacity-55' : ''" v-html="faceOf(step.card)" />
                      <span
                        class="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full text-white ring-2 ring-[#2a1035] sm:size-6"
                        :class="step.guess === null ? 'bg-[#6b6480]' : step.won ? 'bg-[#3fd25a]' : 'bg-[#ff5470]'"
                      >
                        <component :is="step.guess === null ? SkipForward : GUESS_LOOK[step.guess].icon" class="size-3 sm:size-3.5" :stroke-width="3" />
                      </span>
                    </div>
                  </div>
                </TransitionGroup>
              </div>

              <!-- The table: the deck and the card in play. -->
              <div class="hilo-table relative min-h-0 flex-1">
                <div class="flex h-full items-center justify-center gap-[6cqw]">
                  <div class="hilo-deck relative hidden shrink-0 @md:block" aria-hidden="true">
                    <span v-for="i in 4" :key="i" class="hilo-deck-card absolute inset-0" :style="{ transform: `translate(${(4 - i) * -2}px, ${(4 - i) * 2}px)` }" v-html="BACK" />
                  </div>

                  <div class="relative shrink-0">
                    <button
                      type="button"
                      class="hilo-card-slot relative block"
                      :class="[!playing && !busy ? 'cursor-pointer' : 'cursor-default', verdict === 'lost' && lost ? 'hilo-thud' : '']"
                      :disabled="playing || busy"
                      :aria-label="shown ? `${rankName(shown)} on the table${playing ? '' : '. Deal a new card'}` : 'Deal a card'"
                      @click="tapCard"
                    >
                      <Transition name="hilo-deal">
                        <div
                          :key="deal"
                          class="hilo-card absolute inset-0"
                          :class="[verdict === 'won' ? 'hilo-won' : verdict === 'lost' && lost ? 'hilo-lost' : '', shown ? '' : 'hilo-down']"
                        >
                          <span class="hilo-face" v-html="shown ? faceOf(shown) : BACK" />
                          <span class="hilo-back" v-html="BACK" />
                        </div>
                      </Transition>
                      <span v-if="lost && verdict === 'lost' && !dealing" class="hilo-veil pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[8%]">
                        <span class="hilo-x g-num rounded-2xl bg-[#ff5470] px-4 py-1 text-5xl text-white sm:text-6xl">×0</span>
                      </span>
                      <span v-if="!playing && !busy" class="hilo-tap g-title pointer-events-none absolute inset-x-0 -bottom-3 z-10 mx-auto w-fit rounded-full bg-[#ff9a2e] px-3 py-0.5 text-sm text-white shadow-[0_3px_0_#c25a0b]">Deal</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- The pot: what the round is worth now. -->
              <div class="flex h-11 shrink-0 items-center justify-center transition-opacity duration-150" :class="showing ? 'opacity-0' : ''" aria-live="polite">
                <p
                  v-if="playing && round?.canCashOut"
                  :key="round?.step"
                  class="hilo-pot g-num inline-flex items-center gap-2 rounded-full bg-black/40 py-1 pr-4 pl-1.5 text-xl ring-2 ring-[#3fd25a]/60 sm:text-2xl"
                >
                  <span class="rounded-full bg-[#3fd25a] px-2.5 py-0.5 text-lg text-white sm:text-xl">{{ times(round.multiplier) }}</span>
                  <CasinoChipIcon class="size-5" />{{ formatCoins(cashValue) }}
                </p>
                <p v-else-if="playing" class="g-title rounded-full bg-black/30 px-3 py-1 text-sm text-white/85 sm:text-base">Higher or lower?</p>
                <p v-else-if="lost" class="g-title rounded-full bg-[#ff5470]/25 px-3 py-1 text-sm text-[#ffc2cc] sm:text-base">Wrong call · ×0</p>
                <GameRoundHistory v-else :items="history" compact class="max-w-full px-1" />
              </div>
            </div>
          </GameFelt>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <!-- On a phone the bet makes way for the calls while a round runs (it is locked then anyway). -->
          <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="playing || busy" :class="playing ? '@max-3xl:hidden' : ''" />

          <!-- The two calls on this card: their odds and what each makes the round worth. -->
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="option in options" :key="option.guess"
              type="button"
              class="g-btn hilo-call h-[5.5rem] flex-col gap-0 rounded-2xl leading-none @3xl:h-[7.5rem]"
              :style="{ '--face': GUESS_LOOK[option.guess].face, '--edge': GUESS_LOOK[option.guess].edge }"
              :disabled="!playing || busy"
              :aria-label="`${GUESS_LOOK[option.guess].label}${orSame(option, shown?.rank ?? 7) ? ' or same' : ''}, ${chanceFormat.format(option.chance * 100)}% chance, pays ${times(after(option))}`"
              @click="guess(option.guess)"
            >
              <span class="flex items-center gap-0.5 text-xl @3xl:text-2xl"><component :is="GUESS_LOOK[option.guess].icon" class="size-6 @3xl:size-7" :stroke-width="2.75" />{{ GUESS_LOOK[option.guess].label }}</span>
              <span class="mt-0.5 font-[family-name:var(--font-round)] text-[11px] font-bold opacity-90">{{ orSame(option, shown?.rank ?? 7) ? 'or same · ' : '' }}{{ chanceFormat.format(option.chance * 100) }}%</span>
              <span class="hilo-pay g-num mt-1 rounded-full bg-black/25 px-2 py-0.5 text-base [text-shadow:none] @3xl:mt-2 @3xl:px-3 @3xl:text-xl" :title="`${formatCoinsExact(payFor(stakeBet, after(option)))} chips`">{{ times(after(option)) }}</span>
            </button>
          </div>

          <!-- Which ranks each call wins on: green for higher, orange for lower, the card on the table ringed. -->
          <div class="g-well grid grid-cols-13 gap-0.5 rounded-xl p-1" :class="playing ? '' : 'opacity-60'" aria-hidden="true">
            <span
              v-for="cell in rankStrip" :key="cell.r"
              class="hilo-rank g-num grid h-7 place-items-center rounded-md text-[11px] leading-none @3xl:h-9 @3xl:text-xs"
              :class="[cell.wins.length ? 'text-white' : 'text-white/35', cell.here ? 'hilo-rank-here' : '']"
              :style="{ background: stripFill(cell.wins) }"
            >{{ cell.name }}</span>
          </div>

          <!-- Sticks to the bottom of the sheet, so the big button never scrolls out of reach on a phone. -->
          <div class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto flex gap-2 rounded-b-[1.4rem] bg-[var(--g-panel)] px-3 pt-1 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            <button
              v-if="playing"
              type="button"
              class="g-btn g-dark size-16 shrink-0 flex-col gap-1 rounded-2xl"
              :disabled="busy || !skipsLeft"
              :title="`Skip this card (${skipsLeft} left)`"
              :aria-label="`Skip this card, ${skipsLeft} left`"
              @click="skip"
            >
              <SkipForward class="size-6" :stroke-width="2.75" />
              <span class="flex gap-1" aria-hidden="true">
                <span v-for="i in HILO_SKIPS" :key="i" class="size-2 rounded-full ring-[1.5px] ring-black/30" :class="i <= skipsLeft ? 'bg-[#ffc93a]' : 'bg-black/35'" />
              </span>
            </button>
            <button
              v-if="playing"
              type="button"
              class="g-btn g-gold h-16 min-w-0 flex-1 flex-col gap-0 rounded-2xl leading-none"
              :class="round?.canCashOut && !busy ? 'hilo-ready' : ''"
              :disabled="busy || !round?.canCashOut"
              @click="cashOut"
            >
              <span class="text-2xl uppercase">Cash out</span>
              <span v-if="round?.canCashOut" :key="cashValue" class="hilo-amount g-num flex items-center gap-1 text-lg text-[#4a2a00] [text-shadow:none]"><CasinoChipIcon class="size-4" />{{ formatCoins(cashValue) }}</span>
              <span v-else class="font-[family-name:var(--font-round)] text-sm font-bold opacity-80">Make a right call first</span>
            </button>
            <button v-else type="button" class="g-btn g-orange h-16 w-full rounded-2xl text-3xl uppercase" :disabled="busy" @click="start">
              Deal
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Deal a card, then call whether the next one is higher or lower. Ranks run from A (low) to K (high); on 2 to Q a call wins on the same rank too, an ace offers higher or same, a king lower or same. Every card comes from a freshly shuffled deck.</p>
      <p>A right call multiplies the round by 13 ÷ the ranks it wins on, a wrong one ends it with nothing. The round starts at ×0,975, so cashing out at any point returns 97,5%. Skip up to {{ HILO_SKIPS }} cards a round. A round you leave stays open; after a day without a move it is cashed out for you (or refunded before the first right call). Space deals and cashes out, the arrow keys call, S skips.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
/* Desktop: the stage fills the sheet's height without scrolling. Phone: a fixed table height. */
.hilo-table { container-type: size; height: 12.5rem; flex: none; }
@container game (min-width: 48rem) {
    .hilo-stage { height: clamp(24rem, min(calc(85dvh - 6.5rem), calc(100dvh - 13.5rem)), 44rem); }
    .hilo-table { height: auto; flex: 1; }
}
/* The card: as tall as the table allows, in the deck's 112 × 156 shape. */
.hilo-card-slot, .hilo-deck {
    height: min(92cqh, 21rem);
    aspect-ratio: 112 / 156;
}
.hilo-deck { height: min(80cqh, 18rem); }
.hilo-deck-card, .hilo-face, .hilo-back, .hilo-mini { line-height: 0; }
.hilo-deck-card :deep(svg), .hilo-face :deep(svg), .hilo-back :deep(svg), .hilo-mini :deep(svg) { width: 100%; height: 100%; display: block; }
.hilo-deck-card { border-radius: 8%; box-shadow: 0 3px 0 rgb(0 0 0 / 0.35); }
.hilo-mini { width: 2.35rem; height: 3.27rem; border-radius: 0.3rem; box-shadow: 0 2px 0 rgb(0 0 0 / 0.4); }
@media (min-width: 640px) { .hilo-mini { width: 2.7rem; height: 3.75rem; } }

/* Two faces back to back; the deal turns the card over from its back. */
.hilo-card-slot { perspective: 1100px; }
.hilo-card { transform-style: preserve-3d; border-radius: 8%; }
.hilo-face, .hilo-back { position: absolute; inset: 0; backface-visibility: hidden; border-radius: 8%; overflow: hidden; box-shadow: 0 8px 0 rgb(0 0 0 / 0.35), 0 18px 30px rgb(0 0 0 / 0.4); }
.hilo-back { transform: rotateY(180deg); }
.hilo-down .hilo-face { visibility: hidden; }
.hilo-down .hilo-back { transform: none; }
.hilo-won .hilo-face { box-shadow: 0 8px 0 rgb(0 0 0 / 0.35), 0 0 0 4px #3fd25a, 0 0 34px 8px rgb(63 210 90 / 0.65); }
.hilo-lost .hilo-face { box-shadow: 0 8px 0 rgb(0 0 0 / 0.35), 0 0 0 4px #ff5470, 0 0 34px 8px rgb(255 84 112 / 0.65); }
.hilo-card-slot:not(:disabled):hover .hilo-card { transform: translateY(-4px); transition: transform 0.15s ease; }

.hilo-deal-enter-active { animation: hilo-deal-in 0.43s cubic-bezier(0.25, 0.8, 0.35, 1.05) both; z-index: 2; }
.hilo-deal-leave-active { animation: hilo-deal-out 0.32s ease-in both; z-index: 1; }
@keyframes hilo-deal-in {
    0% { transform: translate(-70%, 4%) rotateY(180deg) rotate(-8deg) scale(0.9); }
    60% { transform: translate(0, -6%) rotateY(20deg) rotate(1deg) scale(1.04); }
    100% { transform: translate(0, 0) rotateY(0) rotate(0) scale(1); }
}
@keyframes hilo-deal-out {
    to { transform: translate(-10%, -75%) scale(0.35) rotate(-6deg); opacity: 0; }
}
.hilo-thud { animation: hilo-thud 0.4s 0.43s ease-out; }
.hilo-veil { background: rgb(60 0 20 / 0.35); animation: hilo-veil 0.25s ease-out both; }
.hilo-x { animation: hilo-x 0.35s cubic-bezier(0.3, 0.7, 0.4, 1.5) both; box-shadow: 0 5px 0 #a3163a, 0 10px 24px rgb(0 0 0 / 0.45); border: 3px solid #fff; text-shadow: 0 3px 0 #a3163a; }
.hilo-rank { text-shadow: 0 1px 0 rgb(0 0 0 / 0.45); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25); }
.hilo-rank-here { outline: 2.5px solid #fff; outline-offset: -1px; transform: scale(1.12); z-index: 1; position: relative; }
@keyframes hilo-veil { from { opacity: 0; } }
.hilo-tap { animation: hilo-tap 1.5s ease-in-out infinite; }
.hilo-pot { animation: hilo-pot 0.4s cubic-bezier(0.3, 0.7, 0.4, 1.5); }
.hilo-call:not(:disabled) .hilo-pay { background: rgb(0 0 0 / 0.22); }
.hilo-ready { animation: hilo-ready 1.3s ease-in-out infinite; }
.hilo-amount { animation: hilo-amount 0.35s cubic-bezier(0.3, 0.7, 0.4, 1.6); }
.hilo-trail-enter-active { transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.3, 0.7, 0.4, 1.4); }
.hilo-trail-enter-from { opacity: 0; transform: translateY(14px) scale(0.6); }
@keyframes hilo-thud { 0% { translate: 0; } 20% { translate: -9px; } 40% { translate: 8px; } 60% { translate: -5px; } 80% { translate: 3px; } 100% { translate: 0; } }
@keyframes hilo-x { from { transform: scale(1.8) rotate(-12deg); opacity: 0; } to { transform: rotate(-12deg); } }
@keyframes hilo-tap { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes hilo-pot { 0% { transform: scale(0.8); } 55% { transform: scale(1.12); } 100% { transform: scale(1); } }
@keyframes hilo-ready { 0%, 100% { box-shadow: 0 4px 0 var(--edge), 0 6px 12px rgb(0 0 0 / 0.25), inset 0 2px 0 rgb(255 255 255 / 0.35), 0 0 0 0 rgb(255 201 58 / 0); } 50% { box-shadow: 0 4px 0 var(--edge), 0 6px 12px rgb(0 0 0 / 0.25), inset 0 2px 0 rgb(255 255 255 / 0.35), 0 0 22px 4px rgb(255 201 58 / 0.55); } }
@keyframes hilo-amount { 0% { transform: scale(0.7); } 60% { transform: scale(1.2); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
    .hilo-deal-enter-active, .hilo-deal-leave-active, .hilo-thud, .hilo-x, .hilo-veil, .hilo-tap, .hilo-pot, .hilo-ready, .hilo-amount { animation: none; }
    .hilo-deal-leave-active { display: none; }
    .hilo-trail-enter-active { transition: none; }
}
</style>
