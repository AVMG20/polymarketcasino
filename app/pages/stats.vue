<script setup lang="ts">
import { ChartArea, Coins, Gem, Gift, ListChecks, TriangleAlert, Vault, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCoins, formatCoinsExact } from '#shared/money'
import { COINS_PER_GEM } from '#shared/economy'
import { findGame } from '#shared/games/registry'
import { isStatsRange, STATS_RANGES, type PlayerStats, type StatsRange } from '#shared/stats'

useHead({ title: 'Stats' })

const route = useRoute()
const router = useRouter()
const DEFAULT_RANGE: StatsRange = '30d'
const range = computed<StatsRange>({
    get: () => (isStatsRange(route.query.range) ? route.query.range : DEFAULT_RANGE),
    set: v => router.replace({ query: { ...route.query, range: v === DEFAULT_RANGE ? undefined : v } })
})
const game = computed<string | null>({
    get: () => (typeof route.query.game === 'string' && route.query.game ? route.query.game : null),
    set: v => router.replace({ query: { ...route.query, game: v ?? undefined } })
})
const rangeOptions = STATS_RANGES.map(value => ({ value, label: value === 'all' ? 'All' : value.toUpperCase(), title: value === 'all' ? 'All time' : `Last ${value.slice(0, -1)} days` }))

const { data: stats, pending, error, refresh } = useFetch<PlayerStats>('/api/me/stats', {
    query: computed(() => ({ range: range.value, game: game.value ?? undefined }))
})

const gameName = computed(() => (game.value ? stats.value?.games.find(g => g.game === game.value)?.name ?? findGame(game.value)?.name ?? game.value : ''))

/** Big numbers go compact so a tile never overflows; the exact value sits in the title. */
const short = (v: number) => (Math.abs(v) >= 1e6 ? formatCoins(v, true) : formatCoins(v))
const signedShort = (v: number) => formatSignedCoins(v, Math.abs(v) >= 1e6)

const tiles = computed(() => {
    const s = stats.value?.summary
    if (!s) return []
    const winGame = s.biggestWinGame ? stats.value!.games.find(g => g.game === s.biggestWinGame)?.name ?? s.biggestWinGame : null
    // Stakes are paid coins first, then chips; every payout is chips.
    const coins = s.wageredCoins ?? s.wagered
    const chips = s.wageredChips ?? 0
    return [
        { label: 'Net', value: signedShort(s.net), title: `${formatCoinsExact(s.net)}: chips paid out minus coins and chips wagered`, note: '' },
        {
            label: 'Wagered',
            value: short(s.wagered),
            title: `${formatCoinsExact(coins)} coins + ${formatCoinsExact(chips)} chips`,
            note: chips > 0 ? `${short(coins)} coins · ${short(chips)} chips` : 'coins'
        },
        { label: 'Paid out', value: short(s.paidOut), title: `${formatCoinsExact(s.paidOut)} chips`, note: 'chips' },
        { label: 'Return', value: formatReturn(s.returnRate), title: 'Paid out ÷ wagered', note: '' },
        { label: 'Rounds', value: short(s.rounds), title: formatCoinsExact(s.rounds), note: '' },
        {
            label: 'Best win',
            value: s.biggestWin ? short(s.biggestWin) : '–',
            title: s.biggestWin ? `${formatCoinsExact(s.biggestWin)} chips profit on one round` : 'Biggest profit on one round',
            note: winGame && s.biggestWinDay ? `${game.value ? '' : `${winGame} · `}${formatDay(s.biggestWinDay)}` : ''
        }
    ]
})

const FLOW_LABELS = {
    allowance: { label: 'Daily allowance', icon: Gift },
    convert: { label: 'Gems converted', icon: Gem },
    cage: { label: 'Cashier cage', icon: Vault },
    mission: { label: 'Daily missions', icon: ListChecks }
} as const

