<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { findGame } from '#shared/games/registry'
import { formatNumber } from '#shared/money'
import {
    betKey, betReturn, pocketColor, WHEEL_ORDER,
    type PocketColor, type RouletteBet, type RouletteBetKind, type RouletteResult
} from '#shared/games/roulette'

/**
 * Single-zero roulette on the old site's live felt: the wheel beside the
 * layout, chip piles on the cells, the ball run against the wheel. The round
 * itself is the casino's single-player play endpoint.
 */
const info = findGame('roulette')!
const round = useGameRound<RouletteResult>('roulette')
const { coins } = useCasinoSession()
const sound = useTableSound()
// Phones get the board stood upright: the felt's cells are too small to tap.
const upright = useMediaQuery('(max-width: 767px)')

const LADDER = [10, 50, 100, 500, 1_000, 5_000, 25_000] as const
const chip = ref(100)

// ─── felt geometry, the old table's 1720-wide stage ─────────────────────────
const CENTER_Y = 540
const COL_W = 60
const ROW_H = 92
const ZERO_WIDTH = 66
const COLBET_WIDTH = 94
const GRID_WIDTH = 12 * COL_W
const OUTSIDE_HEIGHT = 82
const DOZEN_HEIGHT = 82
const BETTING_HEIGHT = OUTSIDE_HEIGHT + 3 * ROW_H + DOZEN_HEIGHT
const BETTING_WIDTH = ZERO_WIDTH + GRID_WIDTH + COLBET_WIDTH
const WHEEL_SIZE = 460
const WHEEL_GAP = 60
const WHEEL_LEFT = (1720 - (WHEEL_SIZE + WHEEL_GAP + BETTING_WIDTH)) / 2
const WHEEL_TOP = CENTER_Y - WHEEL_SIZE / 2
const ZERO_LEFT = WHEEL_LEFT + WHEEL_SIZE + WHEEL_GAP
const NUM_LEFT = ZERO_LEFT + ZERO_WIDTH
const COLBET_LEFT = NUM_LEFT + GRID_WIDTH
const BETTING_TOP = CENTER_Y - BETTING_HEIGHT / 2
const GRID_TOP = BETTING_TOP + OUTSIDE_HEIGHT
const DOZENS_TOP = GRID_TOP + 3 * ROW_H
const OUTSIDE_WIDTH = GRID_WIDTH / 6
const DOZEN_WIDTH = GRID_WIDTH / 3
const HOUSE_POS = { x: WHEEL_LEFT + WHEEL_SIZE / 2, y: 872 }
const SPIN_MS = 5_000

interface Spot {
    kind: RouletteBetKind
    value?: number
    label?: string
    diamond?: string
    tone: 'red' | 'black' | 'green' | 'outside'
    /** Felt box, stage pixels. */
    box: { x: number, y: number, w: number, h: number }
    /** [col, row, colSpan, rowSpan] on the phone's upright board (5 × 14). */
    at: [number, number, number, number]
}

const numberAt = (row: number, col: number) => 3 * (col + 1) - row

