<script setup lang="ts">
import { pocketColor, WHEEL_ORDER } from '#shared/games/roulette'

/**
 * A European roulette wheel: a wooden bowl with a ball track and brass
 * deflectors, a turning rotor with numbered pockets, and a ball that orbits
 * the track, slows, drops past the deflectors and rattles into its pocket.
 *
 * Everything moves with transforms written straight to the DOM from one
 * animation frame loop. The ball is placed relative to the rotor, on a curve
 * that ends exactly on the drawn pocket, so it always lands where the server
 * said. The rotor keeps idling between spins and the ball rides along in its
 * pocket. `spin(pocket)` resolves once the ball has settled.
 */
const STEP = 360 / WHEEL_ORDER.length
const COLORS = {
    red: { face: '#d3263a', pocket: '#8c1322' },
    black: { face: '#1f1d26', pocket: '#0b0a0f' },
    green: { face: '#119a5c', pocket: '#08603a' }
} as const

// Radii in the 200-unit viewBox.
const R_ROTOR = 73
const R_NUMBERS = 61
const R_POCKETS = 48
const R_CONE = 15
const R_TRACK = 88.5
const R_DEFLECT = 70
const R_REST = 54.5

const point = (angle: number, r: number) => {
    const a = angle * Math.PI / 180
    return `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`
}
function wedge(a0: number, a1: number, r0: number, r1: number) {
    return `M${point(a0, r1)} A${r1} ${r1} 0 0 1 ${point(a1, r1)} L${point(a1, r0)} A${r0} ${r0} 0 0 0 ${point(a0, r0)} Z`
}

const pockets = WHEEL_ORDER.map((n, i) => {
    const a0 = i * STEP - STEP / 2
    const a1 = i * STEP + STEP / 2
    const tone = COLORS[pocketColor(n)]
    const mid = i * STEP
    return {
        n,
        number: wedge(a0, a1, R_NUMBERS, R_ROTOR - 1.6),
        pocket: wedge(a0, a1, R_POCKETS, R_NUMBERS),
        face: tone.face,
        well: tone.pocket,
        fret: `M${point(a0, R_POCKETS)} L${point(a0, R_ROTOR - 1.6)}`,
        label: point(mid, (R_NUMBERS + R_ROTOR) / 2 - 0.6),
        angle: mid
    }
})
const deflectors = Array.from({ length: 8 }, (_, i) => ({ angle: i * 45 + 22.5, tall: i % 2 === 0 }))
const spokes = Array.from({ length: 8 }, (_, i) => i * 45)

const rotor = ref<HTMLElement>()
const ball = ref<HTMLElement>()
const ballFace = ref<HTMLElement>()
/** The pocket the ball sits in after a spin (null while it runs). */
const hit = ref<number | null>(null)
const hitPath = computed(() => {
    if (hit.value === null) return ''
    const i = WHEEL_ORDER.indexOf(hit.value as typeof WHEEL_ORDER[number])
    return wedge(i * STEP - STEP / 2, i * STEP + STEP / 2, R_POCKETS, R_ROTOR - 1.6)
})
const hitColor = computed(() => (hit.value === null ? null : pocketColor(hit.value)))

const sound = useTableSound()

// ─── motion ──────────────────────────────────────────────────────────────────
const IDLE = 9 // deg/s the rotor keeps turning at
const KICK = 150 // deg/s the croupier gives it each spin
const TAU = 2.6 // s, how fast the rotor slows back to idle
const SPIN_MS = 3300

interface Run {
    start: number
    target: number
    travel: number
    r0: number
    kicks: { at: number, width: number, deg: number }[]
    lastPocket: number
    resolve: () => void
}

let theta = Math.random() * 360 // rotor angle (cosmetic)
let omega = IDLE
let psi = 0 // ball angle relative to the rotor
let radius = R_REST
let run: Run | null = null
let frame = 0
let last = 0
let reduced = false

