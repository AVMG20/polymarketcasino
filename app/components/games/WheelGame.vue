<script setup lang="ts">
// The old site's Wheel page (pages/games/wheel.vue) with the casino's plumbing:
// rounds through useCasinoGame → useGameRound, and the server draws the segment
// (an index into wheelLayout) instead of the page picking one that matches.
// Nuxt UI's UCard, UButton, UAlert and USeparator are rebuilt as plain elements
// with the same sizes and colours.
import { CircleDotIcon, CircleHelpIcon, LoaderCircleIcon, XIcon } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import type { WheelResult, WheelRisk as WheelDifficulty } from '#shared/games/wheel'
import { WHEEL_TABLES as WHEEL_CONFIGS, wheelLayout } from '#shared/games/wheel'

type WheelHistoryEntry = { multiplier: number, won: boolean, payout: number, bet: number }

const info = findGame('wheel')!
useHead({ title: info.name })
onMounted(() => useHubBridge().postTitle(info.name))
const RTP = Math.round(info.rtp * 1000) / 10

const {
    bet, isPlaying: isSpinning, isFetching, lastBet, errorMsg, balance, setBalance, history, pushHistory, play
} = useCasinoGame<WheelResult, WheelHistoryEntry>('wheel')

const difficulty = ref<WheelDifficulty>('medium')
const lastResult = ref<(WheelResult & { payout: number }) | null>(null)
const showHelp = ref(false)

const canvasRef = ref<HTMLCanvasElement | null>(null)
// rotationOffset: how far the wheel has been rotated clockwise (radians).
// Segment i occupies angles [i*arc, (i+1)*arc] measured clockwise from top (12 o'clock).
// After rotation, segment i's midpoint sits at: rotationOffset + (i + 0.5) * arc  (clockwise from top)
// The pointer is at 0 (top). Segment is under pointer when: (rotationOffset + (i+0.5)*arc) % 2π == 0
const rotationOffset = ref(0)
const animFrame = ref<number | null>(null)

// The old labels said 1, 3 and 5 losses; these count the real losing segments.
const difficultyOptions = (['easy', 'medium', 'hard'] as const).map((value) => {
    const losses = WHEEL_CONFIGS[value].find(s => s.multiplier === 0)?.count ?? 0
    return { label: value[0]!.toUpperCase() + value.slice(1), value, desc: `${losses} loss${losses === 1 ? '' : 'es'} / 10` }
})

const COLOR_MAP: Record<string, string> = {
    0: '#ef4444',
    red: '#ef4444',
    blue: '#3b82f6',
    yellow: '#f59e0b',
    green: '#22c55e'
}

// Color tiers by multiplier value
function segmentColor(color: string): string {
    return COLOR_MAP[color] ?? '#a7a3a3'
}

// Flat segment list in wheel order (losses evenly spread); the server draws an index into it.
const wheelSegments = computed(() => wheelLayout(difficulty.value).map(s => ({ multiplier: s.multiplier, color: segmentColor(s.color) })))

// ─── Draw ──────────────────────────────────────────────────────────────────
// We define segment i's start angle (canvas coords, 0=right, clockwise) as:
//   canvasAngle = -π/2 + rotationOffset + i * arc
// This means rotationOffset=0 puts segment 0's start at the top (12 o'clock).
// Segment i's midpoint is at: -π/2 + rotationOffset + (i + 0.5) * arc
// Under pointer (top = -π/2 in canvas) means midpoint = -π/2:
//   rotationOffset + (i + 0.5) * arc ≡ 0 (mod 2π)
//   rotationOffset ≡ -(i + 0.5) * arc   (mod 2π)

