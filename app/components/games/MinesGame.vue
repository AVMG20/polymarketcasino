<script setup lang="ts">
import { Shuffle } from 'lucide-vue-next'
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { MINES_MAX, MINES_MAX_MULTIPLIER, MINES_MIN, MINES_TILES, minesMultiplier, minesSafeChance, type MinesView } from '#shared/games/mines'
import { findGame } from '#shared/games/registry'
import { formatCoins, formatCoinsExact, payFor } from '#shared/money'
import type { WinShow } from '~/components/game/WinBurst.vue'

const info = findGame('mines')!
const game = useStepRound<MinesView>('mines')

const bet = ref(info.minBet)
const bombs = ref(3)
const win = ref<WinShow | null>(null)
/** The tile being dug right now (the request is out). */
const digging = ref<number | null>(null)
/** Tiles that just turned (they play their reveal once). */
const fresh = ref(new Set<number>())
/** The end of a round: the rest of the board turns over, one tile after another. */
const revealing = ref(false)
const shaking = ref(false)
const history = ref<{ id: string, label: string, won: boolean }[]>([])
const sound = useGameSound()

const round = computed(() => game.round.value)
const view = computed(() => round.value?.view ?? null)
const playing = computed(() => round.value?.status === 'open')
const over = computed(() => !!round.value && round.value.status !== 'open')
const lost = computed(() => round.value?.status === 'lost')
const revealed = computed(() => new Set(view.value?.revealed ?? []))
const bombSet = computed(() => new Set(view.value?.bombs ?? []))
const gems = computed(() => view.value?.revealed.length ?? 0)
const shownBombs = computed(() => (playing.value ? view.value!.mines : bombs.value))
const gemsLeft = computed(() => MINES_TILES - shownBombs.value - (playing.value ? gems.value : 0))
const multiplier = computed(() => (playing.value ? round.value!.multiplier : 1))
const nextMultiplier = computed(() => (playing.value ? view.value?.next ?? null : minesMultiplier(bombs.value, 1)))
const nextChance = computed(() => minesSafeChance(shownBombs.value, playing.value ? gems.value : 0))
const cashValue = computed(() => (round.value && playing.value ? round.value.payout : 0))
const nextValue = computed(() => (nextMultiplier.value ? payFor(playing.value ? round.value!.bet : bet.value, nextMultiplier.value) : 0))

/** Desktop: the next gems up the ladder, what each makes the round worth. */
const ladder = computed(() => {
    const from = playing.value ? gems.value : 0
    const last = MINES_TILES - shownBombs.value
    const stake = playing.value ? round.value!.bet : bet.value
    const steps: { gem: number, multiplier: number, payout: number }[] = []
    for (let k = from + 1; k <= Math.min(last, from + 8); k++) {
        const multiplier = Math.min(MINES_MAX_MULTIPLIER, minesMultiplier(shownBombs.value, k))
        steps.push({ gem: k, multiplier, payout: payFor(stake, multiplier) })
        if (multiplier >= MINES_MAX_MULTIPLIER) break
    }
    return steps
})

const presets = [
    { value: 1, face: '#22c55e', edge: '#15803d' },
    { value: 3, face: '#3b82f6', edge: '#1e40af' },
    { value: 5, face: '#a855f7', edge: '#6b21a8' },
    { value: 10, face: '#f59e0b', edge: '#b45309' },
    { value: 24, face: '#ef4444', edge: '#991b1b' }
]

const multipleFormat = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function times(value: number) {
    return `×${multipleFormat.format(Math.floor(value * 100) / 100)}`
}
const chanceFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 })

type TileKind = 'closed' | 'gem' | 'hit' | 'gem-ghost' | 'bomb-ghost'
function tileKind(tile: number): TileKind {
    if (revealed.value.has(tile)) return 'gem'
    if (!over.value) return 'closed'
    if (view.value?.hit === tile) return 'hit'
    return bombSet.value.has(tile) ? 'bomb-ghost' : 'gem-ghost'
}
/** The order the rest of the board turns over at the end: rings out from the tile that ended it. */
function revealDelay(tile: number): string {
    const from = view.value?.hit ?? view.value?.revealed.at(-1) ?? 12
    const d = Math.max(Math.abs((tile % 5) - (from % 5)), Math.abs(Math.floor(tile / 5) - Math.floor(from / 5)))
    return `${d * 70}ms`
}
// Dirt chunks thrown out of a dug tile (fixed, so no randomness).
const CHUNKS = [[-1, -0.9, 7], [0.2, -1.2, 5], [1.1, -0.7, 8], [1.2, 0.3, 5], [0.5, 1, 6], [-0.6, 1.1, 5], [-1.3, 0.2, 7], [-0.2, -0.5, 4]]
    .map(([x, y, s], i) => ({ '--x': `${x! * 2.4}rem`, '--y': `${y! * 2.2}rem`, '--s': `${s}px`, '--r': `${i * 47}deg` }))

