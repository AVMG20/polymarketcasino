<script setup lang="ts">
import { Award, Check, Lock } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import { levelUnlocks, MAX_CASINO_LEVEL } from '#shared/casino-level'
import { formatCoins } from '#shared/money'
import { decorName } from '~/utils/decor-art'
import { specialLift, type SpecialLift } from '~/utils/tycoon-art'

/**
 * The casino level up close: the level, the XP bar, what the next level
 * unlocks and every level's unlocks (reached ones ticked). XP comes from
 * every finished build: rooms, games, game levels and upgrades.
 */
const tycoon = useTycoon()
const arrange = useArrange()
const open = computed(() => arrange.levelOpen.value)
const lv = computed(() => tycoon.level.value)
const progress = computed(() => {
    const { xp, levelXp, nextXp } = lv.value
    return nextXp === null ? 1 : Math.max(0, Math.min(1, (xp - levelXp) / Math.max(1, nextXp - levelXp)))
})
const unlocks = computed(() => levelUnlocks())
/** The next level that unlocks something. */
const next = computed(() => unlocks.value.find(u => u.level > lv.value.level) ?? null)
const gameName = (slug: string) => findGame(slug)?.name ?? slug
/** The specials the next level unlocks: what each would do on this floor. */
const nextLifts = computed<Record<string, SpecialLift | null>>(() => {
    const st = tycoon.state.value
    if (!st || !next.value) return {}
    return Object.fromEntries(next.value.decor.map(type => [type, specialLift(st, type, st.serverNow)]))
})

</script>

<template>
  <TycoonDrawer :open="open" card dismissable title="Casino level" :icon="Award" color="#a879ff" height="80dvh" @close="arrange.levelOpen.value = false">
    <div class="space-y-3 px-3 pb-4">
      <div class="g-well flex items-center gap-3 rounded-2xl p-3">
        <TycoonLevelBadge :level="lv.level" :progress="progress" :size="72" :stroke="6" />
        <div class="min-w-0 flex-1 space-y-1.5">
          <p class="g-title text-2xl leading-none">Level {{ lv.level }}<span class="g-num text-base text-[var(--g-muted)]"> / {{ MAX_CASINO_LEVEL }}</span></p>
          <template v-if="lv.nextXp !== null">
            <span class="block h-3 overflow-hidden rounded-full bg-black/45 shadow-[inset_0_2px_0_rgb(0_0_0/0.35)]">
              <span class="block h-full rounded-full bg-gradient-to-r from-[#8a5cf0] to-[#c9a8ff] transition-[width] duration-500" :style="{ width: `${Math.max(4, progress * 100)}%` }" />
            </span>
            <p class="g-num text-sm text-[var(--g-muted)]">{{ formatCoins(lv.xp - lv.levelXp) }} / {{ formatCoins(lv.nextXp - lv.levelXp) }} XP</p>
          </template>
          <p v-else class="text-sm font-semibold text-[#ffc93a]">Top level: everything is unlocked</p>
        </div>
      </div>
      <p class="px-1 text-[12.5px] leading-4 text-[var(--g-muted)]">Every build earns XP: rooms, games, machine levels and upgrades. Higher levels unlock games and decorations, and dress up your rooms.</p>

      <div v-if="next" class="rounded-2xl border-2 border-[#a879ff]/60 bg-[#a879ff]/12 p-2.5">
        <p class="mb-2 px-0.5 text-sm font-bold">Next: level {{ next.level }} unlocks</p>
        <div class="flex flex-wrap gap-2">
          <span v-for="slug in next.games" :key="slug" class="flex items-center gap-1.5 rounded-xl bg-black/25 py-1 pr-2.5 pl-1">
            <span class="block size-9 shrink-0 overflow-hidden rounded-lg border-2 border-black/50"><TycoonGameArt :slug="slug" /></span>
            <span class="text-[13px] font-semibold">{{ gameName(slug) }}</span>
          </span>
          <span v-for="type in next.decor" :key="type" class="flex items-center gap-1.5 rounded-xl bg-black/25 py-1 pr-2.5 pl-1">
            <span class="block size-9 shrink-0 overflow-hidden rounded-lg border-2 border-black/50"><TycoonDecorArt :type="type" /></span>
            <span class="flex min-w-0 flex-col items-start gap-0.5">
              <span class="text-[13px] font-semibold">{{ decorName(type) }}</span>
              <TycoonSpecialStat v-if="nextLifts[type]" :lifts="[nextLifts[type]]" />
            </span>
          </span>
        </div>
      </div>

      <ol class="g-well divide-y divide-white/5 rounded-2xl px-2.5 py-1">
        <li
          v-for="u in unlocks"
          :key="u.level"
          class="flex min-h-14 items-center gap-2.5 py-1.5"
          :class="u.level <= lv.level ? '' : 'opacity-60'"
        >
          <span
            class="g-num grid size-9 shrink-0 place-items-center rounded-full border-2 text-sm"
            :class="u.level <= lv.level ? 'border-[#1b8a33] bg-[#3fd25a] text-white' : u.level === next?.level ? 'border-[#a879ff] bg-[#a879ff]/25' : 'border-black/40 bg-black/30'"
            :title="u.level <= lv.level ? `Level ${u.level}: reached` : `Level ${u.level}`"
          >
            <Check v-if="u.level <= lv.level" class="size-4.5" :stroke-width="4" />
            <template v-else>{{ u.level }}</template>
          </span>
          <span class="flex min-w-0 flex-1 flex-wrap gap-1.5">
            <span v-for="slug in u.games" :key="slug" class="block size-10 shrink-0 overflow-hidden rounded-lg border-2 border-black/50" :title="gameName(slug)"><TycoonGameArt :slug="slug" /></span>
            <span v-for="type in u.decor" :key="type" class="block size-10 shrink-0 overflow-hidden rounded-lg border-2 border-black/50" :title="decorName(type)"><TycoonDecorArt :type="type" /></span>
          </span>
          <Lock v-if="u.level > lv.level" class="size-4 shrink-0 text-[var(--g-muted)]" :stroke-width="3" />
        </li>
      </ol>
    </div>
  </TycoonDrawer>
</template>
