<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { ChartColumn, Table2 } from 'lucide-vue-next'
import { formatCoins, formatCoinsExact } from '#shared/money'
import type { StatsDay } from '#shared/stats'

/**
 * Two panels on one day axis (small multiples, never a second y-scale): the
 * balance at each day's end as a line, or with a game picked that game's
 * running net; under it the net result per day as bars, gains above the zero
 * line and losses below it. One crosshair and tooltip for both, by pointer or
 * arrow keys. The table holds every number: hidden for screen readers, or
 * shown in place of the chart.
 */
const props = defineProps<{ days: StatsDay[], cumulative: boolean }>()

const root = ref<HTMLElement | null>(null)
const { width } = useElementSize(root)
const showTable = ref(false)

const LINE_H = 140
const GAP = 24
const BAR_H = 110
const AXIS_H = 22
const LEFT = 48
const RIGHT = 10
const TOP = 8
const HEIGHT = TOP + LINE_H + GAP + BAR_H + AXIS_H
const lineTop = TOP
const lineBase = TOP + LINE_H
const barTop = lineBase + GAP

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/** The next round number at or above `v` (1, 1.2, 1.5, 2, … 8 × 10ⁿ). */
function niceCeil(v: number): number {
    if (v <= 0) return 0
    if (v <= 5) return Math.ceil(v)
    const p = 10 ** Math.floor(Math.log10(v))
    return NICE.find(f => f * p >= v - 1e-9)! * p
}

const n = computed(() => props.days.length)
const plotW = computed(() => Math.max(0, width.value - LEFT - RIGHT))
const band = computed(() => (n.value ? plotW.value / n.value : 0))
const cx = (i: number) => LEFT + band.value * (i + 0.5)
const barW = computed(() => Math.max(1, Math.min(24, band.value - 2)))

// ─── Line panel: balance, or a game's running net ───────────────────────

const lineValues = computed(() => {
    if (!props.cumulative) return props.days.map(d => d.balance)
    let run = 0
    return props.days.map(d => (run += d.net))
})
const lineLabel = computed(() => (props.cumulative ? 'Running net' : 'Coin balance'))
const lineDomain = computed(() => {
    const up = niceCeil(Math.max(0, ...lineValues.value))
    const down = niceCeil(Math.max(0, ...lineValues.value.map(v => -v)))
    return { up: up || (down ? 0 : 10), down }
})
const yl = (v: number) => lineTop + ((lineDomain.value.up - v) / (lineDomain.value.up + lineDomain.value.down)) * LINE_H
// A label closer than 14px to the zero line would overlap it: keep the gridline, drop the label.
const lineTicks = computed(() => [lineDomain.value.up, 0, -lineDomain.value.down]
    .filter((v, i) => i === 1 || v !== 0)
    .map(v => ({ v, label: v === 0 || Math.abs(yl(v) - yl(0)) >= 14 })))

function linePoints(values: number[]): string {
    if (values.length === 1) {
        const half = Math.min(band.value / 2, 12)
        return `${cx(0) - half},${yl(values[0]!)} ${cx(0) + half},${yl(values[0]!)}`
    }
    return values.map((v, i) => `${cx(i)},${yl(v)}`).join(' ')
}
const line = computed(() => linePoints(lineValues.value))
const area = computed(() => {
    const pts = line.value.split(' ')
    if (!pts[0]) return ''
    const zero = yl(0)
    return `M${pts.join('L')}L${pts.at(-1)!.split(',')[0]},${zero}L${pts[0].split(',')[0]},${zero}Z`
})

// ─── Bar panel: net per day ─────────────────────────────────────────────

const barDomain = computed(() => {
    let up = 0
    let down = 0
    for (const d of props.days) {
        up = Math.max(up, d.net)
        down = Math.max(down, -d.net)
    }
    up = niceCeil(up)
    down = niceCeil(down)
    if (!up && !down) up = 10
    return { up, down }
})
const yb = (v: number) => barTop + ((barDomain.value.up - v) / (barDomain.value.up + barDomain.value.down)) * BAR_H
const y0 = computed(() => yb(0))
// A label closer than 14px to the zero line would overlap it: keep the gridline, drop the label.
const barTicks = computed(() => [barDomain.value.up, 0, -barDomain.value.down]
    .filter((v, i) => i === 1 || v !== 0)
    .map(v => ({ v, label: v === 0 || Math.abs(yb(v) - y0.value) >= 14 })))

/** A bar from the zero line with a 4px rounded data end; square at the baseline. */
function barPath(i: number, value: number): string {
    if (value === 0) return ''
    const w = barW.value
    const x0 = cx(i) - w / 2
    const dir = value > 0 ? 1 : -1
    // 1px off the zero line, so the line stays visible between gains and losses.
    const base = y0.value - dir
    const end = dir === 1 ? Math.min(yb(value), base - 1) : Math.max(yb(value), base + 1)
    const h = Math.abs(base - end)
    const r = Math.min(4, w / 2, h)
    if (dir === 1) {
        return `M${x0},${base}V${end + r}Q${x0},${end} ${x0 + r},${end}H${x0 + w - r}Q${x0 + w},${end} ${x0 + w},${end + r}V${base}Z`
    }
    return `M${x0},${base}V${end - r}Q${x0},${end} ${x0 + r},${end}H${x0 + w - r}Q${x0 + w},${end} ${x0 + w},${end - r}V${base}Z`
}
const bars = computed(() => props.days.map((d, i) => ({ d: barPath(i, d.net), gain: d.net > 0 })))

