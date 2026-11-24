<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { formatCoins } from '#shared/money'
import { VISITOR_TIER_IDS, type HistoryHour, type VisitorTierId } from '#shared/visitors'

/**
 * My Casino hour by hour, two panels on one hour axis (small multiples, never
 * a second y-scale): the guests on the floor per tier as stacked areas (in
 * the tier colours), and under it a line of the coins that came into the
 * cage, with a dashed line for what a full cage turned away. One crosshair
 * and tooltip for both, by pointer, tap or arrow keys.
 */
const props = defineProps<{ hours: HistoryHour[], days: boolean }>()

const root = ref<HTMLElement | null>(null)
const { width } = useElementSize(root)

const GUEST_H = 150
const GAP = 36
const INCOME_H = 120
const AXIS_H = 22
const LEFT = 44
const RIGHT = 8
const TOP = 18
const HEIGHT = TOP + GUEST_H + GAP + INCOME_H + AXIS_H
const guestTop = TOP
const guestBase = TOP + GUEST_H
const incomeTop = guestBase + GAP
const incomeBase = incomeTop + INCOME_H

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
function niceCeil(v: number): number {
    if (v <= 0) return 0
    if (v <= 5) return Math.ceil(v)
    const p = 10 ** Math.floor(Math.log10(v))
    return NICE.find(f => f * p >= v - 1e-9)! * p
}

const ONE = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 })
const guestsOf = (h: HistoryHour) => VISITOR_TIER_IDS.reduce((sum, id) => sum + (h.visitors[id] ?? 0), 0)

const n = computed(() => props.hours.length)
const plotW = computed(() => Math.max(0, width.value - LEFT - RIGHT))
const band = computed(() => (n.value ? plotW.value / n.value : 0))
const cx = (i: number) => LEFT + band.value * (i + 0.5)

