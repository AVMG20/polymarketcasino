<script setup lang="ts">
import { ArrowUpCircle, Footprints, Megaphone, Store, Users, X } from 'lucide-vue-next'
import { formatCoins, formatCoinsExact } from '#shared/money'
import { findCampaign } from '#shared/tycoon'

/**
 * "While you were away": the card the floor shows when the player comes back
 * after ten minutes or more (the server says what happened, see
 * server/utils/welcome.ts). The cage's coins come first, with a gentle
 * nudge when a full cage turned income away; then what got built, the
 * campaign that ran out and the visitors now. One big button walks to the
 * cage and collects. Coins other players' bets put in the cage (their 1%
 * rakeback, the visitors pot) show under it.
 */
const emit = defineEmits<{ collect: [], upgradeCage: [], campaigns: [] }>()
const tycoon = useTycoon()
const sound = useTycoonSound()
const away = computed(() => tycoon.welcome.value)
const campaign = computed(() => (away.value?.campaignEnded ? findCampaign(away.value.campaignEnded) ?? null : null))
const cageMaxed = computed(() => (tycoon.state.value?.upgrades.cage ?? 0) >= 5)
/** Income per hour of the away stretch, and the Whales who came by. */
const hours = computed(() => cageHours(away.value?.hours ?? []))
const longAway = computed(() => (away.value?.awayMs ?? 0) > 20 * 3_600_000)
/** The three biggest spenders, in the order they came; the rest as a count. */
const notableMore = computed(() => Math.max(0, (away.value?.whales ?? away.value?.notable?.length ?? 0) - Math.min(3, away.value?.notable?.length ?? 0)))
const notable = computed(() => [...(away.value?.notable ?? [])].sort((a, b) => b.spent - a.spent).slice(0, 3).sort((a, b) => a.at - b.at).map(g => ({
    ...g,
    color: tierDef(g.tier).color,
    // Their whole stay: "A Whale played 22:00-00:30 and spent 2.250".
    text: g.until
        ? `A ${tierDef(g.tier).name} played ${longAway.value ? formatDayClock(g.at) : formatClock(g.at)}-${formatClock(g.until)} and spent ${formatCoins(g.spent)}`
        : `A ${tierDef(g.tier).name} came in at ${longAway.value ? formatDayClock(g.at) : formatClock(g.at)} and spent ${formatCoins(g.spent)}`
})))

function close() {
    tycoon.welcome.value = null
}
function collect() {
    close()
    emit('collect')
}
function upgrade() {
    close()
    emit('upgradeCage')
}
function campaigns() {
    close()
    emit('campaigns')
}

watch(away, value => value && sound.play('levelUp'))

const COLORS = ['#ffc93a', '#ff5470', '#3fd25a', '#4aa6ff', '#a879ff', '#2fe0d0']
const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
    x: Math.round(Math.cos((i / 16) * Math.PI * 2) * (120 + (i % 3) * 30)),
    y: Math.round(Math.sin((i / 16) * Math.PI * 2) * (70 + (i % 4) * 16)) - 60,
    r: (i * 53) % 360,
    d: (i % 4) * 40,
    c: COLORS[i % COLORS.length]
}))
</script>

