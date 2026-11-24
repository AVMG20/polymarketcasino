<script setup lang="ts">
import { Award, Check, Lock } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import { levelUnlocks, MAX_CASINO_LEVEL } from '#shared/casino-level'
import { findDecor, type DecorType } from '#shared/decor'
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


/**
 * The unlock under the mouse (or tapped): what it is and what it does. A
 * game shows its tagline, a plain decoration "just for looks", a special its
 * bonus on this floor (worked out only for the one shown).
 */
const peek = ref<string | null>(null)
function setPeek(key: string | null) {
    peek.value = key
}
function enter(event: PointerEvent, key: string) {
    if (event.pointerType === 'mouse') setPeek(key)
}
function leave(event: PointerEvent, key: string) {
    if (event.pointerType === 'mouse' && peek.value === key) setPeek(null)
}
function tap(key: string) {
    setPeek(peek.value === key ? null : key)
}
watch(open, (o) => {
    if (!o) peek.value = null
})
const gameTagline = (slug: string) => findGame(slug)?.tagline ?? ''
const peekLift = computed<SpecialLift | null>(() => {
    const st = tycoon.state.value
    const key = peek.value
    if (!st || !key?.startsWith('decor:')) return null
    const type = key.slice(6) as DecorType
    return findDecor(type)?.special ? specialLift(st, type, st.serverNow) : null
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
          class="relative flex min-h-14 items-center gap-2.5 py-1.5"
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
            <span v-for="slug in u.games" :key="slug" @pointerenter="enter($event, `game:${slug}`)" @pointerleave="leave($event, `game:${slug}`)">
              <button type="button" class="block size-11 shrink-0 overflow-hidden rounded-lg border-2" :class="peek === `game:${slug}` ? 'border-[#ffc93a]' : 'border-black/50'" :aria-label="gameName(slug)" @click="tap(`game:${slug}`)"><TycoonGameArt :slug="slug" /></button>
              <Transition name="pop">
                <span v-if="peek === `game:${slug}`" class="peek g-panel">
                  <span class="block text-[13px] font-bold">{{ gameName(slug) }}</span>
                  <span class="block text-[11px] font-semibold tracking-wide text-[#7dd3fc] uppercase">New game</span>
                  <span v-if="gameTagline(slug)" class="mt-0.5 block text-xs leading-4 text-[var(--g-muted)]">{{ gameTagline(slug) }}</span>
                </span>
              </Transition>
            </span>
            <span v-for="type in u.decor" :key="type" @pointerenter="enter($event, `decor:${type}`)" @pointerleave="leave($event, `decor:${type}`)">
              <button type="button" class="block size-11 shrink-0 overflow-hidden rounded-lg border-2" :class="peek === `decor:${type}` ? 'border-[#ffc93a]' : 'border-black/50'" :aria-label="decorName(type)" @click="tap(`decor:${type}`)"><TycoonDecorArt :type="type" /></button>
              <Transition name="pop">
                <span v-if="peek === `decor:${type}`" class="peek g-panel">
                  <span class="block text-[13px] font-bold">{{ decorName(type) }}</span>
                  <template v-if="findDecor(type)?.special">
                    <span class="block text-[11px] font-semibold tracking-wide text-[#ffc93a] uppercase">Special · one of each</span>
                    <span v-if="peekLift" class="mt-1 block"><TycoonSpecialStat :lifts="[peekLift]" /></span>
                    <span class="mt-0.5 block text-xs leading-4 text-[var(--g-muted)]">{{ findDecor(type)?.blurb }}</span>
                  </template>
                  <template v-else>
                    <span class="block text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Decoration · just for looks</span>
                    <span class="mt-0.5 block text-xs leading-4 text-[var(--g-muted)]">{{ findDecor(type)?.blurb }}</span>
                  </template>
                </span>
              </Transition>
            </span>
          </span>
          <Lock v-if="u.level > lv.level" class="size-4 shrink-0 text-[var(--g-muted)]" :stroke-width="3" />
        </li>
      </ol>
    </div>
  </TycoonDrawer>
</template>

<style scoped>
/* What an unlock does: a small card under its row (hover with a mouse, tap on touch). */
.peek {
  position: absolute;
  top: calc(100% - 4px);
  left: 2.9rem;
  right: 0;
  z-index: 20;
  border-radius: 14px;
  padding: 8px 10px;
  pointer-events: none;
}
</style>
<style scoped>
.pop-enter-active { transition: transform 0.18s cubic-bezier(0.3, 1.4, 0.5, 1), opacity 0.15s ease; }
.pop-leave-active { transition: transform 0.12s ease, opacity 0.12s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-4px) scale(0.97); }
</style>
