<script setup lang="ts">
import { RotateCcw, Trash2, Undo2 } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import { formatCoins, formatCoinsExact, payFor, sumCoins } from '#shared/money'
import {
    betKey, betReturn, coveredPockets, pocketColor, ROULETTE_MAX_BETS, ROULETTE_POCKETS,
    type PocketColor, type RouletteBet, type RouletteBetKind, type RouletteResult
} from '#shared/games/roulette'
import { CHIP_LADDER, chipsFor } from '~/components/game/Chip.vue'
import type { WinShow } from '~/components/game/WinBurst.vue'

/**
 * Single-zero roulette: a wheel with a real ball run above a layout you drop
 * chips on. One spin settles every bet on the layout (the server draws the
 * pocket); the wheel plays it out, then the layout pays where the chips lie.
 */
const info = findGame('roulette')!
const round = useGameRound<RouletteResult>('roulette')
const bankroll = useBankroll()
const sound = useTableSound()

const chip = ref<number>(100)

// ─── the layout ───────────────────────────────────────────────────────────────
interface Spot {
    key: string
    kind: RouletteBetKind
    value?: number
    label?: string
    diamond?: 'red' | 'black'
    tone: 'red' | 'black' | 'green' | 'outside'
    pockets: number[]
    /** Grid placement on the wide board and on the upright (phone) board: col / row / col span / row span. */
    wide: [number, number, number, number]
    tall: [number, number, number, number]
}

function spot(s: Omit<Spot, 'key' | 'pockets'>): Spot {
    return { ...s, key: betKey(s), pockets: coveredPockets(s) }
}

const spots: Spot[] = [
    spot({ kind: 'straight', value: 0, label: '0', tone: 'green', wide: [1, 1, 1, 3], tall: [1, 1, 3, 1] }),
    ...Array.from({ length: 36 }, (_, i) => {
        const row = i % 3
        const col = Math.floor(i / 3)
        const n = 3 * (col + 1) - row
        return spot({ kind: 'straight', value: n, label: String(n), tone: pocketColor(n) as 'red' | 'black', wide: [col + 2, row + 1, 1, 1], tall: [3 - row, col + 2, 1, 1] })
    }),
    ...[0, 1, 2].map(row => spot({ kind: 'column', value: 3 - row, label: '2:1', tone: 'outside', wide: [14, row + 1, 1, 1], tall: [3 - row, 14, 1, 1] })),
    ...[1, 2, 3].map(d => spot({ kind: 'dozen', value: d, label: `${d === 1 ? '1st' : d === 2 ? '2nd' : '3rd'} 12`, tone: 'outside', wide: [2 + (d - 1) * 4, 4, 4, 1], tall: [4, 2 + (d - 1) * 4, 1, 4] })),
    ...([
        { kind: 'low', label: '1-18' },
        { kind: 'even', label: 'Even' },
        { kind: 'red', diamond: 'red' },
        { kind: 'black', diamond: 'black' },
        { kind: 'odd', label: 'Odd' },
        { kind: 'high', label: '19-36' }
    ] as const).map((s, i) => spot({ ...s, tone: 'outside', wide: [2 + i * 2, 5, 2, 1], tall: [5, 2 + i * 2, 1, 2] }))
]
const spotByKey = new Map(spots.map(s => [s.key, s]))

function placement(s: Spot) {
    const area = ([col, row, cols, rows]: Spot['wide']) => ({ col: `${col} / span ${cols}`, row: `${row} / span ${rows}` })
    const wide = area(s.wide)
    const tall = area(s.tall)
    return { '--wc': wide.col, '--wr': wide.row, '--tc': tall.col, '--tr': tall.row }
}

const bets = ref<Record<string, RouletteBet>>({})
const placed = ref<{ key: string, amount: number }[]>([])
/** Bumped on every chip dropped on a spot, so its top chip lands again. */
const drops = ref<Record<string, number>>({})
const lastLayout = ref<RouletteBet[]>([])
/** After a spin: every spot's result, left on the layout until the next chip goes down. */
const outcome = ref<Record<string, { won: boolean, amount: number, payout: number }> | null>(null)
const result = ref<RouletteResult | null>(null)
const spinning = ref(false)
const errorMsg = ref('')
const win = ref<WinShow | null>(null)
const history = ref<{ id: string, pocket: number, color: PocketColor }[]>([])
const hovered = ref<string | null>(null)