const spots: Spot[] = [
    { kind: 'straight', value: 0, label: '0', tone: 'green', box: { x: ZERO_LEFT, y: GRID_TOP, w: ZERO_WIDTH, h: ROW_H * 3 }, at: [1, 1, 3, 1] },
    ...Array.from({ length: 36 }, (_, i): Spot => {
        const row = i % 3
        const col = Math.floor(i / 3)
        const n = numberAt(row, col)
        return { kind: 'straight', value: n, label: String(n), tone: pocketColor(n) as 'red' | 'black', box: { x: NUM_LEFT + col * COL_W, y: GRID_TOP + row * ROW_H, w: COL_W, h: ROW_H }, at: [3 - row, col + 2, 1, 1] }
    }),
    ...[0, 1, 2].map((row): Spot => ({ kind: 'column', value: 3 - row, label: '2:1', tone: 'outside', box: { x: COLBET_LEFT, y: GRID_TOP + row * ROW_H, w: COLBET_WIDTH, h: ROW_H }, at: [3 - row, 14, 1, 1] })),
    ...[1, 2, 3].map((dozen): Spot => ({ kind: 'dozen', value: dozen, label: `${dozen === 1 ? '1st' : dozen === 2 ? '2nd' : '3rd'} 12`, tone: 'outside', box: { x: NUM_LEFT + (dozen - 1) * DOZEN_WIDTH, y: DOZENS_TOP, w: DOZEN_WIDTH, h: DOZEN_HEIGHT }, at: [4, 2 + (dozen - 1) * 4, 1, 4] })),
    ...([
        { kind: 'low', label: '1 – 18' },
        { kind: 'even', label: 'EVEN' },
        { kind: 'red', diamond: '#c02434' },
        { kind: 'black', diamond: '#14181f' },
        { kind: 'odd', label: 'ODD' },
        { kind: 'high', label: '19 – 36' }
    ] as const).map((bet, i): Spot => ({ ...bet, tone: 'outside', box: { x: NUM_LEFT + i * OUTSIDE_WIDTH, y: BETTING_TOP, w: OUTSIDE_WIDTH, h: OUTSIDE_HEIGHT }, at: [5, 2 + i * 2, 1, 2] }))
]

const center = (spot: Spot) => ({ x: spot.box.x + spot.box.w / 2, y: spot.box.y + spot.box.h / 2 })
const spotByKey = new Map(spots.map(spot => [betKey(spot), spot]))

function uprightStyle(spot: Spot) {
    const [col, row, colSpan, rowSpan] = spot.at
    return { gridColumn: `${col} / span ${colSpan}`, gridRow: `${row} / span ${rowSpan}` }
}

// ─── the layout ───────────────────────────────────────────────────────────────
const bets = ref<Record<string, RouletteBet>>({})
const placed = ref<{ key: string, amount: number }[]>([])
const lastLayout = ref<RouletteBet[]>([])
/** After a spin: what each winning spot paid, left on the felt until the next chip goes down. */
const paid = ref<Record<string, number>>({})
const result = ref<RouletteResult | null>(null)
const payout = ref(0)
const spinning = ref(false)
const history = ref<{ id: string, pocket: number, color: PocketColor }[]>([])

const stake = computed(() => Object.values(bets.value).reduce((sum, bet) => sum + bet.amount, 0))
const limit = computed(() => Math.min(info.maxBet, coins.value))
const winningKeys = computed(() => new Set(result.value?.bets.filter(bet => bet.won).map(bet => betKey(bet)) ?? []))
const busy = computed(() => spinning.value || round.busy.value)

function pileOn(key: string): number {
    return bets.value[key]?.amount ?? paid.value[key] ?? 0
}

function freshLayout() {
    if (Object.keys(paid.value).length) paid.value = {}
}

function place(spot: Spot) {
    if (busy.value) return
    if (stake.value + chip.value > limit.value) return
    const key = betKey(spot)
    if (!bets.value[key] && Object.keys(bets.value).length >= 40) return
    freshLayout()
    const existing = bets.value[key]
    bets.value = { ...bets.value, [key]: { kind: spot.kind, ...(spot.value === undefined ? {} : { value: spot.value }), amount: (existing?.amount ?? 0) + chip.value } }
    placed.value.push({ key, amount: chip.value })
    sound.play('chip')
}

function undo() {
    const last = placed.value.pop()
    if (!last) return
    const bet = bets.value[last.key]
    if (!bet) return
    const next = { ...bets.value }
    if (bet.amount - last.amount <= 0) delete next[last.key]
    else next[last.key] = { ...bet, amount: bet.amount - last.amount }
    bets.value = next
}

function clear() {
    bets.value = {}
    placed.value = []
}

function setLayout(layout: RouletteBet[]) {
    bets.value = Object.fromEntries(layout.map(bet => [betKey(bet), { ...bet }]))
    placed.value = layout.map(bet => ({ key: betKey(bet), amount: bet.amount }))
}