function markFresh(tiles: number[]) {
    fresh.value = new Set(tiles)
}

async function start() {
    if (game.busy.value || playing.value) return null
    win.value = null
    revealing.value = false
    fresh.value = new Set()
    return game.start(bet.value, { mines: bombs.value })
}

/** A tile: dig it, or (between rounds) start a round and dig it. */
async function tap(tile: number) {
    if (game.busy.value) return
    if (!playing.value) {
        const started = await start()
        if (!started) return
    }
    await dig(tile)
}

async function dig(tile: number) {
    if (!playing.value || game.busy.value || revealed.value.has(tile)) return
    digging.value = tile
    sound.dig()
    const response = await game.act({ type: 'reveal', tile })
    digging.value = null
    if (!response) return
    const r = response.round
    if (r.status !== 'lost') sound.gem(r.view.revealed.length)
    if (r.status === 'open') {
        markFresh([tile])
        return
    }
    await finish(r.status === 'cashed' ? 'cashed' : 'lost', tile)
}

function pickRandom() {
    const closed = Array.from({ length: MINES_TILES }, (_, i) => i).filter(i => !revealed.value.has(i))
    // Cosmetic choice of a tile for the player: the bombs were placed on the server at the start.
    if (closed.length) void dig(closed[Math.floor(Math.random() * closed.length)]!)
}

