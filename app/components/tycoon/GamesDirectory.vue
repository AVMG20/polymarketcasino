<script setup lang="ts">
import { Check, Eye, HardHat, LayoutGrid, Lock, Star } from 'lucide-vue-next'
import { GAMES } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import { nextStar } from '#shared/stars'
import { findTycoonGame, findZone, TYCOON_GAMES, ZONES } from '#shared/tycoon'

/** Every game as a cover tile with its state on your floor. Tap: walk there (built) or its build card. */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], walk: [slug: string], play: [slug: string], build: [slug: string] }>()

const tycoon = useTycoon()
const { wallet } = useWallet()
/** The next star and the chips it takes to hold it (null at ten). */
const next = computed(() => (wallet.value ? nextStar(wallet.value.stars.level) : null))

const groups = computed(() => {
    const s = tycoon.state.value
    const list = ZONES.map(zone => ({
        id: zone.id,
        name: zone.name,
        owned: !!s?.zones.includes(zone.id),
        art: zoneArt(zone.id),
        games: TYCOON_GAMES.filter(g => g.zone === zone.id).map(g => GAMES.find(game => game.slug === g.slug)).filter(g => !!g)
    })).filter(group => group.games.length)
    const others = GAMES.filter(game => !findTycoonGame(game.slug))
    return others.length ? [...list, { id: 'more', name: 'More', owned: true, art: zoneArt('main'), games: others }] : list
})

type Status = { kind: 'built', level: number } | { kind: 'building', progress: number, leftMs: number } | { kind: 'open' } | { kind: 'locked', zone: string }

function statusOf(slug: string): Status {
    const s = tycoon.state.value
    const level = s?.games[slug] ?? 0
    const running = tycoon.queue.value.find(c => c.kind === 'game' && c.id === slug)
    if (running && level === 0) return { kind: 'building', progress: 1 - running.leftMs / running.total, leftMs: running.leftMs }
    if (level >= 1) return { kind: 'built', level }
    const def = findTycoonGame(slug)
    if (def && s && !s.zones.includes(def.zone)) return { kind: 'locked', zone: findZone(def.zone)?.name ?? def.zone }
    return { kind: 'open' }
}

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
      <div v-if="wallet" class="g-well flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-3 py-2" :title="`Your stars follow your chips: hold more chips for more stars (${wallet.stars.level} of 10)`">
        <span class="flex items-center gap-1.5">
          <Star class="size-4 fill-[#ffc93a] text-[#ffc93a]" :stroke-width="2.5" />
          <span class="g-title text-sm uppercase">Stars</span>
          <span class="g-num text-sm text-[var(--g-muted)]">{{ wallet.stars.level }}/10</span>
        </span>
        <CasinoStarTrack :level="wallet.stars.level" size="sm" />
        <span class="flex w-full items-center gap-1 text-xs font-semibold text-[var(--g-muted)]">
          <template v-if="next">Hold <CasinoChipIcon class="size-3.5" /><span class="g-num text-[var(--g-ink)]">{{ formatCoins(next.threshold) }}</span> chips for the next star</template>
          <template v-else>Every star is yours: keep holding your chips</template>
        </span>
      </div>

      <section v-for="group in groups" :key="group.id" class="space-y-2">
        <h3 class="flex items-center gap-2">
          <span class="grid size-7 place-items-center rounded-lg border-2 border-black/40" :style="{ background: group.art.color }">
            <component :is="group.art.icon" class="size-4 text-white" :stroke-width="2.75" />
          </span>
          <span class="g-title text-lg">{{ group.name }}</span>
          <Lock v-if="!group.owned" class="size-4 text-[#ffc93a]" :stroke-width="3" />
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
                  <span v-else-if="status.kind === 'locked'" class="absolute inset-0 grid place-items-center">
                    <span class="grid size-9 place-items-center rounded-full border-2 border-black/50 bg-[#1b1329]/90"><Lock class="size-4 text-[#ffc93a]" :stroke-width="3" /></span>
                  </span>
                  <span v-else class="absolute inset-0 grid place-items-center">
                    <span class="grid size-10 place-items-center rounded-full border-2 border-black/50 bg-[#3fd25a] shadow-[0_3px_0_#1b8a33]"><HardHat class="size-5 text-white" :stroke-width="2.75" /></span>
                  </span>
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
