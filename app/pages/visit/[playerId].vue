<script setup lang="ts">
import { Heart, Home, Lock, Megaphone, RotateCcw, Sparkles, Trophy, Users } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { findGame } from '#shared/games/registry'
import { formatCoins, formatCoinsExact } from '#shared/money'
import { skinOf } from '#shared/cosmetics'
import type { CasinoVisit, LikeResponse } from '#shared/social'
import { emptyCounts } from '#shared/visitors'
import { findCampaign, findZone, MAX_LEVEL, seatsOf, TYCOON_GAMES, ZONES, type ZoneId } from '#shared/tycoon'
import CasinoFloor from '~/components/tycoon/CasinoFloor.vue'
import { levelForXp, roomLook, XP_CHIPS } from '#shared/casino-level'
import { homeSpot, zoneAt } from '#shared/floor/layout'
import { placedDecorations, standingRect } from '~/composables/useFloorScene'
import { QUICK_GAMES } from '~/utils/game-embed'
import type { FloorApi, FloorPlot, FloorScene, FloorTarget, FloorZone } from '~/utils/floor/types'

/**
 * Visiting another player's casino: their floor, read-only. Your avatar
 * walks around as a guest, theirs idles by the builder desk. Their built
 * games play here like at home (the same overlay), with your own coins and
 * chips: rounds and seats pass the host, and the 1% rakeback on your bets
 * goes into their cage as coins instead of yours (the game overlay says so;
 * an owner on their floor sees it come in live). No balances of
 * theirs, no build menu.
 */
const route = useRoute()
const router = useRouter()
const session = useCasinoSession()
const { host } = useVisitHost()
const events = useFloorEvents()
const tycoon = useTycoon()
const floor = ref<FloorApi | null>(null)
// Your own avatar walks here in your own clothes: read your casino once if this page opened first.
onMounted(() => {
    if (!tycoon.state.value) void tycoon.refresh()
})

const ownerId = computed(() => typeof route.params.playerId === 'string' ? route.params.playerId : '')
const visit = ref<CasinoVisit | null>(null)
// Everyone walking around this casino, its owner too when they are in.
const presence = useFloorPresence(() => visit.value?.owner.id)
/** Server time minus Date.now() when the visit was read. */
const offset = ref(0)
const failed = ref<'missing' | 'error' | null>(null)
const floorReady = ref(false)
const floorFailed = ref(false)
const floorKey = ref(0)
const liking = ref(false)
const heartPop = ref(0)

type Info =
    | { kind: 'game', slug: string, level: number, golden: boolean }
    | { kind: 'owner' }
    | { kind: 'cage' }
    | { kind: 'zone', id: ZoneId }
const info = ref<Info | null>(null)

async function load() {
    const id = ownerId.value
    failed.value = null
    try {
        const read = await $fetch<CasinoVisit>(`/api/tycoon/visit/${encodeURIComponent(id)}`)
        if (id !== ownerId.value) return
        visit.value = read
        offset.value = read.serverNow - Date.now()
        host.value = { id: read.owner.id, name: read.owner.name, games: { ...read.games } }
    } catch (error) {
        if (session.handleUnauthorized(error)) return
        const status = apiStatus(error)
        failed.value = status === 404 || status === 400 ? 'missing' : 'error'
    }
}

// Your own casino is the real one.
watch([ownerId, () => session.player.value?.id], ([id, me]) => {
    if (!id || id === me) {
        void router.replace('/')
        return
    }
    if (visit.value?.owner.id !== id) {
        visit.value = null
        host.value = null
        info.value = null
        floorReady.value = false
        void load()
    }
}, { immediate: true })

const ownerName = computed(() => visit.value?.owner.name ?? '')
const campaign = computed(() => visit.value?.campaign ? findCampaign(visit.value.campaign) ?? null : null)