const busy = computed(() => spinning.value || round.busy.value)
const stake = computed(() => sumCoins(Object.values(bets.value).map(b => b.amount)))
/** A layout is paid from coins first, then chips: the bankroll is the limit. */
const limit = computed(() => Math.min(info.maxBet, bankroll.total.value))
const covered = computed(() => new Set(Object.values(bets.value).flatMap(b => coveredPockets(b))))
const lit = computed(() => new Set(hovered.value ? spotByKey.get(hovered.value)?.pockets ?? [] : []))
/** The most the layout can return: the best pocket for it. */
const maxWin = computed(() => {
    const layout = Object.values(bets.value)
    let best = 0
    for (let pocket = 0; pocket < ROULETTE_POCKETS; pocket++) {
        const total = sumCoins(layout.filter(b => coveredPockets(b).includes(pocket)).map(b => payFor(b.amount, betReturn(b))))
        best = Math.max(best, total)
    }
    return best
})
const canSpin = computed(() => !busy.value && (stake.value > 0 || (!!outcome.value && lastLayout.value.length > 0)))

/** What lies on each spot: open chips, or after a spin the payout (won) or the lost stake. */
const piles = computed(() => {
    const out: Record<string, { chips: number[], label: string, state: 'open' | 'won' | 'lost' }> = {}
    const add = (key: string, amount: number, state: 'open' | 'won' | 'lost') => {
        out[key] = { chips: chipsFor(amount, 5).reverse(), label: formatCoins(amount, true), state }
    }
    for (const [key, settled] of Object.entries(outcome.value ?? {})) add(key, settled.won ? settled.payout : settled.amount, settled.won ? 'won' : 'lost')
    for (const [key, bet] of Object.entries(bets.value)) add(key, bet.amount, 'open')
    return out
})

/** Starts a new layout once the last spin's result has been looked at. */
function freshLayout() {
    if (!outcome.value) return
    outcome.value = null
    result.value = null
    win.value = null
}

const nudge = ref(0)
function refuse() {
    nudge.value++
}

function place(s: Spot) {
    if (busy.value) return
    errorMsg.value = ''
    freshLayout()
    const existing = bets.value[s.key]
    if (!existing && Object.keys(bets.value).length >= ROULETTE_MAX_BETS) return refuse()
    if (stake.value + chip.value > limit.value) return refuse()
    bets.value = { ...bets.value, [s.key]: { kind: s.kind, ...(s.value === undefined ? {} : { value: s.value }), amount: sumCoins([existing?.amount ?? 0, chip.value]) } }
    placed.value.push({ key: s.key, amount: chip.value })
    drops.value = { ...drops.value, [s.key]: (drops.value[s.key] ?? 0) + 1 }
    sound.play('chip')
}

function takeBack(key?: string) {
    if (busy.value) return
    let index = placed.value.length - 1
    if (key) while (index >= 0 && placed.value[index]!.key !== key) index--
    const last = index >= 0 ? placed.value.splice(index, 1)[0] : undefined
    const bet = last && bets.value[last.key]
    if (!last || !bet) return
    const next = { ...bets.value }
    const left = sumCoins([bet.amount, -last.amount])
    if (left <= 0) delete next[last.key]
    else next[last.key] = { ...bet, amount: left }
    bets.value = next
    sound.play('chip')
}

function clear() {
    if (busy.value) return
    freshLayout()
    bets.value = {}
    placed.value = []
}

function setLayout(layout: RouletteBet[]) {
    bets.value = Object.fromEntries(layout.map(b => [betKey(b), { ...b }]))
    placed.value = layout.map(b => ({ key: betKey(b), amount: b.amount }))
    drops.value = Object.fromEntries(layout.map(b => [betKey(b), (drops.value[betKey(b)] ?? 0) + 1]))
}

function layoutFits(layout: RouletteBet[]): boolean {
    return layout.length > 0 && sumCoins(layout.map(b => b.amount)) <= limit.value
}