// ─── Axis, hover and keys ───────────────────────────────────────────────

const multiYear = computed(() => n.value > 0 && props.days[0]!.day.slice(0, 4) !== props.days.at(-1)!.day.slice(0, 4))
const xLabels = computed(() => {
    if (!n.value || !plotW.value) return []
    const fit = Math.max(2, Math.floor(plotW.value / 72))
    const step = Math.max(1, Math.ceil(n.value / fit))
    const out: { i: number, x: number, text: string }[] = []
    for (let i = n.value - 1; i >= 0; i -= step) {
        out.push({ i, x: Math.min(Math.max(cx(i), LEFT + 18), LEFT + plotW.value - 18), text: formatDay(props.days[i]!.day) })
    }
    return out.reverse()
})

const tick = (v: number) => (v < 0 ? `−${formatCoins(-v, true)}` : formatCoins(v, true))
const empty = computed(() => props.days.every(d => d.rounds === 0))

const active = ref<number | null>(null)
const current = computed(() => (active.value === null ? null : props.days[active.value] ?? null))
const currentLine = computed(() => (active.value === null ? 0 : lineValues.value[active.value] ?? 0))

function pick(e: PointerEvent) {
    const x = e.clientX - (e.currentTarget as SVGElement).getBoundingClientRect().left
    if (!band.value) return
    active.value = Math.min(n.value - 1, Math.max(0, Math.floor((x - LEFT) / band.value)))
}
function key(delta: number) {
    if (!n.value) return
    active.value = active.value === null ? n.value - 1 : Math.min(n.value - 1, Math.max(0, active.value + delta))
}

const tooltipStyle = computed(() => {
    if (active.value === null) return {}
    const x = cx(active.value)
    const right = x > width.value / 2
    return { left: `${x}px`, top: `${lineTop}px`, transform: right ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }
})

