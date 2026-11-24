<script setup lang="ts">
import { HardHat, ListChecks, Megaphone, RotateCcw, ScrollText } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import type { MissionId } from '#shared/missions'
import { homeSpot, type Tile } from '#shared/floor/layout'
import type { BuildKind, ZoneId } from '#shared/tycoon'
import CasinoFloor from '~/components/tycoon/CasinoFloor.vue'
import { QUICK_GAMES } from '~/utils/game-embed'
import { COLLECT_LAND_MS, type ArrangeItem, type FloorApi, type FloorFocusOptions, type FloorTarget } from '~/utils/floor/types'

/** My Casino: the floor fills the screen, the HUD and the sheets sit on top. */
const route = useRoute()
const router = useRouter()
const tycoon = useTycoon()
const events = useFloorEvents()
const { scene, startPolling } = useFloorScene()
const cosmetics = useCosmetics()
const sound = useTycoonSound()
const leaderboard = useLeaderboard()
const houseRules = useHouseRules()
const session = useCasinoSession()
// Visitors walking around your casino (and you, in your other tabs' eyes).
const presence = useFloorPresence(() => session.player.value?.id)

const floor = ref<FloorApi | null>(null)
const floorReady = ref(false)
/** The floor could not start (no WebGL): offer a retry instead of an endless loader. */
const floorFailed = ref(false)
const floorKey = ref(0)
const onboarding = ref<{ markCollected: () => void } | null>(null)

const buildOpen = ref(false)
const buildTab = ref('games')
const gamesOpen = ref(false)
const campaignsOpen = ref(false)
const buildersOpen = ref(false)
const missionsOpen = ref(false)
const card = ref<{ kind: BuildKind, id: string } | null>(null)
const arrange = useArrange()

const playSlug = computed(() => {
    const slug = route.query.play
    return typeof slug === 'string' && findGame(slug) ? slug : null
})
const fullScreenGame = computed(() => !!playSlug.value && !QUICK_GAMES.includes(playSlug.value))
let pushed = false

// The floor mounts after the first read: focus and walk requests that arrive
// before its @ready are kept (the latest of each) and applied then.
let pendingFocus: { target: FloorTarget, options?: FloorFocusOptions } | null = null
let pendingWalk: FloorTarget | null = null
function focusFloor(target: FloorTarget, options?: FloorFocusOptions) {
    if (floor.value && floorReady.value) floor.value.focus(target, options)
    else pendingFocus = { target, options }
}

/** Where the open panel covers the floor (a drawer at the bottom on phones, a side panel from md up). */
function panelInsets(): FloorFocusOptions {
    const panel = document.querySelector<HTMLElement>('[data-floor-root] section[role="dialog"]')
    if (!panel) return {}
    return window.innerWidth >= 768 ? { right: panel.offsetWidth + 24 } : { bottom: panel.offsetHeight + 8 }
}