const bump = (u: number, at: number, width: number) => (Math.abs(u - at) < width ? 0.5 * (1 + Math.cos(Math.PI * (u - at) / width)) : 0)

/** Ball distance from the centre over the run (u = 0..1). */
function ballRadius(u: number, r0: number): number {
    if (u < 0.1) {
        const v = u / 0.1
        return r0 + (R_TRACK - r0) * (1 - (1 - v) ** 2)
    }
    if (u < 0.5) return R_TRACK
    if (u < 0.7) {
        // Falls off the track, then glances off a deflector.
        const v = (u - 0.5) / 0.2
        return R_TRACK - (R_TRACK - R_DEFLECT) * v * v + bump(u, 0.64, 0.035) * 5
    }
    // Rattles over the frets into the pocket.
    const v = (u - 0.7) / 0.3
    return R_REST + (R_DEFLECT - R_REST) * (1 - v) ** 2 + Math.abs(Math.sin(v * Math.PI * 2.5)) * 6 * (1 - v) ** 2
}

function paint() {
    if (rotor.value) rotor.value.style.transform = `rotate(${theta}deg)`
    const phi = theta + psi
    if (ball.value) ball.value.style.transform = `rotate(${phi}deg) translateY(${-radius / 2}%)`
    // The face keeps its highlight to the top-left whatever the angle.
    if (ballFace.value) ballFace.value.style.transform = `translate(-50%, -50%) rotate(${-phi}deg)`
}

function tick(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (!reduced) {
        omega = IDLE + (omega - IDLE) * Math.exp(-dt / TAU)
        theta = (theta + omega * dt) % 360
    }
    if (run) {
        const u = Math.min(1, (now - run.start) / SPIN_MS)
        const jitter = run.kicks.reduce((sum, k) => sum + bump(u, k.at, k.width) * k.deg, 0)
        psi = run.target + run.travel * (1 - u) ** 3 + jitter
        radius = ballRadius(u, run.r0)
        // Clicks as the ball crosses frets in the pocket ring.
        if (u > 0.68) {
            const pocket = Math.floor((psi + STEP / 2) / STEP)
            if (pocket !== run.lastPocket) {
                run.lastPocket = pocket
                sound.play('tick')
            }
        }
        if (u >= 1) {
            psi = run.target
            radius = R_REST
            const done = run.resolve
            run = null
            done()
        }
    }
    paint()
    frame = requestAnimationFrame(tick)
}

/** Spins the ball into `pocket`; resolves when it has settled. */
function spin(pocket: number): Promise<void> {
    const index = WHEEL_ORDER.indexOf(pocket as typeof WHEEL_ORDER[number])
    const target = index * STEP
    hit.value = null
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
        psi = target
        radius = R_REST
        paint()
        hit.value = pocket
        return Promise.resolve()
    }
    run?.resolve()
    omega = Math.max(omega, KICK)
    // Counter-clockwise relative to the rotor: from where it is, a couple of laps, onto the pocket.
    const gap = (((psi - target) % 360) + 360) % 360
    // Cosmetic: how the ball glances off the deflectors and frets.
    const r = () => 0.6 + Math.random() * 0.8
    return new Promise((resolve) => {
        run = {
            start: performance.now(),
            target,
            travel: gap + 720,
            r0: radius,
            kicks: [
                { at: 0.64, width: 0.05, deg: 10 * r() },
                { at: 0.79, width: 0.04, deg: -5 * r() },
                { at: 0.89, width: 0.035, deg: 3 * r() }
            ],
            lastPocket: Number.NaN,
            resolve: () => {
                hit.value = pocket
                resolve()
            }
        }
    })
}

/** Clears the pocket highlight (the next layout is being placed). */
function clear() {
    hit.value = null
}

onMounted(() => {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    psi = Math.floor(Math.random() * WHEEL_ORDER.length) * STEP
    last = performance.now()
    paint()
    frame = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    run?.resolve()
    run = null
})

