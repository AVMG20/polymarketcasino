<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { findGame } from '#shared/games/registry'
import { WHEEL_RISKS, WHEEL_TABLES, wheelLayout, type WheelColor, type WheelResult, type WheelRisk } from '#shared/games/wheel'
import { formatCoins } from '#shared/money'

const info = findGame('wheel')!
const round = useGameRound<WheelResult>('wheel')

const bet = ref(info.minBet)
const risk = ref<WheelRisk>('medium')
const last = ref<WheelResult | null>(null)
const lastPayout = ref(0)
const highlight = ref<number | null>(null)
const spinning = ref(false)
const history = ref<{ id: string, label: string, won: boolean }[]>([])

const COLORS: Record<WheelColor, string> = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#f59e0b' }
const RISK_LABEL: Record<WheelRisk, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

const segments = computed(() => wheelLayout(risk.value))
const legend = computed(() => WHEEL_TABLES[risk.value])
const maxMultiple = computed(() => Math.max(...legend.value.map(seg => seg.multiplier)))
const winChance = computed(() => legend.value.filter(seg => seg.multiplier > 0).reduce((sum, seg) => sum + seg.count, 0) * 10)

// rotation: how far the wheel has turned clockwise, in radians. Segment i
// starts at -π/2 + rotation + i × arc, so rotation 0 puts segment 0 at the top.
const canvas = ref<HTMLCanvasElement | null>(null)
let rotation = 0
let frame = 0

function lighten(hex: string, amount: number) {
    const n = Number.parseInt(hex.slice(1), 16)
    const c = (shift: number) => Math.min(255, ((n >> shift) & 0xff) + amount)
    return `rgb(${c(16)},${c(8)},${c(0)})`
}

function draw() {
    const el = canvas.value
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const size = el.clientWidth
    if (el.width !== Math.round(size * dpr)) {
        el.width = Math.round(size * dpr)
        el.height = Math.round(size * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const segs = segments.value
    const n = segs.length
    const c = size / 2
    const r = c - 4
    const arc = (Math.PI * 2) / n
    ctx.clearRect(0, 0, size, size)

    for (let i = 0; i < n; i++) {
        const start = -Math.PI / 2 + rotation + i * arc
        const lit = highlight.value === i
        const color = COLORS[segs[i]!.color]
        ctx.beginPath()
        ctx.moveTo(c, c)
        ctx.arc(c, c, r, start, start + arc)
        ctx.closePath()
        ctx.fillStyle = lit ? lighten(color, 60) : color
        ctx.fill()
        ctx.strokeStyle = '#0b0b12'
        ctx.lineWidth = 2
        ctx.stroke()

        const mid = start + arc / 2
        ctx.save()
        ctx.translate(c + Math.cos(mid) * r * 0.68, c + Math.sin(mid) * r * 0.68)
        ctx.rotate(mid + Math.PI / 2)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = lit ? '#111' : '#fff'
        ctx.font = `700 ${Math.max(11, Math.round(size / 24))}px 'JetBrains Mono', ui-monospace, monospace`
        ctx.shadowColor = 'rgba(0,0,0,.6)'
        ctx.shadowBlur = lit ? 0 : 3
        ctx.fillText(`${segs[i]!.multiplier}×`, 0, 0)
        ctx.restore()
    }

    ctx.beginPath()
    ctx.arc(c, c, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#1b1b26'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(c, c, size * 0.06, 0, Math.PI * 2)
    ctx.fillStyle = '#12121a'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(c, c, size * 0.018, 0, Math.PI * 2)
    ctx.fillStyle = '#4b4b5c'
    ctx.fill()
}

function spinTo(index: number): Promise<void> {
    const n = segments.value.length
    const arc = (Math.PI * 2) / n
    const full = Math.PI * 2
    // Land the segment's middle under the pointer at the top, a little off
    // centre so it doesn't look mechanical (cosmetic only).
    const jitter = (Math.random() - 0.5) * arc * 0.6
    const target = ((-(index + 0.5) * arc + jitter) % full + full) % full
    const current = (rotation % full + full) % full
    const from = rotation
    const to = rotation + ((target - current + full) % full) + full * (3 + Math.floor(Math.random() * 3))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reduced ? 0 : 2200
    return new Promise((resolve) => {
        const start = performance.now()
        const step = (now: number) => {
            const t = duration ? Math.min(1, (now - start) / duration) : 1
            rotation = from + (to - from) * (1 - (1 - t) ** 4)
            draw()
            if (t < 1) frame = requestAnimationFrame(step)
            else resolve()
        }
        frame = requestAnimationFrame(step)
    })
}

async function spin() {
    if (round.busy.value) return
    highlight.value = null
    const response = await round.play({ bet: bet.value, options: { risk: risk.value } })
    if (!response) return
    last.value = null
    spinning.value = true
    await spinTo(response.result.index)
    spinning.value = false
    highlight.value = response.result.index
    draw()
    last.value = response.result
    lastPayout.value = response.payout
    history.value = [{ id: response.roundId, label: `${response.result.multiplier}×`, won: response.result.won }, ...history.value].slice(0, 20)
    round.settle()
}

function pickRisk(value: WheelRisk) {
    if (round.busy.value) return
    risk.value = value
}

watch(risk, () => {
    rotation = 0
    highlight.value = null
    last.value = null
    nextTick(draw)
})

let observer: ResizeObserver | null = null
function onKey(event: KeyboardEvent) {
    if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault()
        void spin()
    }
}
onMounted(() => {
    window.addEventListener('keydown', onKey)
    observer = new ResizeObserver(() => draw())
    if (canvas.value) observer.observe(canvas.value)
    draw()
})
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    observer?.disconnect()
    cancelAnimationFrame(frame)
})
</script>

