<script setup lang="ts">
import { ChartArea, Hammer, LayoutGrid, ListChecks, Megaphone, ScrollText, Sofa, Sparkles, Timer, Users, Volume2, VolumeX, Zap } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import { findZone, type ZoneId } from '#shared/tycoon'

/**
 * Everything laid over the floor: the resource bar and the cage jar up top,
 * the construction rings on the right and the round action buttons below.
 */
const emit = defineEmits<{ build: [], games: [], cage: [], shop: [], zone: [id: ZoneId], popover: [open: boolean], campaigns: [], missions: [], level: [], decor: [] }>()
const tycoon = useTycoon()
const casinoStats = useCasinoStats()
const { coins } = useCasinoSession()
const sound = useTycoonSound()

// Daily missions: a ring of the ones cleared, a badge when one is ready to claim.
const missions = computed(() => tycoon.missions.value)
/** Every mission claimed: the button hides until the next day's missions. */
const allClaimed = computed(() => !!missions.value?.missions.length && missions.value.missions.every(m => m.claimed))
const missionsCleared = computed(() => missions.value?.missions.filter(m => m.claimed || m.progress >= m.target).length ?? 0)
const missionPop = ref(0)
watch(() => tycoon.missionDone.value, done => done && missionPop.value++)

const state = computed(() => tycoon.state.value)

// The casino level: a gold coin with a ring of XP; it pops when the level goes up.
const lv = computed(() => tycoon.level.value)
const xpShare = computed(() => {
    const { xp, levelXp, nextXp } = lv.value
    return nextXp === null ? 1 : Math.max(0, Math.min(1, (xp - levelXp) / Math.max(1, nextXp - levelXp)))
})
const levelPop = ref(0)
watch(() => tycoon.levelUp.value, up => up && levelPop.value++)
/** What the specials on the floor do (rarity, spend, coins an hour), or null when none stands. */
const specialsLine = computed(() => {
    const st = state.value
    if (!st) return null
    const lift = specialsLift(st, st.serverNow)
    return lift.rarity || lift.spend ? { lifts: [lift.rarity, lift.spend], gain: specialsGain(st, st.serverNow) } : null
})
/** A drawer covers most of a phone's floor: fold the HUD down to the money pills so the strip above shows the floor. */
const openDrawers = useState<number>('tycoon:open-drawers', () => 0)
const fold = computed(() => (openDrawers.value > 0 ? 'max-md:hidden' : ''))
const full = computed(() => tycoon.cageFill.value >= 0.999)
const stored = computed(() => Math.floor(tycoon.cageStored.value))

