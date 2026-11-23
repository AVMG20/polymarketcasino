<script setup lang="ts">
/** The cage as a glass jar of coins (the cage pays coins); `fill` 0..1. */
const props = defineProps<{ fill: number }>()
const TOP = 13
const BOTTOM = 41
const level = computed(() => BOTTOM - (BOTTOM - TOP) * Math.max(0, Math.min(1, props.fill)))
// Coins piled inside, bottom first: each shows once the fill reaches it.
const CHIPS = [
    { x: 13, y: 37 }, { x: 20, y: 38 }, { x: 27, y: 37 }, { x: 16, y: 32 }, { x: 24, y: 32 },
    { x: 12, y: 27 }, { x: 20, y: 27 }, { x: 28, y: 27 }, { x: 16, y: 22 }, { x: 24, y: 21 }, { x: 20, y: 16 }
]
const uid = useId()
</script>

<template>
  <svg viewBox="0 0 40 46" aria-hidden="true">
    <defs>
      <clipPath :id="`${uid}-jar`"><rect x="6" y="12" width="28" height="30" rx="9" /></clipPath>
      <linearGradient :id="`${uid}-glass`" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity=".26" />
        <stop offset="0.45" stop-color="#fff" stop-opacity=".08" />
        <stop offset="1" stop-color="#fff" stop-opacity=".2" />
      </linearGradient>
      <radialGradient :id="`${uid}-coin`" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#fff3b0" />
        <stop offset="0.5" stop-color="#ffc93a" />
        <stop offset="1" stop-color="#d98a00" />
      </radialGradient>
      <linearGradient :id="`${uid}-lid`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#fff3b0" />
        <stop offset="0.5" stop-color="#ffc93a" />
        <stop offset="1" stop-color="#d98a00" />
      </linearGradient>
      <linearGradient :id="`${uid}-fill`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#ffe27a" stop-opacity=".55" />
        <stop offset="1" stop-color="#d98a00" stop-opacity=".7" />
      </linearGradient>
    </defs>
    <ellipse cx="20" cy="43.5" rx="14" ry="2" fill="black" opacity="0.3" />
    <rect x="6" y="12" width="28" height="30" rx="9" :fill="`url(#${uid}-glass)`" />
    <g :clip-path="`url(#${uid}-jar)`">
      <rect x="0" :y="level" width="40" height="46" :fill="`url(#${uid}-fill)`" class="transition-[y] duration-500" />
      <g v-for="(chip, i) in CHIPS" :key="i">
        <template v-if="chip.y + 3 >= level">
          <ellipse :cx="chip.x" :cy="chip.y + 0.9" rx="4.2" ry="2.3" fill="#b06d00" stroke="#5a3400" stroke-width="1" />
          <ellipse :cx="chip.x" :cy="chip.y" rx="4.2" ry="2.3" :fill="`url(#${uid}-coin)`" stroke="#5a3400" stroke-width="1" />
          <ellipse :cx="chip.x" :cy="chip.y - 0.3" rx="2.4" ry="1.1" fill="#fff6c2" fill-opacity=".75" />
        </template>
      </g>
    </g>
    <rect x="6" y="12" width="28" height="30" rx="9" fill="none" stroke="#1b1329" stroke-opacity=".7" stroke-width="3.6" />
    <rect x="6" y="12" width="28" height="30" rx="9" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.8" />
    <path d="M10.5 18 v14" stroke="#fff" stroke-opacity=".6" stroke-width="2.4" stroke-linecap="round" />
    <path d="M29.5 30 v5" stroke="#fff" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round" />
    <rect x="10" y="7" width="20" height="6" rx="2" :fill="`url(#${uid}-lid)`" stroke="#1b1329" stroke-width="1.5" />
    <rect x="12" y="3.5" width="16" height="4.5" rx="2" :fill="`url(#${uid}-lid)`" stroke="#1b1329" stroke-width="1.5" />
    <path d="M13.5 5 H20 M11.5 8.6 H18" stroke="#fff" stroke-opacity=".7" stroke-width="1" stroke-linecap="round" />
  </svg>
</template>
