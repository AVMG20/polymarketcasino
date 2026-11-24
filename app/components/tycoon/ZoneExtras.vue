<script setup lang="ts">
import { Check, PaintRoller } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import { findGame } from '#shared/games/registry'
import { fullIncomePerHour, guestsPerHour, TYCOON_GAMES, type ZoneId } from '#shared/tycoon'

/**
 * What a zone brings, on its detail card: the games it holds (with their
 * level once built), the coins an hour they can add on average once built, and, once the zone is
 * open, its skins (previewed live on the floor).
 */
const props = defineProps<{ id: ZoneId }>()
const tycoon = useTycoon()

const games = computed(() => TYCOON_GAMES.filter(game => game.zone === props.id).map(game => ({
    slug: game.slug,
    name: findGame(game.slug)?.name ?? game.slug,
    level: tycoon.state.value?.games[game.slug] ?? 0
})))
/**
 * Cage coins an hour on average these games add with each one built (at least
 * level 1) and the zone open: the casino with them minus as it is now.
 */
const income = computed(() => {
    const s = tycoon.state.value
    const all = Object.fromEntries(games.value.map(game => [game.slug, Math.max(1, game.level)]))
    if (!s) return fullIncomePerHour({ games: all })
    const zones = s.zones.includes(props.id) ? s.zones : [...s.zones, props.id]
    const gain = guestsPerHour({ ...s, zones, games: { ...s.games, ...all } }, s.serverNow) - guestsPerHour(s, s.serverNow)
    return Math.max(0, Math.round(gain))
})
const owned = computed(() => !!tycoon.state.value?.zones.includes(props.id))
</script>

<template>
  <div class="space-y-3">
    <div class="g-well rounded-2xl p-2">
      <div class="mb-1.5 flex items-center justify-between px-1">
        <span class="text-[11px] font-semibold tracking-wider text-[var(--g-muted)] uppercase">{{ games.length }} games</span>
        <span class="g-num flex items-center gap-1 text-sm text-[#ffc93a]" :title="`About ${formatCoins(income)} more coins an hour on average for your cage with every game here built`"><CasinoCoinIcon class="size-4" />+{{ formatCoins(income) }}/h</span>
      </div>
      <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        <div
          v-for="game in games"
          :key="game.slug"
          class="flex min-w-0 flex-col items-center gap-1 rounded-xl p-1"
          :title="game.level ? `${game.name} · Lv ${game.level}` : game.name"
        >
          <span class="relative block aspect-square w-full overflow-hidden rounded-xl border-2 border-black/50" :class="game.level ? '' : 'grayscale-[0.5]'">
            <TycoonGameArt :slug="game.slug" />
            <span v-if="game.level" class="g-num absolute bottom-0.5 left-0.5 rounded-full border-2 border-black/50 bg-[#1b1329]/90 px-1 text-[10px] leading-3.5">Lv {{ game.level }}</span>
            <span v-if="game.level" class="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full border-[1.5px] border-black/50 bg-[#3fd25a]"><Check class="size-2.5 text-white" :stroke-width="4" /></span>
          </span>
          <span class="w-full truncate text-center text-[11px] leading-3.5 font-semibold">{{ game.name }}</span>
        </div>
      </div>
    </div>

    <div v-if="owned" class="space-y-2">
      <p class="flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wider text-[var(--g-muted)] uppercase"><PaintRoller class="size-3.5" :stroke-width="3" /> Skin</p>
      <TycoonSkinPicker :zone="id" />
    </div>
  </div>
</template>
