<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { PLINKO_MAX_ROWS, PLINKO_MIN_ROWS, PLINKO_RISKS, plinkoTable, type PlinkoResult, type PlinkoRisk } from '#shared/games/plinko'
import { findGame } from '#shared/games/registry'
import { costFor, formatCoins, formatCoinsExact, payFor, sumCoins } from '#shared/money'
import type { WinShow } from '~/components/game/WinBurst.vue'

const info = findGame('plinko')!
// A few rounds can be in the air at once; they settle in the order they were dropped.
const pool = [useGameRound<PlinkoResult>('plinko'), useGameRound<PlinkoResult>('plinko'), useGameRound<PlinkoResult>('plinko'), useGameRound<PlinkoResult>('plinko')]

const bet = ref(info.minBet)
const rows = ref(12)
const risk = ref<PlinkoRisk>('medium')
const balls = ref(1)
const win = ref<WinShow | null>(null)
const history = ref<{ id: string, label: string, won: boolean }[]>([])
const inFlight = ref(0)
const sound = useGameSound()

const table = computed(() => plinkoTable(rows.value, risk.value))
const stake = computed(() => costFor(bet.value, balls.value))
const maxWin = computed(() => payFor(bet.value, Math.max(...table.value)))
const locked = computed(() => inFlight.value > 0 || pool.some(r => r.busy.value))
const canDrop = computed(() => pool.some(r => !r.busy.value) && stake.value <= info.maxBet)

const riskOptions: { value: PlinkoRisk, label: string, face: string, edge: string }[] = PLINKO_RISKS.map(value => ({
    value,
    label: value[0]!.toUpperCase() + value.slice(1),
    ...(value === 'low' ? { face: '#3fd25a', edge: '#1b8a33' } : value === 'medium' ? { face: '#ff9a2e', edge: '#c25a0b' } : { face: '#ff3d8b', edge: '#9d1450' })
}))
const ballPresets = [1, 2, 3, 5, 10]

const multipleFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 })
const totalFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 })
/** A slot's label: `0,3`, `4,2`, `110`, `1K`. */
function slotLabel(m: number): string {
    return m >= 1000 ? `${multipleFormat.format(m / 1000)}K` : multipleFormat.format(m)
}
/** Slot colours by value: cool blue under the bet, then green, gold, orange, red and hot pink at the edges. */
function slotTone(m: number): { face: string, edge: string, ink: string, glow: string } {
    if (m >= 100) return { face: '#ff3d8b', edge: '#9d1450', ink: '#fff', glow: '255 61 139' }
    if (m >= 20) return { face: '#ff4f45', edge: '#a3241b', ink: '#fff', glow: '255 79 69' }
    if (m >= 5) return { face: '#ff9a2e', edge: '#b3560b', ink: '#3b1800', glow: '255 154 46' }
    if (m >= 2) return { face: '#ffd23f', edge: '#b9850a', ink: '#3b2600', glow: '255 210 63' }
    if (m >= 1) return { face: '#7bdc5a', edge: '#3a8a22', ink: '#103b05', glow: '123 220 90' }
    return { face: '#6d84d8', edge: '#33468f', ink: '#fff', glow: '109 132 216' }
}
const chanceFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 })
/** Desktop: every prize on this board, biggest first, with how often a ball lands on it. */
const paytable = computed(() => {
    const n = rows.value
    let ways = 1
    const byMultiple = new Map<number, number>()
    table.value.forEach((m, k) => {
        // C(n, k) / 2^n: the chance of k rights out of n bounces.
        if (k > 0) ways = (ways * (n - k + 1)) / k
        byMultiple.set(m, (byMultiple.get(m) ?? 0) + ways / 2 ** n)
    })
    return [...byMultiple].sort((a, b) => b[0] - a[0]).map(([m, p]) => ({
        m,
        chance: p >= 0.01 ? `${chanceFormat.format(p * 100)}%` : `1 in ${chanceFormat.format(1 / p)}`,
        title: `${formatFixed(p * 100, 4)}% of balls`
    }))
})
const BALL_HUES = [45, 330, 190, 140, 280, 20, 210, 100, 300, 170]