const scene = computed<FloorScene | null>(() => {
    const v = visit.value
    if (!v) return null
    const owned = new Set<string>(v.zones)
    // Their zones wear their skins.
    const zones: FloorZone[] = ZONES.map(zone => ({ id: zone.id, owned: owned.has(zone.id), available: false, construction: null, skin: skinOf(v.skins, zone.id) }))
    const plots: FloorPlot[] = TYCOON_GAMES.map((game) => {
        const level = v.games[game.slug] ?? 0
        // A first build in progress stands on the floor as scaffolding (no countdown: visitors don't see the times).
        const building = level === 0 && !!v.building?.includes(game.slug)
        return {
            id: game.slug,
            archetype: game.archetype,
            accent: game.accent,
            zone: game.zone,
            // Not built: not drawn (no build signs in someone else's casino).
            status: building ? 'building' : level >= 1 ? 'built' : 'locked',
            rect: level >= 1 || building ? standingRect(v.placements, game.slug) : null,
            level,
            golden: v.golden.includes(game.slug),
            construction: null,
            occupancy: null
        }
    })
    return {
        zones,
        plots,
        decorations: placedDecorations(v.decorations),
        // The cage is the owner's: drawn empty.
        cage: { fill: 0, stored: 0 },
        // Their room look follows their casino level (older payloads: worked out from the casino's value).
        decor: v.look ?? roomLook(v.level ?? levelForXp(Math.floor(v.value / XP_CHIPS))),
        guestsPerHour: 0,
        visitors: v.floor?.visitors ?? { ...emptyCounts(), tourist: v.visitors },
        queue: v.floor?.turnedAway ?? v.queue,
        campaign: v.campaign,
        rush: false,
        player: { name: session.player.value?.name ?? 'You', image: session.player.value?.image ?? null, avatar: tycoon.state.value?.cosmetics?.avatar ?? null },
        owner: { name: v.owner.name, image: v.owner.image, avatar: v.owner.avatar ?? null },
        clockOffset: offset.value
    }
})

// A game opened from their floor: ?play=<slug>, like at home.
const playSlug = computed(() => {
    const slug = route.query.play
    return typeof slug === 'string' && findGame(slug) && (visit.value?.games[slug] ?? 0) >= 1 ? slug : null
})
const fullScreenGame = computed(() => !!playSlug.value && !QUICK_GAMES.includes(playSlug.value))
let pushed = false

function openGame(slug: string) {
    info.value = null
    if (playSlug.value) void router.replace({ query: { play: slug } })
    else {
        pushed = true
        void router.push({ query: { play: slug } })
    }
    if (QUICK_GAMES.includes(slug)) floor.value?.focus({ kind: 'game', id: slug })
}

function closeGame() {
    if (pushed) router.back()
    else void router.replace({ query: {} })
    pushed = false
}

events.onRound((event) => {
    floor.value?.celebrate(event.slug, { payout: event.payout, stake: event.stake, chipsEarned: event.chipsEarned, big: event.payout > 0 && event.payout >= event.stake * 10 })
})
events.onPlaying((slug, on) => floor.value?.playing(slug, on))

onBeforeUnmount(() => {
    host.value = null
})

function onInteract(target: FloorTarget) {
    const v = visit.value
    if (!v) return
    switch (target.kind) {
        case 'game':
            if ((v.games[target.id] ?? 0) >= 1 && findGame(target.id)) openGame(target.id)
            else info.value = { kind: 'game', slug: target.id, level: v.games[target.id] ?? 0, golden: v.golden.includes(target.id) }
            return
        case 'builder':
            info.value = { kind: 'owner' }
            return
        case 'cage':
            info.value = { kind: 'cage' }
            return
        case 'zone':
            info.value = { kind: 'zone', id: target.id }
    }
}

async function like() {
    const v = visit.value
    if (!v || v.likedToday || liking.value) return
    liking.value = true
    try {
        const result = await $fetch<LikeResponse>(`/api/tycoon/visit/${encodeURIComponent(v.owner.id)}/like`, { method: 'POST' })
        if (visit.value?.owner.id === v.owner.id) {
            visit.value = { ...visit.value, likes: result.likes, likedToday: true }
            heartPop.value++
        }
    } catch (error) {
        if (!session.handleUnauthorized(error)) toast.error(apiErrorMessage(error, 'Could not leave a heart'))
    } finally {
        liking.value = false
    }
}

