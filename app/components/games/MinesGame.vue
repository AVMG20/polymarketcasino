<script setup lang="ts">
import { Shuffle } from 'lucide-vue-next'
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { MINES_MAX, MINES_MIN, MINES_TILES, minesMultiplier, type MinesView } from '#shared/games/mines'
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
/** Tiles that just turned (they play their reveal animation once). */
const fresh = ref(new Set<number>())
const history = ref<{ id: string, label: string, won: boolean }[]>([])

const round = computed(() => game.round.value)
const view = computed(() => round.value?.view ?? null)
const playing = computed(() => round.value?.status === 'open')
const over = computed(() => !!round.value && round.value.status !== 'open')
const revealed = computed(() => new Set(view.value?.revealed ?? []))
const bombSet = computed(() => new Set(view.value?.bombs ?? []))
const gems = computed(() => view.value?.revealed.length ?? 0)
const shownBombs = computed(() => (round.value ? view.value!.mines : bombs.value))
const multiplier = computed(() => (playing.value || over.value ? round.value!.multiplier : 1))
const nextMultiplier = computed(() => (playing.value ? view.value?.next ?? null : minesMultiplier(bombs.value, 1)))
const cashValue = computed(() => (round.value && playing.value ? round.value.payout : 0))
const firstGem = computed(() => payFor(bet.value, minesMultiplier(bombs.value, 1)))

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

type TileKind = 'closed' | 'gem' | 'bomb' | 'hit' | 'gem-ghost' | 'bomb-ghost'
function tileKind(tile: number): TileKind {
    if (revealed.value.has(tile)) return 'gem'
    if (!over.value) return 'closed'
    if (view.value?.hit === tile) return 'hit'
    return bombSet.value.has(tile) ? 'bomb-ghost' : 'gem-ghost'
}

function markFresh(tiles: number[]) {
    fresh.value = new Set(tiles)
}

async function start() {
    if (game.busy.value || playing.value) return
    win.value = null
    fresh.value = new Set()
    await game.start(bet.value, { mines: bombs.value })
}

