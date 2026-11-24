<script setup lang="ts">
import { ChartNoAxesColumn, TriangleAlert } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCoins, formatCoinsExact } from '#shared/money'
import { VISITOR_TIER_IDS, type HistoryResponse } from '#shared/visitors'

useHead({ title: 'Casino stats' })

/**
 * My Casino hour by hour (GET /api/tycoon/history): who came in, per tier,
 * and what the cage took. 24 hours or 3 days.
 */
type Range = HistoryResponse['range']
const route = useRoute()
const router = useRouter()
const range = computed<Range>({
    get: () => (route.query.range === '3d' ? '3d' : '24h'),
    set: v => router.replace({ query: { ...route.query, range: v === '24h' ? undefined : v } })
})
const rangeOptions: { value: Range, label: string, title: string }[] = [
    { value: '24h', label: '24H', title: 'The last 24 hours' },
    { value: '3d', label: '3D', title: 'The last 3 days' }
]

const { data, pending, error, refresh } = useFetch<HistoryResponse>('/api/tycoon/history', {
    query: computed(() => ({ range: range.value }))
})
const hours = computed(() => cageHours(data.value?.hours ?? []))

const tiles = computed(() => {
    const h = hours.value
    if (!data.value) return []
    const income = h.reduce((s, x) => s + x.income, 0)
    const lost = h.reduce((s, x) => s + x.lost, 0)
    const best = h.reduce<(typeof h)[number] | null>((b, x) => (!b || x.income + x.lost > b.income + b.lost ? x : b), null)
    // Averaged over the hours the floor was open (not the hours before the casino existed).
    const open = h.map(x => VISITOR_TIER_IDS.reduce((t, id) => t + (x.visitors[id] ?? 0), 0)).filter(n => n > 0)
    const guestHours = open.reduce((s, n) => s + n, 0)
    const when = (ms: number) => (range.value === '3d' ? formatDayClock(ms) : formatClock(ms))
    return [
        { label: 'Income', value: formatCoins(income), title: `${formatCoinsExact(income)} coins came into your cage`, note: 'coins' },
        { label: 'Busiest hour', value: best && best.income + best.lost > 0 ? formatCoins(best.income + best.lost) : '–', title: 'The hour your guests spent the most (a full cage may have lost some of it)', note: best && best.income + best.lost > 0 ? when(best.at) : '' },
        { label: 'Guests', value: open.length ? new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(guestHours / open.length) : '–', title: 'Guests on your floor, on average', note: 'on average' },
        { label: 'Lost', value: formatCoins(lost), title: lost > 0 ? `${formatCoinsExact(lost)} coins had nowhere to go: the cage was full` : 'Nothing lost to a full cage', note: 'cage full' }
    ]
})
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-5 px-4 py-6">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 class="mr-auto font-display text-2xl font-extrabold tracking-tight">My Casino</h1>
      <NuxtLink to="/stats" class="inline-flex h-10 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8">
        <ChartNoAxesColumn class="size-4 text-muted-foreground" aria-hidden="true" /> Game stats
      </NuxtLink>
      <CasinoSegmented v-model="range" :options="rangeOptions" label="Range" />
    </div>

    <div v-if="error && !data" class="flex flex-col items-center gap-3 rounded-2xl border bg-card px-4 py-12 text-center">
      <TriangleAlert class="size-6 text-destructive" aria-hidden="true" />
      <p class="font-medium">Couldn't load your casino's history</p>
      <Button variant="outline" @click="refresh()">Try again</Button>
    </div>

    <template v-else>
      <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4" :class="pending && data ? 'opacity-60 transition-opacity' : ''">
        <template v-if="data">
          <div v-for="t in tiles" :key="t.label" class="min-w-0 rounded-2xl border bg-card px-4 py-3" :title="t.title">
            <dt class="text-xs text-muted-foreground">{{ t.label }}</dt>
            <dd class="mt-1 truncate font-display text-2xl font-bold leading-tight">{{ t.value }}</dd>
            <dd v-if="t.note" class="truncate text-xs text-muted-foreground">{{ t.note }}</dd>
          </div>
        </template>
        <template v-else>
          <Skeleton v-for="i in 4" :key="i" class="h-[4.75rem] rounded-2xl" />
        </template>
      </dl>

      <section class="min-w-0 rounded-2xl border bg-card p-4" :class="pending && data ? 'opacity-60 transition-opacity' : ''">
        <StatsCasinoChart v-if="data" :hours="hours" :days="range === '3d'" />
        <Skeleton v-else class="h-[380px] rounded-xl" />
      </section>

      <section class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="t in TIERS" :key="t.id" class="min-w-0 rounded-2xl border bg-card px-4 py-3">
          <p class="flex items-center gap-2 text-sm font-semibold">
            <span class="size-3 shrink-0 rounded-full" :style="{ background: tierChartColor(t.id) }" aria-hidden="true" />
            {{ tierPlural(t.id, 2) }}
            <span class="ml-auto text-xs font-normal text-muted-foreground" :title="`Coins an hour one ${t.name} spends, before game levels`">{{ formatCoins(t.spend) }}/h each</span>
          </p>
          <p class="mt-1 text-xs text-muted-foreground">{{ tierBlurb(t.id) }}{{ tierUnlockLine(t.id) ? ` They ${tierUnlockLine(t.id)}.` : '' }}</p>
        </div>
      </section>
    </template>
  </div>
</template>
