<script setup lang="ts">
import { Award, Check, ChevronsUp, Dices, Hammer, Shirt, Sparkles } from 'lucide-vue-next'
import type { Component } from 'vue'
import { formatCoins } from '#shared/money'
import { starTitle, type StarGoalKey } from '#shared/stars'

/**
 * The Stars sheet ("achievements"): the ten casino goals, each a star in any
 * order, done (ticked) or with a progress bar, and the title the level gives.
 * The server works the goals out; opening the sheet reads the casino again,
 * so the progress is fresh.
 */
const props = defineProps<{ open: boolean }>()
const tycoon = useTycoon()
const wallet = useWallet()
const stars = computed(() => wallet.stars.value ?? tycoon.state.value?.starGoals ?? null)
const title = computed(() => (stars.value ? starTitle(stars.value.level) : null))

watch(() => props.open, open => open && void tycoon.refresh(), { immediate: true })

const ICONS: Record<StarGoalKey, { icon: Component, color: string }> = {
    'level-5': { icon: Award, color: '#a879ff' },
    'level-10': { icon: Award, color: '#a879ff' },
    'level-15': { icon: Award, color: '#a879ff' },
    'level-20': { icon: Award, color: '#a879ff' },
    'level-25': { icon: Award, color: '#a879ff' },
    'build-all': { icon: Hammer, color: '#ff9f1c' },
    'play-all': { icon: Dices, color: '#4aa6ff' },
    'all-specials': { icon: Sparkles, color: '#ffc93a' },
    'max-all': { icon: ChevronsUp, color: '#3fd25a' },
    'all-cosmetics': { icon: Shirt, color: '#f27fb4' }
}
</script>

<template>
  <div v-if="stars" class="space-y-3 px-3 pb-4">
    <div class="g-well flex items-center gap-3 rounded-2xl p-3">
      <svg viewBox="0 0 24 24" class="size-16 shrink-0 drop-shadow-[0_3px_0_rgb(0_0_0/0.45)]" aria-hidden="true">
        <defs>
          <linearGradient id="stars-sheet-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff2a8" />
            <stop offset="0.5" stop-color="#ffc93a" />
            <stop offset="1" stop-color="#e88a00" />
          </linearGradient>
        </defs>
        <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" :fill="stars.level ? 'url(#stars-sheet-gold)' : '#3a2f4d'" stroke="#7a4a00" stroke-width="1.1" stroke-linejoin="round" />
        <text x="12" y="14.6" text-anchor="middle" font-size="6" font-family="var(--font-game)" :fill="stars.level ? '#5a3200' : '#b9aecb'">{{ stars.level }}</text>
      </svg>
      <div class="min-w-0 flex-1 space-y-1.5">
        <p class="g-title text-2xl leading-none">{{ title ?? 'No stars yet' }}</p>
        <p class="g-num text-sm text-[var(--g-muted)]">{{ stars.level }} / {{ stars.max }} stars</p>
        <CasinoStarTrack :level="stars.level" size="sm" />
      </div>
    </div>
    <p class="px-1 text-[12.5px] leading-4 text-[var(--g-muted)]">Every goal is a star, in any order, and a star is yours for good. Your stars count at the Polynux hub.</p>

    <ul class="g-well divide-y divide-white/5 rounded-2xl px-2.5 py-1">
      <li v-for="goal in stars.goals" :key="goal.key" class="flex min-h-16 items-center gap-2.5 py-2">
        <span
          class="grid size-10 shrink-0 place-items-center rounded-full border-2"
          :class="goal.done ? 'border-[#1b8a33] bg-[#3fd25a] text-white' : 'border-black/40 bg-black/30'"
          :style="goal.done ? undefined : { color: ICONS[goal.key].color }"
        >
          <Check v-if="goal.done" class="size-5" :stroke-width="4" />
          <component :is="ICONS[goal.key].icon" v-else class="size-5" :stroke-width="2.75" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-baseline gap-2">
            <span class="truncate text-[15px] font-bold">{{ goal.name }}</span>
            <span v-if="goal.done" class="ml-auto shrink-0 text-[11px] font-bold tracking-wide text-[#7ee08f] uppercase">Done</span>
            <span v-else class="g-num ml-auto shrink-0 text-sm" :title="`${formatCoins(goal.have)} of ${formatCoins(goal.need)}`">{{ formatCoins(goal.have) }}/{{ formatCoins(goal.need) }}</span>
          </span>
          <span class="block text-[12.5px] leading-4 text-[var(--g-muted)]">{{ goal.description }}</span>
          <span v-if="!goal.done" class="mt-1.5 block h-2 overflow-hidden rounded-full bg-black/45 shadow-[inset_0_2px_0_rgb(0_0_0/0.35)]">
            <span class="block h-full rounded-full bg-gradient-to-r from-[#f08a00] to-[#ffe066] transition-[width] duration-500" :style="{ width: `${Math.max(goal.have > 0 ? 4 : 0, (goal.have / goal.need) * 100)}%` }" />
          </span>
        </span>
      </li>
    </ul>
  </div>
</template>