// The daily allowance is gone: it only shows for a range that still has old claims in it.
const flows = computed(() => (stats.value?.flows ?? []).filter(f => f.category !== 'allowance' || f.count > 0).map(f => ({
    ...f,
    ...FLOW_LABELS[f.category],
    detail: f.category === 'convert' ? `${formatCoins(f.amount / COINS_PER_GEM)} gems` : `${f.count}×`
})))
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-5 px-4 py-6">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 class="mr-auto font-display text-2xl font-extrabold tracking-tight">Stats</h1>
      <NuxtLink to="/casino-stats" class="inline-flex h-10 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8">
        <ChartArea class="size-4 text-muted-foreground" aria-hidden="true" /> My Casino
      </NuxtLink>
      <button
        v-if="game"
        type="button"
        class="inline-flex h-10 items-center gap-1.5 rounded-xl border bg-card pr-2 pl-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8"
        :aria-label="`Show every game, not just ${gameName}`"
        title="Every game"
        @click="game = null"
      >
        {{ gameName }}
        <X class="size-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
      <CasinoSegmented v-model="range" :options="rangeOptions" label="Range" />
    </div>

    <div v-if="error && !stats" class="flex flex-col items-center gap-3 rounded-2xl border bg-card px-4 py-12 text-center">
      <TriangleAlert class="size-6 text-destructive" aria-hidden="true" />
      <p class="font-medium">Couldn't load your stats</p>
      <Button variant="outline" @click="refresh()">Try again</Button>
    </div>

    <template v-else>
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" :class="pending && stats ? 'opacity-60 transition-opacity' : ''">
        <template v-if="stats">
          <div v-for="t in tiles" :key="t.label" class="min-w-0 rounded-2xl border bg-card px-4 py-3" :title="t.title">
            <dt class="text-xs text-muted-foreground">{{ t.label }}</dt>
            <dd class="mt-1 truncate font-display text-2xl font-bold leading-tight">{{ t.value }}</dd>
            <dd v-if="t.note" class="truncate text-xs text-muted-foreground">{{ t.note }}</dd>
          </div>
        </template>
        <template v-else>
          <Skeleton v-for="i in 6" :key="i" class="h-[4.75rem] rounded-2xl" />
        </template>
      </dl>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section class="min-w-0 rounded-2xl border bg-card p-4" :class="pending && stats ? 'opacity-60 transition-opacity' : ''">
          <StatsDailyChart v-if="stats" :days="stats.days" :cumulative="!!stats.game" />
          <Skeleton v-else class="h-[336px] rounded-xl" />
        </section>

        <section class="min-w-0 space-y-3 rounded-2xl border bg-card p-4" :class="pending && stats ? 'opacity-60 transition-opacity' : ''">
          <h2 class="text-sm font-semibold">Outside games</h2>
          <template v-if="stats">
            <ul class="divide-y">
              <li v-for="f in flows" :key="f.category" class="flex items-center gap-3 py-2.5">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <component :is="f.icon" class="size-4" aria-hidden="true" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm">{{ f.label }}</span>
                  <span class="block text-xs text-muted-foreground">{{ f.detail }}</span>
                </span>
                <span class="font-semibold tabular-nums" :title="`${formatCoinsExact(f.amount)} coins`">{{ formatSignedCoins(f.amount) }}</span>
              </li>
              <li class="flex items-center gap-3 py-2.5">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Coins class="size-4" aria-hidden="true" />
                </span>
                <span class="min-w-0 flex-1 truncate text-sm">Coin balance</span>
                <span class="text-right font-semibold tabular-nums" :title="`${formatCoinsExact(stats.balance.start)} → ${formatCoinsExact(stats.balance.end)} coins`">
                  <span class="text-muted-foreground">{{ short(stats.balance.start) }} →</span> {{ short(stats.balance.end) }}
                </span>
              </li>
            </ul>
          </template>
          <Skeleton v-else class="h-40 rounded-xl" />
        </section>
      </div>

      <section class="min-w-0 rounded-2xl border bg-card p-4" :class="pending && stats ? 'opacity-60 transition-opacity' : ''">
        <h2 class="mb-1 text-sm font-semibold">Games</h2>
        <template v-if="stats">
          <StatsGameTable v-if="stats.games.length" :games="stats.games" :selected="game" @select="game = $event" />
          <p v-else class="py-8 text-center text-sm text-muted-foreground">No rounds</p>
        </template>
        <Skeleton v-else class="h-40 rounded-xl" />
      </section>
    </template>
  </div>
</template>
