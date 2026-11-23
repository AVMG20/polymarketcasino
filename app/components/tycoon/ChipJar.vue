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
      <linearGradient :id="`${uid}-fill`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#ffe27a" stop-opacity=".55" />
        <stop offset="1" stop-color="#d98a00" stop-opacity=".7" />
      </linearGradient>
    </defs>
    <rect x="6" y="12" width="28" height="30" rx="9" fill="rgb(255 255 255 / 0.13)" />
    <g :clip-path="`url(#${uid}-jar)`">
      <rect x="0" :y="level" width="40" height="46" :fill="`url(#${uid}-fill)`" class="transition-[y] duration-500" />
      <g v-for="(chip, i) in CHIPS" :key="i">
        <template v-if="chip.y + 3 >= level">
          <ellipse :cx="chip.x" :cy="chip.y" rx="4.2" ry="2.3" fill="#ffd23f" stroke="#8a5300" stroke-width="1" />
          <ellipse :cx="chip.x" :cy="chip.y - 0.3" rx="2.4" ry="1.1" fill="#fff6c2" fill-opacity=".75" />
        </template>
      </g>
    </g>
    <rect x="6" y="12" width="28" height="30" rx="9" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2.2" />
    <path d="M10.5 18 v14" stroke="#fff" stroke-opacity=".55" stroke-width="2.4" stroke-linecap="round" />
    <rect x="10" y="7" width="20" height="6" rx="2" fill="#ffc93a" stroke="#7a4a00" stroke-width="1.5" />
    <rect x="12" y="3.5" width="16" height="4.5" rx="2" fill="#ffdb70" stroke="#7a4a00" stroke-width="1.5" />
  </svg>
</template>
