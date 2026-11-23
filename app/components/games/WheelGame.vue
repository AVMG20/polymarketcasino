<script setup lang="ts">
// The old site's Wheel page (pages/games/wheel.vue) with the casino's plumbing:
// rounds through useCasinoGame → useGameRound, and the server draws the segment
// (an index into wheelLayout) instead of the page picking one that matches.
import { findGame } from '#shared/games/registry'
import { formatCoins, formatCoinsExact, payFor } from '#shared/money'
import type { WheelResult, WheelRisk as WheelDifficulty } from '#shared/games/wheel'
import { WHEEL_TABLES as WHEEL_CONFIGS, wheelLayout } from '#shared/games/wheel'
import type { WinShow } from '~/components/game/WinBurst.vue'

type WheelHistoryEntry = { id: number, multiplier: number, won: boolean, payout: number, bet: number }

const info = findGame('wheel')!
const bankroll = useBankroll()

const {
    bet, isPlaying: isSpinning, isFetching, lastBet, errorMsg, setBalance, history, pushHistory, play
} = useCasinoGame<WheelResult, WheelHistoryEntry>('wheel', { historyLimit: 20 })

const difficulty = ref<WheelDifficulty>('medium')
const lastResult = ref<(WheelResult & { payout: number }) | null>(null)
const win = ref<WinShow | null>(null)
let rounds = 0
const sound = useGameSound()

const canvasRef = ref<HTMLCanvasElement | null>(null)
// The wheel is drawn once with segment 0 starting at the top and turned with a
// CSS transform: rotation is how far it has turned clockwise (radians).
// Segment i's midpoint sits at rotation + (i + 0.5) * arc clockwise from the
// top, so it is under the pointer when that is a whole number of turns.
const rotation = ref(0)
let frame = 0

const difficultyOptions = (['easy', 'medium', 'hard'] as const).map((value) => {
    const losses = WHEEL_CONFIGS[value].find(s => s.multiplier === 0)?.count ?? 0
    return { label: value[0]!.toUpperCase() + value.slice(1), value, losses }
})

const COLOR_MAP: Record<string, string> = {
    0: '#ef4444',
    red: '#ef4444',
    blue: '#3b82f6',
    yellow: '#f59e0b',
    green: '#22c55e'
}

const multipleFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 })
/** A segment multiplier: `1,3×`, `2×`. */
function multiple(value: number): string {
    return `${multipleFormat.format(value)}×`
}

function segmentColor(color: string): string {
    return COLOR_MAP[color] ?? '#a7a3a3'
}

// Flat segment list in wheel order (losses evenly spread); the server draws an index into it.
const wheelSegments = computed(() => wheelLayout(difficulty.value).map(s => ({ multiplier: s.multiplier, color: segmentColor(s.color) })))

// ─── Draw ──────────────────────────────────────────────────────────────────
function drawWheel(highlightIndex?: number) {
    const canvas = canvasRef.value
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const segs = wheelSegments.value
    const n = segs.length
    const k = canvas.width / 340
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const r = cx - 10 * k
    const arc = (2 * Math.PI) / n

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (let i = 0; i < n; i++) {
        const startAngle = -Math.PI / 2 + i * arc
        const endAngle = startAngle + arc
        const isHighlit = highlightIndex === i
        const dimmed = highlightIndex !== undefined && !isHighlit

        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, r, startAngle, endAngle)
        ctx.closePath()
        ctx.fillStyle = isHighlit ? lighten(segs[i]!.color, 55) : segs[i]!.color
        ctx.globalAlpha = dimmed ? 0.55 : 1
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = 'rgba(0,0,0,.55)'
        ctx.lineWidth = 2 * k
        ctx.stroke()

        // Label: centred in the segment, rotated to read outward.
        const midAngle = startAngle + arc / 2
        ctx.save()
        ctx.translate(cx + Math.cos(midAngle) * r * 0.68, cy + Math.sin(midAngle) * r * 0.68)
        ctx.rotate(midAngle + Math.PI / 2)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = isHighlit ? '#000' : '#fff'
        ctx.font = `${Math.round(19 * k)}px 'Lilita One', ui-rounded, sans-serif`
        ctx.shadowColor = 'rgba(0,0,0,0.7)'
        ctx.shadowBlur = isHighlit ? 0 : 3 * k
        ctx.fillText(multiple(segs[i]!.multiplier), 0, 0)
        ctx.restore()
    }

    // Gold rim with studs.
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, 2 * Math.PI)
    ctx.strokeStyle = '#f5c542'
    ctx.lineWidth = 8 * k
    ctx.stroke()
    for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i * arc) / 2
        ctx.beginPath()
        ctx.arc(cx + Math.cos(a) * (r + k), cy + Math.sin(a) * (r + k), 3.2 * k, 0, 2 * Math.PI)
        ctx.fillStyle = '#fff7d6'
        ctx.fill()
    }

    // Hub.
    ctx.beginPath()
    ctx.arc(cx, cy, 22 * k, 0, 2 * Math.PI)
    ctx.fillStyle = '#1a1325'
    ctx.fill()
    ctx.strokeStyle = '#f5c542'
    ctx.lineWidth = 4 * k
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, 7 * k, 0, 2 * Math.PI)
    ctx.fillStyle = '#f5c542'
    ctx.fill()
}