// ── The board ───────────────────────────────────────────────────────────────
//
// Row r (0-based) has r + 3 pegs, dx apart, centred. A ball starts above the
// middle peg of row 0; every bounce moves it half a gap left (0) or right (1),
// so it hits a peg on every row and, after `rows` bounces, drops into slot
// k = the number of rights, centred at (k - rows / 2) × dx. The path comes
// from the server; only the wobble and bounce heights are cosmetic.
//
// The canvas covers the whole board (pegs and the prize slots under them), so
// a ball falls right into its slot; the slots are DOM under the canvas.

const host = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const size = reactive({ w: 320, h: 320 })

interface Geometry { cx: number, dx: number, gap: number, top: number, peg: number, ball: number, slotTop: number, slotH: number, w: number, h: number, ox: number, oy: number }

/** Board geometry: as big as the stage allows (width and height), centred in it. */
function geometryFor(n: number): Geometry {
    const dx = Math.min(52, size.w / (n + 1.35), (size.h - 8) / (0.88 * n + 1.85))
    const gap = dx * 0.88
    const top = dx * 1.05
    const slotTop = top + (n - 1) * gap + gap * 0.9
    const slotH = Math.max(22, dx * 0.92)
    const w = (n + 1.35) * dx
    const h = slotTop + slotH + 8
    return { cx: w / 2, dx, gap, top, peg: Math.max(2.6, dx * 0.15), ball: Math.max(4.8, dx * 0.29), slotTop, slotH, w, h, ox: (size.w - w) / 2, oy: Math.max(0, (size.h - h) / 2) }
}
const geometry = computed(() => geometryFor(rows.value))

function pegX(g: Geometry, r: number, k: number) {
    return g.cx + (k - (r + 2) / 2) * g.dx
}
function pegY(g: Geometry, r: number) {
    return g.top + r * g.gap
}

interface Seg { t0: number, dur: number, x0: number, y0: number, x1: number, y1: number, v0: number, g: number, peg: [number, number] | null }
interface Flight {
    slot: number
    multiplier: number
    segs: Seg[]
    end: number
    landed: boolean
    /** The next segment whose end (a peg hit) hasn't flashed yet. */
    next: number
    trail: { x: number, y: number }[]
    hue: number
    onLand: () => void
}

let flights: Flight[] = []
/** Peg hits: `${r}:${k}` → time (s) of the last hit and the ball's hue. */
const pegHits = new Map<string, { at: number, hue: number }>()
let popIds = 0
let frame = 0
let reduced = false

function now() {
    return performance.now() / 1000
}

/** A ball's whole route as falling/bouncing segments: a hop off every peg, then the drop into its slot. */
function plan(g: Geometry, path: number[], start: number): Seg[] {
    const n = path.length
    const grav = 520 * g.gap
    const segs: Seg[] = []
    const contact = g.peg + g.ball * 0.95
    let off = 0
    let x = g.cx + (Math.random() - 0.5) * g.dx * 0.14
    let y = -g.ball
    let t = start
    for (let r = 0; r <= n; r++) {
        const last = r === n
        const tx = last ? g.cx + (off / 2) * g.dx : g.cx + (off / 2) * g.dx + (Math.random() - 0.5) * g.peg * 0.8
        const ty = last ? g.slotTop + g.slotH * 0.42 : pegY(g, r) - contact
        // The first drop falls from the chute; every other hop bounces up off the peg first.
        const rise = r === 0 ? 0 : g.gap * (0.14 + Math.random() * 0.14)
        const v0 = -Math.sqrt(2 * grav * rise)
        const dy = ty - y
        const dur = (-v0 + Math.sqrt(v0 * v0 + 2 * grav * dy)) / grav
        segs.push({ t0: t, dur, x0: x, y0: y, x1: tx, y1: ty, v0, g: grav, peg: last ? null : [r, (off + r + 2) / 2] })
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
            // Ease the sideways move so a hop arcs off the peg instead of sliding.
            const p = u / s.dur
            const e = p * (2 - p)
            return { x: s.x0 + (s.x1 - s.x0) * e, y: s.y0 + s.v0 * u + 0.5 * s.g * u * u }
        }
    }
    const lastSeg = f.segs[f.segs.length - 1]!
    return { x: lastSeg.x1, y: lastSeg.y1 }
}

