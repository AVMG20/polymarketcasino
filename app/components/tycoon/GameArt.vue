<script setup lang="ts">
import { findTycoonGame } from '#shared/tycoon'

/**
 * A game as a little illustration: its machine or table (by archetype) in
 * the game's accent colour, under a spotlight. Slots show their own symbol
 * three times on the reels, so the cabinets tell apart.
 */
const props = defineProps<{ slug: string }>()
const def = computed(() => findTycoonGame(props.slug))
const accent = computed(() => def.value?.accent ?? '#a879ff')
const archetype = computed(() => def.value?.archetype ?? 'slot')
const uid = useId()

const INK = '#1b1329'
const SYMBOL: Record<string, string> = {
    spinata: 'cherry',
    trashpanda: 'clover',
    fireinthehole: 'flame',
    candymadness: 'heart',
    bookofshadows: 'diamond',
    xenoslot: 'star',
    emberportals: 'seven',
    aethergates: 'crown'
}
const symbol = computed(() => SYMBOL[props.slug] ?? 'seven')

/** `share` of the accent mixed with `other` (CSS color-mix, used as a style fill). */
const mix = (other: string, share: number) => `color-mix(in oklab, ${accent.value} ${share}%, ${other})`

function star(cx: number, cy: number, r: number, inner = 0.45): string {
    return Array.from({ length: 10 }, (_, i) => {
        const radius = i % 2 ? r * inner : r
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`
    }).join(' ')
}

/** Pie slices of a wheel: `count` paths around (cx, cy). */
function slices(cx: number, cy: number, r: number, count: number) {
    return Array.from({ length: count }, (_, i) => {
        const a0 = (i / count) * Math.PI * 2 - Math.PI / 2
        const a1 = ((i + 1) / count) * Math.PI * 2 - Math.PI / 2
        const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
        return `M${cx} ${cy} L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`
    })
}
const wheelSlices = slices(50, 50, 30, 8)
const rouletteSlices = slices(50, 50, 28, 12)

/** Pegfall: rows of pegs, 3 to 7 wide, and the prize slots under them (hot in the corners). */
const plinkoPegs = [3, 4, 5, 6, 7].flatMap((count, row) => Array.from({ length: count }, (_, i) => [50 + (i - (count - 1) / 2) * 8, 22 + row * 9.5] as const))
const plinkoSlots = ['#ff5470', '#ff9a2e', '#ffc93a', '#ff9a2e', '#ff5470']
/** Gem Dig: 5×5 tiles, row by row; 'open' tiles are dug (two show gems, one a bomb). */
const minesTiles = Array.from({ length: 25 }, (_, i) => ([6, 13, 15, 19, 21].includes(i) ? 'open' : 'dirt'))
</script>

<template>
  <svg viewBox="0 0 100 100" class="block size-full" aria-hidden="true">
    <defs>
      <radialGradient :id="`${uid}-bg`" cx="0.5" cy="0.32" r="0.8">
        <stop offset="0" :style="{ stopColor: mix('#3b2c58', 55) }" />
        <stop offset="0.7" stop-color="#241a36" />
        <stop offset="1" stop-color="#140e1f" />
      </radialGradient>
      <linearGradient :id="`${uid}-body`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" :style="{ stopColor: mix('white', 72) }" />
        <stop offset="0.55" :style="{ stopColor: accent }" />
        <stop offset="1" :style="{ stopColor: mix('black', 70) }" />
      </linearGradient>
      <g :id="`${uid}-sym`">
        <template v-if="symbol === 'cherry'">
          <path d="M3 5 Q4.5 0.5 8 1 M7 5.5 Q6.5 2.5 8 1" fill="none" stroke="#16a34a" stroke-width="1.1" stroke-linecap="round" />
          <circle cx="3" cy="6.8" r="2.4" fill="#ef4444" :stroke="INK" stroke-width="0.8" />
          <circle cx="7" cy="7.3" r="2.4" fill="#ef4444" :stroke="INK" stroke-width="0.8" />
        </template>
        <g v-else-if="symbol === 'clover'" :stroke="INK" stroke-width="0.8" fill="#22c55e">
          <path d="M5 6 L6.5 9.5" fill="none" stroke="#15803d" stroke-width="1.2" />
          <circle cx="5" cy="2.6" r="2" /><circle cx="2.6" cy="5" r="2" /><circle cx="7.4" cy="5" r="2" /><circle cx="5" cy="5" r="1.4" stroke="none" />
        </g>
        <g v-else-if="symbol === 'flame'">
          <path d="M5 0.5 C8.5 3.5 9.3 6.2 7.6 8.6 C6.4 10.2 3.6 10.2 2.4 8.6 C0.8 6.3 2.6 4.4 3.4 2.4 C4.4 4 5.2 3.8 5 0.5 Z" fill="#f97316" :stroke="INK" stroke-width="0.8" />
          <path d="M5 5 C6.6 6.4 6.8 7.6 6 8.5 C5.4 9.1 4.4 9.1 4 8.5 C3.4 7.5 4.4 6.6 5 5 Z" fill="#fde047" />
        </g>
        <path v-else-if="symbol === 'heart'" d="M5 9.2 C1 6.3 0 4.2 1.2 2.4 C2.5 0.8 4.4 1.3 5 3 C5.6 1.3 7.5 0.8 8.8 2.4 C10 4.2 9 6.3 5 9.2 Z" fill="#ec4899" :stroke="INK" stroke-width="0.8" />
        <g v-else-if="symbol === 'diamond'" :stroke="INK" stroke-width="0.8" stroke-linejoin="round">
          <polygon points="1.5,3.6 3.6,1.2 6.4,1.2 8.5,3.6 5,9" fill="#67e8f9" />
          <polyline points="1.5,3.6 8.5,3.6" fill="none" />
        </g>
        <polygon v-else-if="symbol === 'star'" :points="star(5, 5.3, 4.6)" fill="#facc15" :stroke="INK" stroke-width="0.8" stroke-linejoin="round" />
        <polygon v-else-if="symbol === 'crown'" points="1,8.5 1,2.8 3.2,5.2 5,1.6 6.8,5.2 9,2.8 9,8.5" fill="#fbbf24" :stroke="INK" stroke-width="0.8" stroke-linejoin="round" />
        <path v-else d="M1.8 1.4 H8.4 V3 L5.2 9.2 H2.8 L5.9 3.2 H1.8 Z" fill="#ef4444" :stroke="INK" stroke-width="0.8" stroke-linejoin="round" />
      </g>
    </defs>

    <rect width="100" height="100" :fill="`url(#${uid}-bg)`" />
    <g opacity="0.18" stroke="white" stroke-width="5">
      <path d="M-10 40 L40 -10 M10 110 L110 10" />
    </g>
    <ellipse cx="50" cy="90" rx="34" ry="6" fill="black" opacity="0.4" />

    <g :stroke="INK" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
      <!-- Slot cabinet -->
      <template v-if="archetype === 'slot'">
        <rect x="31" y="8" width="38" height="14" rx="7" fill="#ffc93a" />
        <circle v-for="x in [39, 46, 54, 61]" :key="x" :cx="x" cy="15" r="2.2" fill="#fff7c2" stroke-width="1.4" />
        <path d="M76 52 L84 30" fill="none" stroke="#c9b8e8" stroke-width="3.2" />
        <circle cx="85" cy="27" r="5" fill="#ff5470" />
        <rect x="22" y="20" width="56" height="68" rx="10" :fill="`url(#${uid}-body)`" />
        <rect x="28" y="31" width="44" height="26" rx="5" fill="#fff" />
        <line x1="42.7" y1="31" x2="42.7" y2="57" stroke-width="1.8" />
        <line x1="57.3" y1="31" x2="57.3" y2="57" stroke-width="1.8" />
        <use v-for="x in [30.3, 45, 59.7]" :key="x" :href="`#${uid}-sym`" :transform="`translate(${x} 37.5) scale(1.25)`" stroke="none" />
        <rect x="30" y="64" width="40" height="15" rx="4" fill="#241a36" />
        <ellipse cx="50" cy="73" rx="12" ry="3.2" fill="#ffc93a" stroke-width="1.6" />
      </template>

      <!-- Dice on felt -->
      <template v-else-if="archetype === 'dice'">
        <ellipse cx="50" cy="72" rx="40" ry="16" :style="{ fill: mix('black', 70) }" />
        <ellipse cx="50" cy="69" rx="40" ry="16" :style="{ fill: accent }" />
        <g transform="rotate(-14 34 50)">
          <rect x="18" y="34" width="32" height="32" rx="7" fill="#fff" />
          <g fill="#ef4444" stroke="none"><circle cx="26" cy="42" r="3.2" /><circle cx="34" cy="50" r="3.2" /><circle cx="42" cy="58" r="3.2" /></g>
        </g>
        <g transform="rotate(12 66 46)">
          <rect x="51" y="30" width="30" height="30" rx="7" fill="#fff" />
          <g :fill="INK" stroke="none"><circle cx="59" cy="38" r="3" /><circle cx="73" cy="38" r="3" /><circle cx="59" cy="52" r="3" /><circle cx="73" cy="52" r="3" /></g>
        </g>
      </template>

      <!-- Rocket climbing a multiplier curve -->
      <template v-else-if="archetype === 'rocket'">
        <path d="M12 84 Q48 82 70 30" fill="none" :style="{ stroke: accent }" stroke-width="4" stroke-dasharray="2 7" />
        <g transform="rotate(35 66 36)">
          <path d="M60 58 Q66 74 72 58 Z" fill="#ff9a2e" />
          <path d="M62 58 Q66 68 70 58 Z" fill="#fde047" stroke="none" />
          <path d="M57 50 L50 60 L58 58 Z M75 50 L82 60 L74 58 Z" :style="{ fill: mix('black', 70) }" />
          <path d="M66 12 C77 22 78 44 74 58 H58 C54 44 55 22 66 12 Z" :fill="`url(#${uid}-body)`" />
          <circle cx="66" cy="34" r="6" fill="#bfeaff" />
        </g>
        <polygon :points="star(22, 22, 6)" fill="#ffc93a" stroke-width="1.6" />
        <polygon :points="star(84, 74, 4)" fill="#fff7c2" stroke-width="1.4" />
      </template>

      <!-- Prize wheel -->
      <template v-else-if="archetype === 'wheel'">
        <path d="M40 82 L50 66 L60 82 Z" fill="#4a3a6b" />
        <circle cx="50" cy="50" r="35" fill="#ffc93a" />
        <path v-for="(d, i) in wheelSlices" :key="i" :d="d" :style="{ fill: i % 2 ? '#fff7ea' : accent }" stroke-width="1.6" />
        <circle cx="50" cy="50" r="30" fill="none" />
        <circle v-for="i in 8" :key="`b${i}`" :cx="50 + 32.5 * Math.cos((i / 8) * Math.PI * 2)" :cy="50 + 32.5 * Math.sin((i / 8) * Math.PI * 2)" r="1.6" fill="#fff" stroke="none" />
        <circle cx="50" cy="50" r="7" fill="#ff5470" />
        <path d="M44 6 H56 L50 18 Z" fill="#ff5470" />
      </template>

      <!-- Jet with a contrail -->
      <template v-else-if="archetype === 'flight'">
        <path d="M8 76 Q30 70 46 54" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="5" />
        <polygon :points="star(80, 20, 5)" fill="#ffc93a" stroke-width="1.5" />
        <g transform="rotate(-38 56 46)">
          <path d="M50 46 L38 26 H46 L64 44 Z" :style="{ fill: mix('black', 75) }" />
          <path d="M50 52 L38 70 H46 L64 54 Z" :style="{ fill: mix('black', 75) }" />
          <path d="M22 49 L16 40 H22 L30 46 Z" :style="{ fill: mix('black', 75) }" />
          <path d="M18 44 H72 C82 44 88 47 88 49 C88 51 82 54 72 54 H18 Q14 49 18 44 Z" :fill="`url(#${uid}-body)`" />
          <path d="M74 45.5 C80 45.5 84 47.5 84 49 H72 Z" fill="#bfeaff" stroke-width="1.6" />
        </g>
      </template>

      <!-- A hand of cards and a magic sparkle -->
      <template v-else-if="archetype === 'hands'">
        <g v-for="(angle, i) in [-24, -8, 8, 24]" :key="i" :transform="`rotate(${angle} 50 92)`">
          <rect x="35" y="26" width="30" height="44" rx="5" :fill="i === 3 ? '#fff' : i % 2 ? '#fff7ea' : `url(#${uid}-body)`" />
          <template v-if="i === 3">
            <path d="M50 38 C44 44 42 48 46 51 C48 52.5 49.5 51.5 50 50 C50.5 51.5 52 52.5 54 51 C58 48 56 44 50 38 Z" :style="{ fill: accent }" stroke-width="1.6" />
            <path d="M48.5 50 L47 58 H53 L51.5 50" :style="{ fill: accent }" stroke-width="1.6" />
          </template>
        </g>
        <polygon :points="star(80, 18, 8)" fill="#ffc93a" stroke-width="1.8" />
        <polygon :points="star(18, 26, 4.5)" fill="#fff7c2" stroke-width="1.4" />
      </template>

      <!-- Roulette from above -->
      <template v-else-if="archetype === 'roulette'">
        <circle cx="50" cy="50" r="38" fill="#7a4a1d" />
        <circle cx="50" cy="50" r="33" fill="#ffc93a" />
        <path v-for="(d, i) in rouletteSlices" :key="i" :d="d" :fill="i % 2 ? '#241a36' : '#e11d48'" stroke-width="1.2" />
        <circle cx="50" cy="50" r="15" :style="{ fill: mix('#16a34a', 25) }" />
        <path d="M50 38 V62 M38 50 H62" stroke="#ffc93a" stroke-width="3" />
        <circle cx="50" cy="50" r="4.5" fill="#ffc93a" />
        <circle cx="70" cy="28" r="4" fill="#fff" stroke-width="1.8" />
      </template>

      <!-- Pegfall: an upright peg board, a ball dropping into the prize slots -->
      <template v-else-if="archetype === 'plinko'">
        <rect x="18" y="8" width="64" height="80" rx="10" :fill="`url(#${uid}-body)`" />
        <rect x="24" y="14" width="52" height="56" rx="6" fill="#241a36" />
        <circle v-for="(peg, i) in plinkoPegs" :key="i" :cx="peg[0]" :cy="peg[1]" r="1.9" fill="#fff7ea" stroke="none" />
        <path d="M50 17 Q47 26 52 33 Q57 41 50 50" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="1.6" stroke-dasharray="2 3" />
        <circle cx="50" cy="52" r="4.2" fill="#ffc93a" stroke-width="1.8" />
        <circle cx="48.8" cy="50.8" r="1.2" fill="#fff" stroke="none" />
        <g stroke-width="1.6">
          <rect v-for="(slot, i) in plinkoSlots" :key="`s${i}`" :x="25 + i * 10.2" y="72" width="9" height="10" rx="2.2" :fill="slot" />
        </g>
      </template>

      <!-- Gem Dig: a grid of dirt tiles, a few dug up -->
      <template v-else-if="archetype === 'mines'">
        <rect x="12" y="16" width="76" height="72" rx="9" :style="{ fill: mix('black', 70) }" />
        <rect x="12" y="12" width="76" height="72" rx="9" :fill="`url(#${uid}-body)`" />
        <g stroke-width="1.5">
          <template v-for="(tile, i) in minesTiles" :key="i">
            <rect :x="17.5 + (i % 5) * 13.2" :y="17.5 + Math.floor(i / 5) * 12.6" width="11.4" height="10.8" rx="2.4" :fill="tile === 'dirt' ? '#8a5a2b' : '#241a36'" />
            <path v-if="tile === 'dirt'" :d="`M${19.5 + (i % 5) * 13.2} ${20.5 + Math.floor(i / 5) * 12.6} h7`" stroke="#b07a42" stroke-width="1.4" />
          </template>
        </g>
        <!-- A gem and a bomb in the open tiles -->
        <g transform="translate(32.3 31.3)" stroke-width="1.2" stroke-linejoin="round">
          <polygon points="0.6,2.6 2.6,0.4 6.6,0.4 8.6,2.6 4.6,8.4" fill="#34d399" />
          <polyline points="0.6,2.6 8.6,2.6" fill="none" />
        </g>
        <g transform="translate(71.4 55.8)" stroke-width="1.2">
          <circle cx="4.6" cy="5" r="3.6" fill="#ff5470" />
          <path d="M6.6 2 L8.2 0.4" fill="none" />
        </g>
        <g transform="translate(32.3 69.2)" stroke-width="1.2" stroke-linejoin="round">
          <polygon points="0.6,2.6 2.6,0.4 6.6,0.4 8.6,2.6 4.6,8.4" fill="#67e8f9" />
          <polyline points="0.6,2.6 8.6,2.6" fill="none" />
        </g>
        <polygon :points="star(84, 12, 6)" fill="#ffc93a" stroke-width="1.6" />
      </template>

      <!-- Card Climb: one big card, higher or lower -->
      <template v-else-if="archetype === 'hilo'">
        <ellipse cx="50" cy="80" rx="40" ry="11" :style="{ fill: accent }" />
        <rect x="14" y="40" width="20" height="28" rx="3.5" fill="#fff7ea" transform="rotate(-12 24 54)" />
        <rect x="30" y="14" width="40" height="58" rx="6" fill="#fff" />
        <text x="35" y="29" font-size="13" font-weight="900" :fill="INK" stroke="none" font-family="ui-rounded, sans-serif">7</text>
        <path d="M50 34 C42 42 40 47 44 50 C46.5 51.8 48.6 50.6 49.3 49 L47.5 56 H52.5 L50.7 49 C51.4 50.6 53.5 51.8 56 50 C60 47 58 42 50 34 Z" :fill="INK" stroke="none" />
        <g stroke-width="2.2">
          <path d="M80 34 L88 44 H83 V54 H77 V44 H72 Z" fill="#3fd25a" />
          <path d="M80 86 L88 76 H83 V66 H77 V76 H72 Z" fill="#ff5470" transform="translate(0 -6)" />
        </g>
      </template>

      <!-- Card table -->
      <template v-else>
        <path d="M6 58 Q50 30 94 58 V66 Q50 40 6 66 Z" fill="#7a4a1d" />
        <path d="M10 60 Q50 36 90 60 L90 88 H10 Z" :style="{ fill: accent }" />
        <path d="M22 72 Q50 56 78 72" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="1.6" stroke-dasharray="3 3" />
        <g transform="rotate(-10 40 46)">
          <rect x="27" y="28" width="24" height="34" rx="4" fill="#fff" />
          <text x="31" y="40" font-size="10" font-weight="900" :fill="INK" stroke="none" font-family="ui-rounded, sans-serif">A</text>
          <path d="M39 45 C35 49 34 52 37 54 C38.5 55 39.5 54 39.8 53 C40 54 41 55 42.6 54 C45.5 52 44 49 39 45 Z" :fill="INK" stroke="none" />
        </g>
        <g transform="rotate(10 62 46)">
          <rect x="50" y="30" width="24" height="34" rx="4" fill="#fff" />
          <text x="54" y="42" font-size="10" font-weight="900" fill="#e11d48" stroke="none" font-family="ui-rounded, sans-serif">K</text>
          <path d="M62 56 C57 52 56 49 58 47.4 C59.6 46 61.4 46.8 62 48.4 C62.6 46.8 64.4 46 66 47.4 C68 49 67 52 62 56 Z" fill="#e11d48" stroke="none" />
        </g>
        <g v-for="(x, i) in [22, 78]" :key="x">
          <ellipse :cx="x" cy="80" rx="8" ry="3.5" :fill="i ? '#ffc93a' : '#ff5470'" />
          <ellipse :cx="x" cy="76" rx="8" ry="3.5" :fill="i ? '#ffc93a' : '#ff5470'" />
        </g>
      </template>
    </g>
  </svg>
</template>