/** Frame a zone beside the panel that shows it (its detail card, a skin picker). */
async function focusZone(id: ZoneId) {
    await nextTick()
    // The panel mounts with the card: give it a frame to lay out.
    requestAnimationFrame(() => focusFloor({ kind: 'zone', id }, panelInsets()))
}
function walkFloor(target: FloorTarget) {
    if (floor.value && floorReady.value) floor.value.walkTo(target)
    else pendingWalk = target
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
function onFloorReady() {
    floorFailed.value = false
    floorReady.value = true
    if (pendingFocus) focusFloor(pendingFocus.target, pendingFocus.options)
    if (pendingWalk) walkFloor(pendingWalk)
    pendingFocus = null
    pendingWalk = null
    // A new or rebuilt floor gets arrange mode back, with what was in hand.
    syncArrange()
}

function openGame(slug: string) {
    arrange.active.value = false
    cosmetics.hide()
    houseRules.open.value = false
    gamesOpen.value = false
    buildOpen.value = false
    campaignsOpen.value = false
    buildersOpen.value = false
    card.value = null
    // Opening a game over another replaces it, so closing never reopens the previous one.
    if (playSlug.value) void router.replace({ path: '/', query: { play: slug } })
    else {
        pushed = true
        void router.push({ path: '/', query: { play: slug } })
    }
}

function closeGame() {
    if (pushed) router.back()
    else void router.replace({ path: '/', query: {} })
    pushed = false
}

watch(playSlug, (slug) => {
    if (!slug) {
        pushed = false
        return
    }
    if (QUICK_GAMES.includes(slug)) focusFloor({ kind: 'game', id: slug })
}, { immediate: true })

// Links from elsewhere (a locked game's page): /?build=game:limbo opens that build card.
watch(() => route.query.build, (value) => {
    if (typeof value !== 'string') return
    const [kind, id] = value.split(':')
    if ((kind === 'game' || kind === 'zone' || kind === 'upgrade') && id) openCard(kind, id)
    void router.replace({ path: '/', query: { ...route.query, build: undefined } })
}, { immediate: true })

function openCard(kind: BuildKind, id: string) {
    arrange.active.value = false
    houseRules.open.value = false
    gamesOpen.value = false
    buildOpen.value = false
    campaignsOpen.value = false
    buildersOpen.value = false
    card.value = { kind, id }
    cosmetics.hide()
    if (kind === 'game') focusFloor({ kind: 'game', id })
    else if (kind === 'zone') void focusZone(id as ZoneId)
}

function openMenu(tab = 'games') {
    arrange.active.value = false
    cosmetics.hide()
    houseRules.open.value = false
    card.value = null
    gamesOpen.value = false
    campaignsOpen.value = false
    buildersOpen.value = false
    buildTab.value = tab
    buildOpen.value = true
}

/** The small cards over the floor: the ad campaigns, the builders list and the daily missions. */
function openPanel(panel: 'campaigns' | 'builders' | 'missions') {
    arrange.active.value = false
    cosmetics.hide()
    card.value = null
    gamesOpen.value = false
    buildOpen.value = false
    houseRules.open.value = false
    campaignsOpen.value = panel === 'campaigns'
    buildersOpen.value = panel === 'builders'
    missionsOpen.value = panel === 'missions'
}

/** A mission's Go: take the player to where it is done. */
function goMission(id: MissionId) {
    missionsOpen.value = false
    switch (id) {
        case 'collects': return walkFloor({ kind: 'cage' })
        case 'build': return openMenu()
        case 'campaign': return openPanel('campaigns')
        case 'visit':
            leaderboard.open.value = true
            return
        default:
            gamesOpen.value = true
    }
}

/** A soft tap for any button on the floor's UI (the effects of what it does come on top). */
function onTap(event: MouseEvent) {
    if (event.target instanceof Element && event.target.closest('button:not(:disabled)')) sound.play('tap')
}

/** The coin pill shows this instead of the balance while a collect's coins are in the air. */
const coinsHeld = useState<number | null>('tycoon:coins-held', () => null)
let landTimer: ReturnType<typeof setTimeout> | null = null

async function collect() {
    if (landTimer) clearTimeout(landTimer)
    // Hold the pill at the old balance: it counts up when the coins land, not when the answer comes.
    coinsHeld.value = coinsHeld.value ?? session.coins.value
    const amount = await tycoon.collect()
    if (amount > 0 && floor.value) {
        sound.play('collect')
        // The cage pays coins: they fly to the coin pill.
        const pill = document.querySelector<HTMLElement>('[data-pill="coins"]')?.getBoundingClientRect()
        floor.value.collected(amount, { currency: 'coins', to: pill ? { x: pill.left + 16, y: pill.top + pill.height / 2 } : undefined })
        onboarding.value?.markCollected()
        landTimer = setTimeout(() => {
            landTimer = null
            coinsHeld.value = null
            sound.play('kaching')
        }, COLLECT_LAND_MS)
    } else {
        if (amount > 0) sound.play('collect')
        coinsHeld.value = null
    }
}
onBeforeUnmount(() => {
    if (landTimer) clearTimeout(landTimer)
    coinsHeld.value = null
})

// ── Arrange mode: move games, place decorations ─────────────────────────
/** What the player holds on the floor (the engine draws the ghost), and why it can't go where it hovers. */
const carrying = ref<ArrangeItem | null>(null)
const problem = ref<string | null>(null)
const arranging = ref(false)

function closePanels() {
    cosmetics.hide()
    houseRules.open.value = false
    card.value = null
    gamesOpen.value = false
    buildOpen.value = false
    campaignsOpen.value = false
    buildersOpen.value = false
    missionsOpen.value = false
    arrange.levelOpen.value = false
}

/** The tile the ghost was last over, so a rebuilt floor puts it back there. */
let carryAt: Tile | null = null

/**
 * Tell the floor the whole arrange state (on, what is in hand, where). Safe to
 * repeat: the floor ignores the item it already carries. Sent on every change,
 * when the floor is ready and after it rebuilds itself.
 */
function syncArrange() {
    if (!floorReady.value || !floor.value) return
    if (!arrange.active.value) return floor.value.arrange(null)
    const item = carrying.value
    floor.value.arrange(item ? { carrying: item, at: carryAt ?? originOf(item) } : { carrying: null })
    takePending()
}

watch(() => arrange.active.value, (on) => {
    carrying.value = null
    problem.value = null
    carryAt = null
    if (on) {
        if (playSlug.value) closeGame()
        closePanels()
    } else {
        arrange.shopOpen.value = false
        arrange.pending.value = null
    }
    // After the HUD/overlay swap has rendered, so the floor is sure to be mounted.
    void nextTick(syncArrange)
})
// The shop hands over a decoration (new, or from storage) while arrange mode is already on.
watch(() => arrange.pending.value, item => item && arrange.active.value && takePending())

function takePending() {
    const item = arrange.pending.value
    if (!item || !floorReady.value) return
    arrange.pending.value = null
    carry(item)
}

/** Where an item stands now (the ghost starts there); null: the middle of the screen. */
function originOf(item: ArrangeItem): Tile | null {
    if (item.kind === 'game') return tycoon.placements.value[item.id] ?? homeSpot(item.id)
    if (item.kind === 'decor') {
        const owned = tycoon.decor.value.find(d => d.id === item.id)
        return owned && owned.x !== null && owned.y !== null ? { x: owned.x, y: owned.y } : null
    }
    return null
}

function carry(item: ArrangeItem) {
    carrying.value = item
    problem.value = null
    carryAt = null
    floor.value?.arrange({ carrying: item, at: originOf(item) })
}

function onArrangePick(item: ArrangeItem) {
    // The floor lifted it: the page always follows, so both agree on what is in
    // hand (a save still in flight just finishes first: place and buyDecor wait for it).
    if (!arrange.active.value) return void floor.value?.arrange(null)
    carry(item)
}

function onArrangeHover(at: Tile | null, why: string | null) {
    if (at) carryAt = at
    problem.value = why
}

/** Dropped on a free spot: move it, place it or buy it. A failed drop flies back with a shake (and a toast says why). */
async function onArrangeDrop(item: ArrangeItem, at: Tile) {
    carrying.value = null
    carryAt = null
    problem.value = null
    arranging.value = true
    const response = item.kind === 'game' ? await tycoon.place({ item: 'game', id: item.id, x: at.x, y: at.y })
        : item.kind === 'decor' ? await tycoon.place({ item: 'decor', id: item.id, x: at.x, y: at.y })
            : await tycoon.buyDecor({ type: item.type, x: at.x, y: at.y })
    arranging.value = false
    if (!response) {
        floor.value?.arrange({ carrying: null })
        return
    }
    sound.play(item.kind === 'new' ? 'kaching' : 'hammer')
}

/** Put the decoration in hand back into storage. */
async function storeCarried() {
    const item = carrying.value
    if (!item || item.kind !== 'decor') return
    arranging.value = true
    const response = await tycoon.place({ item: 'decor', id: item.id, store: true })
    arranging.value = false
    // Stored: the new scene no longer has it, so nothing flies back.
    await nextTick()
    carrying.value = null
    carryAt = null
    problem.value = null
    floor.value?.arrange({ carrying: null })
    if (response) sound.play('collect')
}

function cancelCarry() {
    carrying.value = null
    carryAt = null
    problem.value = null
    floor.value?.arrange({ carrying: null })
}

function openDecorShop() {
    if (carrying.value) cancelCarry()
    arrange.shopOpen.value = true
}

// Escape: drop what is in hand, then leave arrange mode. Capture: this runs before the floor's own Escape.
if (import.meta.client) {
    useEventListener(window, 'keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !arrange.active.value || arrange.shopOpen.value) return
        if (carrying.value) cancelCarry()
        else arrange.active.value = false
    }, { capture: true })
}

