<script setup lang="ts">
/**
 * A small chart in the floor UI's style: one or more series over the same
 * hours, stacked (guests per tier) or a single line with a soft fill
 * (income). Drawn in a fixed viewBox that stretches to the width; the lines
 * keep their thickness.
 */
const props = withDefaults(defineProps<{
    /** Series bottom to top; each value per hour. */
    series: { color: string, values: number[] }[]
    stacked?: boolean
    height?: number
}>(), { stacked: false, height: 120 })

const W = 300
const H = 100
const n = computed(() => Math.max(0, ...props.series.map(s => s.values.length)))
/** Running totals per series (stacked), or the values themselves. */
const tops = computed(() => {
    const out: number[][] = []
    props.series.forEach((s, k) => {
        out.push(s.values.map((v, i) => (props.stacked && k > 0 ? out[k - 1]![i]! : 0) + Math.max(0, v)))
    })
    return out
})
const max = computed(() => Math.max(1, ...tops.value.flat()) * 1.1)
const x = (i: number) => (n.value <= 1 ? W / 2 : (i / (n.value - 1)) * W)
const y = (v: number) => H - (v / max.value) * H
const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

const shapes = computed(() => tops.value.map((top, k) => {
    const base = props.stacked && k > 0 ? tops.value[k - 1]! : top.map(() => 0)
    const back = base.map((v, i) => [x(i), y(v)] as const).reverse().map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
    return { color: props.series[k]!.color, area: `${line(top)} ${back} Z`, line: line(top) }
}))
const gradId = `lc-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="block w-full" :style="{ height: `${height}px` }" role="img">
    <defs>
      <linearGradient v-for="(s, k) in shapes" :id="`${gradId}-${k}`" :key="k" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :stop-color="s.color" :stop-opacity="stacked ? 0.75 : 0.45" />
        <stop offset="1" :stop-color="s.color" :stop-opacity="stacked ? 0.55 : 0.04" />
      </linearGradient>
    </defs>
    <!-- Soft guide lines -->
    <line v-for="g in [25, 50, 75]" :key="g" x1="0" :y1="g" :x2="W" :y2="g" stroke="rgb(255 255 255 / 0.07)" vector-effect="non-scaling-stroke" />
    <template v-for="(s, k) in shapes" :key="k">
      <path :d="s.area" :fill="`url(#${gradId}-${k})`" stroke="none" />
      <path :d="s.line" fill="none" :stroke="s.color" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </template>
  </svg>
</template>
