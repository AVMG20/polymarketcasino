<script setup lang="ts">
/**
 * A small chart in the floor UI's style: one line per series over the same
 * hours, each from zero (a single series gets a soft fill). Drawn in a fixed
 * viewBox that stretches to the width; the lines keep their thickness.
 *
 * Hover (mouse), tap or drag sideways (touch) or the arrow keys pick the
 * nearest hour: a guide line, a dot on each line and the `tip` slot (given
 * that hour's `index`) in a small dark card beside the guide.
 */
const props = withDefaults(defineProps<{
    /** Series in drawing order (later ones on top); each value per hour. */
    series: { color: string, values: number[] }[]
    height?: number
    /** What the chart shows, for screen readers. */
    label?: string
}>(), { height: 120, label: 'Chart' })

const W = 300
const H = 100
const n = computed(() => Math.max(0, ...props.series.map(s => s.values.length)))
const max = computed(() => Math.max(1, ...props.series.flatMap(s => s.values)) * 1.1)
const x = (i: number) => (n.value <= 1 ? W / 2 : (i / (n.value - 1)) * W)
const y = (v: number) => H - (Math.max(0, v) / max.value) * H
const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

const shapes = computed(() => props.series.map(s => ({
    color: s.color,
    line: line(s.values),
    area: props.series.length === 1 && s.values.length ? `${line(s.values)} L${x(s.values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z` : null
})))
const gradId = `lc-${Math.random().toString(36).slice(2, 8)}`

// ── Inspecting an hour ────────────────────────────────────────────────────
const box = ref<HTMLElement | null>(null)
const active = ref<number | null>(null)

function pick(e: PointerEvent) {
    const r = box.value?.getBoundingClientRect()
    if (!r || !r.width || n.value === 0) return
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    active.value = n.value <= 1 ? 0 : Math.round(f * (n.value - 1))
}
function down(e: PointerEvent) {
    pick(e)
}
function move(e: PointerEvent) {
    // A mouse inspects on hover; a finger while it is down.
    if (e.pointerType === 'mouse' || e.buttons) pick(e)
}
function leave(e: PointerEvent) {
    // A lifted finger keeps its hour readable; a tap elsewhere closes it.
    if (e.pointerType === 'mouse') active.value = null
}
function key(e: KeyboardEvent) {
    if (!n.value) return
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (step) {
        e.preventDefault()
        active.value = Math.min(n.value - 1, Math.max(0, (active.value ?? (step > 0 ? -1 : n.value)) + step))
    } else if (e.key === 'Escape') {
        active.value = null
    }
}
function outside(e: PointerEvent) {
    if (active.value !== null && box.value && !box.value.contains(e.target as Node)) active.value = null
}
onMounted(() => document.addEventListener('pointerdown', outside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true))
watch(n, (len) => {
    if (active.value !== null && active.value >= len) active.value = null
})

/** The guide's place, as a share of the width (0-100). */
const at = computed(() => (active.value === null ? 0 : (x(active.value) / W) * 100))
const dots = computed(() => (active.value === null
    ? []
    : props.series.map(s => ({ color: s.color, top: (y(s.values[active.value!] ?? 0) / H) * 100 }))))
</script>

<template>
  <div
    ref="box"
    class="chart relative select-none outline-none"
    :style="{ height: `${height}px` }"
    tabindex="0"
    role="img"
    :aria-label="`${label}. Use the arrow keys to read an hour.`"
    @pointerdown="down"
    @pointermove="move"
    @pointerleave="leave"
    @keydown="key"
    @blur="active = null"
  >
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="absolute inset-0 block size-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient v-for="(s, k) in shapes" :id="`${gradId}-${k}`" :key="k" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :stop-color="s.color" stop-opacity="0.45" />
          <stop offset="1" :stop-color="s.color" stop-opacity="0.04" />
        </linearGradient>
      </defs>
      <!-- Soft guide lines -->
      <line v-for="g in [25, 50, 75]" :key="g" x1="0" :y1="g" :x2="W" :y2="g" stroke="rgb(255 255 255 / 0.07)" vector-effect="non-scaling-stroke" />
      <line x1="0" :y1="H" :x2="W" :y2="H" stroke="rgb(255 255 255 / 0.14)" vector-effect="non-scaling-stroke" />
      <template v-for="(s, k) in shapes" :key="k">
        <path v-if="s.area" :d="s.area" :fill="`url(#${gradId}-${k})`" stroke="none" />
        <path :d="s.line" fill="none" :stroke="s.color" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      </template>
      <line v-if="active !== null" :x1="x(active)" y1="0" :x2="x(active)" :y2="H" stroke="rgb(255 255 255 / 0.55)" stroke-width="1.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
    </svg>
    <template v-if="active !== null">
      <span v-for="(d, k) in dots" :key="k" class="dot" :style="{ left: `${at}%`, top: `${d.top}%`, background: d.color }" />
      <div class="tip" :style="at > 50 ? { right: `calc(${100 - at}% + 8px)` } : { left: `calc(${at}% + 8px)` }">
        <slot name="tip" :index="active" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Sideways drags inspect; up and down still scroll the sheet. */
.chart { touch-action: pan-y; cursor: crosshair; }
.chart:focus-visible { box-shadow: 0 0 0 2px rgb(125 211 252 / 0.6); border-radius: 6px; }
.dot {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  border: 2px solid #120c1d;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.tip {
  position: absolute;
  top: 2px;
  z-index: 2;
  max-width: calc(50% - 10px);
  min-width: 0;
  padding: 5px 8px;
  border-radius: 10px;
  background: rgb(18 12 29 / 0.94);
  border: 2px solid rgb(0 0 0 / 0.55);
  box-shadow: 0 3px 0 rgb(0 0 0 / 0.35);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  pointer-events: none;
}
</style>