function rebet() {
    if (busy.value) return
    if (!layoutFits(lastLayout.value)) return refuse()
    freshLayout()
    setLayout(lastLayout.value)
    sound.play('chip')
}

/** Doubles the layout (or last spin's, when the felt is empty). */
function double() {
    if (busy.value) return
    const base = stake.value ? Object.values(bets.value) : lastLayout.value
    const next = base.map(b => ({ ...b, amount: payFor(b.amount, 2) }))
    if (!layoutFits(next)) return refuse()
    freshLayout()
    setLayout(next)
    sound.play('chip')
}

// ─── a spin ───────────────────────────────────────────────────────────────────
const wheel = ref<{ spin: (pocket: number) => Promise<void>, clear: () => void } | null>(null)
const wheelArea = ref<HTMLElement>()

/** On a phone the layout sits under the wheel: bring the wheel into view for the run. */
function showWheel() {
    const box = wheelArea.value?.getBoundingClientRect()
    if (!box || (box.top >= 0 && box.bottom <= window.innerHeight)) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    wheelArea.value?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
}

async function spin() {
    if (busy.value) return
    // Spin again: the last layout goes back down.
    if (!stake.value && outcome.value && lastLayout.value.length) {
        if (!layoutFits(lastLayout.value)) return refuse()
        freshLayout()
        setLayout(lastLayout.value)
    }
    const layout = Object.values(bets.value)
    if (!layout.length) return
    if (stake.value > limit.value) return refuse()

    errorMsg.value = ''
    spinning.value = true
    win.value = null
    result.value = null
    wheel.value?.clear()
    showWheel()
    const response = await round.play({ options: { bets: layout } })
    if (!response) {
        spinning.value = false
        errorMsg.value = round.error.value || 'The spin did not go through'
        return
    }
    lastLayout.value = layout.map(b => ({ ...b }))
    await wheel.value?.spin(response.result.pocket)

    result.value = response.result
    outcome.value = Object.fromEntries(response.result.bets.map(b => [betKey(b), { won: b.won, amount: b.amount, payout: b.payout }]))
    bets.value = {}
    placed.value = []
    history.value = [{ id: response.roundId, pocket: response.result.pocket, color: response.result.color }, ...history.value].slice(0, 16)
    const multiple = response.stake > 0 ? Math.floor((response.payout / response.stake) * 100) / 100 : 0
    win.value = { id: response.roundId, payout: response.payout, multiplier: multiple }
    sound.play(response.payout > 0 ? 'win' : 'lose')
    round.settle()
    spinning.value = false
}