/** The floor put the item back by itself (Escape on the canvas). */
function onArrangeCancel() {
    carrying.value = null
    carryAt = null
    problem.value = null
}
onBeforeUnmount(() => {
    arrange.active.value = false
    arrange.shopOpen.value = false
    arrange.levelOpen.value = false
})

function onInteract(target: FloorTarget) {
    if (arrange.active.value) return
    switch (target.kind) {
        case 'game': {
            const built = tycoon.state.value && (tycoon.state.value.games[target.id] ?? 0) >= 1
            if (built) openGame(target.id)
            else openCard('game', target.id)
            return
        }
        case 'zone': return openCard('zone', target.id)
        case 'cage': return void collect()
        case 'builder': return openPanel('builders')
        case 'self': return cosmetics.show()
    }
}

// The wardrobe takes the place of any other panel.
watch(() => cosmetics.wardrobe.value.open, (open) => {
    if (!open) return
    houseRules.open.value = false
    card.value = null
    gamesOpen.value = false
    buildOpen.value = false
    campaignsOpen.value = false
    buildersOpen.value = false
})
// The house rules take the place of any other panel too.
watch(() => houseRules.open.value, (open) => {
    if (!open) return
    cosmetics.hide()
    card.value = null
    gamesOpen.value = false
    buildOpen.value = false
    campaignsOpen.value = false
    buildersOpen.value = false
    missionsOpen.value = false
})
// A skin picker shows a zone: frame it beside the panel.
watch(() => cosmetics.preview.value?.zone, (zone) => {
    if (zone) void focusZone(zone)
})