async function dig(tile: number) {
    if (!playing.value || game.busy.value || revealed.value.has(tile)) return
    digging.value = tile
    const response = await game.act({ type: 'reveal', tile })
    digging.value = null
    if (!response) return
    const r = response.round
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
const shaking = ref(false)

/** Reveals the board, shows the result, then settles. */
async function finish(status: 'cashed' | 'lost', tile: number | null) {
    const r = round.value!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (status === 'lost') {
        markFresh(tile === null ? [] : [tile])
        shaking.value = !reduced
        await wait(reduced ? 0 : 450)
        shaking.value = false
    } else if (tile !== null) {
        markFresh([tile])
        await wait(reduced ? 0 : 250)
    }
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
    <div class="@container">
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <GameWinBurst v-slot="{ showing }" :show="win" class="rounded-[1.5rem]">
          <GameFelt tone="green" class="h-full">
            <div class="flex h-full min-h-[17rem] flex-col gap-2 p-3 sm:p-5 @3xl:min-h-[30rem]">
              <!-- The pot: what cashing out pays, and what the next gem makes it. -->
              <div class="flex items-center justify-between gap-2 transition-opacity duration-150" :class="showing ? 'opacity-0' : ''">
                <div class="min-w-0">
                  <p
                    :key="`${round?.id}:${gems}`"
                    class="mines-mult g-num leading-none tabular-nums"
                    :class="[over && round?.status === 'lost' ? 'text-[#ffb3c0]' : gems ? 'mines-mult-up text-[#b6ffc4]' : 'text-white/60']"
                  >{{ over && round?.status === 'lost' ? '×0' : times(multiplier) }}</p>
                  <p class="mt-0.5 truncate text-xs font-semibold text-white/60 sm:text-sm">
                    <template v-if="playing && nextMultiplier">Next gem {{ times(nextMultiplier) }}</template>
                    <template v-else-if="over && round?.status === 'lost'">Boom. Try again!</template>
                    <template v-else>First gem {{ times(minesMultiplier(bombs, 1)) }}</template>
                  </p>
                </div>
                <div class="flex shrink-0 gap-1.5">
                  <span class="g-num inline-flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-base sm:text-lg" :title="`${MINES_TILES - shownBombs - gems} gems left`">
                    <svg viewBox="-28 -28 56 56" class="size-5" aria-hidden="true"><path d="M-22 -7 L-12 -20 H12 L22 -7 L0 22 Z" fill="#2fe0d0" stroke="#063b37" stroke-width="5" stroke-linejoin="round" /></svg>
                    {{ MINES_TILES - shownBombs - gems }}
                  </span>
                  <span class="g-num inline-flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-base sm:text-lg" :title="`${shownBombs} bombs`">
                    <svg viewBox="-28 -28 56 56" class="size-5" aria-hidden="true"><circle cx="-2" cy="4" r="18" fill="#2a2438" stroke="#0b0812" stroke-width="5" /><path d="M8 -12 q6 -10 14 -8" fill="none" stroke="#c9b8a0" stroke-width="5" stroke-linecap="round" /><circle cx="22" cy="-21" r="5" fill="#ffb800" /></svg>
                    {{ shownBombs }}
                  </span>
                </div>
              </div>

              <!-- The field. -->
              <div class="grid flex-1 place-items-center">
                <div
                  class="grid w-full max-w-[26rem] grid-cols-5 gap-1.5 sm:gap-2.5"
                  :class="shaking ? 'mines-shake' : ''"
                  role="grid"
                  aria-label="Field"
                >
                  <button
                    v-for="tile in MINES_TILES" :key="tile - 1"
                    type="button"
                    class="mines-tile relative aspect-square min-h-11 rounded-xl sm:rounded-2xl"
                    :class="[`mines-${tileKind(tile - 1)}`, digging === tile - 1 ? 'mines-digging' : '', fresh.has(tile - 1) ? 'mines-fresh' : '']"
                    :disabled="!playing || game.busy.value || revealed.has(tile - 1)"
                    :aria-label="tileKind(tile - 1) === 'closed' ? `Dig tile ${tile}` : tileKind(tile - 1).startsWith('gem') ? 'Gem' : 'Bomb'"
                    @click="dig(tile - 1)"
                  >
                    <!-- A gem -->
                    <svg v-if="tileKind(tile - 1).startsWith('gem')" viewBox="-30 -30 60 60" class="mines-art absolute inset-[14%]" aria-hidden="true">
                      <path d="M-26 -8 L-14 -24 H14 L26 -8 L0 26 Z" fill="url(#mines-gem)" stroke="#063b37" stroke-width="4" stroke-linejoin="round" />
                      <path d="M-26 -8 H26 M-14 -24 L-6 -8 L0 26 M14 -24 L6 -8 L0 26" fill="none" stroke="#063b37" stroke-width="2" opacity=".5" />
                      <path d="M-12 -20 L-6 -10" stroke="#fff" stroke-width="4" stroke-linecap="round" />
                    </svg>
                    <!-- A bomb -->
                    <svg v-else-if="tileKind(tile - 1) !== 'closed'" viewBox="-30 -30 60 60" class="mines-art absolute inset-[14%]" aria-hidden="true">
                      <circle cx="-3" cy="5" r="20" fill="url(#mines-bomb)" stroke="#0b0812" stroke-width="4" />
                      <rect x="4" y="-21" width="11" height="8" rx="2" fill="#4b4668" stroke="#0b0812" stroke-width="3" transform="rotate(35 9 -17)" />
                      <path d="M13 -21 q6 -8 13 -6" fill="none" stroke="#c9b8a0" stroke-width="3.5" stroke-linecap="round" />
                      <circle cx="26" cy="-27" r="6" fill="#ffd23f" />
                      <circle cx="-11" cy="-3" r="5" fill="#fff" opacity=".45" />
                    </svg>
                    <span v-if="tileKind(tile - 1) === 'hit'" class="mines-boom pointer-events-none absolute inset-0 rounded-[inherit]" />
                  </button>
                </div>
              </div>

              <GameRoundHistory :items="history" compact class="px-1" />
            </div>
          </GameFelt>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="playing || game.busy.value" />

          <div class="g-well flex items-center gap-3 rounded-2xl px-3 py-1">
            <span class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Bombs</span>
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
            <span class="g-num w-7 text-right text-2xl">{{ bombs }}</span>
          </div>

          <div class="flex items-center justify-between gap-1" role="radiogroup" aria-label="Bombs">
            <button
              v-for="p in presets" :key="p.value"
              type="button" role="radio"
              class="mines-chip grid size-12 shrink-0 place-items-center rounded-full font-[family-name:var(--font-game)] text-lg text-white transition disabled:opacity-40"
              :class="bombs === p.value ? 'mines-chip-on' : ''"
              :style="{ '--face': p.face, '--edge': p.edge }"
              :disabled="playing || game.busy.value"
              :aria-checked="bombs === p.value"
              :aria-label="`${p.value} bomb${p.value > 1 ? 's' : ''}`"
              @click="bombs = p.value"
            >
              {{ p.value }}
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">{{ playing ? 'Next gem' : 'First gem' }}</p>
              <p class="g-num truncate text-2xl text-[var(--g-gold)]">{{ nextMultiplier ? times(nextMultiplier) : '–' }}</p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">{{ playing ? 'Cash out' : 'Win' }}</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl text-[var(--g-green)]" :title="`${formatCoinsExact(playing ? cashValue : firstGem)} chips`">
                <CasinoChipIcon class="size-4" />{{ formatCoins(playing ? cashValue : firstGem) }}
              </p>
            </div>
          </div>

          <!-- Sticks to the bottom of the sheet, so the big button never scrolls out of reach on a phone. -->
          <div class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto flex gap-2 rounded-b-[1.4rem] bg-[var(--g-panel)] px-3 pt-1 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            <template v-if="playing">
              <button type="button" class="g-btn g-dark size-16 shrink-0 rounded-2xl" :disabled="game.busy.value" title="Dig a random tile" aria-label="Dig a random tile" @click="pickRandom">
                <Shuffle class="size-7" :stroke-width="2.75" />
              </button>
              <button
                type="button"
                class="g-btn g-gold h-16 min-w-0 flex-1 flex-col gap-0 rounded-2xl leading-none"
                :class="round?.canCashOut ? 'mines-ready' : ''"
                :disabled="game.busy.value || !round?.canCashOut"
                @click="cashOut"
              >
                <span class="text-2xl uppercase">Cash out</span>
                <span v-if="round?.canCashOut" class="flex items-center gap-1 font-[family-name:var(--font-round)] text-sm font-bold"><CasinoChipIcon class="size-3.5" />{{ formatCoins(cashValue) }}</span>
                <span v-else class="font-[family-name:var(--font-round)] text-sm font-bold opacity-80">Dig a gem first</span>
              </button>
            </template>
            <button v-else type="button" class="g-btn g-green h-16 w-full rounded-2xl text-3xl uppercase" :disabled="game.busy.value" @click="start">
              Dig in
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Shared gradients for the tile art. -->
    <svg width="0" height="0" class="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="mines-gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d4fff6" /><stop offset=".5" stop-color="#2fe0d0" /><stop offset="1" stop-color="#0e8f86" /></linearGradient>
        <radialGradient id="mines-bomb" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#7a7392" /><stop offset="1" stop-color="#16121f" /></radialGradient>
      </defs>
    </svg>

    <template #rules>
      <p>Choose how many bombs hide in the 25 tiles, then dig. Every gem raises the multiplier; a bomb ends the round and the bet is lost. Cash out whenever you like after the first gem.</p>
      <p>After k gems the multiplier is 97,5% ÷ the chance of k gems in a row, so cashing out at any point returns 97,5%. Dig every gem and the round cashes out on its own. A round you leave stays open: come back to play on or cash out; after a day without a move it is cashed out for you (or refunded if no gem was dug yet). Space starts and cashes out.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.mines-mult {
    font-family: var(--font-game);
    font-size: clamp(2rem, 9cqw, 3.25rem);
    text-shadow: 0 4px 0 rgb(0 0 0 / 0.35);
}
.mines-mult-up { animation: mines-up 0.35s cubic-bezier(0.3, 0.7, 0.4, 1.5); text-shadow: 0 4px 0 #0b5b22, 0 0 22px rgb(63 210 90 / 0.6); }
.mines-tile { transition: transform 0.12s ease, filter 0.12s ease; }
.mines-closed {
    background: linear-gradient(180deg, #b07a4f 0%, #8a5a36 100%);
    box-shadow: 0 5px 0 #4a2c17, inset 0 2px 0 rgb(255 255 255 / 0.25), inset 0 -3px 0 rgb(0 0 0 / 0.15);
    border: 2px solid #3b2416;
}
.mines-closed::before {
    content: '';
    position: absolute;
    inset: 22% 18% auto auto;
    width: 26%;
    height: 12%;
    border-radius: 9999px;
    background: rgb(255 220 180 / 0.25);
}
.mines-closed:not(:disabled):hover { filter: brightness(1.1); transform: translateY(-2px); }
.mines-closed:not(:disabled):active { transform: translateY(4px); box-shadow: 0 1px 0 #4a2c17, inset 0 2px 0 rgb(255 255 255 / 0.25); }
.mines-closed:disabled { cursor: default; }
.mines-digging { animation: mines-dig 0.3s ease-in-out infinite alternate; filter: brightness(1.15); }
.mines-gem, .mines-gem-ghost, .mines-bomb-ghost, .mines-hit {
    background: radial-gradient(circle at 50% 40%, #2b2046 0%, #17112b 100%);
    border: 2px solid #0b1a14;
    box-shadow: inset 0 3px 8px rgb(0 0 0 / 0.5), 0 2px 0 rgb(255 255 255 / 0.08);
}
.mines-gem { box-shadow: inset 0 3px 8px rgb(0 0 0 / 0.5), 0 0 14px rgb(47 224 208 / 0.35); }
.mines-gem-ghost .mines-art, .mines-bomb-ghost .mines-art { opacity: 0.35; filter: saturate(0.4); }
.mines-hit { background: radial-gradient(circle at 50% 45%, #ff7a8e 0%, #b3213d 100%); }
.mines-fresh .mines-art { animation: mines-pop 0.38s cubic-bezier(0.3, 0.7, 0.4, 1.6) both; }
.mines-fresh.mines-gem { animation: mines-flash 0.5s ease-out; }
.mines-boom { animation: mines-boom 0.5s ease-out both; background: radial-gradient(circle, rgb(255 240 160 / 0.9), rgb(255 90 60 / 0.4) 45%, transparent 70%); }
.mines-shake { animation: mines-shake 0.45s ease-out; }
.mines-ready { animation: mines-ready 1.2s ease-in-out infinite; }
.mines-chip {
    background: radial-gradient(circle, var(--face) 0 52%, transparent 53%), repeating-conic-gradient(#fff 0 15deg, var(--face) 15deg 45deg);
    border: 2px solid var(--edge);
    box-shadow: 0 3px 0 var(--edge), inset 0 0 0 3px var(--face);
    text-shadow: 0 1.5px 0 rgb(0 0 0 / 0.45);
}
.mines-chip:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 var(--edge), inset 0 0 0 3px var(--face); }
.mines-chip-on { transform: translateY(-3px) scale(1.08); box-shadow: 0 5px 0 var(--edge), 0 0 0 3px #fff, 0 0 16px rgb(255 255 255 / 0.5); }
@keyframes mines-up { 0% { transform: scale(0.85); } 55% { transform: scale(1.12); } 100% { transform: scale(1); } }
@keyframes mines-dig { from { transform: rotate(-3deg) translateY(1px); } to { transform: rotate(3deg) translateY(-1px); } }
@keyframes mines-pop { 0% { transform: scale(0.2) rotate(-20deg); opacity: 0; } 60% { transform: scale(1.2) rotate(6deg); opacity: 1; } 100% { transform: scale(1) rotate(0); } }
@keyframes mines-flash { 0% { box-shadow: inset 0 3px 8px rgb(0 0 0 / 0.5), 0 0 0 4px #b6fff0, 0 0 26px 6px rgb(47 224 208 / 0.9); } 100% { box-shadow: inset 0 3px 8px rgb(0 0 0 / 0.5), 0 0 14px rgb(47 224 208 / 0.35); } }
@keyframes mines-boom { 0% { transform: scale(0.4); opacity: 1; } 100% { transform: scale(2.2); opacity: 0; } }
@keyframes mines-shake {
    0%, 100% { transform: translate(0, 0); }
    15% { transform: translate(-8px, 3px); }
    30% { transform: translate(7px, -4px); }
    45% { transform: translate(-6px, 2px); }
    60% { transform: translate(4px, -1px); }
    80% { transform: translate(-2px, 0); }
}
@keyframes mines-ready { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.12); } }
@media (prefers-reduced-motion: reduce) {
    .mines-mult-up, .mines-digging, .mines-fresh .mines-art, .mines-fresh.mines-gem, .mines-boom, .mines-shake, .mines-ready { animation: none; }
    .mines-tile, .mines-chip, .mines-chip-on { transition: none; }
}
</style>