function rebet() {
    const total = lastLayout.value.reduce((sum, bet) => sum + bet.amount, 0)
    if (!total || total > limit.value) return
    freshLayout()
    setLayout(lastLayout.value)
    sound.play('chip')
}

/** Halve or double the whole layout (or last spin's, when the felt is empty). */
function scale(factor: 0.5 | 2) {
    const base = stake.value ? Object.values(bets.value) : lastLayout.value
    const next = base.map(bet => ({ ...bet, amount: Math.floor(bet.amount * factor) })).filter(bet => bet.amount >= 1)
    const total = next.reduce((sum, bet) => sum + bet.amount, 0)
    if (!next.length || total > limit.value) return
    freshLayout()
    setLayout(next)
    sound.play('chip')
}

// ─── the wheel and the ball ───────────────────────────────────────────────────
const STEP = 360 / WHEEL_ORDER.length
const wheelRotation = ref(0)
const ballRotation = ref(0)

/** Wheel rotation that brings `pocket`'s centre to `targetAngle`, always turning forward a few times. */
function wheelRotationFor(current: number, pocket: number, targetAngle: number, extraTurns = 3) {
    const centre = WHEEL_ORDER.indexOf(pocket as typeof WHEEL_ORDER[number]) * STEP + STEP / 2
    const targetWithin = (((targetAngle - centre) % 360) + 360) % 360
    const currentWithin = ((current % 360) + 360) % 360
    let delta = targetWithin - currentWithin
    if (delta <= 0) delta += 360
    return current + delta + 360 * extraTurns
}

/** The wheel turns one way and the ball runs the other; both stop with the pocket under the ball. */
function spinTo(pocket: number): Promise<void> {
    // Cosmetic only: where on the rim the ball comes to rest.
    const landing = Math.random() * 360
    wheelRotation.value = wheelRotationFor(wheelRotation.value, pocket, landing)
    const within = ((ballRotation.value % 360) + 360) % 360
    let delta = landing - within
    if (delta >= 0) delta -= 360
    ballRotation.value += delta - 360 * 5
    return new Promise(resolve => setTimeout(resolve, SPIN_MS + 80))
}

function buildWheelSvg(size: number): string {
    const r = size / 2
    const rimWidth = 12
    const outerR = r - rimWidth
    const innerR = outerR - 80
    const hubR = innerR - 8
    let pockets = ''
    let labels = ''
    let spokes = ''
    WHEEL_ORDER.forEach((num, i) => {
        const a0 = (i * STEP - 90) * Math.PI / 180
        const a1 = ((i + 1) * STEP - 90) * Math.PI / 180
        const color = pocketColor(num) === 'red' ? '#c02434' : pocketColor(num) === 'black' ? '#14181f' : '#0f6e3c'
        const p = (a: number, rad: number) => `${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`
        pockets += `<path d="M ${p(a0, outerR)} A ${outerR} ${outerR} 0 0 1 ${p(a1, outerR)} L ${p(a1, innerR)} A ${innerR} ${innerR} 0 0 0 ${p(a0, innerR)} Z" fill="${color}" stroke="rgba(217,177,103,.5)" stroke-width="1.5"/>`
        const mid = (a0 + a1) / 2
        const labelR = (outerR + innerR) / 2
        const lx = (Math.cos(mid) * labelR).toFixed(2)
        const ly = (Math.sin(mid) * labelR).toFixed(2)
        labels += `<text x="${lx}" y="${ly}" transform="rotate(${(mid * 180 / Math.PI + 90).toFixed(2)} ${lx} ${ly})" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="800" fill="#f7f3e8" font-family="system-ui,sans-serif">${num}</text>`
    })
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        spokes += `<line x1="0" y1="0" x2="${(Math.cos(a) * hubR * 0.92).toFixed(2)}" y2="${(Math.sin(a) * hubR * 0.92).toFixed(2)}" stroke="#5b5f66" stroke-width="5" stroke-linecap="round"/>`
    }
    return `<svg width="${size}" height="${size}" viewBox="${-r} ${-r} ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`
        + '<defs><radialGradient id="rlHub" cx="35%" cy="32%" r="75%"><stop offset="0%" stop-color="#d7dade"/><stop offset="55%" stop-color="#8b8e94"/><stop offset="100%" stop-color="#4d4f54"/></radialGradient></defs>'
        + `<circle cx="0" cy="0" r="${r}" fill="#1c1109"/>`
        + `<circle cx="0" cy="0" r="${r - rimWidth / 2}" fill="none" stroke="#d9b167" stroke-width="${rimWidth}"/>`
        + pockets + labels
        + `<circle cx="0" cy="0" r="${hubR}" fill="url(#rlHub)" stroke="#d9b167" stroke-width="3"/>`
        + spokes
        + `<circle cx="0" cy="0" r="${(hubR * 0.32).toFixed(2)}" fill="#3a3c40" stroke="#d9b167" stroke-width="2"/>`
        + '</svg>'
}
const wheelSvg = buildWheelSvg(WHEEL_SIZE)