function onKey(event: KeyboardEvent) {
    if (event.target !== document.body) return
    if (event.code === 'Space') {
        event.preventDefault()
        void spin()
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault()
        takeBack()
    }
}
onMounted(() => {
    window.addEventListener('keydown', onKey)
    // Start on a modest chip: the biggest under a hundredth of the balance, at most 1K.
    chip.value = [...CHIP_LADDER].reverse().find(v => v <= 1_000 && v * 100 <= bankroll.total.value) ?? CHIP_LADDER[0]
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const pocketText = computed(() => (result.value ? `${result.value.pocket} ${result.value.color}` : ''))
</script>

<template>
  <GameFrame slug="roulette" wide>
    <div class="@container">
      <div class="flex flex-col gap-3 @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_20rem] @3xl:grid-rows-[auto_1fr] @3xl:items-start @7xl:grid-cols-[minmax(0,1fr)_23rem]">
        <GameFelt tone="green" class="@3xl:row-span-2">
          <div class="flex flex-col gap-2 p-3 sm:p-4">
            <!-- Last numbers, newest first. -->
            <div class="flex min-h-8 items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
              <TransitionGroup name="rl-hist">
                <span
                  v-for="(h, i) in history" :key="h.id"
                  class="rl-disc g-num grid shrink-0 place-items-center rounded-full text-white"
                  :class="[h.color, i === 0 ? 'size-8 text-base' : 'size-7 text-sm opacity-80']"
                >{{ h.pocket }}</span>
              </TransitionGroup>
              <span v-if="!history.length" class="g-title rounded-full bg-black/25 px-3 py-1 text-xs text-white/60">Single zero</span>
            </div>

            <!-- The wheel, where the result shows. -->
            <GameWinBurst :show="win" class="rounded-[1.25rem]">
              <div ref="wheelArea" class="flex flex-col items-center gap-2 pb-1">
                <!-- Bigger with the screen: the pocket numbers stay legible on a desktop. -->
                <div class="w-[min(74cqw,19rem)] @3xl:w-[min(52cqw,clamp(18rem,calc(60dvh-11rem),30rem))]">
                  <GameRouletteWheel ref="wheel" />
                </div>
                <div class="flex h-8 items-center justify-center">
                  <p v-if="result && win && win.payout <= 0" class="rl-zero g-title text-base text-[#ffc2cc] sm:text-lg">
                    ×0 <span class="text-sm text-white/55 capitalize">{{ pocketText }}</span>
                  </p>
                  <p v-else-if="result && win" class="g-title text-sm text-white/80 capitalize sm:text-base">{{ pocketText }}</p>
                  <p v-else class="g-title inline-flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-0.5 text-sm text-white/85 sm:text-base">
                    {{ spinning ? 'No more bets' : stake > 0 ? 'Ready to spin' : 'Place your chips' }}
                  </p>
                </div>
              </div>
            </GameWinBurst>

            <!-- The layout: upright on a phone, the classic wide board from ~34rem. -->
            <div class="@container/board">
              <div class="rl-board" :class="{ 'rl-closed': busy }" @pointerleave="hovered = null">
                <button
                  v-for="s in spots" :key="s.key"
                  type="button"
                  class="rl-spot"
                  :class="[
                    s.tone,
                    s.kind === 'straight' && s.value === 0 ? 'rl-zero-spot' : '',
                    {
                      'rl-lit': lit.has(s.value ?? -1) && s.kind === 'straight',
                      'rl-hit': result && s.kind === 'straight' && s.value === result.pocket,
                      'rl-won': outcome?.[s.key]?.won
                    }
                  ]"
                  :style="placement(s)"
                  :disabled="busy"
                  :title="`${s.label ?? s.kind}: pays ${betReturn(s)}×`"
                  :aria-label="`${s.label ?? s.kind}, pays ${betReturn(s)} times${bets[s.key] ? `, ${formatCoins(bets[s.key]!.amount)} on it` : ''}`"
                  @click="place(s)"
                  @contextmenu.prevent="takeBack(s.key)"
                  @pointerenter="e => e.pointerType === 'mouse' && (hovered = s.key)"
                >
                  <span v-if="s.tone !== 'outside'" class="rl-tile">{{ s.label }}</span>
                  <span v-else-if="s.diamond" class="rl-diamond" :class="s.diamond" />
                  <span v-else class="rl-text">{{ s.label }}</span>
                  <svg v-if="result && s.kind === 'straight' && s.value === result.pocket" class="rl-dolly" viewBox="0 0 20 24" aria-hidden="true">
                    <ellipse cx="10" cy="20" rx="8" ry="3.4" fill="#7a4c0e" />
                    <rect x="2" y="7" width="16" height="13" fill="#e2b34e" />
                    <ellipse cx="10" cy="7" rx="8" ry="3.4" fill="#fff1b8" stroke="#a8761c" stroke-width="1" />
                  </svg>

                  <span v-if="piles[s.key]" class="rl-pile" :class="`rl-pile-${piles[s.key]!.state}`">
                    <GameChip
                      v-for="(value, i) in piles[s.key]!.chips"
                      :key="i === piles[s.key]!.chips.length - 1 ? `top-${drops[s.key] ?? 0}` : i"
                      :value="value"
                      :label="i === piles[s.key]!.chips.length - 1 ? piles[s.key]!.label : null"
                      class="rl-chip"
                      :class="i === piles[s.key]!.chips.length - 1 && piles[s.key]!.state === 'open' ? 'rl-drop' : ''"
                      :style="{ transform: `translateY(${-i * 3}px)` }"
                    />
                  </span>
                </button>
              </div>
            </div>
          </div>
        </GameFelt>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <div :key="nudge" class="grid grid-cols-3 gap-2 text-center" :class="nudge ? 'rl-nudge' : ''">
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Bet</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-xl" :title="`${formatCoinsExact(stake)} of ${formatCoinsExact(limit)}`">
                <GameStakeIcons :amount="stake" class="text-base" />{{ formatCoins(stake) }}
              </p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2" title="Numbers your chips cover">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Numbers</p>
              <p class="g-num truncate text-xl">{{ covered.size }}<span class="text-sm text-[var(--g-muted)]">/{{ ROULETTE_POCKETS }}</span></p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Win up to</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-xl text-[var(--g-green)]" :title="`${formatCoinsExact(maxWin)} chips`">
                <CasinoChipIcon class="size-4" />{{ formatCoins(maxWin) }}
              </p>
            </div>
          </div>

          <p v-if="errorMsg" role="alert" class="rounded-xl bg-destructive/15 p-3 text-sm text-[#ff8da0]">{{ errorMsg }}</p>
        </div>

        <!-- The dock: chips and Spin, stuck to the bottom of the screen on a phone. -->
        <div class="g-ui g-panel sticky bottom-2 z-20 flex flex-col gap-2 rounded-[1.5rem] p-2 sm:p-3 @3xl:static @3xl:col-start-2">
          <div role="radiogroup" aria-label="Chip" class="grid grid-cols-7 gap-0.5">
            <button
              v-for="value in CHIP_LADDER" :key="value"
              type="button" role="radio" :aria-checked="chip === value" :aria-label="`${formatCoins(value)} chip`"
              class="rl-rack grid h-12 place-items-center rounded-xl disabled:opacity-35"
              :class="chip === value ? 'rl-rack-on' : ''"
              :disabled="value > limit"
              @click="chip = value; sound.play('chip')"
            >
              <GameChip :value="value" class="w-[min(100%,2.75rem)]" />
            </button>
          </div>
          <div class="flex gap-1.5">
            <button type="button" class="g-btn g-dark size-12 shrink-0 rounded-2xl" :disabled="busy || !placed.length" title="Take the last chip back" aria-label="Undo" @click="takeBack()">
              <Undo2 class="size-5" :stroke-width="3" />
            </button>
            <button type="button" class="g-btn g-dark size-12 shrink-0 rounded-2xl" :disabled="busy || (!placed.length && !outcome)" title="Clear the layout" aria-label="Clear" @click="clear">
              <Trash2 class="size-5" :stroke-width="2.75" />
            </button>
            <button type="button" class="g-btn g-dark size-12 shrink-0 rounded-2xl" :disabled="busy || !lastLayout.length || stake > 0" title="Last layout again" aria-label="Rebet" @click="rebet">
              <RotateCcw class="size-5" :stroke-width="3" />
            </button>
            <button type="button" class="g-btn g-dark size-12 shrink-0 rounded-2xl text-lg" :disabled="busy || (!stake && !lastLayout.length)" title="Double the layout" aria-label="Double" @click="double">
              ×2
            </button>
            <button type="button" class="g-btn g-green h-12 min-w-0 flex-1 rounded-2xl text-2xl uppercase" :disabled="!canSpin" @click="spin">
              {{ spinning ? '…' : 'Spin' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Single-zero European roulette. Pick a chip and tap the layout to drop it (right-click a spot takes a chip back). Spin settles every bet at once; Spin again right after a result replays the same layout.</p>
      <p>A bet returns 36 ÷ the numbers it covers: a number 36×, a dozen or column 3×, red, black, odd, even, 1-18 and 19-36 2×. Zero loses every outside bet.</p>
      <p>Space spins; Ctrl+Z takes the last chip back.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.rl-disc { box-shadow: inset 0 -2px 0 rgb(0 0 0 / 0.3), 0 2px 0 rgb(0 0 0 / 0.35); border: 2px solid rgb(255 236 190 / 0.55); }
.rl-disc.red { background: #d3263a; }
.rl-disc.black { background: #1f1d26; }
.rl-disc.green { background: #119a5c; }
.rl-hist-enter-active { transition: transform 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.5), opacity 0.2s; }
.rl-hist-enter-from { transform: scale(0.3); opacity: 0; }
.rl-hist-move { transition: transform 0.25s ease; }

/* ─── the board ─────────────────────────────────────────────────────────────── */
.rl-board {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 0.95fr) minmax(0, 0.95fr);
    grid-template-rows: repeat(14, 2.75rem);
    border: 2px solid rgb(255 236 190 / 0.6);
    border-radius: 0.9rem;
    background: rgb(0 0 0 / 0.14);
    box-shadow: 0 0 0 4px rgb(0 0 0 / 0.12), inset 0 2px 10px rgb(0 0 0 / 0.25);
    overflow: hidden;
    transition: filter 0.25s;
    user-select: none;
    -webkit-user-select: none;
}
.rl-board.rl-closed { filter: saturate(0.8) brightness(0.92); }
.rl-spot {
    grid-column: var(--tc);
    grid-row: var(--tr);
    position: relative;
    display: grid;
    place-items: center;
    min-width: 0;
    border: 1px solid rgb(255 236 190 / 0.35);
    color: #fff7e6;
    cursor: pointer;
    transition: background-color 0.12s;
    -webkit-tap-highlight-color: transparent;
}
.rl-spot:disabled { cursor: default; }
.rl-spot:hover:not(:disabled) { background: rgb(255 255 255 / 0.1); }
.rl-spot:active:not(:disabled) { background: rgb(255 255 255 / 0.18); }
.rl-spot:focus-visible { outline: 3px solid #fff; outline-offset: -3px; z-index: 5; }
.rl-tile {
    display: grid;
    place-items: center;
    width: 78%;
    height: 74%;
    border-radius: 0.45rem;
    font-family: var(--font-game);
    font-size: 1.05rem;
    line-height: 1;
    text-shadow: 0 2px 0 rgb(0 0 0 / 0.35);
    box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.18), inset 0 -3px 0 rgb(0 0 0 / 0.28), 0 2px 0 rgb(0 0 0 / 0.25);
    transition: transform 0.15s, filter 0.15s, box-shadow 0.15s;
}
.red .rl-tile { background: linear-gradient(180deg, #e8394c, #b81a2d); }
.black .rl-tile { background: linear-gradient(180deg, #34313f, #15131a); }
.green .rl-tile { background: linear-gradient(180deg, #1cc477, #0b8048); }
.rl-zero-spot .rl-tile { width: 70%; height: 86%; font-size: 1.35rem; }
.rl-text { font-family: var(--font-game); font-size: 0.95rem; letter-spacing: 0.03em; text-shadow: 0 2px 0 rgb(0 0 0 / 0.3); white-space: nowrap; }
.rl-diamond { width: 1.35rem; height: 1.35rem; transform: rotate(45deg) scaleY(0.8); border-radius: 0.2rem; box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.45), 0 2px 0 rgb(0 0 0 / 0.35); }
.rl-diamond.red { background: #d3263a; }
.rl-diamond.black { background: #1a181f; }
.rl-lit .rl-tile { transform: scale(1.07); filter: brightness(1.25); box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.75), 0 0 12px rgb(255 255 255 / 0.35); }
.rl-hit { z-index: 4; }
.rl-hit .rl-tile { transform: scale(1.1); box-shadow: inset 0 0 0 2px #fff, 0 0 0 3px #ffd84a, 0 0 22px 4px rgb(255 216 74 / 0.8); animation: rl-hit 0.7s ease-in-out 3 alternate; }
.rl-won { background: rgb(255 216 74 / 0.22); box-shadow: inset 0 0 0 2px #ffd84a, inset 0 0 18px rgb(255 216 74 / 0.45); z-index: 3; }
.rl-dolly { position: absolute; left: 50%; top: -0.35rem; width: 1rem; translate: -50% 0; filter: drop-shadow(0 2px 1px rgb(0 0 0 / 0.5)); z-index: 7; animation: rl-dolly 0.45s cubic-bezier(0.3, 0.7, 0.4, 1.5) both; }

/* ─── chips on the layout ───────────────────────────────────────────────────── */
.rl-pile { position: absolute; left: 50%; top: 50%; width: 1.7rem; height: 1.7rem; translate: -50% -42%; pointer-events: none; z-index: 6; }
.rl-chip { position: absolute; inset: 0; width: 100%; filter: drop-shadow(0 2px 1px rgb(0 0 0 / 0.45)); }
.rl-drop { animation: rl-drop 0.32s cubic-bezier(0.3, 0.7, 0.4, 1.4) both; }
.rl-pile-won { filter: drop-shadow(0 0 8px rgb(255 216 74 / 0.95)); animation: rl-pay 0.5s cubic-bezier(0.3, 0.7, 0.4, 1.6) both; }
.rl-pile-lost { animation: rl-sweep 0.55s 0.15s ease-in both; }

/* ─── the chip rack ─────────────────────────────────────────────────────────── */
.rl-rack { transition: transform 0.12s, background-color 0.12s; }
.rl-rack:active:not(:disabled) { transform: translateY(2px); }
.rl-rack-on { background: rgb(255 255 255 / 0.1); box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.85), 0 0 14px rgb(255 216 74 / 0.45); }
.rl-rack-on :deep(.game-chip) { transform: translateY(-3px) scale(1.06); }
.rl-rack :deep(.game-chip) { transition: transform 0.15s cubic-bezier(0.3, 0.7, 0.4, 1.5); }

.rl-zero { animation: rl-zero 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.5); }
.rl-nudge { animation: rl-nudge 0.35s ease-out; }

/* The wide board from ~34rem: zero on the left, 12 columns, 2:1 on the right. */
@container board (min-width: 34rem) {
    .rl-board {
        grid-template-columns: minmax(0, 1.15fr) repeat(12, minmax(0, 1fr)) minmax(0, 1.15fr);
        grid-template-rows: repeat(3, 3.25rem) 2.75rem 2.75rem;
    }
    .rl-spot { grid-column: var(--wc); grid-row: var(--wr); }
    .rl-zero-spot .rl-tile { width: 76%; height: 80%; border-radius: 1.4rem 0.45rem 0.45rem 1.4rem; }
    .rl-pile { width: 1.85rem; height: 1.85rem; }
}
@container board (min-width: 44rem) {
    /* From here the board grows with its width (cqw: the board's container), so cells stay near square. */
    .rl-board { grid-template-rows: repeat(3, clamp(3.6rem, 5.6cqw, 5.5rem)) repeat(2, clamp(3rem, 4.2cqw, 4.25rem)); }
    .rl-tile { font-size: clamp(1.25rem, 2cqw, 1.85rem); }
    .rl-zero-spot .rl-tile { font-size: clamp(1.35rem, 2.3cqw, 2.1rem); }
    .rl-text { font-size: clamp(0.95rem, 1.5cqw, 1.35rem); }
    .rl-diamond { width: clamp(1.35rem, 2.1cqw, 1.9rem); height: clamp(1.35rem, 2.1cqw, 1.9rem); }
    .rl-pile { width: clamp(2.1rem, 3.2cqw, 2.9rem); height: clamp(2.1rem, 3.2cqw, 2.9rem); }
}

@keyframes rl-drop { 0% { transform: translateY(-22px) scale(1.15); opacity: 0; } 60% { opacity: 1; } }
@keyframes rl-pay { 0% { transform: scale(0.6); } 60% { transform: scale(1.25); } 100% { transform: scale(1); } }
@keyframes rl-sweep { to { transform: translateY(10px) scale(0.6); opacity: 0; } }
@keyframes rl-hit { to { filter: brightness(1.45); } }
@keyframes rl-dolly { from { transform: translateY(-14px); opacity: 0; } }
@keyframes rl-zero { from { transform: scale(1.25); } }
@keyframes rl-nudge { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 50% { transform: translateX(4px); } 75% { transform: translateX(-2px); } }
@media (prefers-reduced-motion: reduce) {
    .rl-drop, .rl-pile-won, .rl-hit .rl-tile, .rl-dolly, .rl-zero, .rl-nudge { animation: none; }
    .rl-pile-lost { animation-duration: 0.01s; }
}
</style>