function drawWheel(highlightIndex?: number) {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const segs = wheelSegments.value
    const n = segs.length
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const r = cx - 6
    const arc = (2 * Math.PI) / n

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (let i = 0; i < n; i++) {
        const startAngle = -Math.PI / 2 + rotationOffset.value + i * arc
        const endAngle = startAngle + arc
        const isHighlit = highlightIndex === i

        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, r, startAngle, endAngle)
        ctx.closePath()
        ctx.fillStyle = isHighlit ? lighten(segs[i]!.color, 55) : segs[i]!.color
        ctx.fill()
        ctx.strokeStyle = '#0a0a0a'
        ctx.lineWidth = 2
        ctx.stroke()

        // Label — centred in the segment, rotated to read outward
        const midAngle = startAngle + arc / 2
        const labelR = r * 0.66
        ctx.save()
        ctx.translate(cx + Math.cos(midAngle) * labelR, cy + Math.sin(midAngle) * labelR)
        ctx.rotate(midAngle + Math.PI / 2)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = isHighlit ? '#000' : '#fff'
        ctx.font = `bold ${n <= 12 ? 14 : 11}px ui-monospace, monospace`
        ctx.shadowColor = 'rgba(0,0,0,0.7)'
        ctx.shadowBlur = 3
        ctx.fillText(segs[i]!.multiplier === 0 ? '0×' : `${segs[i]!.multiplier}×`, 0, 0)
        ctx.restore()
    }

    // Outer ring
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, 2 * Math.PI)
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 3
    ctx.stroke()

    // Hub
    ctx.beginPath()
    ctx.arc(cx, cy, 18, 0, 2 * Math.PI)
    ctx.fillStyle = '#111'
    ctx.fill()
    ctx.strokeStyle = '#2a2a2a'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, 2 * Math.PI)
    ctx.fillStyle = '#444'
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

function animateSpin(from: number, to: number, duration: number, winIdx: number, onDone: () => void) {
    const startTime = Date.now()
    const tick = () => {
        const t = Math.min(1, (Date.now() - startTime) / duration)
        rotationOffset.value = from + (to - from) * easeOut(t)
        drawWheel()
        if (t < 1) {
            animFrame.value = requestAnimationFrame(tick)
        } else {
            rotationOffset.value = to % (2 * Math.PI)
            drawWheel(winIdx)
            onDone()
        }
    }
    animFrame.value = requestAnimationFrame(tick)
}

