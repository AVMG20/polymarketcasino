<script setup lang="ts">
import { ChartArea, RotateCcw, Users } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import { VISITOR_TIERS, type HistoryHour, type HistoryResponse } from '#shared/visitors'

/**
 * "Casino stats": the last 24 hours (or 3 days) of the floor in two simple
 * charts, guests per tier and coins an hour, each with one headline. Opened
 * from the top bar and the guests popover; the game stats page is a tap away.
 */
const stats = useCasinoStats()
const tycoon = useTycoon()
const { embedded } = useHubBridge()

const range = ref<HistoryResponse['range']>('24h')
const data = ref<HistoryResponse | null>(null)
const loading = ref(false)
const failed = ref(false)

async function load() {
    loading.value = true
    failed.value = false
    try {
        data.value = await $fetch<HistoryResponse>('/api/tycoon/history', { query: { range: range.value } })
    } catch {
        failed.value = true
    } finally {
        loading.value = false
    }
}
watch([() => stats.open.value, range], ([open]) => {
    if (open) void load()
}, { immediate: true })

const hours = computed<HistoryHour[]>(() => cageHours(data.value?.hours ?? []))
const when = (ms: number) => (range.value === '3d' ? formatDayClock(ms) : formatClock(ms))
/** Three times under each chart: start, middle, end. */
const ticks = computed(() => {
    const h = hours.value
    if (h.length < 2) return []
    return [h[0]!, h[Math.floor((h.length - 1) / 2)]!, h[h.length - 1]!].map(x => when(x.at))
})

const guestsOf = (h: HistoryHour) => countTotal(h.visitors)
/** Tiers that came at all in this stretch, bottom to top. */
const tierSeries = computed(() => VISITOR_TIERS
    .filter(t => hours.value.some(h => (h.visitors[t.id] ?? 0) > 0))
    .map(t => ({ id: t.id, color: t.color, values: hours.value.map(h => h.visitors[t.id] ?? 0) })))
const busiest = computed(() => hours.value.reduce<HistoryHour | null>((b, h) => (!b || guestsOf(h) > guestsOf(b) ? h : b), null))
const best = computed(() => hours.value.reduce<HistoryHour | null>((b, h) => (!b || h.income > b.income ? h : b), null))
const empty = computed(() => !hours.value.some(h => guestsOf(h) > 0 || h.income > 0))
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-50" :style="{ top: embedded ? '2.75rem' : '3.5rem' }">
      <TycoonDrawer class="pointer-events-auto" :open="stats.open.value" dismissable title="Casino stats" :icon="ChartArea" color="#4aa6ff" height="82dvh" @close="stats.close()">
        <div class="space-y-3 px-3 pb-4">
          <div class="flex gap-2" role="group" aria-label="Range">
            <button
              v-for="r in (['24h', '3d'] as const)"
              :key="r"
              type="button"
              class="g-btn h-11 flex-1 rounded-xl text-base uppercase"
              :class="range === r ? 'g-blue' : 'g-dark opacity-90'"
              :aria-pressed="range === r"
              @click="range = r"
            >
              {{ r === '24h' ? '24 hours' : '3 days' }}
            </button>
          </div>

          <div v-if="!data && failed" class="flex flex-col items-center gap-3 py-8 text-center">
            <ChartArea class="size-10 text-[var(--g-muted)] opacity-60" />
            <button type="button" class="g-btn g-green h-12 rounded-2xl px-5 text-lg uppercase" @click="load()"><RotateCcw class="size-5" :stroke-width="3" /> Try again</button>
          </div>
          <div v-else-if="!data" class="space-y-3">
            <div v-for="i in 2" :key="i" class="g-well h-48 animate-pulse rounded-2xl" />
          </div>

          <template v-else>
            <p v-if="empty" class="g-well rounded-2xl px-3 py-4 text-center text-sm text-[var(--g-muted)]">No guests yet in this stretch. Check back once your floor has been open a while.</p>

            <!-- Guests on the floor, per tier -->
            <section class="g-well rounded-2xl p-3" :class="loading ? 'opacity-60 transition-opacity' : ''">
              <p class="flex items-center gap-1.5">
                <Users class="size-4 text-[#7dd3fc]" :stroke-width="3" />
                <span class="g-title text-base">Guests</span>
              </p>
              <p class="g-num mt-0.5 text-[13px] text-[var(--g-muted)]">
                Now <span class="text-[var(--g-ink)]">{{ tycoon.visitors.value }}</span><template v-if="busiest && guestsOf(busiest) > 0"> · busiest {{ when(busiest.at) }}</template>
              </p>
              <TycoonLineChart class="mt-2" stacked :series="tierSeries" />
              <div class="g-num mt-1 flex justify-between text-[11px] text-[var(--g-muted)]"><span v-for="(t, i) in ticks" :key="i">{{ t }}</span></div>
              <p class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] font-semibold">
                <span v-for="s in tierSeries" :key="s.id" class="flex items-center gap-1"><span class="size-2.5 rounded-full border border-black/50" :style="{ background: s.color }" />{{ tierPlural(s.id, 2) }}</span>
              </p>
            </section>

            <!-- Coins an hour into the cage -->
            <section class="g-well rounded-2xl p-3" :class="loading ? 'opacity-60 transition-opacity' : ''">
              <p class="flex items-center gap-1.5">
                <CasinoCoinIcon class="size-4" />
                <span class="g-title text-base">Income</span>
              </p>
              <p class="g-num mt-0.5 text-[13px] text-[var(--g-muted)]">
                Now <span class="text-[#7ee08f]">{{ formatCoins(tycoon.perHour.value) }}/h</span><template v-if="best && best.income > 0"> · best hour {{ when(best.at) }}</template>
              </p>
              <TycoonLineChart class="mt-2" :series="[{ color: '#7ee08f', values: hours.map(h => h.income) }]" />
              <div class="g-num mt-1 flex justify-between text-[11px] text-[var(--g-muted)]"><span v-for="(t, i) in ticks" :key="i">{{ t }}</span></div>
            </section>
          </template>

        </div>
      </TycoonDrawer>
    </div>
  </Teleport>
</template>