// ─── a spin ───────────────────────────────────────────────────────────────────
const flights = ref<{ fly: (from: { x: number, y: number }, to: { x: number, y: number }, amount: number, options?: { delay?: number, size?: number, ladder?: readonly number[] }) => void } | null>(null)

async function spin() {
    const layout = Object.values(bets.value)
    if (!layout.length || busy.value) return
    spinning.value = true
    result.value = null
    const response = await round.play({ options: { bets: layout } })
    if (!response) {
        spinning.value = false
        return
    }
    lastLayout.value = layout.map(bet => ({ ...bet }))
    await spinTo(response.result.pocket)
    result.value = response.result
    payout.value = response.payout

    // Lost chips go back to the house, winners are paid where they stand.
    for (const bet of response.result.bets) {
        const spot = spotByKey.get(betKey(bet))
        if (!spot) continue
        if (bet.won) flights.value?.fly(HOUSE_POS, center(spot), bet.payout - bet.amount, { size: 44, delay: 400, ladder: LADDER })
        else flights.value?.fly(center(spot), HOUSE_POS, bet.amount, { size: 44, ladder: LADDER })
    }
    paid.value = Object.fromEntries(response.result.bets.filter(bet => bet.won).map(bet => [betKey(bet), bet.payout]))
    bets.value = {}
    placed.value = []
    history.value = [{ id: response.roundId, pocket: response.result.pocket, color: response.result.color }, ...history.value].slice(0, 12)
    if (response.payout > 0) sound.play('win')
    setTimeout(() => {
        round.settle()
        spinning.value = false
    }, 900)
}

const phaseLabel = computed(() => {
    if (spinning.value && !result.value) return 'NO MORE BETS'
    if (result.value) return `${result.value.pocket} ${result.value.color.toUpperCase()}`
    return 'PLACE YOUR BETS'
})
const message = computed(() => {
    if (spinning.value && !result.value) return 'No more bets'
    if (result.value) return `${result.value.pocket} ${result.value.color}${payout.value > 0 ? ` · won ${formatNumber(payout.value)}` : ''}`
    return 'Place your bets'
})

const pos = (x: number, y: number) => ({ left: `${x}px`, top: `${y}px` })
const box = (spot: Spot) => ({ left: `${spot.box.x}px`, top: `${spot.box.y}px`, width: `${spot.box.w}px`, height: `${spot.box.h}px` })
const title = (spot: Spot) => `${spot.label ?? spot.kind}: pays ${betReturn(spot)}×`
</script>

