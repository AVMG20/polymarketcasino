<script setup lang="ts">
import { RotateCcw, Trophy } from 'lucide-vue-next'
import type { LeaderboardEntry, LeaderboardResponse } from '#shared/social'
import { ZONES } from '#shared/tycoon'

/**
 * The casino leaderboard: every casino ranked by its value (the chips its
 * finished builds cost), the player's own row always pinned at the bottom. Tap a
 * row to visit that casino. Opened from the HUD on My Casino and from the top
 * bar on the other pages, so it sits in its own layer (under the bar, where
 * there is one) instead of inside the floor page.
 */
const { open, close } = useLeaderboard()
const topBar = useTopBar()
const session = useCasinoSession()
const router = useRouter()

const data = ref<LeaderboardResponse | null>(null)
const loading = ref(false)
const failed = ref(false)

async function load() {
    loading.value = true
    failed.value = false
    try {
        data.value = await $fetch<LeaderboardResponse>('/api/tycoon/leaderboard')
    } catch (error) {
        if (!session.handleUnauthorized(error)) failed.value = true
    } finally {
        loading.value = false
    }
}

watch(open, (isOpen) => {
    if (isOpen) void load()
})

const myId = computed(() => session.player.value?.id ?? null)

function visit(entry: LeaderboardEntry) {
    close()
    void router.push(entry.owner.id === myId.value ? '/' : `/visit/${encodeURIComponent(entry.owner.id)}`)
}

/**
 * The pinned row repeats your own row: hide it while that row is in view in
 * the list (the drawer's scroll box), so you never show twice.
 */
const mineVisible = ref(false)
let observer: IntersectionObserver | null = null
let observed: Element | null = null
function setMineRow(el: unknown) {
    const row = el instanceof Element ? el : null
    if (row === observed) return
    observer?.disconnect()
    observer = null
    observed = row
    mineVisible.value = false
    if (!row) return
    observer = new IntersectionObserver(([entry]) => {
        mineVisible.value = !!entry && entry.isIntersecting && entry.intersectionRatio >= 0.9
    }, { root: row.closest('.drawer-scroll'), threshold: [0, 0.9, 1] })
    observer.observe(row)
}
onBeforeUnmount(() => observer?.disconnect())

const MEDALS = ['#ffc93a', '#d9dde8', '#e0915a'] as const
const ZONE_LIST = ZONES.map(zone => ({ id: zone.id, name: zone.name, art: zoneArt(zone.id) }))
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-50" :style="{ top: topBar.height.value }">
      <TycoonDrawer class="pointer-events-auto" :open="open" dismissable title="Leaderboard" :icon="Trophy" color="#ffc93a" height="82dvh" @close="close()">
        <div class="flex min-h-full flex-col">
          <p class="flex items-center gap-1.5 px-4 pb-2 text-[13px] leading-4 text-[var(--g-muted)]">
            <CasinoChipIcon class="size-4" /> Casino value: the chips everything built cost
          </p>

          <div v-if="!data && loading" class="space-y-2 px-3 pb-4">
            <div v-for="i in 6" :key="i" class="g-well h-[60px] animate-pulse rounded-2xl" />
          </div>

          <div v-else-if="!data && failed" class="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <Trophy class="size-12 text-[var(--g-muted)] opacity-60" />
            <button type="button" class="g-btn g-green h-12 rounded-2xl px-5 text-lg uppercase" @click="load()">
              <RotateCcw class="size-5" :stroke-width="3" /> Try again
            </button>
          </div>

          <template v-else-if="data">
            <p v-if="!data.entries.length" class="px-6 py-10 text-center text-[var(--g-muted)]">No casinos yet</p>
            <ol class="flex-1 space-y-1.5 px-3 pb-3">
              <li v-for="entry in data.entries" :key="entry.owner.id" :ref="entry.owner.id === myId ? setMineRow : undefined">
                <TycoonLeaderboardRow :entry="entry" :me="entry.owner.id === myId" :medal="MEDALS[entry.rank - 1] ?? null" :zones="ZONE_LIST" @select="visit(entry)" />
              </li>
            </ol>
            <div v-if="data.me" class="pinned sticky bottom-0 border-t-2 border-black/40 bg-[#2a1f3f] px-3 pt-2 pb-3 shadow-[0_-8px_16px_rgb(0_0_0/0.3)]" :class="mineVisible ? 'pinned-off' : ''" :aria-hidden="mineVisible || undefined" :inert="mineVisible || undefined">
              <TycoonLeaderboardRow :entry="data.me" me :medal="null" :zones="ZONE_LIST" @select="visit(data.me)" />
            </div>
          </template>
        </div>
        <template #extra>
          <span v-if="data" class="g-num flex shrink-0 items-center gap-1 text-sm text-[var(--g-muted)]" :title="`${data.total} casinos`">
            #{{ data.me?.rank ?? '–' }}<span class="opacity-60">/{{ data.total }}</span>
          </span>
        </template>
      </TycoonDrawer>
    </div>
  </Teleport>
</template>

<style scoped>
/* Your own row is in the list: the pinned copy slides away (it keeps its space, so the list doesn't jump). */
.pinned { transition: transform 0.2s ease, opacity 0.2s ease; }
.pinned-off { transform: translateY(100%); opacity: 0; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .pinned { transition: opacity 0.15s ease; }
  .pinned-off { transform: none; }
}
</style>
