<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { PLINKO_MAX_ROWS, PLINKO_MIN_ROWS, PLINKO_RISKS, plinkoTable, type PlinkoResult, type PlinkoRisk } from '#shared/games/plinko'
import { findGame } from '#shared/games/registry'
import { costFor, formatCoins, formatCoinsExact, payFor } from '#shared/money'
import type { WinShow } from '~/components/game/WinBurst.vue'

const info = findGame('plinko')!
// A few rounds can be in the air at once; they settle in the order they were dropped.
const pool = [useGameRound<PlinkoResult>('plinko'), useGameRound<PlinkoResult>('plinko'), useGameRound<PlinkoResult>('plinko'), useGameRound<PlinkoResult>('plinko')]

const bet = ref(info.minBet)
const rows = ref(12)
const risk = ref<PlinkoRisk>('medium')
const balls = ref(1)
const win = ref<WinShow | null>(null)
const last = ref<{ id: string, multiplier: number, payout: number, stake: number } | null>(null)
const history = ref<{ id: string, label: string, won: boolean }[]>([])
const inFlight = ref(0)

const table = computed(() => plinkoTable(rows.value, risk.value))
const stake = computed(() => costFor(bet.value, balls.value))
const maxWin = computed(() => payFor(bet.value, Math.max(...table.value)))
const locked = computed(() => inFlight.value > 0 || pool.some(r => r.busy.value))
const canDrop = computed(() => pool.some(r => !r.busy.value) && stake.value <= info.maxBet)

const riskOptions: { value: PlinkoRisk, label: string }[] = PLINKO_RISKS.map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))
const ballPresets = [
    { value: 1, face: '#a855f7', edge: '#6b21a8' },
    { value: 2, face: '#3b82f6', edge: '#1e40af' },
    { value: 3, face: '#22c55e', edge: '#15803d' },
    { value: 5, face: '#f59e0b', edge: '#b45309' },
    { value: 10, face: '#ef4444', edge: '#991b1b' }
]

const multipleFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 })
/** A slot's label: `0,3`, `4,2`, `110`, `1K`. */
function slotLabel(m: number): string {
    return m >= 1000 ? `${multipleFormat.format(m / 1000)}K` : multipleFormat.format(m)
}
function slotTone(m: number): { face: string, edge: string, ink: string } {
    if (m >= 100) return { face: '#ff3d8b', edge: '#9d1450', ink: '#fff' }
    if (m >= 20) return { face: '#ff5a4d', edge: '#a3241b', ink: '#fff' }
    if (m >= 5) return { face: '#ff9a2e', edge: '#b3560b', ink: '#3b1800' }
    if (m >= 2) return { face: '#ffd23f', edge: '#b9850a', ink: '#3b2600' }
    if (m >= 1) return { face: '#7bdc5a', edge: '#3a8a22', ink: '#103b05' }
    return { face: '#6d84d8', edge: '#33468f', ink: '#fff' }
}

// ── The board ───────────────────────────────────────────────────────────────
//
// Row r (0-based) has r + 3 pegs, dx apart, centred. A ball starts above the
// middle peg of row 0; every bounce moves it half a gap left (0) or right (1),
// so it hits a peg on every row and, after `rows` bounces, drops into slot
// k = the number of rights, centred at (k - rows / 2) × dx. The path comes
// from the server; only the wobble and bounce heights are cosmetic.

const host = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const size = reactive({ w: 320, h: 300 })

interface Geometry { cx: number, dx: number, gap: number, top: number, peg: number, ball: number, slotTop: number, w: number, h: number }

/** Board geometry for the current size and row count. */
function geometryFor(n: number): Geometry {
    const w = size.w
    const maxH = Math.min(window.innerHeight * 0.62, 34 * 16)
    // Square-ish: n rows of pegs and a bit of headroom; the slots sit below the canvas.
    const dx = Math.min(w / (n + 2), maxH / (n * 0.88 + 1.4))
    const gap = dx * 0.88
    const top = dx * 1.1
    return { cx: w / 2, dx, gap, top, peg: Math.max(2.4, dx * 0.13), ball: Math.max(4.5, dx * 0.27), slotTop: top + (n - 1) * gap + gap * 0.95, w, h: top + (n - 1) * gap + gap * 1.05 }
}
const geometry = computed(() => geometryFor(rows.value))