function buildFromGame(slug: string) {
    if (playSlug.value) closeGame()
    openCard('game', slug)
}

/** A game picked in the Games list: a built one opens at once and the avatar pops over to it; one still building is walked to. */
function walkToGame(slug: string) {
    gamesOpen.value = false
    const built = (tycoon.state.value?.games[slug] ?? 0) >= 1
    if (!built) return walkFloor({ kind: 'game', id: slug })
    openGame(slug)
    if (floor.value && floorReady.value) floor.value.teleportTo({ kind: 'game', id: slug }, QUICK_GAMES.includes(slug))
}

events.onRound((event) => {
    // Mission progress moved on the server: read it once the burst of rounds settles.
    tycoon.refreshSoon()
    floor.value?.celebrate(event.slug, {
        payout: event.payout,
        stake: event.stake,
        chipsEarned: event.chipsEarned,
        big: event.payout > 0 && event.payout >= event.stake * 10
    })
})
events.onPlaying((slug, on) => floor.value?.playing(slug, on))
events.onBuilt((built) => {
    if (built.kind === 'game') {
        focusFloor({ kind: 'game', id: built.id })
        floor.value?.celebrate(built.id, { payout: 0, stake: 0, chipsEarned: 0, big: true })
    } else if (built.kind === 'zone') {
        focusFloor({ kind: 'zone', id: built.id as ZoneId })
    }
})
events.onBuildRequest((request) => {
    if (playSlug.value) closeGame()
    openCard(request.kind, request.id)
})

function retry() {
    tycoon.loadFailed.value = false
    void tycoon.refresh()
}

const hudPopover = ref(false)
const overlayOpen = computed(() => !floorReady.value || arrange.active.value || arrange.levelOpen.value || buildOpen.value || gamesOpen.value || campaignsOpen.value || buildersOpen.value || !!card.value || !!playSlug.value || hudPopover.value || cosmetics.wardrobe.value.open || missionsOpen.value || houseRules.open.value || leaderboard.open.value || !!tycoon.welcome.value)

onMounted(() => {
    void tycoon.refresh({ welcome: true })
    startPolling()
})

useHead({ title: 'My Casino' })
</script>

