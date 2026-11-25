<script setup lang="ts">
import { Check, Eye, HardHat, LayoutGrid, Lock, Package, Star } from 'lucide-vue-next'
import { GAMES } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import { gameUnlockLevel } from '#shared/casino-level'
import { findTycoonGame, TYCOON_GAMES } from '#shared/tycoon'

/** Every game as a cover tile with its state on your floor. Tap: walk there (built) or its build card. */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], walk: [slug: string], play: [slug: string], build: [slug: string] }>()

const tycoon = useTycoon()
const { stars } = useWallet()
/** The open goal closest to done (null at ten). */
const next = computed(() => stars.value?.goals.filter(goal => !goal.done).sort((a, b) => b.have / b.need - a.have / a.need)[0] ?? null)

type Status = { kind: 'built', level: number, stored: boolean } | { kind: 'building', progress: number, leftMs: number } | { kind: 'open' } | { kind: 'locked', level: number }

function statusOf(slug: string): Status {
    const s = tycoon.state.value
    const level = s?.games[slug] ?? 0
    const running = tycoon.queue.value.find(c => c.kind === 'game' && c.id === slug)
    if (running && level === 0) return { kind: 'building', progress: 1 - running.leftMs / running.total, leftMs: running.leftMs }
    if (level >= 1) return { kind: 'built', level, stored: tycoon.storedGames.value.includes(slug) }
    const needs = findTycoonGame(slug) ? gameUnlockLevel(slug) : 1
    if (needs > tycoon.level.value.level) return { kind: 'locked', level: needs }
    return { kind: 'open' }
}

/** Your games first, then the ones you can build, then the ones a higher casino level unlocks. */
const groups = computed(() => {
    const games = TYCOON_GAMES.map(g => GAMES.find(game => game.slug === g.slug)).filter(g => !!g)
    const kind = (slug: string) => statusOf(slug).kind
    const locked = games.filter(g => kind(g.slug) === 'locked').sort((a, b) => gameUnlockLevel(a.slug) - gameUnlockLevel(b.slug))
    const list = [
        { id: 'yours', name: 'Your games', icon: Check, color: '#3fd25a', games: games.filter(g => kind(g.slug) === 'built' || kind(g.slug) === 'building') },
        { id: 'open', name: 'Ready to build', icon: HardHat, color: '#ff9f1c', games: games.filter(g => kind(g.slug) === 'open') },
        { id: 'locked', name: 'Unlock with casino level', icon: Lock, color: '#7a6a99', games: locked }
    ].filter(group => group.games.length)
    const others = GAMES.filter(game => !findTycoonGame(game.slug))
    return others.length ? [...list, { id: 'more', name: 'More', icon: LayoutGrid, color: '#4aa6ff', games: others }] : list
})

function tap(slug: string) {
    const status = statusOf(slug)
    if (status.kind === 'built' || status.kind === 'building') emit('walk', slug)
    else emit('build', slug)
}
</script>