<template>
  <LiveTableShell
    slug="roulette"
    solo
    connected
    :message="message"
    :seconds="null"
    :progress="null"
    :next-round-in="null"
    :watching="0"
    :seated="false"
    :leaving="false"
    :open-seat="null"
    :feed="[]"
    :scoreboard="[]"
  >
    <template #felt>
      <LiveTableStage v-if="!upright">
        <div class="lt-rules" style="top: 92px">SINGLE ZERO EUROPEAN WHEEL</div>
        <div class="rl-history" :style="{ left: '50%', top: '134px', transform: 'translateX(-50%)' }">
          <span class="rl-history-label">LAST</span>
          <span v-for="item in history.slice(0, 10)" :key="item.id" class="rl-pill" :class="item.color">{{ item.pocket }}</span>
          <span v-if="!history.length" class="rl-history-empty">No spins yet</span>
        </div>
        <div class="lt-phase" :style="pos(ZERO_LEFT + BETTING_WIDTH / 2, BETTING_TOP - 74)">
          <span class="label" :class="result ? (payout > 0 ? 'win' : '') : ''">{{ phaseLabel }}</span>
          <span v-if="result && payout > 0" class="count" style="color: var(--lt-win)">+{{ formatNumber(payout) }}</span>
        </div>

        <div class="rl-wheel" :style="{ ...pos(WHEEL_LEFT, WHEEL_TOP), width: `${WHEEL_SIZE}px`, height: `${WHEEL_SIZE}px` }">
          <div class="rl-wheel-spin" :style="{ transform: `rotate(${wheelRotation}deg)`, transitionDuration: `${SPIN_MS}ms` }" v-html="wheelSvg" />
          <div class="rl-ball-orbit" :style="{ transform: `rotate(${ballRotation}deg)`, transitionDuration: `${SPIN_MS}ms` }"><div class="rl-ball" /></div>
        </div>

        <div class="rl-layout" :class="{ closed: busy }" :style="{ left: `${ZERO_LEFT - 4}px`, top: `${BETTING_TOP - 4}px`, width: `${BETTING_WIDTH + 8}px`, height: `${BETTING_HEIGHT + 8}px` }" />
        <div
          v-for="spot in spots"
          :key="betKey(spot)"
          class="rl-cell"
          :class="[spot.tone, { zero: spot.value === 0 && spot.kind === 'straight', won: winningKeys.has(betKey(spot)), hit: result && spot.kind === 'straight' && spot.value === result.pocket }]"
          :style="{ ...box(spot), fontSize: spot.value === 0 && spot.kind === 'straight' ? '30px' : spot.tone === 'outside' ? '16px' : undefined }"
          :title="title(spot)"
          @click="place(spot)"
          @contextmenu.prevent="undo()"
        >
          <span v-if="spot.diamond" class="rl-diamond" :style="{ background: spot.diamond }" />
          <template v-else>{{ spot.label }}</template>
        </div>
        <template v-for="spot in spots" :key="`pile-${betKey(spot)}`">
          <div v-if="pileOn(betKey(spot))" class="rl-pile" :class="{ won: !!paid[betKey(spot)] && !bets[betKey(spot)] }" :style="pos(center(spot).x, center(spot).y)">
            <LiveTableChipPile :amount="pileOn(betKey(spot))" :size="44" :max="5" :ladder="LADDER" />
          </div>
        </template>
        <div v-if="stake > 0" class="rl-total" :style="pos(NUM_LEFT + GRID_WIDTH / 2, DOZENS_TOP + DOZEN_HEIGHT + 40)">
          <span>TOTAL BET</span><b>{{ formatNumber(stake) }}</b>
        </div>

        <div class="lt-house-well" :style="{ ...pos(HOUSE_POS.x, HOUSE_POS.y + 6), width: '170px' }" />
        <div class="lt-house" :style="pos(HOUSE_POS.x, HOUSE_POS.y + 10)">
          <LiveTableChipPile :column="[10, 8]" :size="38" :ladder="LADDER" />
          <LiveTableChipPile :column="[1_000, 11]" :size="38" />
          <LiveTableChipPile :column="[25_000, 6]" :size="38" />
          <LiveTableChipPile :column="[500, 9]" :size="38" />
        </div>
        <LiveTableChipFlights ref="flights" />
      </LiveTableStage>

      <!-- Phones: the wheel, then the board stood upright. -->
      <div v-else class="rl-felt space-y-3 p-3">
        <div class="relative mx-auto aspect-square w-52">
          <div class="rl-wheel">
            <div class="rl-wheel-spin" :style="{ transform: `rotate(${wheelRotation}deg)`, transitionDuration: `${SPIN_MS}ms` }" v-html="wheelSvg" />
            <div class="rl-ball-orbit" :style="{ transform: `rotate(${ballRotation}deg)`, transitionDuration: `${SPIN_MS}ms` }"><div class="rl-ball" /></div>
          </div>
        </div>
        <div class="flex min-h-7 flex-wrap justify-center gap-1">
          <span v-for="item in history" :key="item.id" class="rl-pill small" :class="item.color">{{ item.pocket }}</span>
        </div>
        <div class="grid gap-1 select-none" style="grid-template-columns: repeat(3, minmax(0, 1fr)) 1.1fr 1.1fr; grid-template-rows: repeat(14, minmax(2.6rem, auto))">
          <button
            v-for="spot in spots"
            :key="betKey(spot)"
            type="button"
            class="rl-cell static"
            :class="[spot.tone, { won: winningKeys.has(betKey(spot)), hit: result && spot.kind === 'straight' && spot.value === result.pocket }]"
            :style="uprightStyle(spot)"
            :title="title(spot)"
            @click="place(spot)"
          >
            <span v-if="spot.diamond" class="rl-diamond small" :style="{ background: spot.diamond }" />
            <span v-else :class="spot.at[3] > 1 ? '[writing-mode:vertical-rl]' : ''">{{ spot.label }}</span>
            <LiveTableChipPile v-if="pileOn(betKey(spot))" class="absolute -top-1 -right-1 z-10" :amount="pileOn(betKey(spot))" :size="24" :max="3" :ladder="LADDER" />
          </button>
        </div>
      </div>
    </template>

    <template #controls>
      <div class="flex items-stretch gap-2">
        <div class="lt-panel shrink-0">
          <span class="lt-panel-label">Total bet</span>
          <span class="lt-panel-value lt-mono">{{ formatNumber(stake) }}</span>
        </div>
        <LiveTableRack v-model="chip" :available="Math.max(0, limit - stake)" :ladder="LADDER" :muted="busy" class="min-w-0 flex-1" />
      </div>
      <LiveTableBetBar
        :can-repeat="!busy && lastLayout.length > 0"
        :can-scale="!busy && (stake > 0 || lastLayout.length > 0)"
        :can-undo="!busy && placed.length > 0"
        :can-clear="!busy && placed.length > 0"
        :can-deal="!busy && stake > 0"
        deal-label="SPIN"
        @repeat="rebet"
        @scale="scale"
        @undo="undo"
        @clear="clear"
        @deal="spin"
      />
    </template>

    <template #rules>
      <p>Single-zero European roulette. Pick a chip, click the layout to place it (right-click takes the last chip back), then spin. One spin settles every bet.</p>
      <p>A bet returns 36 ÷ the pockets it covers: a number 36×, a dozen or column 3×, red, black, odd, even, 1-18 and 19-36 2×. Zero loses every outside bet.</p>
    </template>
  </LiveTableShell>