<template>
  <div data-floor-root class="relative h-[calc(100dvh-var(--topbar-h,3.5rem))] overflow-hidden bg-[#1c1424]" @click.capture="onTap">
    <CasinoFloor
      v-if="scene"
      :key="floorKey"
      ref="floor"
      class="absolute inset-0"
      :scene="scene"
      :paused="fullScreenGame"
      :remotes="presence.remotes.value"
      @interact="onInteract"
      @move="presence.move"
      @ready="onFloorReady"
      @error="onFloorError"
      @arrange-pick="onArrangePick"
      @arrange-hover="onArrangeHover"
      @arrange-drop="onArrangeDrop"
      @arrange-cancel="onArrangeCancel"
    />

    <div v-if="!scene || !floorReady" class="g-ui absolute inset-0 z-20 grid place-items-center bg-[#1c1424]">
      <div v-if="(!scene && tycoon.loadFailed.value) || floorFailed" class="flex flex-col items-center gap-4 px-6 text-center">
        <CasinoChipIcon class="size-16 opacity-60 grayscale" />
        <button type="button" class="g-btn g-green h-14 rounded-2xl px-6 text-xl uppercase" @click="floorFailed ? retryFloor() : retry()">
          <RotateCcw class="size-5" :stroke-width="3" /> Try again
        </button>
      </div>
      <div v-else class="flex flex-col items-center gap-3">
        <CasinoChipIcon class="loader-chip size-16" />
        <p class="g-title text-xl uppercase">Opening your casino</p>
      </div>
    </div>

    <template v-if="scene">
      <TycoonArrangeBar v-if="arrange.active.value" :carrying="carrying" :problem="problem" :busy="arranging" @done="arrange.active.value = false" @cancel="cancelCarry" @store="storeCarried" @shop="openDecorShop" @take="carry" />
      <TycoonHud v-else @build="openMenu()" @games="gamesOpen = true" @cage="walkFloor({ kind: 'cage' })" @shop="openMenu('gems')" @zone="id => openCard('zone', id)" @popover="open => (hudPopover = open)" @campaigns="openPanel('campaigns')" @missions="openPanel('missions')" @level="arrange.levelOpen.value = true" @decor="arrange.start()" />
      <TycoonOnboarding ref="onboarding" :paused="overlayOpen" @cage="walkFloor({ kind: 'cage' })" @games="gamesOpen = true" @limbo="openCard('game', 'limbo')" @build="(kind, id) => openCard(kind, id)" />
    </template>

    <TycoonBuildMenu :open="buildOpen" :tab="buildTab" @close="buildOpen = false" @play="openGame" />
    <TycoonBuildCard :target="card" @close="card = null" @play="openGame" @open="openCard" @menu="openMenu(card?.kind === 'zone' ? 'zones' : card?.kind === 'upgrade' ? 'upgrades' : 'games')" />
    <TycoonGamesDirectory :open="gamesOpen" @close="gamesOpen = false" @walk="walkToGame" @play="openGame" @build="slug => openCard('game', slug)" />
    <TycoonDrawer :open="campaignsOpen" card dismissable title="Marketing" :icon="Megaphone" color="#4aa6ff" height="80dvh" @close="campaignsOpen = false">
      <TycoonCampaigns />
    </TycoonDrawer>
    <TycoonDrawer :open="buildersOpen" card dismissable title="Builders" :icon="HardHat" color="#ffc93a" @close="buildersOpen = false">
      <div class="px-3 pb-3"><TycoonBuilders @build="openMenu()" @open="openCard" /></div>
    </TycoonDrawer>
    <TycoonDrawer :open="houseRules.open.value" card dismissable title="House rules" :icon="ScrollText" color="#a879ff" height="80dvh" @close="houseRules.open.value = false">
      <TycoonHouseRules />
    </TycoonDrawer>
    <TycoonWardrobe />
    <TycoonDrawer :open="missionsOpen" card dismissable title="Missions" :icon="ListChecks" color="#ff9a2e" height="80dvh" @close="missionsOpen = false">
      <TycoonMissions @go="goMission" />
    </TycoonDrawer>
    <TycoonDecorShop :open="arrange.shopOpen.value" @close="arrange.shopOpen.value = false" />
    <TycoonLevelSheet />
    <TycoonCelebration />
    <TycoonLevelUp />
    <TycoonDecorRefundNote />
    <TycoonWelcomeBack @collect="walkFloor({ kind: 'cage' })" @upgrade-cage="openCard('upgrade', 'cage')" @campaigns="openPanel('campaigns')" />
    <TycoonGameOverlay :slug="playSlug" @close="closeGame" @build="buildFromGame" />
  </div>
</template>

<style scoped>
.loader-chip { animation: loader-spin 1.1s cubic-bezier(0.5, 0, 0.5, 1) infinite; filter: drop-shadow(0 4px 0 rgb(0 0 0 / 0.4)); }
@keyframes loader-spin {
  0% { transform: rotateY(0deg) translateY(0); }
  50% { transform: rotateY(180deg) translateY(-8px); }
  100% { transform: rotateY(360deg) translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .loader-chip { animation: none; }
}
</style>