<template>
  <TycoonDrawer :open="open" title="Games" :icon="LayoutGrid" color="#4aa6ff" height="72dvh" @close="emit('close')">
    <div class="space-y-4 px-3 pb-5">
      <!-- Stars: what the pips are, and what the next one takes. -->
      <div v-if="stars" class="g-well flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-3 py-2" :title="`Every casino goal is a star (${stars.level} of 10)`">
        <span class="flex items-center gap-1.5">
          <Star class="size-4 fill-[#ffc93a] text-[#ffc93a]" :stroke-width="2.5" />
          <span class="g-title text-sm uppercase">Stars</span>
          <span class="g-num text-sm text-[var(--g-muted)]">{{ stars.level }}/10</span>
        </span>
        <CasinoStarTrack :level="stars.level" size="sm" />
        <span class="flex w-full items-center gap-1 text-xs font-semibold text-[var(--g-muted)]">
          <template v-if="next">Next star: {{ next.description }} <span class="g-num text-[var(--g-ink)]">{{ formatCoins(next.have) }}/{{ formatCoins(next.need) }}</span></template>
          <template v-else>Every star is yours</template>
        </span>
      </div>

      <section v-for="group in groups" :key="group.id" class="space-y-2">
        <h3 class="flex items-center gap-2">
          <span class="grid size-7 place-items-center rounded-lg border-2 border-black/40" :style="{ background: group.color }">
            <component :is="group.icon" class="size-4 text-white" :stroke-width="2.75" />
          </span>
          <span class="g-title text-lg">{{ group.name }}</span>
          <span v-if="group.id === 'locked'" class="g-num ml-auto text-sm text-[var(--g-muted)]">You: Lv {{ tycoon.level.value.level }}</span>
        </h3>
        <ul class="grid grid-cols-3 gap-2">
          <li v-for="game in group.games" :key="game.slug">
            <template v-for="status in [statusOf(game.slug)]" :key="status.kind">
              <button type="button" class="tile relative block w-full overflow-hidden rounded-[18px] text-left transition-transform active:scale-95" :title="game.name" @click="tap(game.slug)">
                <span class="relative block aspect-square overflow-hidden rounded-[14px] border-2 border-black/50">
                  <span class="block size-full" :class="status.kind === 'locked' ? 'grayscale brightness-50' : status.kind === 'open' ? 'brightness-75 saturate-50' : ''"><TycoonGameArt :slug="game.slug" /></span>
                  <span v-if="status.kind === 'built'" class="absolute top-1 right-1 grid size-6 place-items-center rounded-full border-2 border-black/50 bg-[#3fd25a]"><Check class="size-3.5 text-white" :stroke-width="4" /></span>
                  <span v-if="status.kind === 'built'" class="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/75 to-transparent pt-3 pb-1"><TycoonPips :level="status.level" :max="5" /></span>
                  <span v-else-if="status.kind === 'building'" class="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/25 to-black/10 p-1.5">
                    <TycoonBuildBar :progress="status.progress" :left-ms="status.leftMs" size="sm" />
                  </span>
                  <span v-else-if="status.kind === 'locked'" class="absolute inset-0 grid place-items-center" :title="`Reach casino level ${status.level}`">
                    <span class="g-num flex items-center gap-1 rounded-full border-2 border-black/50 bg-[#1b1329]/90 px-2 py-1 text-[13px] leading-none text-[#ffc93a]"><Lock class="size-3.5" :stroke-width="3" />Lv {{ status.level }}</span>
                  </span>
                  <span v-else class="absolute inset-0 grid place-items-center">
                    <span class="grid size-10 place-items-center rounded-full border-2 border-black/50 bg-[#3fd25a] shadow-[0_3px_0_#1b8a33]"><HardHat class="size-5 text-white" :stroke-width="2.75" /></span>
                  </span>
                  <span v-if="status.kind === 'built' && status.stored" class="absolute top-1 left-1 grid size-6 place-items-center rounded-full border-2 border-black/50 bg-[#ffb35c]" title="In storage: you can play it, but it is not on your floor (no seats, visitors can't play it)"><Package class="size-3.5 text-[#5a2e00]" :stroke-width="3" /></span>
                  <span v-if="game.live && status.kind !== 'built'" class="absolute top-1 left-1 grid size-6 place-items-center rounded-full border-2 border-black/50 bg-[#4aa6ff]" title="Watch for free"><Eye class="size-3.5 text-white" :stroke-width="3" /></span>
                </span>
                <span class="flex h-[34px] items-center justify-center px-1 text-center text-[12px] leading-[14px] font-semibold"><span class="line-clamp-2">{{ game.name }}</span></span>
              </button>
            </template>
          </li>
        </ul>
      </section>
    </div>
  </TycoonDrawer>
</template>

<style scoped>
.tile {
  padding: 4px 4px 0;
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.12);
}
</style>
