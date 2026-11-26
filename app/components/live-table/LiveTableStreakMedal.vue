<script setup lang="ts">
/**
 * Evolving win-streak medal: appears at 2 wins in a row and upgrades visually
 * across 10 distinct tiers (2 through 11+), always displaying the streak number.
 */
const props = withDefaults(defineProps<{
    streak: number
    size?: number
}>(), { size: 36 })

const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const tier = computed(() => Math.max(2, Math.min(11, props.streak)))
const label = computed(() => String(props.streak))
const fontSize = computed(() => (label.value.length >= 3 ? 15 : label.value.length === 2 ? 18 : 22))
const centerY = computed(() => (tier.value === 2 ? 32 : tier.value === 9 ? 31 : tier.value === 10 ? 32 : tier.value >= 11 ? 31 : 29))

const STAR_PATH = 'M32,8 L37,13 L45,11 L47,18 L54,21 L52,29 L56,35 L50,41 L50,48 L42,49 L38,55 L32,52 L26,55 L22,49 L14,48 L14,41 L8,35 L12,29 L10,21 L17,18 L19,11 L27,13 Z'
const FLAME_PATH = 'M13,42 C3,34 4,20 13,12 C11,18 14,20 17,15 C19,7 28,2 32,2 C36,2 45,7 47,15 C50,20 53,18 51,12 C60,20 61,34 51,42 C46,49 39,53 32,53 C25,53 18,49 13,42 Z'
</script>