function pegX(g: Geometry, r: number, k: number) {
    return g.cx + (k - (r + 2) / 2) * g.dx
}
function pegY(g: Geometry, r: number) {
    return g.top + r * g.gap
}

interface Flight {
    id: number
    path: number[]
    slot: number
    multiplier: number
    start: number
    /** Per segment: start (s), duration (s), from/to points, apex rise. */
    segs: { t0: number, dur: number, x0: number, y0: number, x1: number, y1: number, v0: number, g: number, peg: [number, number] | null }[]
    end: number
    landed: boolean
    /** The next segment whose end (a peg hit) hasn't flashed yet. */
    next: number
    trail: { x: number, y: number }[]
    hue: number
    onLand: () => void
}

let flights: Flight[] = []
/** Peg hits: `${r}:${k}` → time (s) of the last hit. */
const pegHits = new Map<string, number>()
let ballIds = 0
let frame = 0
let reduced = false

function now() {
    return performance.now() / 1000
}

/** A ball's whole route as falling/bouncing segments. */
function plan(g: Geometry, path: number[], start: number): Flight['segs'] {
    const n = path.length
    const grav = 460 * g.gap
    const segs: Flight['segs'] = []
    const contact = g.peg + g.ball * 0.92
    let off = 0
    let x = g.cx + (Math.random() - 0.5) * g.dx * 0.16
    let y = g.top - g.gap * 1.05
    let t = start
    // The pegs hit: row r at offset `off` (in half gaps from the middle peg).
    for (let r = 0; r <= n; r++) {
        const last = r === n
        const tx = last ? g.cx + (off / 2) * g.dx : g.cx + (off / 2) * g.dx + (Math.random() - 0.5) * g.peg * 0.8
        const ty = last ? g.slotTop - g.ball * 0.4 : pegY(g, r) - contact
        // The first drop falls from rest; every other hop bounces up off the peg first.
        const rise = r === 0 ? 0 : g.gap * (0.16 + Math.random() * 0.14)
        const v0 = -Math.sqrt(2 * grav * rise)
        const dy = ty - y
        const dur = (-v0 + Math.sqrt(v0 * v0 + 2 * grav * dy)) / grav
        const k = last ? null : (off + r + 2) / 2
        segs.push({ t0: t, dur, x0: x, y0: y, x1: tx, y1: ty, v0, g: grav, peg: last ? null : [r, k!] })
        t += dur
        x = tx
        y = ty
        if (!last) off += path[r] ? 1 : -1
    }
    return segs
}

function position(f: Flight, t: number): { x: number, y: number } {
    for (const s of f.segs) {
        if (t < s.t0 + s.dur) {
            const u = Math.max(0, t - s.t0)
            return { x: s.x0 + (s.x1 - s.x0) * (u / s.dur), y: s.y0 + s.v0 * u + 0.5 * s.g * u * u }
        }
    }
    const lastSeg = f.segs[f.segs.length - 1]!
    return { x: lastSeg.x1, y: lastSeg.y1 }
}

