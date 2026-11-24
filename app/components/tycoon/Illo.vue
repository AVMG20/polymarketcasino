<script setup lang="ts">
import type { IlloName } from '~/utils/tycoon-art'

/**
 * The hand-drawn pictures of everything that isn't a game: the zones, the
 * upgrades and the gem shop's items. Same style as GameArt: a spotlight in
 * the item's colour, chunky ink outlines, light from the top left.
 * `plain` leaves out the backdrop (for a picture on a coloured badge). The
 * backdrop bleeds past the square, so the picture can sit in a wider box.
 */
const props = defineProps<{ name: IlloName, color?: string, plain?: boolean }>()
const accent = computed(() => props.color ?? '#a879ff')
const uid = useId()
const INK = '#1b1329'
const mix = (other: string, share: number) => `color-mix(in oklab, ${accent.value} ${share}%, ${other})`
const url = (id: string) => `url(#${uid}-${id})`

function star(cx: number, cy: number, r: number, inner = 0.45): string {
    return Array.from({ length: 10 }, (_, i) => {
        const radius = i % 2 ? r * inner : r
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`
    }).join(' ')
}

/** Marquee bulbs around a rounded sign. */
const marquee: [number, number][] = [26, 34, 42, 50, 58, 66, 74].flatMap((x): [number, number][] => [[x, 13.5], [x, 33.5]]).concat([[21, 23.5], [79, 23.5]])
/** Chandelier candles and crystal drops. */
const candles: [number, number][] = [[14, 46], [28, 38], [72, 38], [86, 46]]
const drops: [number, number][] = [[24, 58], [38, 64], [50, 72], [62, 64], [76, 58]]
/** Penthouse windows: lit or dark, row by row. */
const towerWindows = Array.from({ length: 15 }, (_, i) => ({ x: 36 + (i % 3) * 10, y: 36 + Math.floor(i / 3) * 10, lit: ![4, 9, 11].includes(i) }))
</script>

<template>
  <svg viewBox="0 0 100 100" class="block size-full" aria-hidden="true">
    <defs>
      <radialGradient :id="`${uid}-bg`" gradientUnits="userSpaceOnUse" cx="50" cy="32" r="80">
        <stop offset="0" :style="{ stopColor: mix('#3b2c58', 55) }" />
        <stop offset="0.7" stop-color="#241a36" />
        <stop offset="1" stop-color="#140e1f" />
      </radialGradient>
      <linearGradient :id="`${uid}-acc`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" :style="{ stopColor: mix('white', 65) }" />
        <stop offset="0.55" :style="{ stopColor: accent }" />
        <stop offset="1" :style="{ stopColor: mix('black', 68) }" />
      </linearGradient>
      <linearGradient :id="`${uid}-gold`" x1="0" x2="0.4" y1="0" y2="1">
        <stop offset="0" stop-color="#fff3b0" />
        <stop offset="0.45" stop-color="#ffc93a" />
        <stop offset="1" stop-color="#d98a00" />
      </linearGradient>
      <linearGradient :id="`${uid}-wood`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#e3a66c" />
        <stop offset="0.5" stop-color="#b9784a" />
        <stop offset="1" stop-color="#7c4a2d" />
      </linearGradient>
      <linearGradient :id="`${uid}-steel`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#eef1ff" />
        <stop offset="1" stop-color="#8f96b8" />
      </linearGradient>
      <linearGradient :id="`${uid}-red`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#ff8a9c" />
        <stop offset="0.5" stop-color="#ff3d5e" />
        <stop offset="1" stop-color="#b3123a" />
      </linearGradient>
      <linearGradient :id="`${uid}-night`" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#4a3d80" />
        <stop offset="1" stop-color="#211845" />
      </linearGradient>
      <radialGradient :id="`${uid}-glow`">
        <stop offset="0" stop-color="#fff3b0" stop-opacity="0.85" />
        <stop offset="1" stop-color="#ffc93a" stop-opacity="0" />
      </radialGradient>
    </defs>

    <template v-if="!plain">
      <!-- Bleeds past the square, so a wider box (the gem shop's 4:3 tiles) stays filled. -->
      <rect x="-60" y="-60" width="220" height="220" :fill="url('bg')" />
      <path d="M-40 70 L70 -40 M-10 40 L40 -10 M10 110 L110 10 M40 140 L140 40" stroke="white" stroke-opacity="0.16" stroke-width="5" />
      <ellipse cx="50" cy="90" rx="36" ry="6" fill="black" opacity="0.4" />
    </template>

    <g :stroke="INK" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
      <!-- Back Room: a wooden staff door under a bare bulb, a crate by the wall -->
      <template v-if="name === 'backroom'">
        <rect x="12" y="20" width="76" height="68" rx="6" fill="#8a4b3c" />
        <g stroke="#6b3528" stroke-width="1.6" opacity="0.9">
          <path d="M14 34 H86 M14 48 H86 M14 62 H86 M14 76 H86" />
          <path d="M24 20 V34 M44 20 V34 M64 34 V48 M20 48 V62 M80 48 V62 M26 62 V76 M74 76 V88" />
        </g>
        <circle cx="50" cy="20" r="20" :fill="url('glow')" stroke="none" />
        <rect x="32" y="32" width="36" height="56" rx="4" :fill="url('wood')" />
        <rect x="37" y="37" width="26" height="20" rx="2.5" fill="#9c6038" stroke-width="1.8" />
        <rect x="37" y="61" width="26" height="22" rx="2.5" fill="#9c6038" stroke-width="1.8" />
        <path d="M39 39.5 H52" stroke="#fff" stroke-opacity="0.35" stroke-width="1.8" />
        <circle cx="61" cy="59" r="3" :fill="url('gold')" stroke-width="1.6" />
        <path d="M50 4 V14" stroke-width="1.8" />
        <rect x="46.5" y="13" width="7" height="4" rx="1" fill="#6b5a8e" stroke-width="1.6" />
        <circle cx="50" cy="21" r="5" fill="#fff3b0" stroke-width="2" />
        <circle cx="48.5" cy="19.5" r="1.4" fill="#fff" stroke="none" />
        <rect x="10" y="68" width="20" height="20" rx="2" :fill="url('wood')" />
        <path d="M10 68 L30 88 M30 68 L10 88" stroke-width="2" />
        <rect x="74" y="74" width="16" height="14" rx="2" fill="#c98d5a" />
      </template>

      <!-- Main Floor: a storefront under a marquee, striped awning, lit windows -->
      <template v-else-if="name === 'main'">
        <rect x="14" y="34" width="72" height="54" rx="4" :fill="url('acc')" />
        <rect x="20" y="56" width="14" height="14" rx="2" fill="#ffe27a" stroke-width="2" />
        <rect x="66" y="56" width="14" height="14" rx="2" fill="#ffe27a" stroke-width="2" />
        <path d="M27 56 V70 M20 63 H34 M73 56 V70 M66 63 H80" stroke-width="1.6" />
        <rect x="40" y="58" width="20" height="30" rx="2" fill="#bfeaff" />
        <path d="M50 58 V88" stroke-width="1.8" />
        <path d="M42 61 V70" stroke="#fff" stroke-width="2" stroke-opacity="0.8" />
        <!-- Awning -->
        <g stroke-width="2">
          <path v-for="i in 6" :key="i" :d="`M${14 + (i - 1) * 12} 38 h12 v8 a6 5 0 0 1 -12 0 Z`" :fill="i % 2 ? '#ff5470' : '#fff7ea'" />
        </g>
        <!-- Marquee -->
        <rect x="16" y="8" width="68" height="31" rx="9" fill="#ff5470" />
        <rect x="22" y="15" width="56" height="17" rx="5" fill="#2a1b3d" stroke-width="1.8" />
        <polygon :points="star(50, 23.5, 7)" :fill="url('gold')" stroke-width="1.6" />
        <polygon :points="star(33, 23.5, 3.6)" fill="#ffe27a" stroke-width="1.2" />
        <polygon :points="star(67, 23.5, 3.6)" fill="#ffe27a" stroke-width="1.2" />
        <circle v-for="([x, y], i) in marquee" :key="i" :cx="x" :cy="y - 2" r="1.7" fill="#fff7c2" stroke="none" />
      </template>

      <!-- Table Pit: a felt table with a spade, cards and chip stacks -->
      <template v-else-if="name === 'pit'">
        <ellipse cx="50" cy="68" rx="44" ry="22" fill="#7a4a1d" />
        <ellipse cx="50" cy="65" rx="44" ry="22" :fill="url('wood')" />
        <ellipse cx="50" cy="64" rx="37" ry="16.5" fill="#1f9d55" />
        <ellipse cx="50" cy="64" rx="37" ry="16.5" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="1.4" stroke-dasharray="3 3" transform="scale(0.85) translate(8.8 11.3)" />
        <path d="M50 54 C43 60 40 64 44 68 C46.5 70 49 69 49.6 67.2 L48 73 H52 L50.4 67.2 C51 69 53.5 70 56 68 C60 64 57 60 50 54 Z" fill="#43c47a" stroke="none" />
        <g transform="rotate(-12 40 38)">
          <rect x="29" y="22" width="22" height="31" rx="3.5" fill="#fff" />
          <path d="M40 29 C35.5 33 34.5 35.5 37 37.3 C38.4 38.3 39.6 37.6 39.8 36.6 L38.8 40.5 H41.2 L40.2 36.6 C40.4 37.6 41.6 38.3 43 37.3 C45.5 35.5 44.5 33 40 29 Z" :fill="INK" stroke="none" />
        </g>
        <g transform="rotate(10 60 38)">
          <rect x="49" y="22" width="22" height="31" rx="3.5" fill="#fff" />
          <path d="M60 41 C55.5 37.6 54.5 35 56 33.4 C57.5 32 59.3 32.6 60 34 C60.7 32.6 62.5 32 64 33.4 C65.5 35 64.5 37.6 60 41 Z" fill="#e11d48" stroke="none" />
        </g>
        <g v-for="([x, c], i) in [[20, '#ff5470'], [80, '#4aa6ff']] as const" :key="i" stroke-width="1.8">
          <ellipse :cx="x" cy="72" rx="8" ry="3.6" :fill="c" />
          <ellipse :cx="x" cy="67.5" rx="8" ry="3.6" :fill="c" />
          <ellipse :cx="x" cy="63" rx="8" ry="3.6" :fill="c" />
          <ellipse :cx="x" cy="63" rx="4.5" ry="1.8" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="1.2" stroke-dasharray="2 1.6" />
        </g>
      </template>

      <!-- Lounge: a cocktail with a cherry, a velvet booth and a music note -->
      <template v-else-if="name === 'lounge'">
        <path d="M10 88 V52 Q10 40 22 40 H78 Q90 40 90 52 V88 Z" :fill="url('acc')" />
        <path d="M24 40 V82 M50 40 V82 M76 40 V82" stroke-width="1.6" opacity="0.55" />
        <circle v-for="(x, i) in [37, 63]" :key="i" :cx="x" cy="54" r="1.8" fill="#ffe27a" stroke-width="1" />
        <ellipse cx="50" cy="84" rx="16" ry="4.5" :fill="url('steel')" />
        <path d="M50 54 V82" stroke-width="5" />
        <path d="M50 54 V82" stroke="#e6ecff" stroke-width="2" />
        <path d="M20 14 H80 L50 56 Z" fill="#ffffff" fill-opacity="0.85" />
        <path d="M26.5 21 H73.5 L50 50 Z" fill="#ff6fb1" stroke-width="2" />
        <path d="M30 24 L45 42" stroke="#fff" stroke-opacity="0.7" stroke-width="2.4" />
        <path d="M60 8 Q58 18 56 26" fill="none" stroke-width="2" />
        <circle cx="56" cy="27" r="5" fill="#e11d48" />
        <circle cx="54.3" cy="25.3" r="1.4" fill="#fff" stroke="none" />
        <g transform="translate(76 8)" stroke-width="2">
          <path d="M4 18 V4 L14 1 V15" fill="none" />
          <ellipse cx="1.8" cy="18" rx="3.4" ry="2.6" fill="#ffc93a" />
          <ellipse cx="11.8" cy="15" rx="3.4" ry="2.6" fill="#ffc93a" />
        </g>
      </template>

      <!-- High Limit: a velvet rope between gold posts, a VIP door with a crown -->
      <template v-else-if="name === 'highlimit'">
        <path d="M28 88 V30 Q28 10 50 10 Q72 10 72 30 V88 Z" :fill="url('acc')" />
        <path d="M34 86 V32 Q34 17 50 17 Q66 17 66 32 V86" fill="#2a1b3d" stroke-width="2" />
        <polygon points="38,46 38,30 44,37 50,26 56,37 62,30 62,46" :fill="url('gold')" stroke-width="2" />
        <circle cx="50" cy="40" r="2.2" fill="#ff5470" stroke-width="1.2" />
        <path d="M38 29 Q40 22 50 21" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="2" />
        <!-- Rope -->
        <path d="M20 54 Q50 80 80 54" fill="none" stroke-width="9" />
        <path d="M20 54 Q50 80 80 54" fill="none" stroke="#d6264b" stroke-width="5.4" />
        <path d="M27 59 Q50 76 73 59" fill="none" stroke="#ff8a9c" stroke-width="1.6" stroke-opacity="0.8" />
        <g v-for="x in [20, 80]" :key="x">
          <ellipse :cx="x" cy="86" rx="10" ry="3.6" :fill="url('gold')" />
          <rect :x="x - 3" y="52" width="6" height="34" rx="2" :fill="url('gold')" />
          <circle :cx="x" cy="48" r="5.5" :fill="url('gold')" />
          <circle :cx="x - 1.6" :cy="46.4" r="1.5" fill="#fff" stroke="none" />
        </g>
      </template>

      <!-- Penthouse: a tower at night with a gold crown on top -->
      <template v-else-if="name === 'penthouse'">
        <circle cx="82" cy="18" r="8" fill="#fff3c4" stroke-width="2" />
        <circle cx="86" cy="15" r="7" :fill="mix('#241a36', 30)" stroke="none" />
        <polygon :points="star(16, 16, 3.6)" fill="#fff7c2" stroke-width="1.2" />
        <polygon :points="star(70, 34, 2.6)" fill="#fff7c2" stroke-width="1" />
        <rect x="10" y="54" width="20" height="34" rx="2" fill="#2e2457" />
        <rect x="70" y="46" width="20" height="42" rx="2" fill="#2e2457" />
        <g stroke="none" fill="#ffd56a" opacity="0.75">
          <rect x="14" y="60" width="4" height="4" /><rect x="22" y="68" width="4" height="4" /><rect x="74" y="52" width="4" height="4" /><rect x="82" y="64" width="4" height="4" /><rect x="74" y="74" width="4" height="4" />
        </g>
        <rect x="30" y="28" width="40" height="60" rx="3" :fill="url('night')" />
        <rect v-for="(w, i) in towerWindows" :key="i" :x="w.x" :y="w.y" width="6" height="6" rx="1" :fill="w.lit ? '#ffd56a' : '#1a1338'" stroke-width="1.2" />
        <rect x="26" y="20" width="48" height="10" rx="3" :fill="url('gold')" />
        <polygon points="36,20 35,6 43,13 50,2 57,13 65,6 64,20" :fill="url('gold')" stroke-width="2.2" />
        <circle cx="50" cy="12" r="2.4" fill="#ff5470" stroke-width="1.2" />
        <path d="M30 23 H48" stroke="#fff" stroke-opacity="0.55" stroke-width="2" />
      </template>

      <!-- Cashier Cage: a barred window over a marble counter with coins and gold bars -->
      <template v-else-if="name === 'cage'">
        <rect x="10" y="12" width="80" height="60" rx="7" :fill="url('wood')" />
        <path d="M22 62 V34 Q22 22 34 22 H66 Q78 22 78 34 V62 Z" fill="#241a36" />
        <circle cx="50" cy="44" r="16" :fill="url('glow')" stroke="none" opacity="0.6" />
        <g stroke-width="5.2"><path d="M33 23 V62 M44.5 22 V62 M55.5 22 V62 M67 23 V62" /></g>
        <g :stroke="'#ffd23f'" stroke-width="2.4"><path d="M33 23 V62 M44.5 22 V62 M55.5 22 V62 M67 23 V62" /></g>
        <path d="M22 34 Q22 22 34 22 H66 Q78 22 78 34" fill="none" stroke-width="2.6" />
        <rect x="6" y="62" width="88" height="10" rx="3" fill="#fff7ea" />
        <rect x="8" y="71" width="84" height="17" rx="3" fill="#b9784a" />
        <path d="M10 65 H60" stroke="#fff" stroke-width="1.6" />
        <g stroke-width="1.8">
          <ellipse cx="24" cy="60" rx="9" ry="3.4" fill="#d99a00" />
          <ellipse cx="24" cy="56" rx="9" ry="3.4" fill="#ffd23f" />
          <ellipse cx="24" cy="52" rx="9" ry="3.4" fill="#ffd23f" />
          <ellipse cx="24" cy="52" rx="5" ry="1.7" fill="none" stroke="#b98228" stroke-width="1.2" />
        </g>
        <g stroke-width="1.8">
          <path d="M62 62 L65 55 H79 L82 62 Z" :fill="url('gold')" />
          <path d="M66 55 L69 48 H79 L82 55 Z" :fill="url('gold')" transform="translate(-2 0)" />
          <path d="M67 51 H76" stroke="#fff" stroke-width="1.2" />
        </g>
      </template>

      <!-- Marketing: a megaphone shouting -->
      <template v-else-if="name === 'marketing'">
        <g transform="rotate(-14 50 54)">
          <rect x="14" y="52" width="10" height="18" rx="3" fill="#4a3a6b" />
          <path d="M28 60 L36 78 H44 L38 60 Z" fill="#4a3a6b" />
          <path d="M22 46 L64 28 V82 L22 64 Z" :fill="url('acc')" />
          <path d="M40 38 V72 M48 35 V76" stroke="#fff" stroke-opacity="0.9" stroke-width="2.4" />
          <ellipse cx="64" cy="55" rx="9" ry="27" :fill="url('red')" />
          <ellipse cx="65.5" cy="55" rx="5" ry="20" fill="#2a1b3d" stroke-width="1.8" />
          <path d="M26 49 L58 35" stroke="#fff" stroke-opacity="0.6" stroke-width="2.2" />
        </g>
        <g fill="none" stroke-width="5.4">
          <path d="M80 30 Q88 42 84 54" /><path d="M86 18 Q100 40 92 64" />
        </g>
        <g fill="none" stroke="#ffc93a" stroke-width="2.6">
          <path d="M80 30 Q88 42 84 54" /><path d="M86 18 Q100 40 92 64" />
        </g>
        <polygon :points="star(82, 80, 5)" :fill="url('gold')" stroke-width="1.6" />
        <polygon :points="star(14, 22, 4)" fill="#fff7c2" stroke-width="1.4" />
      </template>

      <!-- Hospitality: two champagne glasses clinking over a tray -->
      <template v-else-if="name === 'hospitality'">
        <circle cx="50" cy="44" r="36" :fill="url('glow')" stroke="none" opacity="0.5" />
        <ellipse cx="50" cy="82" rx="34" ry="7" :fill="url('steel')" stroke-width="2.2" />
        <g transform="rotate(-14 36 50)">
          <path d="M27 18 H45 L42 40 Q36 48 30 40 Z" fill="#fff3c4" stroke-width="2.2" />
          <path d="M28.5 26 H43.5 L41.6 39 Q36 45.5 30.4 39 Z" :fill="url('gold')" stroke="none" />
          <path d="M36 46 V72 M28 74 H44" stroke-width="2.6" />
        </g>
        <g transform="rotate(14 64 50)">
          <path d="M55 18 H73 L70 40 Q64 48 58 40 Z" fill="#fff3c4" stroke-width="2.2" />
          <path d="M56.5 26 H71.5 L69.6 39 Q64 45.5 58.4 39 Z" :fill="url('gold')" stroke="none" />
          <path d="M64 46 V72 M56 74 H72" stroke-width="2.6" />
        </g>
        <g fill="#fff7c2" stroke="none">
          <circle cx="50" cy="12" r="2.4" /><circle cx="44" cy="7" r="1.6" /><circle cx="56" cy="6" r="1.8" />
        </g>
        <polygon :points="star(84, 22, 4.5)" fill="#fff7c2" stroke-width="1.4" />
        <polygon :points="star(16, 26, 3.4)" fill="#fff7c2" stroke-width="1.2" />
      </template>

      <!-- Crew and Builder: a hard hat over a crossed hammer and wrench (the builder adds a plus) -->
      <template v-else-if="name === 'crew' || name === 'builder'">
        <g transform="rotate(-38 50 58)">
          <rect x="46" y="22" width="8" height="64" rx="3" :fill="url('wood')" />
          <path d="M36 16 H64 V28 H36 Z" :fill="url('steel')" />
          <path d="M64 18 L72 22 L64 26 Z" fill="#8f96b8" />
        </g>
        <g transform="rotate(38 50 58)">
          <rect x="46" y="28" width="8" height="58" rx="3" :fill="url('steel')" />
          <path d="M41 18 A12 12 0 1 0 59 18 L56 26 H44 Z" :fill="url('steel')" />
          <path d="M46 10 V20 H54 V10" fill="#241a36" stroke-width="2" />
        </g>
        <g transform="translate(0 12)">
          <path d="M18 62 Q18 32 50 32 Q82 32 82 62 Z" :fill="url('gold')" />
          <path d="M43 33 Q42 46 44 62 M57 33 Q58 46 56 62" fill="none" stroke-width="2" />
          <rect x="8" y="60" width="84" height="11" rx="5.5" fill="#e8a400" />
          <path d="M27 42 Q32 36 40 35" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="3" />
        </g>
        <template v-if="name === 'builder'">
          <circle cx="78" cy="26" r="13" fill="#3fd25a" />
          <path d="M78 19 V33 M71 26 H85" stroke="#fff" stroke-width="4.4" />
        </template>
      </template>

      <!-- Big Spenders (the rush): a top hat full of money, lightning-fast -->
      <template v-else-if="name === 'rush'">
        <g transform="rotate(-10 50 60)">
          <ellipse cx="50" cy="74" rx="36" ry="10" fill="#2b2236" />
          <path d="M28 74 V30 Q28 24 34 24 H66 Q72 24 72 30 V74 Z" fill="#3a2e4d" />
          <rect x="28" y="56" width="44" height="10" fill="#d6264b" />
          <path d="M34 30 V52" stroke="#fff" stroke-opacity="0.35" stroke-width="3" />
          <ellipse cx="50" cy="74" rx="22" ry="4.6" fill="none" stroke="#5a4a72" stroke-width="1.6" />
        </g>
        <path d="M60 4 L44 34 H56 L46 58 L76 24 H62 L72 4 Z" :fill="url('gold')" stroke-width="2.6" />
        <path d="M62 8 L52 28" stroke="#fff" stroke-opacity="0.8" stroke-width="2" />
        <g stroke-width="1.8">
          <ellipse cx="18" cy="84" rx="9" ry="3.6" fill="#d99a00" />
          <ellipse cx="18" cy="80" rx="9" ry="3.6" fill="#ffd23f" />
          <ellipse cx="84" cy="80" rx="9" ry="3.6" fill="#d99a00" />
          <ellipse cx="84" cy="76" rx="9" ry="3.6" fill="#ffd23f" />
          <ellipse cx="84" cy="72" rx="9" ry="3.6" fill="#ffd23f" />
        </g>
        <polygon :points="star(18, 22, 5)" fill="#fff7c2" stroke-width="1.4" />
      </template>

      <!-- Golden: a solid gold slot machine with a crown -->
      <template v-else-if="name === 'golden'">
        <circle cx="50" cy="50" r="44" :fill="url('glow')" stroke="none" opacity="0.55" />
        <path d="M76 52 L84 30" fill="none" stroke="#e8d9a8" stroke-width="3.2" />
        <circle cx="85" cy="27" r="5" fill="#ff5470" />
        <rect x="22" y="22" width="56" height="66" rx="10" :fill="url('gold')" />
        <rect x="28" y="33" width="44" height="24" rx="5" fill="#fff" />
        <path d="M42.7 33 V57 M57.3 33 V57" stroke-width="1.8" />
        <g stroke-width="1.4">
          <polygon v-for="x in [35.3, 50, 64.7]" :key="x" :points="`${x - 5},51 ${x - 5},41 ${x - 2.5},45 ${x},38 ${x + 2.5},45 ${x + 5},41 ${x + 5},51`" fill="#ffc93a" />
        </g>
        <rect x="30" y="64" width="40" height="15" rx="4" fill="#7a4a00" />
        <ellipse cx="50" cy="73" rx="12" ry="3.2" fill="#ffe27a" stroke-width="1.6" />
        <path d="M27 30 V62" stroke="#fff" stroke-opacity="0.7" stroke-width="3" />
        <polygon points="34,22 33,6 42,13 50,2 58,13 67,6 66,22" :fill="url('gold')" />
        <circle cx="50" cy="13" r="2.4" fill="#ff5470" stroke-width="1.2" />
        <polygon :points="star(14, 40, 6, 0.3)" fill="#fff" stroke="none" />
        <polygon :points="star(88, 70, 5, 0.3)" fill="#fff" stroke="none" />
      </template>

      <!-- Wardrobe: a shirt and bow tie on a hanger -->
      <template v-else-if="name === 'wardrobe'">
        <path d="M50 22 V14 Q50 8 56 8 Q62 8 62 14" fill="none" stroke-width="3" />
        <path d="M50 22 L18 36 H82 Z" fill="none" stroke-width="3.4" />
        <path d="M50 22 L18 36 H82 Z" fill="none" :stroke="url('wood')" stroke-width="1.4" />
        <path d="M34 30 L16 40 L22 56 L30 52 V88 H70 V52 L78 56 L84 40 L66 30 Q50 40 34 30 Z" :fill="url('acc')" />
        <path d="M34 30 Q50 52 66 30" fill="#fff7ea" stroke-width="2.2" />
        <path d="M50 38 L40 33 V43 Z M50 38 L60 33 V43 Z" fill="#d6264b" stroke-width="1.8" />
        <circle cx="50" cy="38" r="2.6" fill="#ff5470" stroke-width="1.6" />
        <circle v-for="y in [56, 68, 80]" :key="y" cx="50" :cy="y" r="2" fill="#ffc93a" stroke-width="1.2" />
        <path d="M36 42 V80" stroke="#fff" stroke-opacity="0.35" stroke-width="3" />
        <polygon :points="star(84, 74, 6)" :fill="url('gold')" stroke-width="1.6" />
      </template>

      <!-- Mission pictures (drawn to sit on a coloured badge with `plain`) -->
      <template v-else-if="name === 'dice'">
        <g transform="rotate(-14 36 56)">
          <rect x="12" y="34" width="44" height="44" rx="10" fill="#fff" />
          <g fill="#ef4444" stroke="none"><circle cx="23" cy="45" r="4.4" /><circle cx="34" cy="56" r="4.4" /><circle cx="45" cy="67" r="4.4" /></g>
        </g>
        <g transform="rotate(12 66 42)">
          <rect x="46" y="18" width="40" height="40" rx="9" fill="#fff" />
          <g :fill="INK" stroke="none"><circle cx="56" cy="28" r="4" /><circle cx="76" cy="28" r="4" /><circle cx="56" cy="48" r="4" /><circle cx="76" cy="48" r="4" /></g>
        </g>
      </template>

      <template v-else-if="name === 'cherry'">
        <path d="M30 56 Q38 26 62 14 M70 60 Q66 34 62 14" fill="none" stroke-width="7" />
        <path d="M30 56 Q38 26 62 14 M70 60 Q66 34 62 14" fill="none" stroke="#22c55e" stroke-width="3.4" />
        <path d="M62 14 Q74 4 88 12 Q76 22 62 14 Z" fill="#4ade80" />
        <circle cx="30" cy="68" r="18" :fill="url('red')" />
        <circle cx="70" cy="70" r="18" :fill="url('red')" />
        <ellipse cx="23" cy="61" rx="5" ry="3.4" fill="#fff" fill-opacity="0.8" stroke="none" transform="rotate(-30 23 61)" />
        <ellipse cx="63" cy="63" rx="5" ry="3.4" fill="#fff" fill-opacity="0.8" stroke="none" transform="rotate(-30 63 63)" />
      </template>

      <template v-else-if="name === 'bigwin'">
        <path d="M50 6 C74 26 84 46 76 66 C70 82 58 90 50 90 C42 90 30 82 24 66 C18 50 28 36 34 26 C38 36 44 38 46 30 C48 22 46 14 50 6 Z" fill="#ff7a1a" />
        <path d="M50 38 C62 50 66 60 62 72 C59 80 54 84 50 84 C46 84 41 80 38 72 C35 62 42 54 46 46 C48 52 50 50 50 38 Z" fill="#ffd23f" stroke-width="2" />
        <polygon :points="star(50, 68, 9)" fill="#fff7c2" stroke-width="2" />
      </template>

      <template v-else-if="name === 'cards'">
        <g transform="rotate(-14 40 80)">
          <rect x="16" y="20" width="40" height="58" rx="6" fill="#fff" />
          <text x="22" y="38" font-size="16" font-weight="900" :fill="INK" stroke="none" font-family="ui-rounded, sans-serif">A</text>
        </g>
        <g transform="rotate(10 62 80)">
          <rect x="42" y="18" width="42" height="60" rx="6" fill="#fff" />
          <path d="M63 30 C51 42 47 50 53 55 C57 58 60.5 56.6 61.4 53.6 L58.8 64 H67.2 L64.6 53.6 C65.5 56.6 69 58 73 55 C79 50 75 42 63 30 Z" :fill="INK" stroke="none" />
        </g>
      </template>

      <template v-else-if="name === 'coins'">
        <g stroke-width="2.4">
          <ellipse cx="34" cy="82" rx="22" ry="8" fill="#b98228" />
          <ellipse cx="34" cy="74" rx="22" ry="8" fill="#ffd23f" />
          <ellipse cx="34" cy="66" rx="22" ry="8" fill="#ffd23f" />
          <ellipse cx="34" cy="58" rx="22" ry="8" fill="#ffd23f" />
          <ellipse cx="34" cy="58" rx="13" ry="4.4" fill="none" stroke="#b98228" stroke-width="1.8" />
        </g>
        <circle cx="66" cy="44" r="24" :fill="url('gold')" />
        <circle cx="66" cy="44" r="16" fill="none" stroke="#b98228" stroke-width="2.2" />
        <polygon :points="star(66, 44, 9)" fill="#fff3b0" stroke="#b98228" stroke-width="1.8" />
        <path d="M50 34 A18 18 0 0 1 62 22" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="3" />
      </template>

      <!-- Visit: a friend's little casino with a heart over the door -->
      <template v-else-if="name === 'visit'">
        <!-- House: walls, a gabled roof with a gold ridge -->
        <rect x="18" y="44" width="64" height="44" rx="4" fill="#fff1dc" />
        <path d="M19.4 80 H80.6 V83.5 Q80.6 86.6 77.5 86.6 H22.5 Q19.4 86.6 19.4 83.5 Z" fill="#e8cfae" stroke="none" />
        <path d="M10 48 L50 16 L90 48 Z" :fill="url('acc')" />
        <path d="M22 44 L50 22 L78 44" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2" />
        <circle cx="50" cy="16" r="4" :fill="url('gold')" stroke-width="2" />
        <!-- Lit windows and a double door -->
        <rect x="24" y="56" width="14" height="13" rx="2.5" fill="#ffe27a" stroke-width="2" />
        <rect x="62" y="56" width="14" height="13" rx="2.5" fill="#ffe27a" stroke-width="2" />
        <path d="M31 56 V69 M69 56 V69" stroke-width="1.6" />
        <path d="M40 88 V68 Q40 60 50 60 Q60 60 60 68 V88 Z" :fill="url('wood')" />
        <path d="M50 61 V88" stroke-width="1.8" />
        <circle cx="47" cy="76" r="1.4" :fill="url('gold')" stroke-width="1" />
        <circle cx="53" cy="76" r="1.4" :fill="url('gold')" stroke-width="1" />
        <!-- The heart -->
        <path d="M50 52 C38 44 34 34 40 29 C44 26 48 28 50 32 C52 28 56 26 60 29 C66 34 62 44 50 52 Z" :fill="url('red')" stroke-width="2.4" />
        <ellipse cx="42.5" cy="33" rx="2.6" ry="1.7" fill="#fff" fill-opacity="0.85" stroke="none" transform="rotate(-35 42.5 33)" />
        <!-- Sparkles -->
        <polygon :points="star(84, 26, 6, 0.3)" fill="#fff3b0" stroke="none" />
        <polygon :points="star(14, 30, 4.5, 0.3)" fill="#fff" stroke="none" />
      </template>

      <template v-else-if="name === 'chest'">
        <path d="M12 46 Q12 18 50 18 Q88 18 88 46 Z" :fill="url('wood')" />
        <rect x="12" y="44" width="76" height="42" rx="5" :fill="url('wood')" />
        <path d="M30 20 V86 M70 20 V86" stroke-width="7" />
        <path d="M30 20 V86 M70 20 V86" stroke="#ffc93a" stroke-width="3.6" />
        <path d="M12 46 H88" stroke-width="3" />
        <rect x="42" y="40" width="16" height="18" rx="3" :fill="url('gold')" />
        <circle cx="50" cy="48" r="2.6" :fill="INK" stroke="none" />
        <path d="M18 30 Q24 24 34 22" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="3" />
      </template>
    </g>
  </svg>
</template>