// ─── Spin ──────────────────────────────────────────────────────────────────
async function spin() {
    const data = await play({ risk: difficulty.value }, () => {
        lastResult.value = null
    })
    if (!data) return

    const segs = wheelSegments.value
    const n = segs.length
    const arc = (2 * Math.PI) / n

    // The server drew the segment.
    const winIdx = data.gameData.index

    // Target rotationOffset so winIdx's midpoint is at the top:
    //   rotationOffset ≡ -(winIdx + 0.5) * arc  (mod 2π)
    const targetBase = ((-(winIdx + 0.5) * arc) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)

    // How much more do we need to rotate from current normalised position to reach targetBase?
    const currentNorm = ((rotationOffset.value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const remaining = ((targetBase - currentNorm) + 2 * Math.PI) % (2 * Math.PI)

    // Add full spins so it looks dramatic, never go backwards (cosmetic, so Math.random)
    const extraSpins = (2 + Math.floor(Math.random() * 4)) * 2 * Math.PI
    const targetOffset = rotationOffset.value + extraSpins + remaining

    animateSpin(rotationOffset.value, targetOffset, 1800, winIdx, () => {
        lastResult.value = { ...data.gameData, payout: data.payout }
        setBalance(data.balance)
        pushHistory({ multiplier: data.gameData.multiplier, won: data.gameData.won, payout: data.payout, bet: lastBet.value })
        isSpinning.value = false
    })
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function pillClass(m: number): string {
    if (m === 0) return 'bg-red-500/20 text-red-400' // red
    if (m < 1.8) return 'bg-blue-500/20 text-blue-400' // blue
    if (m < 3) return 'bg-green-500/20 text-green-400' // green
    if (m < 5) return 'bg-amber-500/20 text-amber-400' // yellow
    return 'bg-amber-500/20 text-amber-400' // yellow (5)
}

const totalSegments = computed(() =>
    WHEEL_CONFIGS[difficulty.value].reduce((s, seg) => s + seg.count, 0)
)
const winChancePct = computed(() => {
    const cfg = WHEEL_CONFIGS[difficulty.value]
    const winning = cfg.filter(s => s.multiplier > 0).reduce((a, s) => a + s.count, 0)
    return ((winning / totalSegments.value) * 100).toFixed(0)
})
const maxPayout = computed(() =>
    Math.floor(bet.value * Math.max(...WHEEL_CONFIGS[difficulty.value].map(s => s.multiplier)) + 1e-6)
)

function onKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        spin()
    }
}
onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    nextTick(() => drawWheel())
})
onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    if (animFrame.value) cancelAnimationFrame(animFrame.value)
})
watch(difficulty, () => {
    rotationOffset.value = 0
    lastResult.value = null
    nextTick(() => drawWheel())
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 p-6">
    <div>
      <h1 class="flex items-center gap-2 text-2xl font-bold">
        <CircleDotIcon class="size-6 text-primary" />
        Wheel
      </h1>
      <p class="mt-0.5 text-sm text-muted-foreground">{{ RTP }}% RTP</p>
    </div>

    <div class="grid gap-6 lg:grid-cols-3">

      <!-- Controls -->
      <div class="divide-y divide-border rounded-2xl bg-card ring ring-border">
        <div class="p-4 sm:px-6">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Controls</h2>
            <button type="button" class="rounded-md p-1 text-foreground transition-colors hover:bg-muted" aria-label="How Wheel works" @click="showHelp = true">
              <CircleHelpIcon class="size-4" />
            </button>
          </div>
        </div>
        <div class="space-y-4 p-4 sm:p-6">

          <!-- Bet -->
          <BetControls v-model="bet" :min="info.minBet" :disabled="isSpinning" />

          <!-- Difficulty -->
          <div>
            <label class="mb-1.5 block text-xs font-medium tracking-wide text-muted-foreground uppercase">Difficulty</label>
            <div class="grid grid-cols-3 gap-1.5">
              <button
                v-for="opt in difficultyOptions" :key="opt.value"
                :disabled="isSpinning"
                class="flex flex-col items-center rounded-lg border px-1 py-2 text-xs font-bold transition-all disabled:opacity-40"
                :class="difficulty === opt.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground hover:border-muted-foreground'"
                @click="difficulty = opt.value"
              >
                <span>{{ opt.label }}</span>
                <span class="mt-0.5 text-[10px] font-normal opacity-60">{{ opt.desc }}</span>
              </button>
            </div>
          </div>

          <!-- Legend -->
          <div class="space-y-2 rounded-lg border border-border bg-muted p-3">
            <p class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Segments</p>
            <div v-for="seg in WHEEL_CONFIGS[difficulty]" :key="seg.multiplier" class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <span class="size-3 flex-shrink-0 rounded-sm" :style="`background:${segmentColor(seg.color)}`" />
                <span class="text-muted-foreground">{{ seg.multiplier === 0 ? 'Loss' : `${seg.multiplier}×` }}</span>
              </div>
              <span class="font-mono text-xs font-bold text-muted-foreground">{{ seg.count }}/{{ totalSegments }}</span>
            </div>
          </div>

          <!-- Stats -->
          <div class="space-y-2 rounded-lg border border-border bg-muted p-3">
            <div class="flex justify-between text-sm">
              <span class="text-muted-foreground">Win Chance</span>
              <span class="font-bold">{{ winChancePct }}%</span>
            </div>
            <div class="h-px w-full bg-border" />
            <div class="flex justify-between text-sm">
              <span class="text-muted-foreground">Max Payout</span>
              <span class="font-bold text-success">${{ formatNumber(maxPayout, false) }}</span>
            </div>
          </div>

          <Transition name="fade-up">
            <div v-if="errorMsg" role="alert" class="flex items-start gap-2.5 rounded-lg bg-error/10 p-4 text-sm text-error">
              <p class="flex-1">{{ errorMsg }}</p>
              <button type="button" class="-m-1 rounded-md p-1 text-foreground hover:bg-muted" aria-label="Dismiss" @click="errorMsg = ''">
                <XIcon class="size-4" />
              </button>
            </div>
          </Transition>

          <div class="flex items-center justify-between rounded-lg border border-border bg-muted p-3">
            <span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Balance</span>
            <span class="text-sm font-bold"><CoinBalance :value="balance" :compact="false" /></span>
          </div>
        </div>
      </div>

      <!-- Game Area -->
      <div class="flex flex-col gap-4 lg:col-span-2">
        <div class="rounded-2xl bg-card ring ring-border">
          <div class="relative flex min-h-[400px] flex-col overflow-hidden p-6">

            <!-- History pills -->
            <div class="mb-3 flex min-h-[26px] flex-wrap gap-1.5">
              <TransitionGroup name="pill-slide">
                <span v-for="(h, i) in history" :key="i"
                      class="inline-flex items-center rounded px-2 py-1 font-mono text-xs font-bold"
                      :class="pillClass(h.multiplier)">{{ h.multiplier }}×</span>
              </TransitionGroup>
            </div>

            <div class="relative z-10 flex flex-1 flex-col items-center justify-center gap-5">

              <!-- Wheel + pointer -->
              <div class="relative flex items-start justify-center">
                <!-- Downward triangle pointer, tip touching the wheel rim -->
                <div class="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2"
                     style="top: -16px; width: 0; height: 0;
                         border-left: 12px solid transparent;
                         border-right: 12px solid transparent;
                         border-top: 22px solid #22c55e;
                         filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));" />
                <!-- max-w-full: on a phone the 340px wheel scales down instead of widening the page. -->
                <canvas
                  ref="canvasRef"
                  width="340" height="340"
                  class="block h-auto max-w-full rounded-full"
                  :class="isSpinning ? 'drop-shadow-[0_0_28px_rgba(34,197,94,0.2)]' : ''"
                />
              </div>

              <!-- Result -->
              <Transition name="fade-up" mode="out-in">
                <div v-if="!isSpinning && lastResult" :key="String(lastResult.multiplier)" class="text-center">
                  <div class="font-mono text-4xl font-black tabular-nums"
                       :class="lastResult.won ? 'text-success' : 'text-error'">
                    {{ lastResult.won ? `+$${formatNumber(lastResult.payout, false)}` : '+$0' }}
                  </div>
                  <div class="mt-1 text-sm text-muted-foreground">{{ lastResult.multiplier }}× multiplier</div>
                </div>
                <div v-else-if="isFetching" key="fetching" class="animate-pulse font-mono text-sm text-muted-foreground">Spinning...</div>
                <div v-else key="idle" class="h-16" />
              </Transition>
            </div>

            <div class="pointer-events-none absolute inset-0 transition-opacity duration-300"
                 :class="isSpinning ? 'animate-pulse bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/30 via-transparent to-transparent opacity-10' : 'opacity-0'" />
          </div>
        </div>

        <!-- Spin button -->
        <div class="rounded-2xl bg-card p-4 ring ring-border sm:p-6">
          <div class="flex items-center gap-4">
            <button
              type="button"
              :disabled="isSpinning || balance < bet"
              class="inline-flex h-16 w-full flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-lg font-black tracking-widest text-primary-foreground uppercase transition-transform hover:bg-primary/75 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-75"
              @click="spin"
            >
              <LoaderCircleIcon v-if="isSpinning" class="size-6 shrink-0 animate-spin" />
              {{ isSpinning ? 'Spinning...' : 'Spin' }}
            </button>
            <div class="hidden flex-col items-end px-4 font-mono text-sm whitespace-nowrap text-muted-foreground sm:flex">
              <span>Press <kbd class="rounded border border-border bg-muted px-2 py-1 font-sans text-xs font-bold">SPACE</kbd></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <GameHelpModal v-model:open="showHelp" title="How Wheel works">
      <li>Spin the wheel and win the multiplier of the segment it lands on.</li>
      <li>A 0× segment means you lose your bet.</li>
      <li><strong class="text-foreground">Difficulty</strong> controls how many losing segments are on the wheel.</li>
      <li>Payout = bet × segment multiplier.</li>
    </GameHelpModal>
  </div>
</template>

<style scoped>
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }
.pill-slide-enter-active { transition: all 0.25s ease; }
.pill-slide-enter-from { opacity: 0; transform: translateX(-8px); }
</style>