defineExpose({ spin, clear })
</script>

<template>
  <div class="rw relative aspect-square w-full select-none" aria-hidden="true">
    <!-- The bowl: wood, brass rim, the ball track and the deflectors. -->
    <svg viewBox="-100 -100 200 200" class="absolute inset-0 size-full">
      <defs>
        <radialGradient id="rw-wood" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#8a5228" />
          <stop offset="70%" stop-color="#5a3014" />
          <stop offset="100%" stop-color="#2e170a" />
        </radialGradient>
        <radialGradient id="rw-track" cx="50%" cy="50%" r="50%">
          <stop offset="76%" stop-color="#1a0f08" />
          <stop offset="86%" stop-color="#3a2414" />
          <stop offset="93%" stop-color="#5b3a20" />
          <stop offset="97%" stop-color="#24150b" />
        </radialGradient>
        <linearGradient id="rw-brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fff1b8" />
          <stop offset="45%" stop-color="#e2b34e" />
          <stop offset="100%" stop-color="#8a5a12" />
        </linearGradient>
      </defs>
      <circle r="100" fill="url(#rw-wood)" />
      <circle r="98" fill="none" stroke="url(#rw-brass)" stroke-width="2.2" />
      <circle r="95.5" fill="url(#rw-track)" />
      <circle r="95.5" fill="none" stroke="rgb(0 0 0 / .55)" stroke-width="1.5" />
      <circle r="78" fill="#3b2414" />
      <circle r="78" fill="none" stroke="rgb(255 220 150 / .18)" stroke-width=".8" />
      <g v-for="d in deflectors" :key="d.angle" :transform="`rotate(${d.angle}) translate(0 -79.5)`">
        <path :d="d.tall ? 'M0 -4.2 L1.6 0 L0 4.2 L-1.6 0 Z' : 'M0 -2 L3.6 0 L0 2 L-3.6 0 Z'" fill="url(#rw-brass)" stroke="#6b4210" stroke-width=".4" />
      </g>
    </svg>

    <!-- The rotor: numbers, pockets, frets, the cone and the turret. -->
    <div ref="rotor" class="absolute inset-0 will-change-transform">
      <svg viewBox="-100 -100 200 200" class="size-full">
        <defs>
          <radialGradient id="rw-cone" cx="45%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#a56a36" />
            <stop offset="60%" stop-color="#6e3f1b" />
            <stop offset="100%" stop-color="#3f210b" />
          </radialGradient>
          <radialGradient id="rw-knob" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#fff6cf" />
            <stop offset="50%" stop-color="#e8bb52" />
            <stop offset="100%" stop-color="#8a5a12" />
          </radialGradient>
        </defs>
        <circle :r="R_ROTOR" fill="#e2b34e" />
        <template v-for="p in pockets" :key="p.n">
          <path :d="p.number" :fill="p.face" />
          <path :d="p.pocket" :fill="p.well" />
        </template>
        <path v-if="hitPath" :d="hitPath" class="rw-hit" fill="#fff" />
        <path v-for="p in pockets" :key="`f${p.n}`" :d="p.fret" stroke="#e7c063" stroke-width=".9" />
        <circle :r="R_NUMBERS" fill="none" stroke="#e7c063" stroke-width=".8" />
        <text
          v-for="p in pockets" :key="`t${p.n}`"
          :transform="`translate(${p.label}) rotate(${p.angle})`"
          text-anchor="middle" dominant-baseline="central"
          class="rw-num" fill="#fff"
        >{{ p.n }}</text>
        <circle :r="R_POCKETS" fill="url(#rw-cone)" stroke="url(#rw-brass)" stroke-width="1.6" />
        <line
          v-for="a in spokes" :key="a"
          :x1="0" :y1="-R_CONE" :x2="0" :y2="-(R_POCKETS - 3)"
          :transform="`rotate(${a})`"
          stroke="rgb(255 220 160 / .16)" stroke-width="5" stroke-linecap="round"
        />
        <circle :r="R_CONE + 2" fill="rgb(0 0 0 / .3)" />
        <!-- Turret: a brass cross with knobs. -->
        <g>
          <rect x="-2.4" y="-27" width="4.8" height="54" rx="2.4" fill="url(#rw-knob)" stroke="#7a4c0e" stroke-width=".5" />
          <rect x="-27" y="-2.4" width="54" height="4.8" rx="2.4" fill="url(#rw-knob)" stroke="#7a4c0e" stroke-width=".5" />
          <circle v-for="k in [[0, -27], [0, 27], [-27, 0], [27, 0]]" :key="`${k[0]}${k[1]}`" :cx="k[0]" :cy="k[1]" r="4" fill="url(#rw-knob)" stroke="#7a4c0e" stroke-width=".5" />
          <circle r="9" fill="url(#rw-knob)" stroke="#7a4c0e" stroke-width=".6" />
        </g>
      </svg>
    </div>

    <!-- Light from the top-left, fixed while the rotor turns. -->
    <div class="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_24%,rgb(255_255_255/.22),transparent_42%),radial-gradient(circle_at_50%_50%,transparent_62%,rgb(0_0_0/.35)_75%,transparent_76%)]" />

    <!-- The ball. -->
    <div ref="ball" class="pointer-events-none absolute inset-0 will-change-transform">
      <span ref="ballFace" class="rw-ball absolute top-1/2 left-1/2 block aspect-square w-[3.6%] rounded-full" />
    </div>

    <!-- The pocket it landed in, big in the middle. -->
    <Transition name="rw-badge">
      <div v-if="hit !== null" :key="hit" class="pointer-events-none absolute inset-0 grid place-items-center">
        <span class="rw-badge grid aspect-square w-[27%] place-items-center rounded-full" :class="hitColor">
          <span class="rw-badge-num">{{ hit }}</span>
        </span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.rw { container-type: inline-size; filter: drop-shadow(0 10px 18px rgb(0 0 0 / 0.55)); }