<template>
  <span
    v-if="streak >= 2"
    class="inline-grid shrink-0 place-items-center select-none"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="`${streak} wins in a row`"
    :aria-label="`${streak} win streak`"
  >
    <svg viewBox="0 0 64 64" class="size-full overflow-visible drop-shadow-[0_2px_3px_rgb(0_0_0/0.6)]">
      <defs>
        <linearGradient v-if="tier === 2" :id="`m-g-${uid}`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e5a468" />
          <stop offset="55%" stop-color="#b97236" />
          <stop offset="100%" stop-color="#7c4418" />
        </linearGradient>
        <linearGradient v-else-if="tier === 3" :id="`m-g-${uid}`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffaa70" />
          <stop offset="55%" stop-color="#d8682b" />
          <stop offset="100%" stop-color="#8f3610" />
        </linearGradient>
        <linearGradient v-else-if="tier === 4" :id="`m-g-${uid}`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="50%" stop-color="#cbd5e1" />
          <stop offset="100%" stop-color="#64748b" />
        </linearGradient>
        <linearGradient v-else-if="tier === 5" :id="`m-g-${uid}`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f8fafc" />
          <stop offset="55%" stop-color="#bae6fd" />
          <stop offset="100%" stop-color="#38bdf8" />
        </linearGradient>
        <linearGradient v-else-if="tier === 6" :id="`m-g-${uid}`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fff0a6" />
          <stop offset="52%" stop-color="#ffc93a" />
          <stop offset="100%" stop-color="#c37b00" />
        </linearGradient>
        <linearGradient v-else-if="tier === 7" :id="`m-g-${uid}`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fff4b8" />
          <stop offset="50%" stop-color="#ffc93a" />
          <stop offset="100%" stop-color="#b86b00" />
        </linearGradient>
        <linearGradient v-else-if="tier === 8" :id="`m-g-${uid}`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6fffe9" />
          <stop offset="52%" stop-color="#2fe0d0" />
          <stop offset="100%" stop-color="#0a7c73" />
        </linearGradient>
        <linearGradient v-else-if="tier === 9" :id="`m-g-${uid}`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#d8b4fe" />
          <stop offset="50%" stop-color="#9333ea" />
          <stop offset="100%" stop-color="#4c1d95" />
        </linearGradient>
        <template v-else-if="tier === 10">
          <linearGradient :id="`m-fl-${uid}`" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff07c" />
            <stop offset="45%" stop-color="#ff8a1f" />
            <stop offset="100%" stop-color="#e11d48" />
          </linearGradient>
          <linearGradient :id="`m-g-${uid}`" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ff6b35" />
            <stop offset="100%" stop-color="#991b1b" />
          </linearGradient>
        </template>
        <template v-else>
          <linearGradient :id="`m-pr-${uid}`" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ff5470" />
            <stop offset="28%" stop-color="#ffc93a" />
            <stop offset="54%" stop-color="#3fd25a" />
            <stop offset="78%" stop-color="#2fe0d0" />
            <stop offset="100%" stop-color="#a879ff" />
          </linearGradient>
          <radialGradient :id="`m-gl-${uid}`" cx="50%" cy="50%" r="50%">
            <stop offset="50%" stop-color="rgba(255,201,58,0.65)" />
            <stop offset="100%" stop-color="rgba(168,121,255,0)" />
          </radialGradient>
        </template>
      </defs>

      <!-- Tier 2: Bronze Coin -->
      <template v-if="tier === 2">
        <circle cx="32" cy="32" r="20" :fill="`url(#m-g-${uid})`" stroke="#120c1d" stroke-width="2.6" />
        <circle cx="32" cy="32" r="15.5" fill="none" stroke="rgba(255,235,200,0.45)" stroke-width="1.6" />
      </template>

      <!-- Tier 3: Copper Ribbon -->
      <template v-else-if="tier === 3">
        <path d="M20,40 L14,57 L23,52 L28,58 L31,42 Z" fill="#d93855" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M44,40 L50,57 L41,52 L36,58 L33,42 Z" fill="#b3213d" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <circle cx="32" cy="29" r="20" :fill="`url(#m-g-${uid})`" stroke="#120c1d" stroke-width="2.6" />
        <circle cx="32" cy="29" r="15" fill="none" stroke="#ffd8b0" stroke-width="1.8" stroke-dasharray="4 3" />
      </template>

      <!-- Tier 4: Silver Shield -->
      <template v-else-if="tier === 4">
        <path d="M20,40 L14,57 L23,52 L28,58 L31,42 Z" fill="#3b82f6" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M44,40 L50,57 L41,52 L36,58 L33,42 Z" fill="#1d4ed8" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <polygon points="32,8 50,17 50,36 32,48 14,36 14,17" :fill="`url(#m-g-${uid})`" stroke="#120c1d" stroke-width="2.6" stroke-linejoin="round" />
        <polygon points="32,12 45,19 45,34 32,43 19,34 19,19" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" />
      </template>

      <!-- Tier 5: Laurel Silver -->
      <template v-else-if="tier === 5">
        <path d="M12,38 C6,30 8,18 16,13 C13,22 14,31 18,38 Z" fill="#ffd86b" stroke="#120c1d" stroke-width="2" />
        <path d="M52,38 C58,30 56,18 48,13 C51,22 50,31 46,38 Z" fill="#ffd86b" stroke="#120c1d" stroke-width="2" />
        <path d="M20,40 L14,57 L23,52 L28,58 L31,42 Z" fill="#2563eb" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M44,40 L50,57 L41,52 L36,58 L33,42 Z" fill="#1d4ed8" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <circle cx="32" cy="29" r="19" :fill="`url(#m-g-${uid})`" stroke="#120c1d" stroke-width="2.6" />
        <circle cx="32" cy="29" r="15" fill="none" stroke="#ffc93a" stroke-width="2.4" />
      </template>

      <!-- Tier 6: Gold Seal -->
      <template v-else-if="tier === 6">
        <path d="M20,40 L14,57 L23,52 L28,58 L31,42 Z" fill="#ff5470" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M44,40 L50,57 L41,52 L36,58 L33,42 Z" fill="#b3213d" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path :d="STAR_PATH" transform="translate(0,-3)" :fill="`url(#m-g-${uid})`" stroke="#120c1d" stroke-width="2.4" stroke-linejoin="round" />
        <circle cx="32" cy="29" r="14.5" fill="#d98a00" stroke="#fff3b8" stroke-width="1.8" />
      </template>

      <!-- Tier 7: Winged Gold -->
      <template v-else-if="tier === 7">
        <path d="M18,22 L3,16 L8,25 L4,30 L11,33 L8,38 L20,38 Z" fill="#ffc93a" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M46,22 L61,16 L56,25 L60,30 L53,33 L56,38 L44,38 Z" fill="#ffc93a" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M16,24 L7,20 L11,26 Z" fill="#fff6cc" opacity="0.6" />
        <path d="M48,24 L57,20 L53,26 Z" fill="#fff6cc" opacity="0.6" />
        <path d="M20,40 L14,57 L23,52 L28,58 L31,42 Z" fill="#ff5470" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M44,40 L50,57 L41,52 L36,58 L33,42 Z" fill="#b3213d" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <circle cx="32" cy="29" r="19" :fill="`url(#m-g-${uid})`" stroke="#120c1d" stroke-width="2.6" />
        <circle cx="32" cy="29" r="14.5" fill="#d97706" stroke="#fff2a8" stroke-width="2" />
      </template>

      <!-- Tier 8: Emerald Gem -->
      <template v-else-if="tier === 8">
        <path d="M18,22 L3,16 L8,25 L4,30 L11,33 L8,38 L20,38 Z" fill="#e2e8f0" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M46,22 L61,16 L56,25 L60,30 L53,33 L56,38 L44,38 Z" fill="#e2e8f0" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M20,40 L14,57 L23,52 L28,58 L31,42 Z" fill="#0ea5e9" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M44,40 L50,57 L41,52 L36,58 L33,42 Z" fill="#0369a1" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <polygon points="32,7 51,18 51,40 32,51 13,40 13,18" fill="#ffc93a" stroke="#120c1d" stroke-width="2.6" stroke-linejoin="round" />
        <polygon points="32,12 46,20 46,38 32,46 18,38 18,20" :fill="`url(#m-g-${uid})`" stroke="#120c1d" stroke-width="2" />
      </template>

      <!-- Tier 9: Royal Crown -->
      <template v-else-if="tier === 9">
        <path d="M18,22 L3,16 L8,25 L4,30 L11,33 L8,38 L20,38 Z" fill="#ffc93a" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M46,22 L61,16 L56,25 L60,30 L53,33 L56,38 L44,38 Z" fill="#ffc93a" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M20,40 L14,57 L23,52 L28,58 L31,42 Z" fill="#7c3aed" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M44,40 L50,57 L41,52 L36,58 L33,42 Z" fill="#4c1d95" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <circle cx="32" cy="31" r="19" fill="#ffc93a" stroke="#120c1d" stroke-width="2.6" />
        <circle cx="32" cy="31" r="15" :fill="`url(#m-g-${uid})`" stroke="#120c1d" stroke-width="2" />
        <path d="M21,14 L18,4 L26,9 L32,2 L38,9 L46,4 L43,14 Z" fill="#ffc93a" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <circle cx="32" cy="9" r="2.2" fill="#2fe0d0" />
      </template>

      <!-- Tier 10: Solar Flame -->
      <template v-else-if="tier === 10">
        <path :d="FLAME_PATH" :fill="`url(#m-fl-${uid})`" stroke="#120c1d" stroke-width="2.4" stroke-linejoin="round" />
        <circle cx="32" cy="32" r="16.5" :fill="`url(#m-g-${uid})`" stroke="#fff0a6" stroke-width="2.4" />
        <path d="M21,14 L18,4 L26,9 L32,2 L38,9 L46,4 L43,14 Z" fill="#fff0a6" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <circle cx="32" cy="9" r="2.2" fill="#ff5470" />
      </template>

      <!-- Tier 11+: Mythic Prism -->
      <template v-else>
        <circle cx="32" cy="32" r="30" :fill="`url(#m-gl-${uid})`" />
        <path d="M18,22 L3,16 L8,25 L4,30 L11,33 L8,38 L20,38 Z" :fill="`url(#m-pr-${uid})`" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path d="M46,22 L61,16 L56,25 L60,30 L53,33 L56,38 L44,38 Z" :fill="`url(#m-pr-${uid})`" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <path :d="STAR_PATH" transform="translate(0,-1)" :fill="`url(#m-pr-${uid})`" stroke="#120c1d" stroke-width="2.5" stroke-linejoin="round" />
        <circle cx="32" cy="31" r="14.5" fill="#1b1329" stroke="#ffffff" stroke-width="2" />
        <path d="M21,14 L18,4 L26,9 L32,2 L38,9 L46,4 L43,14 Z" fill="#fff4b8" stroke="#120c1d" stroke-width="2.2" stroke-linejoin="round" />
        <circle cx="32" cy="9" r="2.2" fill="#2fe0d0" />
        <circle cx="10" cy="12" r="2.2" fill="#fff" />
        <circle cx="55" cy="11" r="2" fill="#ffc93a" />
        <circle cx="54" cy="48" r="2" fill="#2fe0d0" />
      </template>

      <text
        x="32"
        :y="centerY + 1"
        text-anchor="middle"
        dominant-baseline="central"
        font-family="var(--font-game, 'Lilita One', Fredoka, sans-serif)"
        :font-size="fontSize"
        fill="#ffffff"
        stroke="#120c1d"
        stroke-width="3.6"
        paint-order="stroke fill"
      >{{ label }}</text>
    </svg>
  </span>
</template>