<template>
  <Transition name="welcome">
    <div v-if="away" class="g-ui absolute inset-0 z-[46] grid place-items-center bg-[#0b0712]/55 p-3" role="dialog" aria-label="While you were away" @click.self="close">
      <div class="relative flex max-h-full w-full max-w-[22rem] flex-col">
        <span
          v-for="(c, i) in CONFETTI"
          :key="i"
          class="confetti pointer-events-none absolute top-16 left-1/2 h-3 w-1.5 rounded-sm"
          :style="{ background: c.c, '--x': `${c.x}px`, '--y': `${c.y}px`, '--r': `${c.r}deg`, animationDelay: `${c.d}ms` }"
        />
        <div class="g-panel relative min-h-0 overflow-x-hidden overflow-y-auto rounded-[28px] px-4 pt-3 pb-4">
          <button type="button" class="g-btn g-dark absolute top-2 right-2 size-11 rounded-full" aria-label="Close" @click="close">
            <X class="size-5" :stroke-width="3" />
          </button>
          <p class="g-title pr-12 text-2xl leading-tight uppercase">Welcome back!</p>
          <p class="text-sm font-semibold text-[var(--g-muted)]">While you were away · {{ formatDuration(away.awayMs) }}</p>

          <!-- The cage -->
          <div class="g-well mt-3 flex items-center gap-3 rounded-2xl p-2.5">
            <span class="relative grid size-16 shrink-0 place-items-center rounded-2xl bg-black/30">
              <TycoonChipJar :fill="away.capacity > 0 ? Math.min(1, away.stored / away.capacity) : 0" class="h-14 w-12" />
              <span v-if="away.full" class="g-title absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border-2 border-[#7a4a00] bg-[#ffc93a] px-1.5 text-[11px] leading-4 text-[#5a3200] [text-shadow:none]">FULL</span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="g-num flex items-center gap-1.5 text-3xl leading-none text-[#ffe066]" :title="`${formatCoins(away.earned)} coins came into your cage`">
                <CasinoCoinIcon class="size-7 shrink-0" />+{{ formatCoins(away.earned) }}
              </span>
              <span v-if="away.lost > 0" class="mt-1.5 block text-[13px] leading-4 font-semibold text-[#ffb35c]" :title="`The cage was full: ${formatCoins(away.lost)} coins of guest income had nowhere to go`">
                Cage full: {{ formatCoins(away.lost) }} lost
              </span>
            </span>
          </div>
          <!-- What visitors' bets paid you: 1% of every bet placed in your casino by someone else, as coins in the cage. -->
          <p v-if="(away.visitorCoins ?? 0) > 0" class="mt-2 flex items-center gap-1.5 text-[13px] leading-4 font-semibold" :title="`Other players bet in your casino: 1% of their bets, ${formatCoinsExact(away.visitorCoins ?? 0)} coins, went into your cage`">
            <Store class="size-4 shrink-0 text-[#ffc93a]" :stroke-width="2.75" />
            <span>Visitors' bets paid you</span>
            <span class="g-num flex items-center gap-1 text-[#ffe066]"><CasinoCoinIcon class="size-3.5" />+{{ formatCoins(away.visitorCoins ?? 0) }}</span>
          </p>
          <!-- Hour by hour, and who came by -->
          <TycoonHourStrip v-if="hours.length > 1" :hours="hours" :days="longAway" class="mt-2.5" />
          <ul v-if="notable.length" class="mt-2 space-y-1">
            <li v-for="g in notable" :key="g.id ?? `${g.at}:${g.tier}`" class="flex items-center gap-2 text-[13px] leading-4 font-semibold">
              <span class="size-2.5 shrink-0 rounded-full border border-black/50" :style="{ background: g.color, boxShadow: g.tier === 'whale' ? `0 0 6px 1px ${g.color}` : undefined }" />
              {{ g.text }}
            </li>
            <li v-if="notableMore" class="pl-[18px] text-[12px] leading-4 font-semibold text-[var(--g-muted)]">and {{ notableMore }} more {{ notableMore === 1 ? 'Whale' : 'Whales' }}</li>
          </ul>
          <button
            v-if="away.lost > 0 && !cageMaxed"
            type="button"
            class="g-btn g-orange mt-2 h-11 w-full rounded-xl text-base"
            title="A bigger cage holds more while you are away"
            @click="upgrade"
          >
            <ArrowUpCircle class="size-5" :stroke-width="3" /> Bigger cage
          </button>

          <!-- What got built, the campaign that ended, the visitors now -->
          <ul v-if="away.finished.length" class="mt-3 flex flex-wrap gap-2">
            <li v-for="item in away.finished.slice(0, 6)" :key="`${item.kind}:${item.id}:${item.level}`" class="built flex items-center gap-1.5 rounded-2xl py-1 pr-2.5 pl-1" :title="`${buildName(item.kind, item.id)} done`">
              <span class="block size-9 shrink-0 overflow-hidden rounded-xl border-2 border-black/50"><TycoonItemArt :kind="item.kind" :id="item.id" /></span>
              <span class="flex flex-col">
                <span class="g-title max-w-[7.5rem] truncate text-[13px] leading-4">{{ buildName(item.kind, item.id) }}</span>
                <TycoonPips v-if="item.kind !== 'zone'" :level="item.level" :max="5" />
              </span>
            </li>
          </ul>
          <div class="mt-3 flex items-center gap-2">
            <span class="g-well flex h-11 items-center gap-1.5 rounded-xl px-3" title="Guests on your floor now / seats">
              <TycoonVisitorDots v-if="tycoon.floorNow.value" :counts="tycoon.visitorTiers.value" class="text-lg" />
              <template v-else>
                <Users class="size-5 text-[#7dd3fc]" :stroke-width="3" />
                <span class="g-num text-lg leading-none">{{ away.visitors }}</span>
              </template>
              <span class="g-num text-sm leading-none text-[var(--g-muted)]">/{{ away.seats }}</span>
            </span>
            <button v-if="campaign" type="button" class="g-btn g-blue h-11 min-w-0 flex-1 rounded-xl px-2 text-[15px]" :title="`${campaign.name} ran out: run another for more visitors`" @click="campaigns">
              <span class="block size-6 shrink-0 overflow-hidden rounded-full"><TycoonCampaignArt :id="campaign.id" /></span>
              <span class="line-clamp-2 text-left text-[13px] leading-[15px]">{{ campaign.name }} ended</span>
              <Megaphone class="size-4 shrink-0" :stroke-width="3" />
            </button>
          </div>

          <button type="button" class="g-btn g-green collect mt-4 h-14 w-full rounded-2xl text-xl uppercase" @click="collect">
            <Footprints class="size-6" :stroke-width="3" /> Collect
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.built {
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 3px 0 #120c1d;
}
.collect { animation: collect-glow 1.4s ease-in-out infinite; }
@keyframes collect-glow {
  0%, 100% { box-shadow: 0 4px 0 var(--edge), 0 0 0 0 rgb(63 210 90 / 0); }
  50% { box-shadow: 0 4px 0 var(--edge), 0 0 0 5px rgb(63 210 90 / 0.35), 0 0 24px 4px rgb(63 210 90 / 0.4); }
}
.confetti {
  opacity: 0;
  animation: confetti 1.4s cubic-bezier(0.2, 0.8, 0.3, 1) 0.15s forwards;
}
@keyframes confetti {
  0% { opacity: 1; transform: translate(-50%, -50%) rotate(0) scale(0.4); }
  60% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y) + 70px)) rotate(calc(var(--r) + 360deg)) scale(1); }
}
.welcome-enter-active { transition: opacity 0.2s ease; }
.welcome-enter-active .g-panel { transition: transform 0.45s cubic-bezier(0.3, 1.5, 0.5, 1); }
.welcome-leave-active { transition: opacity 0.18s ease; }
.welcome-enter-from, .welcome-leave-to { opacity: 0; }
.welcome-enter-from .g-panel { transform: scale(0.6) translateY(30px); }
@media (prefers-reduced-motion: reduce) {
  .confetti { display: none; }
  .collect { animation: none; }
  .welcome-enter-active .g-panel { transition: none; }
  .welcome-enter-from .g-panel { transform: none; }
}
</style>