</template>

<style scoped>
.rl-felt {
    background: radial-gradient(ellipse at 50% 30%, #14663f 0%, #0f5132 50%, #0c4128 100%);
    box-shadow: inset 0 0 0 6px #3b2416, inset 0 0 40px rgba(0, 0, 0, 0.5);
}
.rl-cell {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, sans-serif;
    font-weight: 800;
    letter-spacing: 0.03em;
    color: #f7f3e8;
    border: 1px solid rgba(217, 177, 103, 0.35);
    box-sizing: border-box;
    font-size: 22px;
    cursor: pointer;
    user-select: none;
    z-index: 2;
    transition: filter 0.15s ease, box-shadow 0.2s ease;
}
.rl-cell.static { position: relative; font-size: 14px; border-radius: 6px; }
.rl-cell:hover { filter: brightness(1.25); }
.rl-cell.red { background: rgba(176, 32, 46, 0.9); }
.rl-cell.black { background: rgba(15, 18, 24, 0.9); }
.rl-cell.green { background: rgba(13, 99, 54, 0.9); }
.rl-cell.outside { background: rgba(217, 177, 103, 0.14); }
.rl-cell.zero { border-radius: 10px 0 0 10px; }
.rl-cell.won { box-shadow: inset 0 0 0 3px var(--lt-gold), 0 0 18px rgba(217, 177, 103, 0.6); z-index: 3; }
.rl-cell.hit { box-shadow: inset 0 0 0 4px #fff, 0 0 26px rgba(255, 255, 255, 0.7); z-index: 4; animation: rl-hit 0.6s ease-in-out 3; }
@keyframes rl-hit { 50% { filter: brightness(1.6); } }
.rl-diamond {
    width: 24px;
    height: 24px;
    transform: rotate(45deg);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.35);
    border-radius: 3px;
}
.rl-diamond.small { width: 14px; height: 14px; }
.rl-layout {
    position: absolute;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.18);
    box-shadow: inset 0 0 0 1.5px rgba(217, 177, 103, 0.3);
    z-index: 1;
    pointer-events: none;
    transition: opacity 0.2s;
}
.rl-layout.closed { opacity: 0.55; }