.rw-num { font-family: var(--font-game); font-size: 8.2px; letter-spacing: 0.02em; }
.rw-hit { opacity: 0.35; animation: rw-hit 0.9s ease-in-out infinite alternate; }
.rw-ball {
    background: radial-gradient(circle at 34% 30%, #fff 0 18%, #e9e9ee 38%, #a9a9b4 78%, #6e6e78 100%);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.7), 0 0 6px rgb(255 255 255 / 0.25);
}
.rw-badge {
    border: 3px solid #f5d27a;
    box-shadow: 0 5px 0 rgb(0 0 0 / 0.45), 0 0 0 4px rgb(0 0 0 / 0.25), 0 0 26px rgb(255 216 120 / 0.65);
}
.rw-badge.red { background: radial-gradient(circle at 40% 30%, #ff5a68, #c8102e 70%); }
.rw-badge.black { background: radial-gradient(circle at 40% 30%, #4a4757, #16141c 70%); }
.rw-badge.green { background: radial-gradient(circle at 40% 30%, #35d48a, #0b7a45 70%); }
.rw-badge-num {
    font-family: var(--font-game);
    color: #fff;
    font-size: 13cqw;
    line-height: 1;
    text-shadow: 0 3px 0 rgb(0 0 0 / 0.45);
}
.rw-badge-enter-active { transition: transform 0.4s cubic-bezier(0.3, 0.7, 0.4, 1.6), opacity 0.2s; }
.rw-badge-leave-active { transition: opacity 0.15s; }
.rw-badge-enter-from { transform: scale(0.2); opacity: 0; }
.rw-badge-leave-to { opacity: 0; }
@keyframes rw-hit { from { opacity: 0.15; } to { opacity: 0.55; } }
@media (prefers-reduced-motion: reduce) {
    .rw-hit { animation: none; }
    .rw-badge-enter-active { transition: none; }
}
</style>
