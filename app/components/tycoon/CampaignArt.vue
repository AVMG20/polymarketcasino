<script setup lang="ts">
import type { CampaignId } from '#shared/tycoon'

/**
 * An ad campaign as a little picture: flyers, a billboard, a TV. Same style
 * as Illo and GameArt: a spotlight in the campaign's colour, gradient fills
 * lit from the top left, chunky ink outlines and a shine on every face.
 * `plain` leaves out the backdrop (for small badges).
 */
const props = defineProps<{ id: CampaignId, plain?: boolean }>()
const color = computed(() => campaignColor(props.id))
const uid = useId()
const INK = '#1b1329'
const mix = (other: string, share: number) => `color-mix(in oklab, ${color.value} ${share}%, ${other})`
const url = (id: string) => `url(#${uid}-${id})`

function star(cx: number, cy: number, r: number, inner = 0.45): string {
    return Array.from({ length: 10 }, (_, i) => {
        const radius = i % 2 ? r * inner : r
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`
    }).join(' ')
}

/** Marquee bulbs around the billboard. */
const bulbs: [number, number][] = [10, 18, 26, 34, 42, 50].map((x): [number, number] => [x + 2, 13])
</script>

<template>
  <svg viewBox="0 0 64 64" class="block size-full" aria-hidden="true">
    <defs>
      <radialGradient :id="`${uid}-bg`" gradientUnits="userSpaceOnUse" cx="32" cy="20" r="52">
        <stop offset="0" :style="{ stopColor: mix('#3b2c58', 60) }" />
        <stop offset="0.7" stop-color="#241a36" />
        <stop offset="1" stop-color="#140e1f" />
      </radialGradient>
      <linearGradient :id="`${uid}-gold`" x1="0" x2="0.4" y1="0" y2="1">
        <stop offset="0" stop-color="#fff3b0" />
        <stop offset="0.45" stop-color="#ffc93a" />
        <stop offset="1" stop-color="#d98a00" />
      </linearGradient>
      <linearGradient :id="`${uid}-red`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#ff8a9c" />
        <stop offset="0.5" stop-color="#ff3d5e" />
        <stop offset="1" stop-color="#b3123a" />
      </linearGradient>
      <linearGradient :id="`${uid}-paper`" x1="0" x2="0.3" y1="0" y2="1">
        <stop offset="0" stop-color="#ffffff" />
        <stop offset="1" stop-color="#e9ddf5" />
      </linearGradient>
      <linearGradient :id="`${uid}-cream`" x1="0" x2="0.3" y1="0" y2="1">
        <stop offset="0" stop-color="#fff4d6" />
        <stop offset="1" stop-color="#f2c98a" />
      </linearGradient>
      <linearGradient :id="`${uid}-case`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#d4b8ff" />
        <stop offset="0.5" stop-color="#a879ff" />
        <stop offset="1" stop-color="#6a3fc4" />
      </linearGradient>
      <radialGradient :id="`${uid}-screen`" cx="0.4" cy="0.35" r="0.8">
        <stop offset="0" stop-color="#bfe8ff" />
        <stop offset="0.55" stop-color="#4aa6ff" />
        <stop offset="1" stop-color="#1f5fc4" />
      </radialGradient>
      <linearGradient :id="`${uid}-post`" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#c9a27a" />
        <stop offset="1" stop-color="#7c5a3a" />
      </linearGradient>
      <radialGradient :id="`${uid}-glow`">
        <stop offset="0" stop-color="#fff3b0" stop-opacity="0.8" />
        <stop offset="1" stop-color="#ffc93a" stop-opacity="0" />
      </radialGradient>
    </defs>

    <template v-if="!plain">
      <rect x="-20" y="-20" width="104" height="104" :fill="url('bg')" />
      <path d="M-10 30 L30 -10 M4 64 L64 4 M24 84 L84 24" stroke="#fff" stroke-opacity="0.14" stroke-width="3.5" />
      <ellipse cx="32" cy="58" rx="22" ry="3.6" fill="black" opacity="0.4" />
    </template>

    <g :stroke="INK" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">
      <!-- Flyers fluttering out of a hand-out stack -->
      <template v-if="id === 'flyers'">
        <path d="M4 22 H11 M2 30 H9 M5 38 H10" stroke="#fff" stroke-opacity="0.75" stroke-width="2.4" />
        <g transform="rotate(-14 26 31)">
          <rect x="13" y="14" width="26" height="34" rx="3" :fill="url('cream')" />
          <rect x="16.5" y="18" width="19" height="6" rx="1.6" :fill="url('red')" stroke-width="1.4" />
          <path d="M18 30 H34 M18 35 H30" stroke-width="1.6" opacity="0.5" />
        </g>
        <g transform="rotate(9 38 33)">
          <rect x="24" y="13" width="28" height="39" rx="3" :fill="url('paper')" />
          <rect x="27.5" y="16.5" width="21" height="8" rx="2" :fill="url('red')" stroke-width="1.6" />
          <path d="M30 19.5 H40" stroke="#fff" stroke-opacity="0.7" stroke-width="1.4" />
          <polygon :points="star(38, 35, 7)" :fill="url('gold')" stroke-width="1.6" />
          <path d="M35.5 31.5 L37 30.5" stroke="#fff" stroke-opacity="0.9" stroke-width="1.3" />
          <path d="M29 45 H47 M32 48.5 H44" stroke-width="1.8" opacity="0.55" />
          <path d="M26.5 16 V49" stroke="#fff" stroke-opacity="0.8" stroke-width="1.6" />
        </g>
      </template>

      <!-- Billboard on posts, lamps shining down on a marquee sign -->
      <template v-else-if="id === 'billboard'">
        <rect x="18" y="40" width="5" height="20" rx="1.5" :fill="url('post')" />
        <rect x="41" y="40" width="5" height="20" rx="1.5" :fill="url('post')" />
        <path d="M14 10 L10 3 M50 10 L54 3" stroke-width="2" />
        <path d="M10 4 L3 20 L17 20 Z M54 4 L47 20 L61 20 Z" fill="#fff7c2" fill-opacity="0.45" stroke="none" />
        <circle cx="10" cy="4" r="2.2" :fill="url('gold')" stroke-width="1.4" />
        <circle cx="54" cy="4" r="2.2" :fill="url('gold')" stroke-width="1.4" />
        <rect x="3" y="10" width="58" height="34" rx="5" :fill="url('gold')" />
        <rect x="8" y="16" width="48" height="23" rx="2.5" :fill="url('red')" />
        <circle v-for="([x, y], i) in bulbs" :key="i" :cx="x" :cy="y" r="1.3" fill="#fff7c2" stroke="none" />
        <circle cx="20" cy="27.5" r="7.5" fill="#fff" />
        <circle cx="20" cy="27.5" r="7.5" fill="none" stroke="#e11d48" stroke-width="2.2" stroke-dasharray="3 2.9" />
        <circle cx="20" cy="27.5" r="3.6" :fill="url('gold')" stroke-width="1.4" />
        <path d="M32 22.5 H50 M32 28 H46 M32 33.5 H49" stroke="#fff" stroke-width="2.6" />
        <path d="M10 18 Q11 17 14 17" stroke="#fff" stroke-opacity="0.6" stroke-width="1.6" fill="none" />
        <path d="M5.5 13 V40" stroke="#fff" stroke-opacity="0.55" stroke-width="1.6" />
      </template>

      <!-- Retro TV with a star on screen -->
      <template v-else>
        <path d="M32 18 L22 5 M32 18 L43 6" stroke-width="2" />
        <circle cx="22" cy="5" r="2.4" :fill="url('red')" stroke-width="1.6" />
        <circle cx="43" cy="6" r="2.4" :fill="url('red')" stroke-width="1.6" />
        <rect x="14" y="53" width="7" height="7" rx="1.5" fill="#4a3a6b" />
        <rect x="43" y="53" width="7" height="7" rx="1.5" fill="#4a3a6b" />
        <rect x="5" y="17" width="54" height="39" rx="9" :fill="url('case')" />
        <rect x="10" y="22" width="35" height="29" rx="7" :fill="url('screen')" />
        <circle cx="27.5" cy="36.5" r="12" :fill="url('glow')" stroke="none" />
        <path d="M14 27 Q18 24 24 25" stroke="#fff" stroke-opacity="0.85" stroke-width="2" fill="none" />
        <polygon :points="star(27.5, 37, 8)" :fill="url('gold')" stroke-width="1.6" />
        <circle cx="52" cy="29" r="3.4" :fill="url('gold')" stroke-width="1.6" />
        <circle cx="52" cy="40" r="3.4" :fill="url('gold')" stroke-width="1.6" />
        <path d="M49 47.5 H55" stroke-width="1.6" />
        <path d="M9 22 Q9 20 11 19.5" stroke="#fff" stroke-opacity="0.6" stroke-width="1.6" fill="none" />
      </template>
    </g>
  </svg>
</template>