.rl-history {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(11, 8, 6, 0.6);
    border: 1.5px solid rgba(217, 177, 103, 0.3);
    border-radius: 999px;
    padding: 6px 14px;
    white-space: nowrap;
}
.rl-history-label { font-size: 13px; font-weight: 800; letter-spacing: 0.08em; color: var(--lt-gold); margin-right: 4px; }
.rl-history-empty { font-size: 14px; color: #9a8f7a; }
.rl-pill {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 800;
    color: #f7f3e8;
    box-shadow: inset 0 0 0 1.5px rgba(0, 0, 0, 0.35);
}
.rl-pill.small { width: 26px; height: 26px; font-size: 11px; }
.rl-pill.red { background: #c02434; }
.rl-pill.black { background: #14181f; }
.rl-pill.green { background: #0f6e3c; }

.rl-wheel { position: absolute; inset: 0; }
.rl-wheel-spin {
    width: 100%;
    height: 100%;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.1, 0.74, 0.2, 1);
    filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.6));
}
.rl-wheel-spin :deep(svg) { width: 100%; height: 100%; display: block; }
.rl-ball-orbit {
    position: absolute;
    inset: 0;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.14, 0.8, 0.22, 1);
    pointer-events: none;
}
.rl-ball {
    position: absolute;
    left: 50%;
    top: 5.2%;
    width: 3.5%;
    height: 3.5%;
    transform: translateX(-50%);
    border-radius: 999px;
    background: radial-gradient(circle at 35% 30%, #ffffff, #d6d6d6 60%, #8c8c8c 100%);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.65);
}

.rl-pile {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 6;
    pointer-events: none;
}
.rl-pile.won { filter: drop-shadow(0 0 10px rgba(217, 177, 103, 0.9)); }
.rl-total {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 18px;
    border-radius: 999px;
    background: rgba(11, 8, 6, 0.88);
    border: 1.5px solid rgba(217, 177, 103, 0.55);
    white-space: nowrap;
    z-index: 3;
}
.rl-total span { font-size: 14px; font-weight: 800; letter-spacing: 0.1em; color: rgba(217, 177, 103, 0.8); }
.rl-total b { font-size: 20px; font-weight: 800; color: var(--lt-gold); font-variant-numeric: tabular-nums; }
</style>