// The pegs and the chute, drawn once per size and row count.
let boardCache: HTMLCanvasElement | null = null
let boardKey = ''
function board(g: Geometry, dpr: number): HTMLCanvasElement {
    const key = `${g.w}:${g.h}:${rows.value}:${dpr}`
    if (boardCache && key === boardKey) return boardCache
    const c = boardCache ?? document.createElement('canvas')
    c.width = Math.ceil(g.w * dpr)
    c.height = Math.ceil(g.h * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, g.w, g.h)
    // A soft glow behind the pyramid.
    const glow = ctx.createRadialGradient(g.cx, g.slotTop * 0.55, 0, g.cx, g.slotTop * 0.55, g.w * 0.62)
    glow.addColorStop(0, 'rgba(120, 190, 255, 0.16)')
    glow.addColorStop(1, 'rgba(120, 190, 255, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, g.w, g.h)
    // The chute the balls drop from: a gold funnel above the first peg.
    const cw = g.dx * 0.95
    const ch = g.top * 0.5
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.roundRect(g.cx - cw / 2 - 2, -4, cw + 4, ch + 7, [0, 0, 8, 8])
    ctx.fill()
    const gold = ctx.createLinearGradient(g.cx - cw / 2, 0, g.cx + cw / 2, 0)
    gold.addColorStop(0, '#b9780a')
    gold.addColorStop(0.35, '#ffe38a')
    gold.addColorStop(0.6, '#ffc93a')
    gold.addColorStop(1, '#a86a06')
    ctx.fillStyle = gold
    ctx.strokeStyle = '#4a2a00'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(g.cx - cw / 2, -4, cw, ch + 4, [0, 0, 7, 7])
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#1a0f05'
    ctx.beginPath()
    ctx.roundRect(g.cx - g.ball * 1.15, ch - 5, g.ball * 2.3, 5, 2.5)
    ctx.fill()
    // The pegs: glossy studs with a dark rim and a drop shadow.
    for (let r = 0; r < rows.value; r++) {
        for (let k = 0; k < r + 3; k++) {
            const x = pegX(g, r, k)
            const y = pegY(g, r)
            ctx.fillStyle = 'rgba(0,0,0,0.4)'
            ctx.beginPath()
            ctx.ellipse(x, y + g.peg * 0.8, g.peg * 1.05, g.peg * 0.65, 0, 0, Math.PI * 2)
            ctx.fill()
            const grad = ctx.createRadialGradient(x - g.peg * 0.35, y - g.peg * 0.45, g.peg * 0.1, x, y, g.peg * 1.15)
            grad.addColorStop(0, '#ffffff')
            grad.addColorStop(0.55, '#dfe7ff')
            grad.addColorStop(1, '#8f9fd6')
            ctx.fillStyle = grad
            ctx.strokeStyle = '#0d1030'
            ctx.lineWidth = Math.max(1, g.peg * 0.4)
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

const PEG_FLASH = 0.5

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
    // Pegs that were just hit light up in the ball's colour and send out a ripple.
    for (const [key, hit] of pegHits) {
        const age = t - hit.at
        if (age > PEG_FLASH) {
            pegHits.delete(key)
            continue
        }
        const [r, k] = key.split(':').map(Number) as [number, number]
        const x = pegX(g, r, k)
        const y = pegY(g, r)
        const fade = 1 - age / PEG_FLASH
        ctx.strokeStyle = `hsla(${hit.hue}, 100%, 70%, ${0.8 * fade})`
        ctx.lineWidth = Math.max(1.2, g.peg * 0.5) * fade
        ctx.beginPath()
        ctx.arc(x, y, g.peg * (1.3 + age * 9), 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = `hsla(${hit.hue}, 100%, 65%, ${0.35 * fade})`
        ctx.beginPath()
        ctx.arc(x, y, g.peg * 2.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `hsla(${hit.hue}, 100%, ${92 - 20 * (1 - fade)}%, ${fade})`
        ctx.beginPath()
        ctx.arc(x, y, g.peg * 1.08, 0, Math.PI * 2)
        ctx.fill()
    }
    for (const f of flights) {
        if (f.landed) continue
        const p = position(f, t)
        f.trail.push(p)
        if (f.trail.length > 8) f.trail.shift()
        f.trail.forEach((q, i) => {
            ctx.fillStyle = `hsla(${f.hue}, 100%, 70%, ${(i / f.trail.length) * 0.3})`
            ctx.beginPath()
            ctx.arc(q.x, q.y, g.ball * (0.35 + (i / f.trail.length) * 0.5), 0, Math.PI * 2)
            ctx.fill()
        })
        ctx.fillStyle = 'rgba(0,0,0,0.3)'
        ctx.beginPath()
        ctx.arc(p.x + 1, p.y + 2.5, g.ball, 0, Math.PI * 2)
        ctx.fill()
        const grad = ctx.createRadialGradient(p.x - g.ball * 0.35, p.y - g.ball * 0.4, g.ball * 0.1, p.x, p.y, g.ball)
        grad.addColorStop(0, '#fffbe6')
        grad.addColorStop(0.4, `hsl(${f.hue}, 100%, 62%)`)
        grad.addColorStop(1, `hsl(${f.hue - 12}, 95%, 38%)`)
        ctx.fillStyle = grad
        ctx.strokeStyle = '#2a1405'
        ctx.lineWidth = Math.max(1.2, g.ball * 0.22)
        ctx.beginPath()
        ctx.arc(p.x, p.y, g.ball, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.beginPath()
        ctx.arc(p.x - g.ball * 0.35, p.y - g.ball * 0.38, g.ball * 0.22, 0, Math.PI * 2)
        ctx.fill()
    }
}

/** Per slot: how many balls landed (a new count replays the bounce). */
const slotHits = ref<number[]>([])
const pops = ref<{ id: number, slot: number, label: string, tone: 'lose' | 'win' | 'big' }[]>([])

function tick() {
    const t = now()
    for (const f of flights) {
        if (f.landed) continue
        // Every segment that ended hit its peg: flash it once.
        while (f.next < f.segs.length && t >= f.segs[f.next]!.t0 + f.segs[f.next]!.dur) {
            const s = f.segs[f.next++]!
            if (s.peg) {
                pegHits.set(`${s.peg[0]}:${s.peg[1]}`, { at: s.t0 + s.dur, hue: f.hue })
                sound.peg(s.peg[0], rows.value)
            }
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

// ── The running tally: every ball of the drops in the air, as they land ─────

const tally = reactive({ balls: 0, landed: 0, stake: 0, payout: 0, paid: 0 })
const tallyDone = computed(() => tally.balls > 0 && tally.landed === tally.balls)
const tallyMultiple = computed(() => (tally.stake > 0 ? Math.floor((tally.payout / tally.stake) * 100) / 100 : 0))
/** Bumped on every landing so the total pops. */
const tallyBeat = ref(0)

function land(f: Flight) {
    f.landed = true
    const hits = [...slotHits.value]
    hits[f.slot] = (hits[f.slot] ?? 0) + 1
    slotHits.value = hits
    const id = ++popIds
    pops.value = [...pops.value, { id, slot: f.slot, label: `${slotLabel(f.multiplier)}×`, tone: f.multiplier >= 5 ? 'big' : f.multiplier >= 1 ? 'win' : 'lose' }]
    setTimeout(() => (pops.value = pops.value.filter(p => p.id !== id)), 950)
    tally.landed++
    tally.payout = sumCoins([tally.payout, payFor(currentBet(f), f.multiplier)])
    tallyBeat.value++
    sound.slot(f.multiplier)
    f.onLand()
}

/** The per-ball bet of the drop a flight belongs to (the bet field may have changed since). */
const flightBets = new WeakMap<Flight, number>()
function currentBet(f: Flight) {
    return flightBets.get(f) ?? bet.value
}

interface Drop { round: ReturnType<typeof useGameRound<PlinkoResult>>, id: string, payout: number, stake: number, balls: number[], done: boolean }
const drops: Drop[] = []

/** Settle the dropped rounds in order, each once all its balls are in. */
function flush() {
    while (drops[0]?.done) {
        const d = drops.shift()!
        history.value = [...d.balls.map((m, i) => ({ id: `${d.id}:${i}`, label: `${slotLabel(m)}×`, won: m >= 1 })), ...history.value].slice(0, 20)
        d.round.settle()
    }
    // The last ball of everything in the air is in: the whole tally is the result (the server's sum).
    if (!drops.length && tallyDone.value) tally.payout = tally.paid
    if (!drops.length && tallyDone.value && tally.payout > 0 && tally.payout >= tally.stake) {
        win.value = { id: `t${popIds}`, payout: tally.payout, multiplier: tallyMultiple.value }
        sound.win(tallyMultiple.value)
    }
}

async function drop() {
    const round = pool.find(r => !r.busy.value)
    if (!round || stake.value > info.maxBet) return
    // A drop onto a quiet board starts a new tally.
    if (!inFlight.value && !drops.length) {
        Object.assign(tally, { balls: 0, landed: 0, stake: 0, payout: 0, paid: 0 })
        win.value = null
    }
    inFlight.value++
    const perBall = bet.value
    const response = await round.play({ bet: perBall, options: { rows: rows.value, risk: risk.value, balls: balls.value } })
    if (!response) {
        inFlight.value--
        return
    }
    const g = geometry.value
    tally.balls += response.result.balls.length
    tally.stake = sumCoins([tally.stake, response.stake])
    tally.paid = sumCoins([tally.paid, response.payout])
    const entry: Drop = { round, id: response.roundId, payout: response.payout, stake: response.stake, balls: response.result.balls.map(b => b.multiplier), done: false }
    drops.push(entry)
    let left = response.result.balls.length
    const finish = () => {
        left--
        if (left > 0) return
        entry.done = true
        inFlight.value--
        flush()
    }
    const t = now()
    // Several drops at once each start from the chute a beat apart.
    const queued = flights.filter(f => !f.landed).length
    response.result.balls.forEach((b, i) => {
        const start = t + (i + Math.min(queued, 3) * 0.3) * 0.17
        const segs = reduced ? [] : plan(g, b.path, start)
        const last = segs[segs.length - 1]
        const flight: Flight = { slot: b.slot, multiplier: b.multiplier, segs, end: last ? last.t0 + last.dur : 0, landed: false, next: 0, trail: [], hue: BALL_HUES[(tally.balls - response.result.balls.length + i) % BALL_HUES.length]!, onLand: finish }
        flightBets.set(flight, perBall)
        if (reduced) land(flight)
        else flights.push(flight)
    })
    flights = flights.filter(f => !f.landed)
    if (reduced) draw()
    else animate()
}

let observer: ResizeObserver | null = null
onMounted(() => {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    observer = new ResizeObserver(([entry]) => {
        if (!entry) return
        const w = Math.max(220, Math.floor(entry.contentRect.width))
        const h = Math.max(200, Math.floor(entry.contentRect.height))
        // Ignore sub-pixel jitter (a scrollbar coming and going) so a resize never loops.
        if (Math.abs(w - size.w) >= 2) size.w = w
        if (Math.abs(h - size.h) >= 2) size.h = h
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

// ── Slot labels: one size for the row, never under 11 px ────────────────────
//
// On a phone a 16-row board leaves under 20 px per slot. The row takes the
// biggest size every label fits at (11-17 px); a wider label ("290") is
// squeezed narrower instead of shrunk, so every number stays readable.

/** Label widths in em, measured in the game font once it has loaded. */
const fontReady = ref(0)
let measurer: CanvasRenderingContext2D | null = null
function labelEm(text: string): number {
    void fontReady.value
    measurer ??= import.meta.client ? document.createElement('canvas').getContext('2d') : null
    if (!measurer) return text.length * 0.6
    measurer.font = `100px 'Lilita One', Fredoka, sans-serif`
    // g-num adds 0.02em per letter.
    return measurer.measureText(text).width / 100 + 0.02 * text.length
}
/** Tight boards: thinner gaps and rims, so the labels get the room. */
const compact = computed(() => geometry.value.dx < 28)
/** Room for a label inside its slot (the slot's gap and rim off). */
const slotRoom = computed(() => geometry.value.dx - (compact.value ? 2 : 3) - (compact.value ? 2 : 3) - 1)
const labelWidths = computed(() => table.value.map(m => labelEm(slotLabel(m))))
const slotFont = computed(() => {
    const fit = Math.min(...labelWidths.value.map(w => slotRoom.value / w))
    return Math.max(11, Math.min(17, geometry.value.dx * 0.6, fit))
})
/** A label too wide at the row's size is squeezed sideways (never below 70%). */
function squeeze(k: number): string | undefined {
    const scale = slotRoom.value / (labelWidths.value[k]! * slotFont.value)
    return scale < 1 ? `scaleX(${Math.max(0.7, scale).toFixed(3)})` : undefined
}
onMounted(() => void document.fonts?.load(`20px 'Lilita One'`).then(() => fontReady.value++).catch(() => {}))
</script>

<template>
  <GameFrame slug="plinko">
    <template #actions>
      <GameSoundToggle />
    </template>
    <div class="@container/game">
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <GameWinBurst :show="win" class="rounded-[1.5rem] [--wb-lift:3rem]">
          <GameFelt tone="night" class="plinko-stage h-full">
            <div class="relative flex h-full flex-col p-1 sm:p-3">
              <!-- The board: canvas pegs over DOM prize slots, as big as the stage allows. -->
              <div ref="host" class="plinko-host relative w-full min-w-0 flex-1">
                <!-- The feed pipe down to the chute when the board sits lower than the top. -->
                <div
                  v-if="geometry.oy > 2"
                  class="plinko-pipe absolute -top-3"
                  :style="{ left: `${geometry.ox + geometry.cx - geometry.dx * 0.36}px`, width: `${geometry.dx * 0.72}px`, height: `${geometry.oy + 16}px` }"
                  aria-hidden="true"
                />
                <div class="absolute" :style="{ left: `${geometry.ox}px`, top: `${geometry.oy}px`, width: `${geometry.w}px`, height: `${geometry.h}px` }">
                  <!-- The prize slots: a bucket per landing spot, hot at the edges. -->
                  <div class="absolute inset-x-0 flex justify-center" :style="{ top: `${geometry.slotTop}px`, height: `${geometry.slotH}px` }" role="list" aria-label="Prize slots">
                    <div
                      v-for="(m, k) in table" :key="`${rows}:${risk}:${k}`"
                      role="listitem"
                      class="relative h-full"
                      :class="compact ? 'px-px' : 'px-[1.5px]'"
                      :style="{ width: `${geometry.dx}px` }"
                    >
                      <span
                        :key="slotHits[k] ?? 0"
                        class="plinko-slot g-num grid size-full place-items-center overflow-hidden leading-none"
                        :class="[slotHits[k] ? 'plinko-slot-hit' : '', m >= 20 ? 'plinko-slot-hot' : '', compact ? 'plinko-slot-compact rounded-[5px]' : 'rounded-md']"
                        :style="{ '--face': slotTone(m).face, '--edge': slotTone(m).edge, '--glow': slotTone(m).glow, 'color': slotTone(m).ink, 'fontSize': `${slotFont}px` }"
                      ><span class="flex w-0 justify-center whitespace-nowrap" :style="{ transform: squeeze(k) }">{{ slotLabel(m) }}</span></span>
                      <span
                        v-for="p in pops.filter(p => p.slot === k)" :key="p.id"
                        class="plinko-float g-num pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 rounded-full px-1.5 whitespace-nowrap"
                        :class="p.tone === 'big' ? 'bg-[#ffc93a] text-base text-[#4a2a00] [text-shadow:none] sm:text-lg' : p.tone === 'win' ? 'bg-[#3fd25a] text-sm text-white' : 'bg-black/60 text-xs text-white/80'"
                      >{{ p.label }}</span>
                    </div>
                  </div>
                  <canvas ref="canvas" class="pointer-events-none absolute inset-0 block" :style="{ width: `${geometry.w}px`, height: `${geometry.h}px` }" aria-hidden="true" />
                </div>

                <!-- Top left, in the empty corner of the pyramid: the tally of the balls in the air. -->
                <div class="pointer-events-none absolute top-1 left-1 z-10 max-w-[42%]" aria-live="polite">
                  <div v-if="tally.balls" :key="tally.stake" class="plinko-tally g-ui rounded-2xl bg-black/45 px-2.5 py-1.5 ring-1 ring-white/10 backdrop-blur-[2px] sm:px-3 sm:py-2">
                    <p class="flex items-center gap-1 text-[11px] font-bold text-white/70 sm:text-xs">
                      <svg viewBox="0 0 10 10" class="size-2.5 shrink-0" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="#ffd23f" stroke="#2a1405" stroke-width="1.4" /></svg>
                      <span class="tabular-nums">{{ tally.landed }}/{{ tally.balls }}</span>
                      <span v-if="tallyDone" class="truncate" :class="tally.payout >= tally.stake ? 'text-[#7ee08f]' : 'text-[#ffb3c0]'">×{{ totalFormat.format(tallyMultiple) }}</span>
                    </p>
                    <p
                      :key="tallyBeat"
                      class="g-num plinko-beat flex items-center gap-1 text-xl leading-tight whitespace-nowrap sm:text-2xl"
                      :class="tallyDone && tally.payout < tally.stake ? 'text-white/85' : 'text-white'"
                      :title="`${formatCoinsExact(tally.payout)} chips of ${formatCoinsExact(tally.stake)} staked`"
                    >
                      <CasinoChipIcon class="size-[.8em]" />{{ formatCoins(tally.payout) }}
                    </p>
                  </div>
                </div>

                <!-- Top right: the best slot on this board, and the last balls. -->
                <div class="pointer-events-none absolute top-1 right-1 z-10 flex max-w-[40%] flex-col items-end gap-1">
                  <p class="g-ui g-num flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-0.5 text-sm whitespace-nowrap text-[#ffd84a] ring-1 ring-white/10 sm:text-base" :title="`Best slot pays ${formatCoinsExact(maxWin)} chips per ball`">
                    <span class="font-[family-name:var(--font-round)] text-[11px] font-bold text-white/60">up to</span>
                    <CasinoChipIcon class="size-3.5" />{{ formatCoins(maxWin) }}
                  </p>
                  <TransitionGroup tag="div" name="plinko-hist" class="flex flex-col items-end gap-1">
                    <span
                      v-for="item in history.slice(0, 5)" :key="item.id"
                      class="g-num rounded-full px-2 py-px text-xs"
                      :class="item.won ? 'bg-[#3fd25a]/25 text-[#9ff0ad]' : 'bg-black/35 text-white/55'"
                    >{{ item.label }}</span>
                  </TransitionGroup>
                </div>
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
              :class="risk === opt.value ? '' : 'g-dark opacity-70'"
              :style="risk === opt.value ? { '--face': opt.face, '--edge': opt.edge } : undefined"
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

          <!-- Balls per drop: gold balls, the picked one lifted. -->
          <div class="g-well flex items-center gap-1 rounded-2xl p-1" role="radiogroup" aria-label="Balls per drop">
            <button
              v-for="p in ballPresets" :key="p"
              type="button" role="radio"
              class="plinko-count relative flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl font-[family-name:var(--font-game)] text-lg transition disabled:opacity-35"
              :class="balls === p ? 'plinko-count-on text-[#4a2a00]' : 'text-white/80 hover:bg-white/5'"
              :disabled="costFor(bet, p) > info.maxBet"
              :aria-checked="balls === p"
              :aria-label="`${p} ball${p > 1 ? 's' : ''}`"
              @click="balls = p"
            >
              <svg viewBox="0 0 10 10" class="size-3 shrink-0" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="#ffd23f" stroke="#2a1405" stroke-width="1.4" /><circle cx="3.6" cy="3.6" r="1" fill="#fff" opacity=".8" /></svg>{{ p }}
            </button>
          </div>

          <!-- Desktop: the board's prizes in the spare room, what each pays per ball and how often; rows that don't fit drop out whole. -->
          <div class="relative hidden min-h-0 flex-1 @3xl:block">
            <ol class="absolute inset-0 flex flex-col flex-wrap content-start gap-1 overflow-hidden" aria-label="Prizes">
              <li v-for="row in paytable" :key="`${rows}:${risk}:${row.m}`" class="flex h-7 w-full shrink-0 items-center gap-2 rounded-lg bg-black/20 pr-2.5 pl-1">
                <span
                  class="plinko-slot g-num grid h-5 w-12 shrink-0 place-items-center rounded-md text-xs leading-none"
                  :style="{ '--face': slotTone(row.m).face, '--edge': slotTone(row.m).edge, '--glow': slotTone(row.m).glow, 'color': slotTone(row.m).ink, 'boxShadow': `0 2px 0 ${slotTone(row.m).edge}` }"
                >{{ slotLabel(row.m) }}×</span>
                <span class="g-num flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-white" :title="`${formatCoinsExact(payFor(bet, row.m))} chips per ball`"><CasinoChipIcon class="size-3.5 shrink-0" />{{ formatCoins(payFor(bet, row.m)) }}</span>
                <span class="shrink-0 font-[family-name:var(--font-round)] text-xs font-bold text-[var(--g-muted)] tabular-nums" :title="row.title">{{ row.chance }}</span>
              </li>
            </ol>
          </div>

          <!-- Sticks to the bottom of the sheet, so Drop never scrolls out of reach on a phone. -->
          <div class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto rounded-b-[1.4rem] bg-[var(--g-panel)] px-3 pt-1 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            <button type="button" class="g-btn g-gold h-16 w-full flex-col gap-0 rounded-2xl leading-none" :disabled="!canDrop" @click="drop">
              <span class="text-3xl uppercase">Drop{{ balls > 1 ? ` ${balls}` : '' }}</span>
              <span class="flex items-center gap-1 font-[family-name:var(--font-round)] text-sm font-bold" :title="`${formatCoinsExact(stake)} in all`">
                <GameStakeIcons :amount="stake" />{{ formatCoins(stake) }}
              </span>
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
/* Desktop: the stage fills the sheet's height (never taller, so nothing scrolls). Phone: square-ish, from the width. */
.plinko-host { aspect-ratio: 20 / 19; max-height: 60dvh; }
@container game (min-width: 48rem) {
    .plinko-stage { height: clamp(24rem, min(calc(85dvh - 6.5rem), calc(100dvh - 13.5rem)), 44rem); }
    .plinko-host { aspect-ratio: auto; max-height: none; height: 100%; }
}
.plinko-pipe {
    background: linear-gradient(90deg, #a86a06, #ffe38a 35%, #ffc93a 60%, #a86a06);
    border: 2px solid #4a2a00;
    border-top: 0;
    box-shadow: 0 0 14px rgb(255 201 58 / 0.25);
}
.plinko-slot {
    background: linear-gradient(180deg, color-mix(in srgb, var(--face) 62%, #fff) 0%, var(--face) 42%, color-mix(in srgb, var(--face) 85%, #000) 100%);
    box-shadow: 0 4px 0 var(--edge), inset 0 2px 0 rgb(255 255 255 / 0.4), 0 0 12px rgb(var(--glow) / 0.35);
    border: 1.5px solid rgb(20 10 40 / 0.6);
    text-shadow: 0 1px 0 rgb(255 255 255 / 0.25);
}
.plinko-slot-compact { border-width: 1px; }
.plinko-slot-hot { animation: plinko-hot 1.8s ease-in-out infinite; }
.plinko-slot-hit { animation: plinko-hit 0.5s cubic-bezier(0.3, 0.7, 0.4, 1.4); }
.plinko-float { animation: plinko-float 0.95s ease-out both; }
.plinko-tally { animation: plinko-in 0.25s ease-out both; }
.plinko-beat { animation: plinko-beat 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.6); transform-origin: left center; }
.plinko-count-on {
    background: linear-gradient(180deg, #fff3b0, #ffc93a 55%, #e79a00);
    box-shadow: 0 3px 0 #9a5a00, inset 0 1px 0 rgb(255 255 255 / 0.6);
    transform: translateY(-2px);
    text-shadow: 0 1px 0 rgb(255 255 255 / 0.4);
}
.plinko-hist-enter-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.plinko-hist-enter-from { opacity: 0; transform: translateX(8px); }
.plinko-hist-leave-active { display: none; }
@keyframes plinko-hot {
    0%, 100% { box-shadow: 0 4px 0 var(--edge), inset 0 2px 0 rgb(255 255 255 / 0.4), 0 0 10px rgb(var(--glow) / 0.35); }
    50% { box-shadow: 0 4px 0 var(--edge), inset 0 2px 0 rgb(255 255 255 / 0.4), 0 0 20px 3px rgb(var(--glow) / 0.6); }
}
@keyframes plinko-hit {
    0% { transform: translateY(0) scale(1); filter: brightness(1); }
    25% { transform: translateY(7px) scale(1.08, 0.86); filter: brightness(1.6); box-shadow: 0 0 0 var(--edge), 0 0 26px 8px rgb(var(--glow) / 0.95); }
    55% { transform: translateY(-3px) scale(0.97, 1.06); }
    100% { transform: translateY(0) scale(1); filter: brightness(1); }
}
@keyframes plinko-float {
    0% { transform: translate(-50%, 8px) scale(0.5); opacity: 0; }
    18% { transform: translate(-50%, 0) scale(1.15); opacity: 1; }
    100% { transform: translate(-50%, -30px) scale(1); opacity: 0; }
}
@keyframes plinko-in { from { opacity: 0; transform: translateY(-6px); } }
@keyframes plinko-beat { 0% { transform: scale(1); } 40% { transform: scale(1.14); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
    .plinko-slot-hit, .plinko-slot-hot, .plinko-float, .plinko-tally, .plinko-beat { animation: none; }
    .plinko-count { transition: none; }
}
</style>