function onFloorReady() {
    floorFailed.value = false
    floorReady.value = true
}
function onFloorError() {
    floorFailed.value = true
    floorReady.value = false
}
function retryFloor() {
    floorFailed.value = false
    floorReady.value = false
    floorKey.value++
}

const infoGame = computed(() => info.value?.kind === 'game' ? findGame(info.value.slug) ?? null : null)
const infoZone = computed(() => {
    const i = info.value
    if (i?.kind === 'game') {
        // Where it stands on their floor (games can stand in any room).
        const at = visit.value?.placements?.[i.slug] ?? homeSpot(i.slug)
        const zone = at ? zoneAt(at.x, at.y) : null
        return zone ? findZone(zone) ?? null : null
    }
    if (i?.kind === 'zone') return findZone(i.id) ?? null
    return null
})

useHead({ title: () => ownerName.value ? `${ownerName.value}'s casino` : 'Visiting' })
</script>

<template>
  <div class="relative h-[calc(100dvh-var(--topbar-h,3.5rem))] overflow-hidden bg-[#1c1424]">
    <CasinoFloor v-if="scene" :key="`${visit?.owner.id}:${floorKey}`" ref="floor" class="absolute inset-0" :scene="scene" :paused="fullScreenGame" :remotes="presence.remotes.value" @interact="onInteract" @move="presence.move" @ready="onFloorReady" @error="onFloorError" />

    <!-- Loading, missing casino, or no floor. -->
    <div v-if="!scene || !floorReady" class="g-ui absolute inset-0 z-20 grid place-items-center bg-[#1c1424]">
      <div v-if="failed === 'missing'" class="flex flex-col items-center gap-4 px-6 text-center">
        <Lock class="size-14 text-[var(--g-muted)] opacity-70" />
        <p class="g-title text-xl uppercase">No casino here</p>
        <NuxtLink to="/" class="g-btn g-green h-14 rounded-2xl px-6 text-xl uppercase"><Home class="size-6" :stroke-width="2.75" /> Back to my casino</NuxtLink>
      </div>
      <div v-else-if="failed === 'error' || floorFailed" class="flex flex-col items-center gap-4 px-6 text-center">
        <CasinoChipIcon class="size-16 opacity-60 grayscale" />
        <button type="button" class="g-btn g-green h-14 rounded-2xl px-6 text-xl uppercase" @click="floorFailed ? retryFloor() : load()">
          <RotateCcw class="size-5" :stroke-width="3" /> Try again
        </button>
      </div>
      <div v-else class="flex flex-col items-center gap-3 px-6 text-center">
        <CasinoChipIcon class="loader-chip size-16" />
        <p class="g-title text-xl uppercase">{{ ownerName ? `Visiting ${ownerName}` : 'Visiting' }}</p>
      </div>
    </div>

    <template v-if="visit && floorReady">
      <!-- Whose casino this is. -->
      <header class="g-ui g-panel absolute inset-x-2 top-2 z-30 flex items-center gap-2.5 rounded-[22px] p-2 pr-2.5 md:right-auto md:left-3 md:w-[26rem]">
        <button type="button" class="relative size-[46px] shrink-0" :aria-label="`About ${ownerName}`" @click="info = { kind: 'owner' }">
          <span class="grid size-full place-items-center overflow-hidden rounded-full border-2 border-black/50 bg-[#2a1f3f]">
            <TycoonAvatarPortrait :name="visit.owner.name" :avatar="visit.owner.avatar" :size="44" />
          </span>
          <span v-if="presence.ownerOnline.value" class="online absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-[#1c1424] bg-[#4ade80]" :title="`${ownerName} is here now`" />
        </button>
        <div class="min-w-0 flex-1">
          <p class="text-[11px] leading-3 font-semibold tracking-wider text-[var(--g-muted)] uppercase">Visiting</p>
          <h1 class="g-title truncate text-xl leading-6">{{ ownerName }}'s casino</h1>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] leading-4 font-semibold">
            <span v-if="visit.rank" class="g-num flex items-center gap-1 text-[#ffc93a]" title="Leaderboard rank"><Trophy class="size-3.5" :stroke-width="3" />#{{ visit.rank }}</span>
            <span class="g-num flex items-center gap-1" :title="`Casino value: ${formatCoinsExact(visit.value)} chips`"><CasinoChipIcon class="size-3.5" />{{ formatCoins(visit.value) }}</span>
            <span v-if="visit.floor" class="g-num flex items-center gap-1" :title="`${visit.visitors} guests in ${visit.seats} seats`">
              <TycoonVisitorDots :counts="visit.floor.visitors" size="sm" /><span class="text-[var(--g-muted)]">/{{ visit.seats }}</span>
            </span>
            <span v-else class="g-num flex items-center gap-1 text-[#9fd7ff]" :title="`${visit.visitors} visitors in ${visit.seats} seats`"><Users class="size-3.5" :stroke-width="3" />{{ visit.visitors }}/{{ visit.seats }}</span>
            <span v-if="campaign" class="flex items-center gap-1 text-[#ffb35c]" :title="`${campaign.name} running`"><Megaphone class="size-3.5" :stroke-width="3" /><span class="max-sm:sr-only">{{ campaign.name }}</span></span>
          </p>
        </div>
        <button
          type="button"
          class="g-btn g-red h-12 min-w-14 shrink-0 flex-col gap-0 rounded-2xl px-2.5 leading-none"
          :class="visit.likedToday ? 'liked' : ''"
          :disabled="liking"
          :aria-pressed="visit.likedToday"
          :aria-label="visit.likedToday ? `You left a heart today (${visit.likes})` : `Leave a heart (${visit.likes})`"
          :title="visit.likedToday ? 'You left a heart today' : 'Leave a heart (once a day)'"
          @click="like()"
        >
          <Heart :key="heartPop" class="size-5" :class="[visit.likedToday ? 'fill-current' : '', heartPop ? 'g-pop' : '']" :stroke-width="2.75" />
          <span class="g-num text-sm">{{ visit.likes }}</span>
        </button>
      </header>

      <!-- The way home. -->
      <div v-if="!info && !playSlug" class="g-ui pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
        <NuxtLink to="/" class="g-btn g-green pointer-events-auto h-14 rounded-2xl px-6 text-xl uppercase">
          <Home class="size-6" :stroke-width="2.75" /> Back to my casino
        </NuxtLink>
      </div>
    </template>

    <!-- What was tapped: a small card, never a game or a build menu. -->
    <TycoonDrawer :open="!!info" card dismissable @close="info = null">
      <div v-if="info?.kind === 'game'" class="flex items-center gap-3 p-3 pr-14">
        <span class="relative size-16 shrink-0 overflow-hidden rounded-2xl border-2 border-black/50">
          <span class="block size-full" :class="info.level ? '' : 'grayscale brightness-50'"><TycoonGameArt :slug="info.slug" /></span>
          <span v-if="info.golden" class="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full border-2 border-black/50 bg-[#ffc93a]" title="Golden"><Sparkles class="size-3 text-[#4a2a00]" :stroke-width="3" /></span>
        </span>
        <div class="min-w-0">
          <p class="g-title truncate text-xl leading-6">{{ infoGame?.name ?? info.slug }}<template v-if="info.level"> · Lv {{ info.level }}</template></p>
          <p v-if="info.level" class="mt-1 flex items-center gap-2">
            <TycoonPips :level="info.level" :max="MAX_LEVEL" size="md" />
            <span class="g-num flex items-center gap-1 text-sm text-[#9fd7ff]" title="Seats"><Users class="size-3.5" :stroke-width="3" />{{ seatsOf(info.slug, info.level) }}</span>
          </p>
          <p v-else class="mt-1 flex items-center gap-1.5 text-sm text-[var(--g-muted)]"><Lock class="size-3.5" :stroke-width="3" />Not built yet</p>
          <p v-if="infoZone" class="mt-0.5 truncate text-xs text-[var(--g-muted)]">{{ infoZone.name }}</p>
        </div>
      </div>
      <div v-else-if="info?.kind === 'owner' && visit" class="flex items-center gap-3 p-3 pr-14">
        <span class="stage grid shrink-0 place-items-end overflow-hidden rounded-2xl border-2 border-black/50 px-1"><TycoonAvatarPortrait :name="visit.owner.name" :avatar="visit.owner.avatar" crop="full" :size="72" /></span>
        <div class="min-w-0">
          <p class="g-title truncate text-xl leading-6">{{ visit.owner.name }}</p>
          <p class="text-sm text-[var(--g-muted)]">Owner · {{ findZone(visit.tier)?.name }}</p>
          <p class="mt-1 flex flex-wrap items-center gap-x-3 text-sm font-semibold">
            <span v-if="visit.rank" class="g-num flex items-center gap-1 text-[#ffc93a]"><Trophy class="size-3.5" :stroke-width="3" />#{{ visit.rank }}</span>
            <span class="g-num flex items-center gap-1"><CasinoChipIcon class="size-3.5" />{{ formatCoins(visit.value) }}</span>
            <span class="g-num flex items-center gap-1 text-[#ff8fa3]"><Heart class="size-3.5 fill-current" :stroke-width="2.5" />{{ visit.likes }}</span>
          </p>
        </div>
      </div>
      <div v-else-if="info?.kind === 'cage'" class="flex items-center gap-3 p-3 pr-14">
        <span class="block size-14 shrink-0 overflow-hidden rounded-2xl border-2 border-black/40"><TycoonItemArt kind="upgrade" id="cage" /></span>
        <div class="min-w-0">
          <p class="g-title text-xl leading-6">Cashier Cage</p>
          <p class="flex items-center gap-1.5 text-sm text-[var(--g-muted)]"><Lock class="size-3.5" :stroke-width="3" />Only {{ ownerName }} collects here</p>
        </div>
      </div>
      <div v-else-if="info?.kind === 'zone'" class="flex items-center gap-3 p-3 pr-14">
        <span class="block size-14 shrink-0 overflow-hidden rounded-2xl border-2 border-black/40"><TycoonItemArt kind="zone" :id="info.id" /></span>
        <div class="min-w-0">
          <p class="g-title truncate text-xl leading-6">{{ infoZone?.name }}</p>
          <p class="flex items-center gap-1.5 text-sm text-[var(--g-muted)]"><Lock class="size-3.5" :stroke-width="3" />Not open yet</p>
        </div>
      </div>
    </TycoonDrawer>

    <!-- Their games, played with your own coins and chips. -->
    <TycoonGameOverlay :slug="playSlug" @close="closeGame" @build="slug => router.push(`/?build=game:${slug}`)" />
  </div>
</template>

<style scoped>
.liked { --face: #c23a56; --edge: #7d1830; }
.online { animation: online-pulse 2s ease-in-out infinite; }
@keyframes online-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgb(74 222 128 / 0.55); }
  50% { box-shadow: 0 0 0 5px rgb(74 222 128 / 0); }
}
.stage { background: radial-gradient(ellipse at 50% 100%, rgb(255 214 120 / 0.3), transparent 70%), #2a1f3f; }
.loader-chip { animation: loader-spin 1.1s cubic-bezier(0.5, 0, 0.5, 1) infinite; filter: drop-shadow(0 4px 0 rgb(0 0 0 / 0.4)); }
@keyframes loader-spin {
  0% { transform: rotateY(0deg) translateY(0); }
  50% { transform: rotateY(180deg) translateY(-8px); }
  100% { transform: rotateY(360deg) translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .loader-chip, .online { animation: none; }
}
</style>