const summary = computed(() => {
    const net = props.days.reduce((s, d) => s + d.net, 0)
    const last = lineValues.value.at(-1) ?? 0
    return `Per day over ${n.value} ${n.value === 1 ? 'day' : 'days'}: net ${formatSignedCoins(net)}, ${lineLabel.value.toLowerCase()} ${props.cumulative ? formatSignedCoins(last) : formatCoins(last)} at the end.`
})
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        <li class="flex items-center gap-1.5"><span class="h-0.5 w-3 rounded-full bg-chart-balance" aria-hidden="true" />{{ lineLabel }}</li>
        <li class="flex items-center gap-1.5"><span class="size-2.5 rounded-[3px] bg-chart-gain" aria-hidden="true" />Day up</li>
        <li class="flex items-center gap-1.5"><span class="size-2.5 rounded-[3px] bg-chart-loss" aria-hidden="true" />Day down</li>
      </ul>
      <button
        type="button"
        class="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-8"
        :aria-pressed="showTable"
        :aria-label="showTable ? 'Show chart' : 'Show table'"
        :title="showTable ? 'Chart' : 'Table'"
        @click="showTable = !showTable"
      >
        <component :is="showTable ? ChartColumn : Table2" class="size-4" aria-hidden="true" />
      </button>
    </div>

    <div :class="showTable ? 'max-h-[296px] overflow-auto rounded-xl border' : 'sr-only'">
      <table class="w-full text-right text-xs">
        <caption class="sr-only">{{ lineLabel }} and net result per day</caption>
        <thead class="sticky top-0 bg-card text-muted-foreground">
          <tr class="border-b">
            <th scope="col" class="px-3 py-2 text-left font-medium">Day</th>
            <th scope="col" class="px-2 py-2 font-medium">Rounds</th>
            <th scope="col" class="px-2 py-2 font-medium">Wagered</th>
            <th scope="col" class="px-2 py-2 font-medium">Net</th>
            <th scope="col" class="px-3 py-2 font-medium">{{ lineLabel }}</th>
          </tr>
        </thead>
        <tbody class="divide-y tabular-nums">
          <tr v-for="i in n" :key="days[n - i]!.day">
            <th scope="row" class="px-3 py-1.5 text-left font-normal text-muted-foreground">{{ formatDay(days[n - i]!.day, multiYear) }}</th>
            <td class="px-2 py-1.5">{{ days[n - i]!.rounds ? formatCoins(days[n - i]!.rounds) : '·' }}</td>
            <td class="px-2 py-1.5" :title="formatCoinsExact(days[n - i]!.wagered)">{{ days[n - i]!.wagered ? formatCoins(days[n - i]!.wagered) : '·' }}</td>
            <td class="px-2 py-1.5" :title="formatCoinsExact(days[n - i]!.net)">{{ formatSignedCoins(days[n - i]!.net) }}</td>
            <td class="px-3 py-1.5">{{ cumulative ? formatSignedCoins(lineValues[n - i]!) : formatCoins(lineValues[n - i]!) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="!showTable"
      ref="root"
      class="relative rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      :style="{ height: `${HEIGHT}px` }"
      tabindex="0"
      role="group"
      :aria-label="summary"
      @keydown.left.prevent="key(-1)"
      @keydown.right.prevent="key(1)"
      @keydown.home.prevent="active = 0"
      @keydown.end.prevent="active = n - 1"
      @keydown.esc="active = null"
      @focus="active ??= n - 1"
      @blur="active = null"
    >
      <svg v-if="width > 0" :width="width" :height="HEIGHT" class="block touch-pan-y select-none" aria-hidden="true" @pointermove="pick" @pointerdown="pick" @pointerleave="active = null">
        <!-- grid and axes -->
        <g class="text-[11px]">
          <template v-for="t in lineTicks" :key="`l${t.v}`">
            <line :x1="LEFT" :x2="LEFT + plotW" :y1="yl(t.v)" :y2="yl(t.v)" :stroke="t.v === 0 ? 'color-mix(in oklch, var(--foreground) 28%, transparent)' : 'var(--border)'" stroke-width="1" shape-rendering="crispEdges" />
            <text v-if="t.label" :x="LEFT - 6" :y="yl(t.v)" dy="0.32em" text-anchor="end" class="tabular-nums fill-muted-foreground">{{ tick(t.v) }}</text>
          </template>
          <template v-for="t in barTicks" :key="`b${t.v}`">
            <line :x1="LEFT" :x2="LEFT + plotW" :y1="yb(t.v)" :y2="yb(t.v)" :stroke="t.v === 0 ? 'color-mix(in oklch, var(--foreground) 28%, transparent)' : 'var(--border)'" stroke-width="1" shape-rendering="crispEdges" />
            <text v-if="t.label" :x="LEFT - 6" :y="yb(t.v)" dy="0.32em" text-anchor="end" class="tabular-nums fill-muted-foreground">{{ tick(t.v) }}</text>
          </template>
          <text v-for="l in xLabels" :key="`x${l.i}`" :x="l.x" :y="HEIGHT - 6" text-anchor="middle" class="fill-muted-foreground">{{ l.text }}</text>
        </g>

        <!-- balance or running net -->
        <path :d="area" fill="var(--chart-balance)" fill-opacity="0.1" />
        <polyline :points="line" fill="none" stroke="var(--chart-balance)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

        <!-- net per day -->
        <path
          v-for="(b, i) in bars"
          :key="`n${i}`"
          :d="b.d"
          :fill="b.gain ? 'var(--chart-gain)' : 'var(--chart-loss)'"
          :opacity="active === null || active === i ? 1 : 0.4"
        />
        <text v-if="empty" :x="LEFT + plotW / 2" :y="barTop + BAR_H / 2" dy="0.32em" text-anchor="middle" class="fill-muted-foreground text-sm">No rounds</text>

        <!-- crosshair -->
        <g v-if="current && active !== null">
          <line :x1="cx(active)" :x2="cx(active)" :y1="lineTop" :y2="barTop + BAR_H" stroke="var(--muted-foreground)" stroke-opacity="0.6" stroke-width="1" />
          <circle :cx="cx(active)" :cy="yl(currentLine)" r="4" fill="var(--chart-balance)" stroke="var(--card)" stroke-width="2" />
        </g>
      </svg>

      <div
        v-if="current"
        class="pointer-events-none absolute z-10 min-w-40 rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
        :style="tooltipStyle"
        aria-live="polite"
      >
        <p class="mb-1.5 font-medium text-muted-foreground">{{ formatDay(current.day, multiYear) }}</p>
        <dl class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
          <dt class="flex items-center gap-1.5 text-muted-foreground"><span class="h-0.5 w-3 rounded-full bg-chart-balance" aria-hidden="true" />{{ lineLabel }}</dt>
          <dd class="text-right font-semibold tabular-nums">{{ cumulative ? formatSignedCoins(currentLine) : formatCoins(currentLine) }}</dd>
          <dt class="flex items-center gap-1.5 text-muted-foreground"><span class="h-0.5 w-3 rounded-full" :class="current.net < 0 ? 'bg-chart-loss' : 'bg-chart-gain'" aria-hidden="true" />Net</dt>
          <dd class="text-right font-semibold tabular-nums">{{ formatSignedCoins(current.net) }}</dd>
          <dt class="pl-[18px] text-muted-foreground">Wagered</dt>
          <dd class="text-right font-semibold tabular-nums">{{ formatCoins(current.wagered) }}</dd>
          <dt class="pl-[18px] text-muted-foreground">Rounds</dt>
          <dd class="text-right font-semibold tabular-nums">{{ formatCoins(current.rounds) }}</dd>
        </dl>
      </div>
    </div>
  </div>
</template>