/** An SVG polyline through `ys` at the hour centres. */
const line = (ys: number[]) => ys.map((y, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y.toFixed(1)}`).join('')
/** The band between `tops` and `bottoms` (bottoms walked back). */
const area = (tops: number[], bottoms: number[]) => (tops.length
    ? `${line(tops)}${bottoms.map((y, i) => `L${cx(bottoms.length - 1 - i).toFixed(1)},${bottoms[bottoms.length - 1 - i]!.toFixed(1)}`).join('')}Z`
    : '')

// ─── Guests per tier ────────────────────────────────────────────────────

const guestMax = computed(() => niceCeil(Math.max(0, ...props.hours.map(guestsOf))) || 5)
const yg = (v: number) => guestBase - (v / guestMax.value) * GUEST_H
const guestTicks = computed(() => [0, guestMax.value / 2, guestMax.value].filter((v, i) => i !== 1 || Number.isInteger(v)))

/** One stacked band per tier that showed up, cheapest at the bottom. */
const bands = computed(() => {
    const below = props.hours.map(() => 0)
    const out: { id: VisitorTierId, color: string, area: string, edge: string }[] = []
    for (const t of TIERS) {
        if (!props.hours.some(h => (h.visitors[t.id] ?? 0) > 0)) continue
        const bottoms = below.map(v => yg(v))
        props.hours.forEach((h, i) => (below[i] = below[i]! + (h.visitors[t.id] ?? 0)))
        const tops = below.map(v => yg(v))
        out.push({ id: t.id, color: tierChartColor(t.id), area: area(tops, bottoms), edge: line(tops) })
    }
    return out
})

// ─── Income per hour ────────────────────────────────────────────────────

const incomeMax = computed(() => niceCeil(Math.max(0, ...props.hours.map(h => Math.max(h.income, h.lost)))) || 10)
const yi = (v: number) => incomeBase - (v / incomeMax.value) * INCOME_H
const incomeTicks = computed(() => [0, incomeMax.value])

const best = computed(() => {
    let at = -1
    let top = 0
    props.hours.forEach((h, i) => {
        if (h.income + h.lost > top) {
            top = h.income + h.lost
            at = i
        }
    })
    return at
})
const incomeLine = computed(() => line(props.hours.map(h => yi(h.income))))
const incomeArea = computed(() => area(props.hours.map(h => yi(h.income)), props.hours.map(() => incomeBase)))
const lostLine = computed(() => (props.hours.some(h => h.lost > 0) ? line(props.hours.map(h => yi(h.lost))) : ''))

// ─── Axis, hover and keys ───────────────────────────────────────────────

const hourOf = (ms: number) => new Date(ms).getHours()
const xLabels = computed(() => {
    if (!n.value || !plotW.value) return []
    const fit = Math.max(2, Math.floor(plotW.value / 56))
    const step = [1, 2, 3, 4, 6, 12, 24].find(s => n.value / s <= fit) ?? 24
    const out: { i: number, x: number, text: string }[] = []
    props.hours.forEach((h, i) => {
        const hour = hourOf(h.at)
        if (hour % step !== 0) return
        const text = props.days && hour === 0 ? new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(new Date(h.at)) : formatClock(h.at)
        out.push({ i, x: Math.min(Math.max(cx(i), LEFT + 16), LEFT + plotW.value - 16), text })
    })
    return out
})

const empty = computed(() => props.hours.every(h => guestsOf(h) === 0 && h.income === 0))

const active = ref<number | null>(null)
const current = computed(() => (active.value === null ? null : props.hours[active.value] ?? null))
const when = (ms: number) => (props.days ? formatDayClock(ms) : `${formatClock(ms)}–${formatClock(ms + 3_600_000)}`)

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
    return { left: `${x}px`, top: `${guestTop}px`, transform: right ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }
})

/** Each tier's share of the guest-hours (the legend). */
const shares = computed(() => {
    const sums = Object.fromEntries(VISITOR_TIER_IDS.map(id => [id, props.hours.reduce((s, h) => s + (h.visitors[id] ?? 0), 0)])) as Record<VisitorTierId, number>
    const total = VISITOR_TIER_IDS.reduce((s, id) => s + sums[id], 0)
    return TIERS.filter(t => sums[t.id] > 0).map(t => ({ ...t, share: total > 0 ? sums[t.id] / total : 0 }))
})

const summary = computed(() => {
    const income = props.hours.reduce((s, h) => s + h.income, 0)
    return `Guests per tier and income per hour over ${n.value} hours: ${formatCoins(income)} coins in all.`
})
</script>

<template>
  <div class="space-y-3">
    <ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      <li v-for="t in shares" :key="t.id" class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-[3px]" :style="{ background: tierChartColor(t.id) }" aria-hidden="true" />{{ tierPlural(t.id, 2) }}
        <span class="tabular-nums">{{ t.share > 0 && t.share < 0.005 ? '<1' : Math.round(t.share * 100) }}%</span>
      </li>
      <li class="flex items-center gap-1.5"><span class="size-2.5 rounded-[3px] bg-chart-gain" aria-hidden="true" />Income</li>
      <li class="flex items-center gap-1.5"><span class="h-0 w-3 border-t-2 border-dashed border-chart-loss" aria-hidden="true" />Lost (cage full)</li>
    </ul>

    <div
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
        <g class="text-[11px]">
          <text :x="0" :y="guestTop - 8" class="fill-muted-foreground font-medium">Guests on the floor</text>
          <template v-for="t in guestTicks" :key="`g${t}`">
            <line :x1="LEFT" :x2="LEFT + plotW" :y1="yg(t)" :y2="yg(t)" :stroke="t === 0 ? 'color-mix(in oklch, var(--foreground) 28%, transparent)' : 'var(--border)'" stroke-width="1" shape-rendering="crispEdges" />
            <text :x="LEFT - 6" :y="yg(t)" dy="0.32em" text-anchor="end" class="tabular-nums fill-muted-foreground">{{ ONE.format(t) }}</text>
          </template>
          <text :x="0" :y="incomeTop - 8" class="fill-muted-foreground font-medium">Coins into the cage</text>
          <template v-for="t in incomeTicks" :key="`i${t}`">
            <line :x1="LEFT" :x2="LEFT + plotW" :y1="yi(t)" :y2="yi(t)" :stroke="t === 0 ? 'color-mix(in oklch, var(--foreground) 28%, transparent)' : 'var(--border)'" stroke-width="1" shape-rendering="crispEdges" />
            <text :x="LEFT - 6" :y="yi(t)" dy="0.32em" text-anchor="end" class="tabular-nums fill-muted-foreground">{{ formatCoins(t, true) }}</text>
          </template>
          <text v-for="l in xLabels" :key="`x${l.i}`" :x="l.x" :y="HEIGHT - 6" text-anchor="middle" class="tabular-nums fill-muted-foreground">{{ l.text }}</text>
        </g>

        <!-- guests per tier: stacked areas -->
        <g v-for="b in bands" :key="b.id">
          <path :d="b.area" :style="{ fill: b.color }" fill-opacity="0.28" />
          <path :d="b.edge" fill="none" :style="{ stroke: b.color }" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        </g>

        <!-- income, and what a full cage turned away -->
        <path :d="incomeArea" fill="var(--chart-gain)" fill-opacity="0.16" />
        <path :d="incomeLine" fill="none" stroke="var(--chart-gain)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <path v-if="lostLine" :d="lostLine" fill="none" stroke="var(--chart-loss)" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round" />
        <text v-if="empty" :x="LEFT + plotW / 2" :y="guestTop + GUEST_H / 2" dy="0.32em" text-anchor="middle" class="fill-muted-foreground text-sm">No guests yet</text>

        <template v-if="current && active !== null">
          <line :x1="cx(active)" :x2="cx(active)" :y1="guestTop" :y2="incomeBase" stroke="var(--muted-foreground)" stroke-opacity="0.6" stroke-width="1" />
          <circle :cx="cx(active)" :cy="yg(guestsOf(current))" r="3.5" fill="var(--card)" stroke="var(--foreground)" stroke-width="1.5" />
          <circle :cx="cx(active)" :cy="yi(current.income)" r="3.5" fill="var(--card)" stroke="var(--chart-gain)" stroke-width="2" />
        </template>
      </svg>

      <div
        v-if="current"
        class="pointer-events-none absolute z-10 min-w-44 rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
        :style="tooltipStyle"
        aria-live="polite"
      >
        <p class="mb-1.5 font-medium text-muted-foreground">{{ when(current.at) }}<span v-if="active === best" class="ml-1.5 text-foreground">· busiest hour</span></p>
        <dl class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
          <template v-for="t in TIERS" :key="t.id">
            <template v-if="(current.visitors[t.id] ?? 0) > 0">
              <dt class="flex items-center gap-1.5 text-muted-foreground"><span class="size-2.5 rounded-[3px]" :style="{ background: tierChartColor(t.id) }" aria-hidden="true" />{{ tierPlural(t.id, 2) }}</dt>
              <dd class="text-right font-semibold tabular-nums">{{ ONE.format(current.visitors[t.id]) }}</dd>
            </template>
          </template>
          <dt class="pl-4 text-muted-foreground">Guests</dt>
          <dd class="text-right font-semibold tabular-nums">{{ ONE.format(guestsOf(current)) }}</dd>
          <dt class="flex items-center gap-1.5 text-muted-foreground"><span class="size-2.5 rounded-[3px] bg-chart-gain" aria-hidden="true" />Income</dt>
          <dd class="text-right font-semibold tabular-nums">+{{ formatCoins(current.income) }}</dd>
          <template v-if="current.lost > 0">
            <dt class="flex items-center gap-1.5 text-muted-foreground"><span class="size-2.5 rounded-[3px] bg-chart-loss" aria-hidden="true" />Lost</dt>
            <dd class="text-right font-semibold tabular-nums">{{ formatCoins(current.lost) }}</dd>
          </template>
        </dl>
      </div>
    </div>
  </div>
</template>
