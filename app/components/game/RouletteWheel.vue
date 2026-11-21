<script setup lang="ts">
import { pocketColor, WHEEL_ORDER } from '#shared/games/roulette'

/**
 * A European wheel in SVG. `spinTo(pocket)` turns it a few times and lands
 * that pocket under the pointer; it resolves when the wheel stops.
 */
const rotation = ref(0)
const duration = ref(0)
const SEGMENT = 360 / WHEEL_ORDER.length

const colors: Record<string, string> = { red: '#d93a3a', black: '#1f2430', green: '#1f9d55' }

const segments = WHEEL_ORDER.map((n, i) => {
    const a0 = ((i - 0.5) * SEGMENT - 90) * Math.PI / 180
    const a1 = ((i + 0.5) * SEGMENT - 90) * Math.PI / 180
    const r = 48
    const path = `M50 50 L${50 + r * Math.cos(a0)} ${50 + r * Math.sin(a0)} A${r} ${r} 0 0 1 ${50 + r * Math.cos(a1)} ${50 + r * Math.sin(a1)} Z`
    const mid = (i * SEGMENT - 90) * Math.PI / 180
    return { n, path, fill: colors[pocketColor(n)]!, x: 50 + 41 * Math.cos(mid), y: 50 + 41 * Math.sin(mid), angle: i * SEGMENT }
})

function spinTo(pocket: number): Promise<void> {
    const index = WHEEL_ORDER.indexOf(pocket as typeof WHEEL_ORDER[number])
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const current = ((rotation.value % 360) + 360) % 360
    const target = ((360 - index * SEGMENT) % 360 + 360) % 360
    duration.value = reduced ? 0 : 4200
    rotation.value += (reduced ? 0 : 5 * 360) + ((target - current + 360) % 360)
    return new Promise(resolve => setTimeout(resolve, duration.value + 50))
}

defineExpose({ spinTo })
</script>

<template>
  <div class="relative aspect-square w-full">
    <svg viewBox="0 0 100 100" class="size-full drop-shadow-lg">
      <circle cx="50" cy="50" r="50" fill="#5b3a1e" />
      <g
        :style="{ transform: `rotate(${rotation}deg)`, transformOrigin: '50px 50px', transition: `transform ${duration}ms cubic-bezier(.15,.75,.2,1)` }"
      >
        <path v-for="seg in segments" :key="seg.n" :d="seg.path" :fill="seg.fill" stroke="#c9a46a" stroke-width="0.3" />
        <text
          v-for="seg in segments"
          :key="`t${seg.n}`"
          :x="seg.x"
          :y="seg.y"
          fill="#fff"
          font-size="3.6"
          font-weight="700"
          text-anchor="middle"
          dominant-baseline="central"
          :transform="`rotate(${seg.angle} ${seg.x} ${seg.y})`"
        >{{ seg.n }}</text>
        <circle cx="50" cy="50" r="30" fill="#3d2814" stroke="#c9a46a" stroke-width="0.6" />
        <circle cx="50" cy="50" r="8" fill="#c9a46a" />
      </g>
    </svg>
    <!-- Pointer -->
    <div class="absolute top-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[16px] border-x-transparent border-t-white drop-shadow" />
  </div>
</template>