function lighten(hex: string, amt: number): string {
    const n = parseInt(hex.slice(1), 16)
    const r = Math.min(255, ((n >> 16) & 0xff) + amt)
    const g = Math.min(255, ((n >> 8) & 0xff) + amt)
    const b = Math.min(255, (n & 0xff) + amt)
    return `rgb(${r},${g},${b})`
}

// ─── Animation ────────────────────────────────────────────────────────────
function easeOut(t: number) {
    return 1 - Math.pow(1 - t, 4)
}

function animateSpin(from: number, to: number, duration: number, onDone: () => void) {
    const start = performance.now()
    const arc = (2 * Math.PI) / wheelSegments.value.length
    const tick = (now: number) => {
        const t = duration ? Math.min(1, (now - start) / duration) : 1
        const was = rotation.value
        rotation.value = from + (to - from) * easeOut(t)
        // The pointer clicks over every segment edge it passes.
        if (Math.floor(rotation.value / arc) > Math.floor(was / arc)) sound.tick(0.35 + 0.4 * (1 - t))
        if (t < 1) frame = requestAnimationFrame(tick)
        else onDone()
    }
    frame = requestAnimationFrame(tick)
}

// ─── Spin ──────────────────────────────────────────────────────────────────
async function spin() {
    const data = await play({ risk: difficulty.value }, () => {
        lastResult.value = null
        win.value = null
        drawWheel()
    })
    if (!data) return

    const n = wheelSegments.value.length
    const arc = (2 * Math.PI) / n
    const winIdx = data.gameData.index
    const turn = 2 * Math.PI

    // Land with winIdx's midpoint under the pointer: rotation ≡ -(winIdx + 0.5) * arc (mod 2π).
    const targetBase = ((-(winIdx + 0.5) * arc) % turn + turn) % turn
    const currentNorm = ((rotation.value % turn) + turn) % turn
    const remaining = ((targetBase - currentNorm) + turn) % turn
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // A couple of full turns so it reads as a spin, never backwards (cosmetic, so Math.random).
    const extraSpins = reduced ? 0 : (2 + Math.floor(Math.random() * 2)) * turn
    const target = rotation.value + extraSpins + remaining

    animateSpin(rotation.value, target, reduced ? 0 : 1400, () => {
        rotation.value = target % turn
        drawWheel(winIdx)
        lastResult.value = { ...data.gameData, payout: data.payout }
        win.value = { id: ++rounds, payout: data.payout, multiplier: data.gameData.multiplier }
        if (data.gameData.multiplier >= 1) sound.win(data.gameData.multiplier)
        else sound.lose()
        setBalance(data.balance)
        pushHistory({ id: rounds, multiplier: data.gameData.multiplier, won: data.gameData.won, payout: data.payout, bet: lastBet.value })
        isSpinning.value = false
    })
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function pillClass(m: number): string {
    if (m === 0) return 'bg-black/35 text-rose-300'
    if (m < 1.8) return 'bg-sky-400/25 text-sky-100'
    if (m < 3) return 'bg-emerald-400/25 text-emerald-100'
    return 'bg-amber-300/30 text-amber-100'
}

const totalSegments = computed(() =>
    WHEEL_CONFIGS[difficulty.value].reduce((s, seg) => s + seg.count, 0)
)
const winChancePct = computed(() => {
    const cfg = WHEEL_CONFIGS[difficulty.value]
    const winning = cfg.filter(s => s.multiplier > 0).reduce((a, s) => a + s.count, 0)
    return Math.round((winning / totalSegments.value) * 100)
})
const maxPayout = computed(() =>
    payFor(bet.value, Math.max(...WHEEL_CONFIGS[difficulty.value].map(s => s.multiplier)))
)

function onKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        spin()
    }
}
onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    // The labels use the game font: draw again once it has loaded.
    nextTick(() => drawWheel())
    void document.fonts?.load(`20px 'Lilita One'`).then(() => !isSpinning.value && drawWheel())
})
onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    cancelAnimationFrame(frame)
})
watch(difficulty, () => {
    rotation.value = 0
    lastResult.value = null
    win.value = null
    nextTick(() => drawWheel())
})
</script>