<template>
  <GameFrame slug="wheel">
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div class="order-2 space-y-4 rounded-2xl border bg-card p-4 lg:order-1">
        <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="round.busy.value" />
        <div class="space-y-1.5">
          <p class="text-xs font-medium text-muted-foreground">Risk</p>
          <div class="grid grid-cols-3 gap-2">
            <Button
              v-for="value in WHEEL_RISKS"
              :key="value"
              size="lg"
              class="h-11"
              :variant="risk === value ? 'default' : 'outline'"
              :disabled="round.busy.value"
              @click="pickRisk(value)"
            >
              {{ RISK_LABEL[value] }}
            </Button>
          </div>
        </div>
        <div class="space-y-1.5 rounded-xl bg-muted p-3">
          <div v-for="seg in legend" :key="seg.multiplier" class="flex items-center justify-between text-sm">
            <span class="flex items-center gap-2">
              <span class="size-3 rounded-sm" :style="{ background: COLORS[seg.color] }" />
              <span class="font-mono">{{ seg.multiplier }}×</span>
            </span>
            <span class="font-mono text-xs text-muted-foreground">{{ seg.count }}/10</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-center">
          <div class="rounded-xl bg-muted p-2">
            <p class="text-xs text-muted-foreground">Chance</p>
            <p class="font-mono font-semibold">{{ winChance }}%</p>
          </div>
          <div class="rounded-xl bg-muted p-2">
            <p class="text-xs text-muted-foreground">Max</p>
            <p class="font-mono font-semibold">{{ formatCoins(Math.floor(bet * maxMultiple + 1e-6)) }}</p>
          </div>
        </div>
        <Button
          size="lg"
          class="h-12 w-full font-display text-base shadow-[0_3px_0_0_color-mix(in_oklch,var(--primary)_60%,black)] active:translate-y-[2px] active:shadow-none"
          :disabled="round.busy.value"
          @click="spin"
        >
          Spin
        </Button>
      </div>

      <div class="order-1 space-y-4 rounded-2xl border bg-card p-4 sm:p-6 lg:order-2">
        <GameRoundHistory :items="history" />
        <div class="relative mx-auto w-full max-w-[22rem] pt-4">
          <div class="pointer-events-none absolute top-0 left-1/2 z-10 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[22px] border-x-transparent border-t-primary drop-shadow-[0_2px_3px_rgb(0_0_0/.5)]" />
          <canvas
            ref="canvas"
            class="block aspect-square w-full rounded-full transition-[filter] duration-300"
            :class="spinning ? 'drop-shadow-[0_0_24px_color-mix(in_oklch,var(--primary)_35%,transparent)]' : ''"
          />
        </div>
        <div class="h-16 text-center">
          <Transition enter-active-class="transition duration-200" enter-from-class="opacity-0 translate-y-1" mode="out-in">
            <div v-if="last" :key="history[0]?.id">
              <p class="font-display text-4xl font-extrabold tabular-nums" :class="last.won ? 'text-success' : 'text-muted-foreground'">
                {{ last.won ? `+${formatCoins(lastPayout)}` : '0' }}
              </p>
              <p class="text-sm text-muted-foreground">{{ last.multiplier }}×</p>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Spin the wheel and win your bet times the segment it stops on. 0× loses the bet.</p>
      <p>The risk sets how many of the ten segments lose and how high the rest pay. Every risk returns 96%.</p>
    </template>
  </GameFrame>
</template>