// Visitors on the floor (capped by the seats) and the hourly guest income, live.
const visitors = computed(() => tycoon.visitors.value)
const visitorMax = computed(() => tycoon.seats.value)
const floorFull = computed(() => visitorMax.value > 0 && visitors.value >= visitorMax.value)
const waiting = computed(() => tycoon.waiting.value)
const perHour = computed(() => tycoon.perHour.value)
/** The average for this floor and these rules (null from a server without visitor tiers). */
const expected = computed(() => tycoon.expectedPerHour.value)
const floorNow = computed(() => tycoon.floorNow.value)
/** Tiers that can visit now, and the next one still to open (for the guests popover). */
const tiers = computed(() => openTiers(floorNow.value).map(t => ({ ...t, n: tycoon.visitorTiers.value[t.id] ?? 0, odds: floorNow.value?.odds[t.id] ?? 0 })))
/** The house rules' running costs this tick (VIP staff), taken off the rows, in whole coins as shown. */
const ruleCosts = computed(() => Math.floor(floorNow.value?.costs ?? 0))
/** Every tier, the locked ones too: who is in, what each spends and what they bring together. */
const tierRows = computed(() => {
    const rows = TIERS.map((t) => {
        const open = tiers.value.find(o => o.id === t.id)
        const n = open?.n ?? 0
        // What the tier brings this tick (level and VIP bonuses, a rush) and one guest's share of it.
        const brings = floorNow.value?.income?.[t.id] ?? n * t.spend
        const each = n > 0 ? Math.round(brings / n) : t.spend
        return { ...t, open: !!open, n, odds: open?.odds ?? 0, brings, shown: perHour.value >= 10 ? Math.floor(brings) : brings, each, zone: t.unlockZone ? findZone(t.unlockZone)?.name ?? t.unlockZone : null }
    })
    // Whole coins that add up: the rows minus the costs make the "now" rate the jar shows
    // (largest remainder: the coins rounding dropped go to the rows that lost the most).
    if (perHour.value >= 10 && rows.some(r => r.brings > 0)) {
        let left = Math.floor(perHour.value) + ruleCosts.value - rows.reduce((sum, r) => sum + r.shown, 0)
        const order = rows.filter(r => r.brings > 0).sort((a, b) => (left > 0 ? (b.brings - b.shown) - (a.brings - a.shown) : (a.brings - a.shown) - (b.brings - b.shown)))
        for (let i = 0; left !== 0 && order.length && i < order.length * 3; i++) {
            const row = order[i % order.length]!
            if (left < 0 && row.shown <= 0) continue
            row.shown += Math.sign(left)
            left -= Math.sign(left)
        }
    }
    return rows
})
/** The floor's state in one line: full and turning guests away, or seats to fill. */
const floorHint = computed(() => {
    if (floorFull.value && waiting.value > 0) return 'Floor full: build seats, or go for richer guests'
    if (visitorMax.value > 0 && tycoon.occupied.value < 0.8) return 'Empty seats: an ad fills them'
    return null
})
const guestsOpen = ref(false)
function toggleGuests() {
    info.value = false
    guestsOpen.value = !guestsOpen.value
}
const pct = (share: number) => (share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`)

// House rules: hidden until the casino unlocks one; a "New" bubble the first time.
const rules = useHouseRules()
const hasRules = computed(() => rules.unlocked.value.length > 0)
const freshRule = computed(() => (rules.fresh.value ? RULE_INFO[rules.fresh.value] : null))
function openRules() {
    info.value = false
    guestsOpen.value = false
    rules.show()
}
const campaign = computed(() => tycoon.campaign.value)
/** Other ads running beside the one that ends first (one per kind). */
const moreCampaigns = computed(() => Math.max(0, tycoon.runningCampaigns.value.length - 1))
const campaignsTitle = computed(() => `${tycoon.runningCampaigns.value.map(c => `${c.def.name}: ${formatCountdown(c.leftMs)} left`).join(' · ')} · tap to extend or add`)
/** Empty seats and no campaign: the megaphone asks for attention. */
const nudge = computed(() => !campaign.value && visitorMax.value > 0 && tycoon.occupied.value < 0.999)
function openCampaigns() {
    info.value = false
    guestsOpen.value = false
    emit('campaigns')
}
/** Time until the cage is full at the current rate (ms), or null when it never fills. */
const fullInMs = computed(() => {
    const s = state.value
    if (!s || full.value || !(perHour.value > 0)) return null
    return ((s.cage.capacity - tycoon.cageStored.value) / perHour.value) * 3_600_000
})
/** A countdown to a full cage is only worth showing when it is close. */
const SOON_MS = 2 * 3_600_000
const info = ref(false)
watch(info, open => open && (guestsOpen.value = false))
watch(() => info.value || guestsOpen.value, open => emit('popover', open))
function collect() {
    info.value = false
    guestsOpen.value = false
    emit('cage')
}

const reducedMotion = import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Chips or coins going up: the icon pops and a "+x" floats off the pill.
const chipPop = ref(0)
const coinPop = ref(0)
const floaters = ref<{ id: number, amount: number, currency: 'coins' | 'chips' }[]>([])
let floaterSeq = 0
function float(amount: number, currency: 'coins' | 'chips') {
    const id = ++floaterSeq
    floaters.value = [...floaters.value, { id, amount, currency }].slice(-4)
    setTimeout(() => (floaters.value = floaters.value.filter(f => f.id !== id)), 1600)
}
watch(() => tycoon.chips.value, (to, from) => {
    if (!(to > from)) return
    chipPop.value++
    float(to - from, 'chips')
})
// A collect holds the coin pill at the old balance while the coins fly; it counts up when they land.
const coinsHeld = useState<number | null>('tycoon:coins-held', () => null)
const shownCoins = computed(() => coinsHeld.value ?? coins.value)
/** The pill flashes gold as a collect lands. */
const coinLand = ref(0)
watch(shownCoins, (to, from) => {
    if (to > from) coinPop.value++
})
watch(coinsHeld, (now, before) => {
    if (now !== null || before === null || !(coins.value > before)) return
    coinLand.value++
    float(coins.value - before, 'coins')
})

// A dot on Games when something finished since the player last looked.
const seenBuilt = ref(0)
const gamesDot = computed(() => (tycoon.lastBuilt.value?.at ?? 0) > seenBuilt.value)
function openGames() {
    seenBuilt.value = Date.now()
    emit('games')
}
const buildCount = computed(() => tycoon.startable.value.length)

// Tapping a construction ring opens its skip popover.
const skipFor = ref<string | null>(null)
const skipItem = computed(() => tycoon.queue.value.find(c => `${c.kind}:${c.id}` === skipFor.value) ?? null)
// A skip that lands finishes the construction, which closes the popover.
watch(skipItem, item => !item && (skipFor.value = null))
// Escape closes the cage details and the skip popover, like a tap outside does.
useEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || (!info.value && !skipFor.value && !guestsOpen.value)) return
    info.value = false
    guestsOpen.value = false
    skipFor.value = null
})
</script>

<template>
  <div class="g-ui pointer-events-none absolute inset-0 z-10 p-2 sm:p-3">
    <!-- Resource bar -->
    <div class="flex items-start justify-between gap-2">
      <div class="pointer-events-auto flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2 sm:gap-2.5">
        <!-- The casino level, top left: a ring of XP to the next level. Tap for what each level unlocks. -->
        <button
          type="button"
          class="level-btn relative grid size-11 shrink-0 place-items-center rounded-full transition-transform active:scale-95"
          :class="levelPop ? 'level-glow' : ''"
          :title="lv.nextXp === null ? `Casino level ${lv.level}: the top` : `Casino level ${lv.level}: ${formatCoins(lv.xp - lv.levelXp)} / ${formatCoins(lv.nextXp - lv.levelXp)} XP to level ${lv.level + 1}`"
          :aria-label="`Casino level ${lv.level}`"
          @click="emit('level')"
        >
          <span :key="levelPop" class="grid" :class="levelPop ? 'g-pop' : ''"><TycoonLevelBadge :level="lv.level" :progress="xpShare" :size="40" :stroke="3.5" /></span>
        </button>
        <span class="res-pill relative" data-pill="coins" title="Coins: for betting. Your cashier cage fills them">
          <span v-if="coinLand" :key="coinLand" class="coin-land pointer-events-none absolute -inset-[2px] rounded-full" />
          <CasinoCoinIcon :key="coinPop" class="res-icon z-[1]" :class="coinPop ? 'g-pop' : ''" />
          <TycoonCounter :value="shownCoins" class="g-num text-[15px] sm:text-lg" />
          <span v-for="f in floaters.filter(x => x.currency === 'coins')" :key="f.id" class="floater g-num pointer-events-none absolute top-full left-7 text-base whitespace-nowrap text-[#ffe066] [text-shadow:0_2px_0_rgb(0_0_0/0.55),0_0_10px_rgb(255_196_40/0.8)]">+{{ formatCoins(f.amount) }}</span>
        </span>
        <span class="res-pill relative" data-pill="chips" data-tip="chips" title="Chips: your winnings. Build with them or bet them">
          <CasinoChipIcon :key="chipPop" class="res-icon" :class="chipPop ? 'g-pop' : ''" />
          <TycoonCounter :value="tycoon.chips.value" class="g-num text-[15px] sm:text-lg" />
          <span v-for="f in floaters.filter(x => x.currency === 'chips')" :key="f.id" class="floater g-num pointer-events-none absolute top-full left-7 text-base whitespace-nowrap text-white [text-shadow:0_2px_0_rgb(0_0_0/0.55),0_0_10px_rgb(255_196_40/0.8)]">+{{ formatCoins(f.amount) }}</span>
        </span>

        <!-- Visitors and the ad campaign: one group, so on a phone they wrap together onto a second row. -->
        <div class="flex items-center gap-x-1.5 sm:gap-2.5" :class="fold">
          <!-- Guests on the floor per tier / seats. Turned away at the door shows as +N. Tap for the tiers and the rate. -->
          <div class="relative z-30">
            <button
              type="button"
              class="hud-pill hud-hit visitors relative gap-1.5 active:scale-95"
              :title="waiting ? `${waiting} turned away just now: build games or level them up for more seats` : `Guests: ${Math.round(tycoon.occupied.value * 100)}% of the seats taken`"
              :aria-label="`Guests: ${visitors} of ${visitorMax} seats`"
              :aria-expanded="guestsOpen"
              @click="toggleGuests"
            >
              <TycoonVisitorDots v-if="floorNow" :counts="tycoon.visitorTiers.value" class="text-[15px] sm:text-lg" />
              <template v-else>
                <Users class="size-4 shrink-0 text-[#7dd3fc]" :stroke-width="3" />
                <span class="g-num text-[15px] leading-none sm:text-lg">{{ visitors }}</span>
              </template>
              <span class="g-num text-[13px] leading-none sm:text-[15px]" :class="floorFull ? 'text-[#ffb35c]' : 'text-[var(--g-muted)]'">/{{ visitorMax }}</span>
              <span v-if="waiting" class="g-num rounded-full bg-[#ff9a2e] px-1 text-[10px] leading-[14px] text-white">+{{ waiting }}</span>
              <span class="absolute inset-x-3 bottom-[3px] block h-[3px] overflow-hidden rounded-full bg-black/50">
                <span class="block h-full rounded-full bg-gradient-to-r transition-[width] duration-500" :class="floorFull ? 'from-[#ff9a2e] to-[#ffc93a]' : 'from-[#4aa6ff] to-[#7dd3fc]'" :style="{ width: `${tycoon.occupied.value * 100}%` }" />
              </span>
            </button>

            <Transition name="pop">
              <div v-if="guestsOpen" class="g-panel absolute top-full left-0 mt-2.5 w-[min(23rem,calc(100vw-1.5rem))] space-y-2 rounded-2xl p-3 text-sm">
                <p class="flex items-center gap-1.5 font-semibold">
                  <Users class="size-4 text-[#7dd3fc]" :stroke-width="3" /> Guests
                  <span class="g-num ml-auto" :class="floorFull ? 'text-[#ffb35c]' : ''">{{ visitors }} / {{ visitorMax }} seats</span>
                </p>
                <!-- Every tier: how many are in, what one spends, what they bring together. Richer guests, more income. -->
                <div class="g-well rounded-xl px-2.5 py-1.5">
                  <p class="grid grid-cols-[1fr_2rem_3.5rem_4rem] gap-x-1.5 pb-1 text-[10.5px] font-bold tracking-wide text-[var(--g-muted)] uppercase">
                    <span>Guest</span><span class="text-right">In</span><span class="text-right">Each</span><span class="text-right">Bring</span>
                  </p>
                  <p
                    v-for="t in tierRows"
                    :key="t.id"
                    class="grid grid-cols-[1fr_2rem_3.5rem_4rem] items-center gap-x-1.5 py-1"
                    :class="t.open ? '' : 'opacity-55'"
                    :title="t.open ? `${tierBlurb(t.id)} ${pct(t.odds)} of new guests are ${tierPlural(t.id, 2)}.` : `${tierPlural(t.id, 2)} ${tierUnlockLine(t.id)}`"
                  >
                    <span class="flex min-w-0 items-center gap-1.5 font-semibold">
                      <span class="size-2.5 shrink-0 rounded-full border border-black/50" :style="{ background: t.color, boxShadow: t.id === 'whale' && t.open ? `0 0 6px 1px ${t.color}` : undefined }" />
                      <span class="truncate">{{ tierPlural(t.id, 2) }}</span>
                      <span v-if="t.open" class="g-num shrink-0 rounded-full bg-black/30 px-1.5 text-[10.5px] leading-4 text-[var(--g-muted)]" title="Chance that a new guest is one of these">{{ pct(t.odds) }}</span>
                    </span>
                    <template v-if="t.open">
                      <span class="g-num text-right">{{ t.n }}</span>
                      <span class="g-num text-right text-[var(--g-muted)]">{{ formatCoins(t.each) }}/h</span>
                      <span class="g-num text-right" :class="t.brings ? 'text-[#7ee08f]' : 'text-[var(--g-muted)]'">{{ t.brings ? `${formatCoins(t.shown)}/h` : '–' }}</span>
                    </template>
                    <span v-else class="col-span-3 truncate text-right text-[12px] font-semibold text-[var(--g-muted)]">🔒 {{ t.zone }}</span>
                  </p>
                  <p v-if="ruleCosts > 0" class="grid grid-cols-[1fr_2rem_3.5rem_4rem] items-center gap-x-1.5 border-t border-white/10 py-1" title="The VIP room's staff, paid from what the guests bring">
                    <span class="font-semibold">House rules</span><span /><span />
                    <span class="g-num text-right text-[#ff8a8a]">−{{ formatCoins(ruleCosts) }}/h</span>
                  </p>
                  <p v-if="tycoon.rushActive.value" class="pt-0.5 text-right text-[11px] font-semibold text-[#ff9a2e]">Big Spenders: every guest ×2</p>
                </div>
                <p class="px-1 text-[12px] leading-4 text-[var(--g-muted)]">Richer guests spend more. Hospitality, new rooms, specials, wealth ads and top machine levels bring them in.</p>
                <p v-if="specialsLine" class="flex flex-wrap items-center gap-1.5 px-1 text-[12px] leading-4 font-semibold" title="What the specials standing on your floor do (put away, they do nothing)">
                  <Sparkles class="size-3.5 shrink-0 text-[#ffc93a]" :stroke-width="3" /> Specials <TycoonSpecialStat class="ml-auto" :lifts="specialsLine.lifts" :gain="specialsLine.gain" />
                </p>
                <p v-if="floorHint" class="px-1 text-[12px] leading-4 font-semibold text-[#ffb35c]">{{ floorHint }}</p>
                <p v-if="waiting" class="px-1 text-[12px] leading-4 font-semibold text-[#ffb35c]">{{ waiting }} turned away just now: no free seat{{ rules.house.value && rules.house.value.rules.door !== 'open' ? ' or your door policy' : '' }}</p>
                <p class="stat-row border-t border-white/10 pt-2" title="Luck makes some hours good and some quiet: the average is what this floor earns over time">
                  <CasinoCoinIcon class="size-4" />
                  <span v-if="full" class="g-num text-[#ffb35c]">Cage full: collect</span>
                  <span v-else class="g-num text-[#7ee08f]">{{ formatCoins(perHour) }}/h now</span>
                  <span v-if="expected !== null" class="g-num ml-auto text-[var(--g-muted)]">~{{ formatCoins(expected) }} avg</span>
                </p>
                <div class="flex gap-2">
                  <button type="button" class="g-btn g-dark h-11 flex-1 rounded-xl text-[15px]" @click="guestsOpen = false; casinoStats.show()">
                    <ChartArea class="size-4.5" :stroke-width="2.75" /> Charts
                  </button>
                  <button v-if="hasRules" type="button" class="g-btn g-dark relative h-11 flex-1 rounded-xl text-[15px]" @click="openRules">
                    <ScrollText class="size-4.5" :stroke-width="2.75" /> Rules
                    <span v-if="freshRule" class="absolute -top-1 -right-1 size-3 rounded-full border-2 border-white bg-[#ff3b5c]" />
                  </button>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Marketing: the running campaign with its countdown, or a megaphone. -->
          <button
            v-if="campaign"
            type="button"
            class="hud-pill hud-hit gap-1.5 pl-1! active:scale-95"
            :title="campaignsTitle"
            :aria-label="`${campaign.def.name} campaign, ${formatCountdown(campaign.leftMs)} left${moreCampaigns ? `, ${moreCampaigns} more running` : ''}`"
            @click="openCampaigns"
          >
            <TycoonRing :progress="campaign.fuel" :size="28" :stroke="3" :color="campaignColor(campaign.def.id)">
              <span class="block size-[20px] overflow-hidden rounded-full"><TycoonCampaignArt :id="campaign.def.id" /></span>
            </TycoonRing>
            <span class="g-num text-[13px] leading-none whitespace-nowrap sm:text-base">{{ formatCountdown(campaign.leftMs) }}</span>
            <span v-if="moreCampaigns" class="g-num rounded-full bg-[#4aa6ff]/25 px-1.5 text-[12px] leading-5 text-[#9fd0ff]">+{{ moreCampaigns }}</span>
          </button>
          <button
            v-else
            type="button"
            class="hud-hit relative"
            :class="nudge && !reducedMotion ? 'nudge' : ''"
            title="Ad campaigns: more visitors"
            aria-label="Ad campaigns"
            @click="openCampaigns"
          >
            <span class="g-btn g-blue size-11 rounded-full"><Megaphone class="size-5 -rotate-12" :stroke-width="2.75" /></span>
          </button>
        </div>
      </div>

      <!-- Sound on/off (shared with the games). -->
      <button
        type="button"
        class="hud-hit pointer-events-auto relative shrink-0"
        :class="fold"
        :title="sound.muted.value ? 'Sound off' : 'Sound on'"
        :aria-label="sound.muted.value ? 'Turn sound on' : 'Turn sound off'"
        :aria-pressed="!sound.muted.value"
        @click="sound.toggle()"
      >
        <span class="g-btn g-dark size-9 rounded-full sm:size-[2.6rem]">
          <VolumeX v-if="sound.muted.value" class="size-5 opacity-70" :stroke-width="2.75" />
          <Volume2 v-else class="size-5" :stroke-width="2.75" />
        </span>
      </button>
    </div>

    <!-- The cage -->
    <div class="mt-3 flex items-start" :class="fold">
    <!-- The cage: one widget. Tap for the details and the Collect button. -->
    <div class="pointer-events-auto relative z-20 inline-block">
      <button
        type="button"
        data-tip="cage"
        class="cage relative flex items-center gap-2 rounded-[22px] py-1.5 pr-3.5 pl-1.5 transition-transform active:scale-95"
        :class="full ? 'cage-full' : ''"
        :title="full ? 'Cage full: income stopped. Collect your coins' : `Cage: ${formatCoins(stored)} / ${formatCoins(state?.cage.capacity ?? 0)} coins · +${formatCoins(perHour)} coins/h`"
        :aria-label="full ? 'Collect the full cage' : 'Cage details'"
        :aria-expanded="info"
        @click="full ? collect() : (info = !info)"
      >
        <span class="relative grid size-12 place-items-center rounded-2xl bg-black/30" :class="full && !reducedMotion ? 'g-bounce' : ''">
          <TycoonChipJar :fill="tycoon.cageFill.value" class="h-11 w-10" />
        </span>
        <span class="flex flex-col items-start gap-1">
          <span v-if="full" class="g-title full-glow text-lg leading-none text-[#ffc93a] uppercase">Full!</span>
          <span v-else class="g-num flex items-center gap-1 text-lg leading-none"><CasinoCoinIcon class="size-4" />{{ formatCoins(stored) }}</span>
          <span class="g-well block h-2 w-[4.75rem] overflow-hidden rounded-full">
            <span class="block h-full rounded-full bg-gradient-to-r from-[#f08a00] to-[#ffe066] transition-[width] duration-500" :style="{ width: `${tycoon.cageFill.value * 100}%` }" />
          </span>
          <span class="flex items-center gap-1 text-[11px] leading-none font-semibold text-[var(--g-muted)]">
            <span v-if="full" class="text-[#ffb35c]">Income stopped</span>
            <span v-else class="flex items-center gap-0.5 text-[#7ee08f]"><CasinoCoinIcon class="size-3" />+{{ formatCoins(perHour) }}/h</span>
            <span v-if="tycoon.rushActive.value && !full" class="g-num rounded-full bg-[#ff9a2e] px-1 text-[9px] leading-[14px] text-white" title="Big Spenders: guest income ×2">×2</span>
            <template v-if="fullInMs !== null && fullInMs < SOON_MS"><Timer class="ml-0.5 size-3" :stroke-width="3" />{{ formatDuration(fullInMs) }}</template>
          </span>
        </span>
      </button>

      <Transition name="pop">
        <div v-if="info" class="g-panel absolute top-full left-0 z-10 mt-2.5 w-60 space-y-1.5 rounded-2xl p-3 text-sm">
          <p class="stat-row"><CasinoCoinIcon class="size-4" /> Coins <span class="g-num ml-auto">{{ formatCoins(stored) }} / {{ formatCoins(state?.cage.capacity ?? 0) }}</span></p>
          <p class="stat-row"><CasinoCoinIcon class="size-4" /> Per hour <span class="g-num ml-auto" :class="full ? 'text-[#ffb35c]' : ''">{{ full ? 'Stopped: full' : `+${formatCoins(perHour)}/h` }}</span></p>
          <p class="stat-row"><Timer class="size-4 text-[#ffc93a]" :stroke-width="3" /> Full in <span class="g-num ml-auto">{{ fullInMs !== null ? formatDuration(fullInMs) : '–' }}</span></p>
          <p v-if="campaign" class="stat-row">
            <span class="size-5 shrink-0"><TycoonCampaignArt :id="campaign.def.id" plain /></span>
            {{ campaign.def.name }} <span class="g-num text-[#7dd3fc]">{{ formatBoost(tycoon.campaigns.value.find(c => c.running)?.boost ?? 1) }}</span>
            <span class="g-num ml-auto">{{ formatCountdown(campaign.leftMs) }}</span>
          </p>
          <p v-if="expected !== null" class="stat-row" title="Luck makes some hours good and some quiet: this is what your floor earns over time">
            <CasinoCoinIcon class="size-4 opacity-70" /> On average <span class="g-num ml-auto text-[var(--g-muted)]">~{{ formatCoins(expected) }}/h</span>
          </p>
          <p v-if="tycoon.rushActive.value" class="stat-row"><Zap class="size-4 text-[#ff9a2e]" :stroke-width="3" /> Big Spenders ×2 <span class="g-num ml-auto">{{ formatCountdown(tycoon.rushLeftMs.value) }}</span></p>
          <div class="flex gap-2 pt-1">
            <button type="button" class="g-btn g-green h-11 flex-1 rounded-xl text-base" title="Walk to the cage and collect" @click="collect">
              <CasinoCoinIcon class="size-5" /> Collect
            </button>
            <button v-if="hasRules" type="button" class="g-btn g-dark relative size-11 shrink-0 rounded-xl" title="House rules" aria-label="House rules" @click="openRules">
              <ScrollText class="size-5" :stroke-width="2.75" />
              <span v-if="freshRule" class="absolute -top-1 -right-1 size-3 rounded-full border-2 border-white bg-[#ff3b5c]" />
            </button>
          </div>
        </div>
      </Transition>

      <!-- A rule just unlocked: one small bubble until the player has looked at it. -->
      <Transition name="pop">
        <button
          v-if="freshRule && !info"
          type="button"
          class="new-rule g-panel absolute top-full left-0 mt-2.5 flex min-h-11 items-center gap-2 rounded-2xl py-1.5 pr-3 pl-2 text-left whitespace-nowrap"
          :title="`${freshRule.name} unlocked: tap to see the house rules`"
          @click="openRules"
        >
          <span class="grid size-8 shrink-0 place-items-center rounded-full bg-black/30"><component :is="freshRule.icon" class="size-4.5" :style="{ color: freshRule.color }" :stroke-width="3" /></span>
          <span class="flex flex-col">
            <span class="flex items-center gap-1 text-[11px] leading-3 font-semibold tracking-wide text-[#ffc93a] uppercase"><Sparkles class="size-3" :stroke-width="3" />New</span>
            <span class="g-title text-[15px] leading-5">{{ freshRule.name }}</span>
          </span>
        </button>
      </Transition>
    </div>

    <!-- Daily missions: three rings fill as they are done; the badge counts what can be claimed. -->
    <button
      v-if="missions && !allClaimed"
      type="button"
      class="missions pointer-events-auto relative ml-2 grid size-[60px] shrink-0 place-items-center rounded-[22px] transition-transform active:scale-95"
      :class="tycoon.claimable.value ? 'missions-ready' : ''"
      :title="`Daily missions: ${missionsCleared} of ${missions.missions.length} done`"
      :aria-label="`Daily missions, ${missionsCleared} of ${missions.missions.length} done${tycoon.claimable.value ? `, ${tycoon.claimable.value} to claim` : ''}`"
      @click="emit('missions')"
    >
      <TycoonRing :progress="missions.missions.length ? missionsCleared / missions.missions.length : 0" :size="50" :stroke="4.5" color="#3fd25a">
        <span :key="missionPop" class="grid size-9 place-items-center rounded-full bg-[#ff9a2e] shadow-[inset_0_2px_0_rgb(255_255_255/0.35)]" :class="missionPop ? 'g-pop' : ''">
          <ListChecks class="size-5 text-white drop-shadow-[0_1.5px_0_rgb(0_0_0/0.35)]" :stroke-width="2.75" />
        </span>
      </TycoonRing>
      <span v-if="tycoon.claimable.value" class="dot g-num grid min-w-6 place-items-center px-1 text-xs leading-none" :class="reducedMotion ? '' : 'g-bounce'">{{ tycoon.claimable.value }}</span>
    </button>


    </div>

    <!-- Construction rings -->
    <ul v-if="tycoon.queue.value.length" :class="fold" class="pointer-events-auto absolute top-14 right-2 flex flex-col items-end gap-3 sm:top-16 sm:right-3">
      <li v-for="item in tycoon.queue.value" :key="`${item.kind}:${item.id}`" class="relative">
        <button
          type="button"
          class="relative grid place-items-center rounded-full bg-[#2a1f3f] shadow-[0_4px_0_#120c1d,0_8px_16px_rgb(0_0_0/0.35)] transition-transform active:scale-95"
          :aria-label="`${buildName(item.kind, item.id)}: ${formatCountdown(item.leftMs)}`"
          @click="skipFor = skipFor === `${item.kind}:${item.id}` ? null : `${item.kind}:${item.id}`"
        >
          <TycoonRing :progress="1 - item.leftMs / item.total" :size="58" :stroke="5">
            <span class="block size-[42px] overflow-hidden rounded-full border-2 border-black/50">
              <TycoonItemArt :kind="item.kind" :id="item.id" />
            </span>
          </TycoonRing>
          <span class="g-num absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border-2 border-black/50 bg-[#1b1329] px-1.5 text-[11px] leading-4 whitespace-nowrap">{{ formatCountdown(item.leftMs) }}</span>
        </button>
        <Transition name="pop">
          <div v-if="skipFor === `${item.kind}:${item.id}`" class="g-panel absolute top-0 right-full mr-3 w-44 rounded-2xl p-2.5">
            <p class="g-title truncate text-base leading-tight">{{ buildName(item.kind, item.id) }}</p>
            <TycoonPips v-if="item.kind !== 'zone'" :level="item.level" :max="5" class="mt-1" />
            <TycoonSkipButton class="mt-2 h-11 w-full rounded-xl text-base" :left-ms="item.leftMs" :target="`${item.kind}:${item.id}`" />
          </div>
        </Transition>
      </li>
    </ul>

    <!-- Decorate: arrange the floor, buy decorations. In the corner, so the action bar stays three buttons. -->
    <div :class="fold" class="pointer-events-auto absolute bottom-0 left-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:left-3">
      <button type="button" data-tip="decor" class="action" aria-label="Decorate" title="Move things around and place decorations" @click="emit('decor')">
        <span class="g-btn size-12 rounded-full" style="--face: #ff7ab0; --edge: #9c2f62"><Sofa class="size-5.5" :stroke-width="2.75" /></span>
        <span class="action-label">Decor</span>
      </button>
    </div>

    <!-- Action bar -->
    <!-- The bar spans the width to centre its buttons; only the buttons take clicks (the Decor button and the floor stay reachable beside them). -->
    <!-- Narrow phones: the bar centres beside the Decor button (left padding) with smaller gaps, so the two never overlap. -->
    <nav :class="fold" class="pointer-events-none absolute inset-x-0 bottom-0 flex *:pointer-events-auto items-end justify-center gap-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-[379px]:gap-3 max-[379px]:pl-14 sm:gap-7">
      <button type="button" data-tip="games" class="action" aria-label="Games" @click="openGames">
        <span class="g-btn g-blue size-14 rounded-full"><LayoutGrid class="size-6" :stroke-width="2.75" /></span>
        <span class="action-label">Games</span>
        <span v-if="gamesDot" class="dot" />
      </button>
      <button type="button" data-tip="build" class="action" aria-label="Build" @click="emit('build')">
        <span class="g-btn g-green size-[72px] rounded-full"><Hammer class="size-8" :stroke-width="2.75" /></span>
        <span class="action-label">Build</span>
        <span v-if="buildCount" class="dot g-num grid min-w-6 place-items-center px-1 text-xs leading-none" :class="reducedMotion ? '' : 'g-bounce'">{{ buildCount > 9 ? '9+' : buildCount }}</span>
      </button>
      <button type="button" class="action" aria-label="Gem shop" @click="emit('shop')">
        <span class="g-btn g-purple size-14 rounded-full"><CasinoGemIcon class="size-6 text-[#bff8f2]" /></span>
        <span class="action-label">Shop</span>
      </button>
    </nav>

    <!-- A tap anywhere closes the skip popover. -->
    <div v-if="skipFor || info || guestsOpen" class="pointer-events-auto fixed inset-0 -z-10" @pointerdown="skipFor = null; info = false; guestsOpen = false" />
  </div>
</template>

<style scoped>
.res-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 2.25rem;
  padding: 0 0.75rem 0 1.85rem;
  margin-left: 0.6rem;
  border-radius: 999px;
  background: linear-gradient(180deg, #1b1329, #241a36);
  border: 2px solid #0e0917;
  box-shadow: 0 3px 0 #0e0917, inset 0 2px 0 rgb(0 0 0 / 0.35), 0 6px 14px rgb(0 0 0 / 0.3);
  line-height: 1;
}
@media (min-width: 640px) {
  .res-pill { height: 2.6rem; padding-left: 2.2rem; padding-right: 1rem; }
}
.res-icon {
  position: absolute;
  left: -0.7rem;
  width: 2.3rem;
  height: 2.3rem;
  filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.45));
}
@media (min-width: 640px) {
  .res-icon { width: 2.7rem; height: 2.7rem; }
}
.cage {
  background: linear-gradient(180deg, #3b2c58, #2a1f3f 60%);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, 0 10px 20px rgb(0 0 0 / 0.35), inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.missions {
  background: linear-gradient(180deg, #3b2c58, #2a1f3f 60%);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, 0 10px 20px rgb(0 0 0 / 0.35), inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.level-btn {
  background: linear-gradient(180deg, #3b2c58, #2a1f3f 60%);
  border: 2px solid #120c1d;
  box-shadow: 0 3px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.level-glow { animation: level-glow 1.6s ease-out 1; }
@keyframes level-glow {
  0%, 100% { box-shadow: 0 4px 0 #120c1d, 0 10px 20px rgb(0 0 0 / 0.35); }
  20%, 60% { border-color: #a879ff; box-shadow: 0 4px 0 #120c1d, 0 0 0 3px rgb(168 121 255 / 0.6), 0 0 26px 6px rgb(168 121 255 / 0.55); }
  40% { box-shadow: 0 4px 0 #120c1d, 0 0 0 0 rgb(168 121 255 / 0); }
}
.missions-ready {
  border-color: #1b8a33;
  box-shadow: 0 4px 0 #120c1d, 0 0 0 3px rgb(63 210 90 / 0.45), 0 0 22px 4px rgb(63 210 90 / 0.4);
}
.cage-full {
  border-color: #c3840a;
  box-shadow: 0 4px 0 #7a4a00, 0 0 0 3px rgb(255 201 58 / 0.5), 0 0 26px 6px rgb(255 201 58 / 0.45);
}
/* Visitors and the campaign: the currency pills' height, without the icon overhang. */
.hud-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 2.25rem;
  padding: 0 0.7rem;
  border-radius: 999px;
  background: linear-gradient(180deg, #1b1329, #241a36);
  border: 2px solid #0e0917;
  box-shadow: 0 3px 0 #0e0917, inset 0 2px 0 rgb(0 0 0 / 0.35), 0 6px 14px rgb(0 0 0 / 0.3);
  line-height: 1;
}
@media (min-width: 640px) {
  .hud-pill { height: 2.6rem; padding: 0 0.9rem; }
}
/* A 44px tap target around a smaller control. */
.hud-hit::after {
  content: '';
  position: absolute;
  inset: -4px;
}
.stat-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 600;
}
.full-glow { animation: full-glow 1.2s ease-in-out infinite; }
/* The "New rule" bubble: a little tail up to the cage. */
.new-rule::before {
  content: '';
  position: absolute;
  top: -7px;
  left: 22px;
  width: 12px;
  height: 12px;
  background: var(--g-panel-hi);
  border-left: 2px solid var(--g-panel-edge);
  border-top: 2px solid var(--g-panel-edge);
  transform: rotate(45deg);
}
/* The megaphone calls: a ring that grows and fades, and a little wobble. */
.nudge::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 3px solid #7dd3fc;
  animation: nudge-ring 1.8s ease-out infinite;
  pointer-events: none;
}
.nudge > .g-btn { animation: nudge-wobble 1.8s ease-in-out infinite; }
@keyframes nudge-ring {
  0% { opacity: 0.9; transform: scale(1); }
  70%, 100% { opacity: 0; transform: scale(1.45); }
}
@keyframes nudge-wobble {
  0%, 60%, 100% { transform: rotate(0deg); }
  70% { transform: rotate(-10deg) scale(1.06); }
  80% { transform: rotate(8deg) scale(1.06); }
  90% { transform: rotate(-4deg); }
}
@keyframes full-glow {
  0%, 100% { text-shadow: 0 2px 0 rgb(0 0 0 / 0.4), 0 0 0 rgb(255 201 58 / 0); }
  50% { text-shadow: 0 2px 0 rgb(0 0 0 / 0.4), 0 0 12px rgb(255 201 58 / 0.9); }
}
.action {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  -webkit-tap-highlight-color: transparent;
}
.action:active .g-btn {
  transform: translateY(3px) scale(0.94);
  box-shadow: 0 1px 0 var(--edge);
}
.action-label {
  font-family: var(--font-game);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 0 2px 0 rgb(0 0 0 / 0.7), 0 0 6px rgb(0 0 0 / 0.6);
}
.dot {
  position: absolute;
  top: -2px;
  right: -4px;
  min-width: 1.4rem;
  height: 1.4rem;
  border-radius: 999px;
  background: #ff3b5c;
  border: 2.5px solid #fff;
  box-shadow: 0 2px 0 rgb(0 0 0 / 0.4);
  color: #fff;
}
.floater { animation: floater 1.5s ease-out forwards; }
/* Coins landing from the cage: a gold ring bursts off the pill. */
.coin-land { animation: coin-land 0.7s ease-out forwards; }
@keyframes coin-land {
  0% { opacity: 0; transform: scale(0.95); box-shadow: 0 0 0 0 rgb(255 201 58 / 0.9), 0 0 0 0 rgb(255 201 58 / 0.6); }
  20% { opacity: 1; transform: scale(1.06); box-shadow: 0 0 0 3px rgb(255 201 58 / 0.9), 0 0 24px 6px rgb(255 201 58 / 0.65); }
  100% { opacity: 0; transform: scale(1.18); box-shadow: 0 0 0 3px rgb(255 201 58 / 0), 0 0 30px 10px rgb(255 201 58 / 0); }
}
@keyframes floater {
  0% { opacity: 0; transform: translateY(-4px) scale(0.7); }
  15% { opacity: 1; transform: translateY(2px) scale(1.15); }
  70% { opacity: 1; }
  100% { opacity: 0; transform: translateY(22px) scale(1); }
}
.pop-enter-active { transition: transform 0.18s cubic-bezier(0.3, 1.4, 0.5, 1), opacity 0.15s ease; }
.pop-leave-active { transition: transform 0.12s ease, opacity 0.12s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(0.85) translateX(8px); }
@media (prefers-reduced-motion: reduce) {
  .floater { animation-duration: 0.01s; }
  .coin-land { animation: none; }
  .full-glow { animation: none; }
}
</style>