<template>
  <GameFrame slug="wheel">
    <template #actions>
      <GameSoundToggle />
    </template>
    <div class="@container">
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <GameWinBurst :show="win" class="rounded-[1.5rem]">
          <GameFelt tone="plum" class="h-full">
            <div class="flex h-full min-h-[17rem] flex-col gap-2 p-3 sm:p-5 @3xl:min-h-[30rem]">
              <div class="grid flex-1 place-items-center">
                <div class="relative w-[min(80cqw,24rem)] pt-5">
                  <!-- The flapper at the top: it kicks while the wheel spins. -->
                  <div
                    class="pointer-events-none absolute top-0 left-1/2 z-20 -ml-4 origin-top"
                    :class="isSpinning && !isFetching ? 'wheel-flapper' : ''"
                    style="width: 0; height: 0; border-left: 16px solid transparent; border-right: 16px solid transparent; border-top: 32px solid #f5c542; filter: drop-shadow(0 3px 3px rgba(0,0,0,.55))"
                  />
                  <div class="rounded-full shadow-[0_10px_0_0_rgba(0,0,0,.35),0_0_40px_rgba(245,197,66,.25)]">
                    <canvas
                      ref="canvasRef"
                      width="480" height="480"
                      class="block aspect-square w-full rounded-full will-change-transform"
                      :style="{ transform: `rotate(${rotation}rad)` }"
                    />
                  </div>
                </div>
              </div>

              <!-- One line under the wheel: a quiet ×0 after a loss, nothing after a win (it shows itself on top). -->
              <div class="flex h-8 items-center justify-center" aria-live="polite">
                <p v-if="lastResult && !lastResult.won" class="wheel-zero g-title text-base text-[#ffc2cc] sm:text-lg">×0 <span class="text-sm text-white/55">no win</span></p>
                <p v-else-if="!lastResult" class="g-title inline-flex items-center gap-1.5 text-sm text-white/70 sm:text-base">
                  <template v-if="isSpinning">Round and round…</template>
                  <template v-else>Win up to <CasinoChipIcon class="size-4" />{{ formatCoins(maxPayout) }}</template>
                </p>
              </div>
              <div class="flex min-h-5 gap-1.5 overflow-x-auto opacity-70 [scrollbar-width:none]">
                <TransitionGroup name="pill-slide">
                  <span v-for="h in history" :key="h.id" class="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-bold" :class="pillClass(h.multiplier)">{{ multiple(h.multiplier) }}</span>
                </TransitionGroup>
              </div>
            </div>
          </GameFelt>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="isSpinning" />

          <div role="radiogroup" aria-label="Risk" class="grid grid-cols-3 gap-2">
            <button
              v-for="opt in difficultyOptions" :key="opt.value"
              type="button" role="radio" :aria-checked="difficulty === opt.value"
              :disabled="isSpinning"
              class="g-btn h-14 flex-col gap-0 rounded-2xl text-lg leading-tight"
              :class="difficulty === opt.value ? 'g-purple' : 'g-dark opacity-70'"
              @click="difficulty = opt.value"
            >
              {{ opt.label }}
              <span class="font-[family-name:var(--font-round)] text-[11px] font-semibold opacity-80">{{ opt.losses }} of 10 lose</span>
            </button>
          </div>

          <div class="grid grid-cols-4 gap-1.5">
            <div v-for="seg in WHEEL_CONFIGS[difficulty]" :key="seg.multiplier" class="g-well flex min-w-0 flex-col items-center rounded-xl py-1.5">
              <span class="g-num text-lg leading-tight" :style="{ color: segmentColor(seg.color) }">{{ multiple(seg.multiplier) }}</span>
              <span class="text-[11px] font-semibold text-[var(--g-muted)]">{{ seg.count }}/{{ totalSegments }}</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Win chance</p>
              <p class="g-num truncate text-2xl">{{ winChancePct }}%</p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Max win</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl text-[var(--g-green)]" :title="`${formatCoinsExact(maxPayout)} chips`">
                <CasinoChipIcon class="size-4" />{{ formatCoins(maxPayout) }}
              </p>
            </div>
          </div>

          <p v-if="errorMsg" role="alert" class="rounded-xl bg-destructive/15 p-3 text-sm text-[#ff8da0]">{{ errorMsg }}</p>

          <!-- Sticks to the bottom of the sheet, so Spin never scrolls out of reach on a phone. -->
          <div class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto rounded-b-[1.4rem] bg-[var(--g-panel)] px-3 pt-1 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            <button
              type="button"
              :disabled="isSpinning || bankroll.total.value < bet"
              class="g-btn g-gold h-16 w-full rounded-2xl text-3xl uppercase"
              @click="spin"
            >
              {{ isSpinning ? 'Spinning…' : 'Spin' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Spin the wheel and win the multiplier of the segment it lands on. A 0× segment loses your bet.</p>
      <p><strong>Risk</strong> sets how many losing segments are on the wheel. Payout = bet × segment multiplier. Space spins.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.pill-slide-enter-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.pill-slide-enter-from { opacity: 0; transform: translateX(-8px); }
.wheel-flapper { animation: flapper 0.16s ease-in-out infinite alternate; }
.wheel-zero { animation: wheel-zero 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.5); }
@keyframes flapper { from { transform: rotate(-9deg); } to { transform: rotate(9deg); } }
@keyframes wheel-zero { from { transform: scale(1.25); } }
@media (prefers-reduced-motion: reduce) { .wheel-flapper, .wheel-zero { animation: none; } }
</style>