async function cashOut() {
    if (!round.value?.canCashOut || game.busy.value) return
    const response = await game.cashOut()
    if (response) await finish('cashed', null)
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Shows the result on the tile, turns the rest of the board over, then settles. */
async function finish(status: 'cashed' | 'lost', tile: number | null) {
    const r = round.value!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    markFresh(tile === null ? [] : [tile])
    if (status === 'lost') {
        sound.bomb()
        shaking.value = !reduced
        await wait(reduced ? 0 : 520)
        shaking.value = false
    } else if (tile !== null) {
        await wait(reduced ? 0 : 280)
    }
    revealing.value = !reduced
    if (status === 'cashed') sound.register()
    win.value = status === 'cashed' ? { id: r.id, payout: r.payout, multiplier: Math.floor(r.multiplier * 100) / 100 } : null
    history.value = [{ id: r.id, label: status === 'cashed' ? times(r.multiplier) : '×0', won: status === 'cashed' }, ...history.value].slice(0, 20)
    game.settle()
}

onMounted(async () => {
    const open = await game.resume()
    if (open) {
        bet.value = open.bet
        bombs.value = open.view.mines
    }
})

function onKey(event: KeyboardEvent) {
    if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault()
        if (playing.value) void cashOut()
        else void start()
    }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <GameFrame slug="mines">
    <template #actions>
      <GameSoundToggle />
    </template>
    <div class="@container/game">
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <GameWinBurst v-slot="{ showing }" :show="win" class="rounded-[1.5rem]">
          <GameFelt class="mines-stage h-full">
            <div class="mines-cave absolute inset-0" aria-hidden="true" />
            <div class="relative flex h-full flex-col gap-2 p-2.5 sm:gap-3 sm:p-4">
              <!-- The pot: what cashing out pays now, and what the next gem makes it. -->
              <div class="flex items-stretch gap-2 transition-opacity duration-150" :class="showing ? 'opacity-0' : ''" aria-live="polite">
                <div class="mines-plate min-w-0 flex-1 rounded-2xl px-3 py-1.5">
                  <p class="text-[10px] font-bold tracking-wider text-white/55 uppercase sm:text-[11px]">{{ lost ? 'Boom' : playing ? 'Cash out' : over ? 'Cashed out' : 'Multiplier' }}</p>
                  <p class="flex items-baseline gap-2 whitespace-nowrap">
                    <span
                      :key="`${round?.id}:${gems}:${round?.status}`"
                      class="mines-mult g-num leading-none"
                      :class="lost ? 'text-[#ffb3c0]' : gems && playing ? 'mines-mult-up text-[#b6ffc4]' : over ? 'text-[#b6ffc4]' : 'text-white'"
                    >{{ lost ? '×0' : over ? times(round!.multiplier) : times(multiplier) }}</span>
                    <span v-if="playing && gems" class="g-num flex items-center gap-1 truncate text-base text-white/85 sm:text-lg" :title="`${formatCoinsExact(cashValue)} chips`">
                      <CasinoChipIcon class="size-4" />{{ formatCoins(cashValue) }}
                    </span>
                  </p>
                </div>
                <div v-if="!over && nextMultiplier" class="mines-next min-w-0 shrink-0 rounded-2xl px-3 py-1.5 text-right" :title="`${chanceFormat.format(nextChance * 100)}% chance the next tile is a gem`">
                  <p class="flex items-center justify-end gap-1 text-[10px] font-bold tracking-wider text-[#9ff0e6]/80 uppercase sm:text-[11px]">
                    <svg viewBox="-28 -28 56 56" class="size-3" aria-hidden="true"><path d="M-22 -7 L-12 -20 H12 L22 -7 L0 22 Z" fill="#2fe0d0" stroke="#063b37" stroke-width="5" stroke-linejoin="round" /></svg>
                    {{ playing ? 'Next gem' : 'First gem' }} · {{ chanceFormat.format(nextChance * 100) }}%
                  </p>
                  <p class="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
                    <span class="g-num text-2xl leading-none text-[#7df5e8] sm:text-3xl">{{ times(nextMultiplier) }}</span>
                  </p>
                </div>
                <div v-else-if="over" class="mines-next flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-1.5">
                  <span class="g-num inline-flex items-center gap-1 text-lg" :title="`${gems} gems dug`">
                    <svg viewBox="-28 -28 56 56" class="size-5" aria-hidden="true"><path d="M-22 -7 L-12 -20 H12 L22 -7 L0 22 Z" fill="#2fe0d0" stroke="#063b37" stroke-width="5" stroke-linejoin="round" /></svg>{{ gems }}
                  </span>
                </div>
              </div>

              <!-- The field. -->
              <div class="mines-area relative min-h-0">
                <div
                  class="mines-field grid grid-cols-5 gap-[2.2%]"
                  :class="[shaking ? 'mines-shake' : '', revealing ? 'mines-revealing' : '']"
                  role="grid"
                  aria-label="Field"
                >
                  <button
                    v-for="tile in MINES_TILES" :key="tile - 1"
                    type="button"
                    class="mines-tile relative rounded-[18%]"
                    :class="[`mines-${tileKind(tile - 1)}`, digging === tile - 1 ? 'mines-digging' : '', fresh.has(tile - 1) ? 'mines-fresh' : '']"
                    :style="{ '--seed': `${((tile * 37) % 100)}%`, '--delay': revealDelay(tile - 1) }"
                    :disabled="game.busy.value || (playing ? revealed.has(tile - 1) : false)"
                    :aria-label="tileKind(tile - 1) === 'closed' ? `Dig tile ${tile}` : over ? `Dig tile ${tile} (new round)` : 'Gem'"
                    @click="tap(tile - 1)"
                  >
                    <!-- A gem -->
                    <svg v-if="tileKind(tile - 1).startsWith('gem')" viewBox="-30 -30 60 60" class="mines-art absolute inset-[13%] overflow-visible" aria-hidden="true">
                      <ellipse cx="0" cy="24" rx="18" ry="4" fill="#000" opacity=".35" />
                      <path d="M-26 -8 L-14 -24 H14 L26 -8 L0 26 Z" fill="url(#mines-gem)" stroke="#063b37" stroke-width="3.5" stroke-linejoin="round" />
                      <path d="M-26 -8 H26 M-14 -24 L-7 -8 L0 26 M14 -24 L7 -8 L0 26 M-7 -8 L0 -24 L7 -8" fill="none" stroke="#063b37" stroke-width="1.6" opacity=".45" />
                      <path d="M-14 -24 L-7 -8 L-26 -8 Z" fill="#fff" opacity=".35" />
                      <path d="M-12 -20 L-7 -11" stroke="#fff" stroke-width="3.5" stroke-linecap="round" />
                    </svg>
                    <!-- A bomb -->
                    <svg v-else-if="tileKind(tile - 1) !== 'closed'" viewBox="-30 -30 60 60" class="mines-art absolute inset-[13%] overflow-visible" aria-hidden="true">
                      <circle cx="-3" cy="5" r="20" fill="url(#mines-bomb)" stroke="#0b0812" stroke-width="3.5" />
                      <rect x="4" y="-21" width="11" height="8" rx="2" fill="#4b4668" stroke="#0b0812" stroke-width="3" transform="rotate(35 9 -17)" />
                      <path d="M13 -21 q6 -8 13 -6" fill="none" stroke="#c9b8a0" stroke-width="3.5" stroke-linecap="round" />
                      <g class="mines-spark"><circle cx="26" cy="-27" r="6" fill="#ffd23f" /><circle cx="26" cy="-27" r="3" fill="#fff" /></g>
                      <circle cx="-11" cy="-3" r="5" fill="#fff" opacity=".45" />
                    </svg>
                    <!-- Dug: dirt flies, the gem sparkles. -->
                    <template v-if="fresh.has(tile - 1)">
                      <span v-for="(c, i) in CHUNKS" :key="i" class="mines-chunk pointer-events-none absolute top-1/2 left-1/2" :style="c" />
                      <span v-if="tileKind(tile - 1) === 'gem'" class="mines-sparkle pointer-events-none absolute inset-0" />
                    </template>
                    <span v-if="tileKind(tile - 1) === 'hit'" class="mines-boom pointer-events-none absolute inset-0 rounded-[inherit]"><i /><i /></span>
                  </button>
                </div>
                <p
                  v-if="!round && !game.busy.value"
                  class="mines-hint g-title pointer-events-none absolute inset-x-0 top-1/2 mx-auto -mt-4 w-fit rounded-full bg-black/55 px-3 py-1 text-sm text-white sm:text-base"
                >Tap a tile to dig</p>
              </div>

              <GameRoundHistory :items="history" compact class="px-1" />
            </div>
          </GameFelt>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="playing || game.busy.value" />

          <div class="g-well flex items-center gap-3 rounded-2xl px-3 py-1">
            <svg viewBox="-28 -28 56 56" class="size-6 shrink-0" aria-hidden="true"><circle cx="-2" cy="4" r="18" fill="#2a2438" stroke="#0b0812" stroke-width="5" /><path d="M8 -12 q6 -10 14 -8" fill="none" stroke="#c9b8a0" stroke-width="5" stroke-linecap="round" /><circle cx="22" cy="-21" r="5" fill="#ffb800" /></svg>
            <SliderRoot
              :model-value="[bombs]"
              :min="MINES_MIN"
              :max="MINES_MAX"
              :step="1"
              :disabled="playing || game.busy.value"
              aria-label="Bombs"
              class="relative flex h-11 min-w-0 flex-1 touch-none items-center select-none data-[disabled]:opacity-60"
              @update:model-value="value => (bombs = value?.[0] ?? bombs)"
            >
              <SliderTrack class="relative h-3 grow overflow-hidden rounded-full bg-black/40">
                <SliderRange class="absolute h-full rounded-full bg-[var(--g-red)]" />
              </SliderTrack>
              <SliderThumb class="block size-7 rounded-full border-[3px] border-[var(--g-red-edge)] bg-white shadow-[0_3px_0_rgba(0,0,0,.4)] outline-none focus-visible:ring-4 focus-visible:ring-white/50" />
            </SliderRoot>
            <span class="g-num w-7 text-right text-2xl">{{ shownBombs }}</span>
          </div>

          <div class="flex items-center justify-between gap-1" role="radiogroup" aria-label="Bombs">
            <button
              v-for="p in presets" :key="p.value"
              type="button" role="radio"
              class="mines-chip grid size-12 shrink-0 place-items-center rounded-full font-[family-name:var(--font-game)] text-lg text-white transition disabled:opacity-40"
              :class="shownBombs === p.value ? 'mines-chip-on' : ''"
              :style="{ '--face': p.face, '--edge': p.edge }"
              :disabled="playing || game.busy.value"
              :aria-checked="shownBombs === p.value"
              :aria-label="`${p.value} bomb${p.value > 1 ? 's' : ''}`"
              @click="bombs = p.value"
            >
              {{ p.value }}
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="g-well min-w-0 rounded-2xl px-1 py-2" :title="`${gemsLeft} gems and ${shownBombs} bombs ${playing ? 'still in the ground' : 'in the ground'}`">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Gems left</p>
              <p class="g-num flex items-center justify-center gap-1 text-2xl text-[var(--g-gem)]">
                <svg viewBox="-28 -28 56 56" class="size-5" aria-hidden="true"><path d="M-22 -7 L-12 -20 H12 L22 -7 L0 22 Z" fill="#2fe0d0" stroke="#063b37" stroke-width="5" stroke-linejoin="round" /></svg>{{ gemsLeft }}
              </p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2" :title="`${formatCoinsExact(nextValue)} chips`">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">{{ playing ? 'Next gem pays' : 'First gem pays' }}</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl text-[var(--g-green)]">
                <CasinoChipIcon class="size-4" />{{ formatCoins(nextValue) }}
              </p>
            </div>
          </div>

          <!-- Desktop: the ladder of the next gems in the spare room; rows that don't fit drop out whole. -->
          <div class="relative hidden min-h-0 flex-1 @3xl:block" aria-hidden="true">
            <ol class="absolute inset-0 flex flex-col flex-wrap content-start gap-1 overflow-hidden">
              <li
                v-for="(step, i) in ladder" :key="`${shownBombs}:${step.gem}`"
                class="mines-rung flex h-8 w-full shrink-0 items-center gap-2 rounded-xl px-2.5"
                :class="i === 0 ? 'mines-rung-next' : ''"
                :style="{ opacity: i === 0 ? 1 : Math.max(0.35, 0.85 - i * 0.08) }"
              >
                <span class="g-num flex w-10 items-center gap-1 text-sm text-[#9ff0e6]">
                  <svg viewBox="-28 -28 56 56" class="size-3.5" aria-hidden="true"><path d="M-22 -7 L-12 -20 H12 L22 -7 L0 22 Z" fill="#2fe0d0" stroke="#063b37" stroke-width="5" stroke-linejoin="round" /></svg>{{ step.gem }}
                </span>
                <span class="g-num flex-1 text-base text-white">{{ times(step.multiplier) }}</span>
                <span class="g-num flex items-center gap-1 truncate text-sm text-[var(--g-green)]"><CasinoChipIcon class="size-3.5" />{{ formatCoins(step.payout) }}</span>
              </li>
            </ol>
          </div>

          <!-- Sticks to the bottom of the sheet, so the big button never scrolls out of reach on a phone. -->
          <div class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto flex gap-2 rounded-b-[1.4rem] bg-[var(--g-panel)] px-3 pt-1 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            <template v-if="playing">
              <button type="button" class="g-btn g-dark size-16 shrink-0 rounded-2xl" :disabled="game.busy.value" title="Dig a random tile" aria-label="Dig a random tile" @click="pickRandom">
                <Shuffle class="size-7" :stroke-width="2.75" />
              </button>
              <button
                type="button"
                class="g-btn g-gold mines-cash h-16 min-w-0 flex-1 flex-col gap-0 rounded-2xl leading-none"
                :class="round?.canCashOut ? 'mines-ready' : ''"
                :disabled="game.busy.value || !round?.canCashOut"
                @click="cashOut"
              >
                <span class="text-2xl uppercase">Cash out</span>
                <span v-if="round?.canCashOut" :key="cashValue" class="mines-cash-amount g-num flex items-center gap-1 text-lg [text-shadow:none]"><CasinoChipIcon class="size-4" />{{ formatCoins(cashValue) }}</span>
                <span v-else class="font-[family-name:var(--font-round)] text-sm font-bold opacity-80">Dig a gem first</span>
              </button>
            </template>
            <button v-else type="button" class="g-btn g-green h-16 w-full rounded-2xl text-3xl uppercase" :disabled="game.busy.value" @click="start">
              {{ over ? 'Dig again' : 'Dig in' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Shared gradients for the tile art. -->
    <svg width="0" height="0" class="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="mines-gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6fffb" /><stop offset=".45" stop-color="#2fe0d0" /><stop offset="1" stop-color="#0b7f77" /></linearGradient>
        <radialGradient id="mines-bomb" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#7a7392" /><stop offset="1" stop-color="#16121f" /></radialGradient>
      </defs>
    </svg>

    <template #rules>
      <p>Choose how many bombs hide in the 25 tiles, then dig (tap any tile to start). Every gem raises the multiplier; a bomb ends the round and the bet is lost. Cash out whenever you like after the first gem.</p>
      <p>After k gems the multiplier is 97,5% ÷ the chance of k gems in a row, so cashing out at any point returns 97,5%. Dig every gem and the round cashes out on its own. A round you leave stays open: come back to play on or cash out; after a day without a move it is cashed out for you (or refunded if no gem was dug yet). Space starts and cashes out.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
/* Desktop: the stage fills the sheet's height without scrolling; the field is the biggest square that fits. */
.mines-area { width: 100%; aspect-ratio: 1; container-type: size; display: grid; place-items: center; }
.mines-field { width: calc(min(100cqw, 100cqh) * 0.95); height: calc(min(100cqw, 100cqh) * 0.95); }
@container game (min-width: 48rem) {
    .mines-stage { height: clamp(24rem, min(calc(85dvh - 6.5rem), calc(100dvh - 13.5rem)), 44rem); }
    .mines-area { aspect-ratio: auto; flex: 1; }
}

/* A warm cave under the felt rail: lamplight from above, rock speckle. */
.mines-cave {
    background:
        radial-gradient(ellipse 70% 45% at 50% -8%, rgb(255 196 120 / 0.42), transparent 70%),
        radial-gradient(ellipse 30% 22% at 8% 92%, rgb(120 70 30 / 0.55), transparent 70%),
        radial-gradient(ellipse 26% 18% at 94% 70%, rgb(120 70 30 / 0.5), transparent 70%),
        radial-gradient(rgb(255 220 170 / 0.08) 1.5px, transparent 2px) 0 0 / 22px 22px,
        radial-gradient(rgb(0 0 0 / 0.22) 2px, transparent 2.5px) 11px 9px / 26px 26px,
        linear-gradient(180deg, #4a2c17 0%, #2f1b0d 55%, #1c0f06 100%);
}
/* The dig site: a dark bed the blocks sit in. */
.mines-field { position: relative; }
.mines-field::before {
    content: '';
    position: absolute;
    inset: -2.2%;
    border-radius: 6%;
    background: linear-gradient(180deg, #1f1108, #2b170b);
    box-shadow: inset 0 4px 12px rgb(0 0 0 / 0.6), 0 2px 0 rgb(255 220 170 / 0.12);
    pointer-events: none;
}
.mines-rung { background: rgb(0 0 0 / 0.22); }
.mines-rung-next { background: rgb(6 59 55 / 0.55); box-shadow: inset 0 0 0 2px rgb(47 224 208 / 0.4); }
.mines-plate { background: rgb(0 0 0 / 0.38); box-shadow: inset 0 2px 0 rgb(0 0 0 / 0.3), 0 1px 0 rgb(255 255 255 / 0.08); }
.mines-next { background: rgb(6 59 55 / 0.55); box-shadow: inset 0 0 0 2px rgb(47 224 208 / 0.35), 0 1px 0 rgb(255 255 255 / 0.08); }
.mines-mult {
    font-family: var(--font-game);
    font-size: clamp(1.9rem, 7cqw, 2.9rem);
    text-shadow: 0 3px 0 rgb(0 0 0 / 0.4);
}
.mines-mult-up { animation: mines-up 0.4s cubic-bezier(0.3, 0.7, 0.4, 1.5); text-shadow: 0 3px 0 #0b5b22, 0 0 22px rgb(63 210 90 / 0.6); }

.mines-tile { transition: transform 0.14s cubic-bezier(0.3, 0.7, 0.4, 1.5), box-shadow 0.14s ease, filter 0.14s ease; -webkit-tap-highlight-color: transparent; }
/* A chunky block of sandy soil: lit top, darker edge below, pebbles placed per tile. */
.mines-closed {
    background:
        radial-gradient(circle at calc(var(--seed) * 0.6 + 18%) 30%, rgb(90 52 24 / 0.55) 0 3.5%, transparent 4.5%),
        radial-gradient(circle at 72% calc(var(--seed) * 0.4 + 40%), rgb(90 52 24 / 0.45) 0 5%, transparent 6%),
        radial-gradient(circle at calc(100% - var(--seed) * 0.5) 78%, rgb(255 236 200 / 0.35) 0 3%, transparent 4%),
        radial-gradient(circle at 28% 70%, rgb(255 236 200 / 0.25) 0 2.5%, transparent 3.5%),
        linear-gradient(180deg, #e3ad72 0%, #c98d55 45%, #a86f3f 100%);
    box-shadow: 0 6px 0 #5e3818, 0 8px 10px rgb(0 0 0 / 0.35), inset 0 3px 0 rgb(255 240 210 / 0.45), inset 0 -3px 0 rgb(0 0 0 / 0.12);
    border: 2px solid #3a200e;
    cursor: pointer;
}
.mines-closed::before {
    content: '';
    position: absolute;
    inset: 9% 12% auto;
    height: 16%;
    border-radius: 9999px;
    background: linear-gradient(180deg, rgb(255 248 230 / 0.45), transparent);
}
@media (hover: hover) {
    .mines-closed:not(:disabled):hover { transform: translateY(-4px); filter: brightness(1.08); box-shadow: 0 10px 0 #5e3818, 0 14px 16px rgb(0 0 0 / 0.35), inset 0 3px 0 rgb(255 240 210 / 0.5), inset 0 -3px 0 rgb(0 0 0 / 0.12); }
}
.mines-closed:not(:disabled):active { transform: translateY(4px); box-shadow: 0 2px 0 #5e3818, 0 3px 4px rgb(0 0 0 / 0.3), inset 0 3px 0 rgb(255 240 210 / 0.45); transition-duration: 0.05s; }
.mines-closed:disabled { cursor: default; }
.mines-digging { animation: mines-dig 0.12s ease-in-out infinite alternate; filter: brightness(1.12); }

/* An opened tile: a hole in the ground. */
.mines-gem, .mines-gem-ghost, .mines-bomb-ghost, .mines-hit {
    background: radial-gradient(circle at 50% 38%, #3a2416 0%, #1e1009 75%);
    border: 2px solid #1a0d05;
    box-shadow: inset 0 5px 10px rgb(0 0 0 / 0.65), 0 2px 0 rgb(255 220 170 / 0.12);
}
.mines-gem { background: radial-gradient(circle at 50% 45%, #0f5a55 0%, #1e1009 72%); box-shadow: inset 0 5px 10px rgb(0 0 0 / 0.6), 0 0 16px rgb(47 224 208 / 0.4), 0 2px 0 rgb(255 220 170 / 0.12); }
.mines-gem .mines-art { filter: drop-shadow(0 0 6px rgb(47 224 208 / 0.65)); }
.mines-gem-ghost .mines-art, .mines-bomb-ghost .mines-art { opacity: 0.42; filter: saturate(0.5); }
.mines-hit { background: radial-gradient(circle at 50% 45%, #ff8a6a 0%, #c4223f 55%, #5a0b1c 100%); border-color: #3a0610; box-shadow: inset 0 4px 10px rgb(0 0 0 / 0.4), 0 0 26px 4px rgb(255 84 112 / 0.6); }
.mines-hit .mines-art { animation: mines-bomb-in 0.4s cubic-bezier(0.3, 0.7, 0.4, 1.6) both; }
.mines-spark { animation: mines-fuse 0.25s ease-in-out infinite alternate; transform-origin: 26px -27px; }
.mines-bomb-ghost .mines-spark { animation: none; opacity: 0.6; }

/* The end of a round: the board turns over in a ring from the last tile. */
.mines-revealing .mines-gem-ghost .mines-art, .mines-revealing .mines-bomb-ghost .mines-art { animation: mines-ghost-in 0.32s var(--delay) cubic-bezier(0.3, 0.7, 0.4, 1.4) both; }

/* Dug: the gem jumps out of the dirt, chunks fly, a sparkle. */
.mines-fresh.mines-gem .mines-art { animation: mines-pop 0.5s cubic-bezier(0.3, 0.7, 0.4, 1.6) both; }
.mines-fresh.mines-gem { animation: mines-flash 0.6s ease-out; }
.mines-chunk {
    width: var(--s);
    height: var(--s);
    margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2);
    border-radius: 30%;
    background: #b47a45;
    box-shadow: inset -1px -1px 0 rgb(0 0 0 / 0.3);
    animation: mines-chunk 0.55s cubic-bezier(0.2, 0.7, 0.4, 1) both;
    z-index: 5;
}
.mines-sparkle::before, .mines-sparkle::after {
    content: '';
    position: absolute;
    top: 18%;
    right: 16%;
    width: 30%;
    height: 30%;
    background: conic-gradient(from 45deg, transparent 0 20deg, #fff 22deg 23deg, transparent 25deg 110deg, #fff 112deg 113deg, transparent 115deg 200deg, #fff 202deg 203deg, transparent 205deg 290deg, #fff 292deg 293deg, transparent 295deg);
    mask-image: radial-gradient(circle, #000 20%, transparent 70%);
    animation: mines-twinkle 0.7s 0.15s ease-out both;
}
.mines-sparkle::after { top: auto; right: auto; bottom: 22%; left: 18%; width: 20%; height: 20%; animation-delay: 0.3s; }

.mines-boom i {
    position: absolute;
    inset: 0;
    border-radius: 50%;
}
.mines-boom i:first-child { background: radial-gradient(circle, rgb(255 250 200 / 0.95), rgb(255 150 60 / 0.6) 40%, transparent 70%); animation: mines-boom 0.55s ease-out both; }
.mines-boom i:last-child { border: 4px solid rgb(255 200 120 / 0.9); animation: mines-ring 0.6s ease-out both; }

.mines-shake { animation: mines-shake 0.5s ease-out; }
.mines-hint { animation: mines-hint 1.6s ease-in-out infinite; }
.mines-ready { animation: mines-ready 1.3s ease-in-out infinite; }
.mines-cash-amount { color: #4a2a00; animation: mines-amount 0.35s cubic-bezier(0.3, 0.7, 0.4, 1.6); }
.mines-chip {
    background: radial-gradient(circle, var(--face) 0 52%, transparent 53%), repeating-conic-gradient(#fff 0 15deg, var(--face) 15deg 45deg);
    border: 2px solid var(--edge);
    box-shadow: 0 3px 0 var(--edge), inset 0 0 0 3px var(--face);
    text-shadow: 0 1.5px 0 rgb(0 0 0 / 0.45);
}
.mines-chip:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 var(--edge), inset 0 0 0 3px var(--face); }
.mines-chip-on { transform: translateY(-3px) scale(1.08); box-shadow: 0 5px 0 var(--edge), 0 0 0 3px #fff, 0 0 16px rgb(255 255 255 / 0.5); }

@keyframes mines-up { 0% { transform: scale(0.85); } 55% { transform: scale(1.14); } 100% { transform: scale(1); } }
@keyframes mines-dig { from { transform: rotate(-4deg) translateY(1px) scale(0.97); } to { transform: rotate(4deg) translateY(-1px) scale(1.02); } }
@keyframes mines-pop { 0% { transform: translateY(30%) scale(0.2) rotate(-25deg); opacity: 0; } 55% { transform: translateY(-14%) scale(1.25) rotate(8deg); opacity: 1; } 100% { transform: translateY(0) scale(1) rotate(0); } }
@keyframes mines-flash { 0% { box-shadow: inset 0 5px 10px rgb(0 0 0 / 0.6), 0 0 0 4px #b6fff0, 0 0 30px 8px rgb(47 224 208 / 0.9); } 100% { box-shadow: inset 0 5px 10px rgb(0 0 0 / 0.6), 0 0 16px rgb(47 224 208 / 0.4); } }
@keyframes mines-chunk {
    0% { transform: translate(0, 0) rotate(0) scale(1); opacity: 1; }
    70% { opacity: 1; }
    100% { transform: translate(var(--x), calc(var(--y) + 1.6rem)) rotate(var(--r)) scale(0.6); opacity: 0; }
}
@keyframes mines-twinkle { 0% { transform: scale(0) rotate(0); opacity: 0; } 40% { transform: scale(1.3) rotate(30deg); opacity: 1; } 100% { transform: scale(0.6) rotate(60deg); opacity: 0; } }
@keyframes mines-bomb-in { 0% { transform: scale(1.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes mines-fuse { from { opacity: 1; transform: scale(1); } to { opacity: 0.7; transform: scale(1.3); } }
@keyframes mines-ghost-in { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: scale(1); opacity: 0.42; } }
@keyframes mines-boom { 0% { transform: scale(0.3); opacity: 1; } 100% { transform: scale(2.6); opacity: 0; } }
@keyframes mines-ring { 0% { transform: scale(0.4); opacity: 1; } 100% { transform: scale(3.2); opacity: 0; } }
@keyframes mines-shake {
    0%, 100% { transform: translate(0, 0) rotate(0); }
    12% { transform: translate(-10px, 4px) rotate(-1deg); }
    26% { transform: translate(9px, -5px) rotate(1deg); }
    42% { transform: translate(-7px, 3px) rotate(-0.5deg); }
    58% { transform: translate(5px, -2px); }
    76% { transform: translate(-2px, 1px); }
}
@keyframes mines-hint { 0%, 100% { transform: translateY(0); opacity: 0.9; } 50% { transform: translateY(-4px); opacity: 1; } }
@keyframes mines-ready { 0%, 100% { box-shadow: 0 4px 0 var(--edge), 0 6px 12px rgb(0 0 0 / 0.25), inset 0 2px 0 rgb(255 255 255 / 0.35), 0 0 0 0 rgb(255 201 58 / 0); } 50% { box-shadow: 0 4px 0 var(--edge), 0 6px 12px rgb(0 0 0 / 0.25), inset 0 2px 0 rgb(255 255 255 / 0.35), 0 0 22px 4px rgb(255 201 58 / 0.55); } }
@keyframes mines-amount { 0% { transform: scale(0.7); } 60% { transform: scale(1.2); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
    .mines-mult-up, .mines-digging, .mines-fresh.mines-gem .mines-art, .mines-fresh.mines-gem, .mines-chunk, .mines-sparkle::before, .mines-sparkle::after,
    .mines-boom i, .mines-shake, .mines-ready, .mines-hint, .mines-spark, .mines-hit .mines-art, .mines-cash-amount,
    .mines-revealing .mines-gem-ghost .mines-art, .mines-revealing .mines-bomb-ghost .mines-art { animation: none; }
    .mines-chunk { display: none; }
    .mines-tile, .mines-chip, .mines-chip-on { transition: none; }
}
</style>