// The pegs, drawn once per size and row count.
let boardCache: HTMLCanvasElement | null = null
let boardKey = ''
function board(g: Geometry, dpr: number): HTMLCanvasElement {
    const key = `${g.w}:${rows.value}:${dpr}`
    if (boardCache && key === boardKey) return boardCache
    const c = boardCache ?? document.createElement('canvas')
    c.width = Math.ceil(g.w * dpr)
    c.height = Math.ceil(g.h * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, g.w, g.h)
    for (let r = 0; r < rows.value; r++) {
        for (let k = 0; k < r + 3; k++) {
            const x = pegX(g, r, k)
            const y = pegY(g, r)
            ctx.fillStyle = 'rgba(0,0,0,0.35)'
            ctx.beginPath()
            ctx.ellipse(x, y + g.peg * 0.7, g.peg * 1.1, g.peg * 0.6, 0, 0, Math.PI * 2)
            ctx.fill()
            const grad = ctx.createRadialGradient(x - g.peg * 0.35, y - g.peg * 0.4, g.peg * 0.1, x, y, g.peg * 1.2)
            grad.addColorStop(0, '#ffffff')
            grad.addColorStop(1, '#a9b6e0')
            ctx.fillStyle = grad
            ctx.strokeStyle = '#141033'
            ctx.lineWidth = Math.max(1, g.peg * 0.45)
            ctx.beginPath()
            ctx.arc(x, y, g.peg, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
        }
    }
    boardCache = c
    boardKey = key
    return c
}

function draw() {
    const el = canvas.value
    if (!el) return
    const g = geometry.value
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (el.width !== Math.ceil(g.w * dpr) || el.height !== Math.ceil(g.h * dpr)) {
        el.width = Math.ceil(g.w * dpr)
        el.height = Math.ceil(g.h * dpr)
    }
    const ctx = el.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, el.width, el.height)
    ctx.drawImage(board(g, dpr), 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const t = now()
    // Pegs that were just hit flash and ring.
    for (const [key, at] of pegHits) {
        const age = t - at
        if (age > 0.45) {
            pegHits.delete(key)
            continue
        }
        const [r, k] = key.split(':').map(Number) as [number, number]
        const x = pegX(g, r, k)
        const y = pegY(g, r)
        const fade = 1 - age / 0.45
        ctx.fillStyle = `rgba(255, 220, 90, ${0.45 * fade})`
        ctx.beginPath()
        ctx.arc(x, y, g.peg * (1.4 + age * 4), 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `rgba(255, 255, 255, ${fade})`
        ctx.beginPath()
        ctx.arc(x, y, g.peg * 1.05, 0, Math.PI * 2)
        ctx.fill()
    }
    for (const f of flights) {
        if (f.landed) continue
        const p = position(f, t)
        f.trail.push(p)
        if (f.trail.length > 7) f.trail.shift()
        f.trail.forEach((q, i) => {
            ctx.fillStyle = `hsla(${f.hue}, 100%, 70%, ${(i / f.trail.length) * 0.35})`
            ctx.beginPath()
            ctx.arc(q.x, q.y, g.ball * (0.4 + (i / f.trail.length) * 0.5), 0, Math.PI * 2)
            ctx.fill()
        })
        ctx.fillStyle = 'rgba(0,0,0,0.3)'
        ctx.beginPath()
        ctx.arc(p.x + 1, p.y + 2, g.ball, 0, Math.PI * 2)
        ctx.fill()
        const grad = ctx.createRadialGradient(p.x - g.ball * 0.35, p.y - g.ball * 0.4, g.ball * 0.1, p.x, p.y, g.ball)
        grad.addColorStop(0, '#fffbe0')
        grad.addColorStop(0.45, `hsl(${f.hue}, 100%, 62%)`)
        grad.addColorStop(1, `hsl(${f.hue - 12}, 95%, 40%)`)
        ctx.fillStyle = grad
        ctx.strokeStyle = '#2a1405'
        ctx.lineWidth = Math.max(1.2, g.ball * 0.22)
        ctx.beginPath()
        ctx.arc(p.x, p.y, g.ball, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
    }
}

const slotHits = ref<number[]>([])
const pops = ref<{ id: number, slot: number, label: string, big: boolean }[]>([])

function tick() {
    const t = now()
    for (const f of flights) {
        if (f.landed) continue
        // Every segment that ended hit its peg: flash it once.
        while (f.next < f.segs.length && t >= f.segs[f.next]!.t0 + f.segs[f.next]!.dur) {
            const s = f.segs[f.next++]!
            if (s.peg) pegHits.set(`${s.peg[0]}:${s.peg[1]}`, s.t0 + s.dur)
        }
        if (t >= f.end) land(f)
    }
    draw()
    if (flights.some(f => !f.landed) || pegHits.size) frame = requestAnimationFrame(tick)
    else frame = 0
}

function animate() {
    if (!frame) frame = requestAnimationFrame(tick)
}

function land(f: Flight) {
    f.landed = true
    const hits = [...slotHits.value]
    hits[f.slot] = (hits[f.slot] ?? 0) + 1
    slotHits.value = hits
    const id = ++ballIds
    pops.value = [...pops.value, { id, slot: f.slot, label: `${slotLabel(f.multiplier)}×`, big: f.multiplier >= 5 }]
    setTimeout(() => (pops.value = pops.value.filter(p => p.id !== id)), 900)
    f.onLand()
}

interface Drop { round: ReturnType<typeof useGameRound<PlinkoResult>>, id: string, payout: number, stake: number, multiplier: number, balls: number[], done: boolean }
const drops: Drop[] = []

/** Settle the dropped rounds in order, each once all its balls are in. */
function flush() {
    while (drops[0]?.done) {
        const d = drops.shift()!
        const multiple = d.stake > 0 ? d.payout / d.stake : 0
        last.value = { id: d.id, multiplier: multiple, payout: d.payout, stake: d.stake }
        win.value = multiple >= 1 ? { id: d.id, payout: d.payout, multiplier: Math.floor(multiple * 100) / 100 } : null
        history.value = [...d.balls.map((m, i) => ({ id: `${d.id}:${i}`, label: `${slotLabel(m)}×`, won: m >= 1 })), ...history.value].slice(0, 20)
        d.round.settle()
    }
}

async function drop() {
    const round = pool.find(r => !r.busy.value)
    if (!round || stake.value > info.maxBet) return
    inFlight.value++
    const g = geometry.value
    const response = await round.play({ bet: bet.value, options: { rows: rows.value, risk: risk.value, balls: balls.value } })
    if (!response) {
        inFlight.value--
        return
    }
    if (win.value && !drops.length) win.value = null
    const entry: Drop = { round, id: response.roundId, payout: response.payout, stake: response.stake, multiplier: response.result.multiplier, balls: response.result.balls.map(b => b.multiplier), done: false }
    drops.push(entry)
    let left = response.result.balls.length
    const finish = () => {
        left--
        if (left > 0) return
        entry.done = true
        inFlight.value--
        flush()
    }
    if (reduced) {
        for (const b of response.result.balls) land({ id: ++ballIds, path: b.path, slot: b.slot, multiplier: b.multiplier, start: 0, segs: [], end: 0, landed: false, next: 0, trail: [], hue: 45, onLand: finish })
        draw()
        return
    }
    const t = now()
    response.result.balls.forEach((b, i) => {
        const start = t + i * 0.16
        const segs = plan(g, b.path, start)
        const last = segs[segs.length - 1]!
        flights.push({ id: ++ballIds, path: b.path, slot: b.slot, multiplier: b.multiplier, start, segs, end: last.t0 + last.dur, landed: false, next: 0, trail: [], hue: [45, 330, 190, 140, 280][i % 5]!, onLand: finish })
    })
    flights = flights.filter(f => !f.landed)
    animate()
}

let observer: ResizeObserver | null = null
onMounted(() => {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    observer = new ResizeObserver(([entry]) => {
        const w = entry ? Math.max(240, Math.floor(entry.contentRect.width)) : size.w
        // Ignore sub-pixel jitter (a scrollbar coming and going) so a resize never loops.
        if (Math.abs(w - size.w) >= 2) size.w = w
    })
    if (host.value) observer.observe(host.value)
    window.addEventListener('keydown', onKey)
    nextTick(draw)
})
onBeforeUnmount(() => {
    observer?.disconnect()
    cancelAnimationFrame(frame)
    window.removeEventListener('keydown', onKey)
})
watch([geometry, rows], () => nextTick(draw))

function onKey(event: KeyboardEvent) {
    if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault()
        void drop()
    }
}

const slotWidth = computed(() => geometry.value.dx)
const lastText = computed(() => (last.value ? `${multipleFormat.format(Math.floor(last.value.multiplier * 100) / 100)}×` : ''))
</script>

<template>
  <GameFrame slug="plinko">
    <div class="@container">
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <GameWinBurst :show="win" class="rounded-[1.5rem]">
          <GameFelt tone="blue" class="h-full">
            <div class="flex h-full min-h-[17rem] flex-col p-2 sm:p-4 @3xl:min-h-[30rem]">
              <GameRoundHistory :items="history" compact class="px-1" />
              <div ref="host" class="relative mx-auto flex w-full flex-1 flex-col items-center justify-center pt-1">
                <canvas ref="canvas" class="block max-w-full" :style="{ width: `${geometry.w}px`, height: `${geometry.h}px` }" aria-hidden="true" />
                <!-- The prize slots: a bucket per landing spot, hot at the edges. -->
                <div class="relative flex justify-center" :style="{ width: `${geometry.w}px` }" role="list" aria-label="Prize slots">
                  <div
                    v-for="(m, k) in table" :key="`${rows}:${risk}:${k}`"
                    role="listitem"
                    class="relative flex justify-center px-[1.5px]"
                    :style="{ width: `${slotWidth}px` }"
                  >
                    <span
                      :key="slotHits[k] ?? 0"
                      class="plinko-slot g-num grid w-full place-items-center rounded-md leading-none"
                      :class="slotHits[k] ? 'plinko-slot-hit' : ''"
                      :style="{ '--face': slotTone(m).face, '--edge': slotTone(m).edge, 'color': slotTone(m).ink, 'height': `${Math.max(22, slotWidth * 0.95)}px`, 'fontSize': `${Math.max(8.5, Math.min(15, slotWidth * (slotLabel(m).length > 3 ? 0.32 : 0.42)))}px` }"
                    >{{ slotLabel(m) }}</span>
                    <span
                      v-for="p in pops.filter(p => p.slot === k)" :key="p.id"
                      class="plinko-float g-num pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 rounded-full px-1.5 whitespace-nowrap"
                      :class="p.big ? 'bg-[#ffc93a] text-sm text-[#4a2a00] [text-shadow:none] sm:text-base' : 'bg-black/55 text-xs text-white'"
                    >{{ p.label }}</span>
                  </div>
                </div>
              </div>
              <div class="flex h-9 items-center justify-center pt-1">
                <p v-if="last && last.multiplier < 1" class="g-title inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-0.5 text-sm text-white/85 sm:text-base">
                  <CasinoChipIcon class="size-4" /> +{{ formatCoins(last.payout) }} <span class="opacity-70">{{ lastText }}</span>
                </p>
                <p v-else-if="!last" class="g-title inline-flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-0.5 text-sm text-white/85 sm:text-base">
                  Win up to {{ formatCoins(maxWin) }}
                </p>
              </div>
            </div>
          </GameFelt>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="locked && !canDrop" label="Bet per ball" />

          <div role="radiogroup" aria-label="Risk" class="grid grid-cols-3 gap-2">
            <button
              v-for="opt in riskOptions" :key="opt.value"
              type="button" role="radio" :aria-checked="risk === opt.value"
              :disabled="locked"
              class="g-btn h-12 rounded-2xl text-lg"
              :class="risk === opt.value ? 'g-blue' : 'g-dark opacity-70'"
              @click="risk = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>

          <div class="g-well flex items-center gap-3 rounded-2xl px-3 py-1">
            <span class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Rows</span>
            <SliderRoot
              :model-value="[rows]"
              :min="PLINKO_MIN_ROWS"
              :max="PLINKO_MAX_ROWS"
              :step="1"
              :disabled="locked"
              aria-label="Rows"
              class="relative flex h-11 min-w-0 flex-1 touch-none items-center select-none data-[disabled]:opacity-60"
              @update:model-value="value => (rows = value?.[0] ?? rows)"
            >
              <SliderTrack class="relative h-3 grow overflow-hidden rounded-full bg-black/40">
                <SliderRange class="absolute h-full rounded-full bg-[var(--g-blue)]" />
              </SliderTrack>
              <SliderThumb class="block size-7 rounded-full border-[3px] border-[var(--g-blue-edge)] bg-white shadow-[0_3px_0_rgba(0,0,0,.4)] outline-none focus-visible:ring-4 focus-visible:ring-white/50" />
            </SliderRoot>
            <span class="g-num w-7 text-right text-2xl">{{ rows }}</span>
          </div>

          <div class="flex items-center justify-between gap-1" role="radiogroup" aria-label="Balls per drop">
            <button
              v-for="p in ballPresets" :key="p.value"
              type="button" role="radio"
              class="plinko-chip grid size-12 shrink-0 place-items-center rounded-full font-[family-name:var(--font-game)] text-white transition disabled:opacity-40"
              :class="[balls === p.value ? 'plinko-chip-on' : '', p.value >= 10 ? 'text-base' : 'text-lg']"
              :style="{ '--face': p.face, '--edge': p.edge }"
              :disabled="costFor(bet, p.value) > info.maxBet"
              :aria-checked="balls === p.value"
              :aria-label="`${p.value} ball${p.value > 1 ? 's' : ''}`"
              @click="balls = p.value"
            >
              <span class="flex items-center gap-0.5">{{ p.value }}<svg viewBox="0 0 10 10" class="size-2.5" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="#ffd23f" stroke="#2a1405" stroke-width="1.4" /></svg></span>
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Stake</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl" :title="`${formatCoinsExact(stake)}`">
                <GameStakeIcons :amount="stake" />{{ formatCoins(stake) }}
              </p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Max win</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl text-[var(--g-green)]" :title="`${formatCoinsExact(maxWin)} chips per ball`">
                <CasinoChipIcon class="size-4" />{{ formatCoins(maxWin) }}
              </p>
            </div>
          </div>

          <!-- Sticks to the bottom of the sheet, so Drop never scrolls out of reach on a phone. -->
          <div class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto rounded-b-[1.4rem] bg-[var(--g-panel)] px-3 pt-1 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            <button type="button" class="g-btn g-gold h-16 w-full rounded-2xl text-3xl uppercase" :disabled="!canDrop" @click="drop">
              Drop{{ balls > 1 ? ` ${balls}` : '' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Drop a ball through the pegs. At every peg it bounces left or right with even odds and lands in one of the slots at the bottom, which pays bet × its number.</p>
      <p><strong>Rows</strong> (8-16) makes the board taller and the edges richer; <strong>risk</strong> trades a softer middle for bigger edges. Drop up to 10 balls at once, each costs the bet. Every board returns 97-97,8%. Space drops.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.plinko-slot {
    background: linear-gradient(180deg, color-mix(in srgb, var(--face) 70%, #fff) 0%, var(--face) 45%);
    box-shadow: 0 4px 0 var(--edge), inset 0 -2px 0 rgb(0 0 0 / 0.12);
    border: 1.5px solid rgb(20 10 40 / 0.55);
}
.plinko-slot-hit { animation: plinko-hit 0.42s cubic-bezier(0.3, 0.7, 0.4, 1.4); }
.plinko-float { animation: plinko-float 0.9s ease-out both; }
.plinko-chip {
    background: radial-gradient(circle, var(--face) 0 52%, transparent 53%), repeating-conic-gradient(#fff 0 15deg, var(--face) 15deg 45deg);
    border: 2px solid var(--edge);
    box-shadow: 0 3px 0 var(--edge), inset 0 0 0 3px var(--face);
    text-shadow: 0 1.5px 0 rgb(0 0 0 / 0.45);
}
.plinko-chip:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 var(--edge), inset 0 0 0 3px var(--face); }
.plinko-chip-on { transform: translateY(-3px) scale(1.08); box-shadow: 0 5px 0 var(--edge), 0 0 0 3px #fff, 0 0 16px rgb(255 255 255 / 0.5); }
@keyframes plinko-hit {
    0% { transform: translateY(0); filter: brightness(1); }
    30% { transform: translateY(5px); filter: brightness(1.5); box-shadow: 0 0 0 var(--edge), 0 0 18px 4px var(--face); }
    100% { transform: translateY(0); filter: brightness(1); }
}
@keyframes plinko-float {
    0% { transform: translate(-50%, 6px) scale(0.6); opacity: 0; }
    20% { transform: translate(-50%, 0) scale(1.1); opacity: 1; }
    100% { transform: translate(-50%, -26px) scale(1); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
    .plinko-slot-hit, .plinko-float { animation: none; }
    .plinko-chip, .plinko-chip-on { transition: none; }
}
</style>
