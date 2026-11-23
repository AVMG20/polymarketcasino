<script setup lang="ts">
import type { CampaignId } from '#shared/tycoon'

/**
 * An ad campaign as a little picture: flyers, a billboard, a TV. `plain`
 * leaves out the coloured backdrop (for small badges).
 */
const props = defineProps<{ id: CampaignId, plain?: boolean }>()
const color = computed(() => campaignColor(props.id))
const uid = useId()
const INK = '#1b1329'

function star(cx: number, cy: number, r: number): string {
    return Array.from({ length: 10 }, (_, i) => {
        const radius = i % 2 ? r * 0.45 : r
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`
    }).join(' ')
}
</script>

<template>
  <svg viewBox="0 0 64 64" class="block size-full" aria-hidden="true">
    <defs>
      <radialGradient :id="`${uid}-bg`" cx="0.35" cy="0.25" r="0.9">
        <stop offset="0" :style="{ stopColor: `color-mix(in oklab, ${color} 55%, white)` }" />
        <stop offset="0.5" :style="{ stopColor: color }" />
        <stop offset="1" :style="{ stopColor: `color-mix(in oklab, ${color} 55%, black)` }" />
      </radialGradient>
    </defs>
    <template v-if="!plain">
      <rect width="64" height="64" :fill="`url(#${uid}-bg)`" />
      <path d="M-6 26 L26 -6 M8 70 L70 8" stroke="#fff" stroke-opacity="0.2" stroke-width="4" />
    </template>

    <g :stroke="INK" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">
      <!-- Flyers flying out -->
      <template v-if="id === 'flyers'">
        <path d="M5 22 H13 M3 30 H11 M6 38 H12" stroke="#fff" stroke-opacity="0.8" stroke-width="2.4" />
        <rect x="15" y="14" width="26" height="34" rx="3" fill="#ffe7b8" transform="rotate(-14 28 31)" />
        <g transform="rotate(9 38 33)">
          <rect x="24" y="14" width="28" height="38" rx="3" fill="#fff" />
          <rect x="27.5" y="17.5" width="21" height="8" rx="2" fill="#ff5470" stroke-width="1.6" />
          <polygon :points="star(38, 35, 6.5)" fill="#ffc93a" stroke-width="1.6" />
          <path d="M29 45 H47 M32 48.5 H44" stroke-width="1.8" opacity="0.6" />
        </g>
      </template>

      <!-- Billboard on posts with lamps -->
      <template v-else-if="id === 'billboard'">
        <path d="M21 42 V60 M43 42 V60" stroke-width="4" />
        <path d="M21 42 V60 M43 42 V60" stroke="#8a6a4a" stroke-width="1.6" />
        <path d="M14 10 L10 3 M50 10 L54 3" stroke-width="2" />
        <path d="M10 4 L4 18 L16 18 Z M54 4 L48 18 L60 18 Z" fill="#fff7c2" fill-opacity="0.55" stroke="none" />
        <rect x="4" y="12" width="56" height="32" rx="4" fill="#ffc93a" />
        <rect x="8" y="16" width="48" height="24" rx="2" fill="#ff5470" />
        <circle cx="20" cy="28" r="7.5" fill="#fff" />
        <circle cx="20" cy="28" r="7.5" fill="none" stroke="#e11d48" stroke-width="2.2" stroke-dasharray="3 2.9" />
        <circle cx="20" cy="28" r="3.6" fill="#ffc93a" stroke-width="1.4" />
        <path d="M32 23 H50 M32 29 H46 M32 35 H49" stroke="#fff" stroke-width="2.6" />
      </template>

      <!-- Retro TV -->
      <template v-else>
        <path d="M32 18 L22 5 M32 18 L43 6" stroke-width="2" />
        <circle cx="22" cy="5" r="2.2" fill="#ff5470" stroke-width="1.6" />
        <circle cx="43" cy="6" r="2.2" fill="#ff5470" stroke-width="1.6" />
        <rect x="14" y="54" width="7" height="6" rx="1.5" fill="#4a3a6b" />
        <rect x="43" y="54" width="7" height="6" rx="1.5" fill="#4a3a6b" />
        <rect x="5" y="17" width="54" height="39" rx="9" fill="#a879ff" />
        <rect x="10" y="22" width="35" height="29" rx="7" fill="#4aa6ff" />
        <path d="M14 27 Q18 24 24 25" stroke="#fff" stroke-opacity="0.8" stroke-width="2" fill="none" />
        <polygon :points="star(27.5, 37, 8)" fill="#ffc93a" stroke-width="1.6" />
        <circle cx="52" cy="29" r="3.2" fill="#ffc93a" stroke-width="1.6" />
        <circle cx="52" cy="40" r="3.2" fill="#ffc93a" stroke-width="1.6" />
        <path d="M49 47 H55" stroke-width="1.6" />
      </template>
    </g>
  </svg>
</template>
