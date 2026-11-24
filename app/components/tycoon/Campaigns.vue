<script setup lang="ts">
import { Armchair, Clock, Gem, Lock, Megaphone, Plus, Timer, Users } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import { CAMPAIGN_STACK_FACTOR, MAX_CAMPAIGN_QUEUE_MS } from '#shared/tycoon'
import { VISITOR_TIER_IDS, VISITOR_TIERS } from '#shared/visitors'
import type { CampaignView } from '~/composables/useTycoon'

/**
 * The ad campaign picker: how full the floor is, then one tile per campaign
 * (art, what a run adds over its whole run, how long it runs, the chip price
 * on the button, and why it can't start when it can't). Campaigns of
 * different kinds run side by side, each with its own timer; buying a
 * running one extends it. Guests ads fill empty seats, wealth ads bring
 * richer guests. Tap a picture for the preview below: who comes, before and
 * with it. Every run already queued makes the next extension dearer (×1,5
 * each), and a queue stops at a week.
 */
const stackHint = `×${formatFixed(CAMPAIGN_STACK_FACTOR, 1)}`
/** The week cap is what blocks it (not a lock or another campaign). */
const weekFull = (c: CampaignView) => c.running && !!c.blocker && c.leftMs + c.def.ms > MAX_CAMPAIGN_QUEUE_MS
const tycoon = useTycoon()

const seats = computed(() => tycoon.seats.value)
const fill = computed(() => tycoon.occupied.value)
const shake = ref<string | null>(null)

// The visitor count pops when it changes (a campaign just started).
const visitorPop = ref(0)
watch(() => tycoon.visitors.value, (to, from) => to > from && visitorPop.value++)

/** The campaign the preview shows (tap a picture): the first open one by default. */
const picked = ref<string | null>(null)
const preview = computed(() => {
    const list = tycoon.campaigns.value
    return list.find(c => c.def.id === picked.value) ?? list.find(c => c.lockedAt === null && !c.blocker) ?? list[0] ?? null
})
/** Who is on the floor on average without and with the previewed run, per tier (open tiers only). */
const previewRows = computed(() => {
    const c = preview.value
    if (!c) return []
    const fmt = (n: number) => (n < 1 ? formatFixed(n, 1) : String(Math.round(n)))
    // A tier that rounds to 0,0 both ways (a Whale on a small floor) is noise: leave it out.
    return VISITOR_TIER_IDS.filter(id => fmt(c.gain.before[id]) !== fmt(0) || fmt(c.gain.after[id]) !== fmt(0)).map((id) => {
        const def = VISITOR_TIERS.find(t => t.id === id)!
        const a = c.gain.before[id]
        const b = c.gain.after[id]
        return { id, name: `${def.name}s`, color: def.color, now: fmt(a), next: fmt(b), trend: fmt(a) === fmt(b) ? 0 : Math.sign(b - a) }
    })
})
/** What a run brings back against its price (coins over the run won back at RTP vs chips). */
const payback = (c: CampaignView) => (c.cost > 0 ? (c.gain.coins * 0.97) / c.cost : 0)

async function run(c: CampaignView) {
    if (tycoon.busy.value) return
    if (c.lockedAt !== null || c.blocker || !c.affordable) {
        shake.value = null
        await nextTick()
        shake.value = c.def.id
        return
    }
    await tycoon.startCampaign(c.def.id)
}

/**
 * The longest campaign on offer that outlasts the cage: its guests keep
 * paying in, but a full cage stops filling. Players who start a day-long run
 * and go to bed should know to collect on the way (or to grow the cage).
 */
const roughHours = (hours: number) => (hours >= 2 ? `~${Math.round(hours)}h` : formatDuration(hours * 3_600_000))
const outlasts = computed(() => {
    const capacity = tycoon.state.value?.cage.capacity ?? 0
    const perHour = (c: CampaignView) => (tycoon.expectedPerHour.value ?? tycoon.perHour.value) + c.gain.coins / Math.max(1, (c.gain.until - c.gain.from) / 3_600_000)
    const long = tycoon.campaigns.value
        .filter(c => c.lockedAt === null && perHour(c) > 0 && c.def.ms > (capacity / perHour(c)) * 3_600_000)
        .sort((a, b) => b.def.ms - a.def.ms)[0]
    return long ? { name: long.def.name, runs: formatDuration(long.def.ms), fills: roughHours(capacity / perHour(long)) } : null
})
/** Floor full and guests turned away: more guests can't sit, richer ones can. Empty seats: an ad fills them. */
const hint = computed(() => {
    if (!seats.value) return null
    if (fill.value >= 0.97 && tycoon.waiting.value > 0) return 'Floor full: build seats, or go for richer guests'
    if (fill.value < 0.8) return 'Empty seats: a guests ad fills them'
    return null
})

/** About what the extension after this one costs: every queued run adds ×CAMPAIGN_STACK_FACTOR (the server rounds its own price). */
const nextCost = (c: CampaignView) => Math.ceil(c.cost * CAMPAIGN_STACK_FACTOR)

function buttonTitle(c: CampaignView): string {
    if (c.blocker) return c.blocker
    if (!c.affordable) return `Need ${formatCoins(c.cost - tycoon.chips.value)} more chips`
    return c.running ? `Extend by ${formatDuration(c.def.ms)}; the next extension costs ${stackHint} more` : `Run ${c.def.name} for ${formatDuration(c.def.ms)}`
}
</script>

<template>
  <div class="space-y-3 px-3 pb-3">
    <!-- The floor now -->
    <div class="g-well space-y-1.5 rounded-2xl px-3 py-2">
      <div class="flex items-center gap-2">
        <Users class="size-5 shrink-0 text-[#7dd3fc]" :stroke-width="2.75" />
        <span class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Visitors / seats</span>
        <span :key="visitorPop" class="g-num text-xl leading-none" :class="visitorPop ? 'g-pop' : ''" title="Visitors on your floor / seats">{{ tycoon.visitors.value }}<span class="text-base text-[var(--g-muted)]"> / {{ seats }}</span></span>
        <span v-if="tycoon.waiting.value" class="g-num flex items-center gap-1 rounded-full bg-[#ff9a2e]/20 px-2 text-sm leading-6 text-[#ffb35c]" title="Turned away just now: no free seat (or your door policy). Build games or level them up for more seats">
          +{{ tycoon.waiting.value }} <Armchair class="size-3.5" :stroke-width="3" />
        </span>
        <span class="g-num ml-auto flex items-center gap-1 text-base text-[#7ee08f]" title="Guest coins an hour (into the cage)"><CasinoCoinIcon class="size-4" />+{{ formatCoins(tycoon.perHour.value) }}/h</span>
      </div>
      <span class="block h-2.5 overflow-hidden rounded-full bg-black/50" :title="`${Math.round(fill * 100)}% of the seats taken`">
        <span class="block h-full rounded-full bg-gradient-to-r from-[#4aa6ff] to-[#7dd3fc] transition-[width] duration-500" :style="{ width: `${fill * 100}%` }" />
      </span>
      <p v-if="hint" class="text-[12px] leading-4 font-semibold text-[#ffb35c]">{{ hint }}</p>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <div
        v-for="c in tycoon.campaigns.value"
        :key="c.def.id"
        class="tile relative flex min-w-0 flex-col rounded-[20px] p-1.5"
        :class="[c.running ? 'tile-running' : '', shake === c.def.id ? 'shake' : '']"
        :title="c.def.description"
      >
        <button type="button" class="relative aspect-square w-full overflow-hidden rounded-[14px] border-2" :class="preview?.def.id === c.def.id ? 'border-[#ffc93a]' : 'border-black/50'" :aria-label="`${c.def.name}: preview`" @click="picked = c.def.id">
          <span class="block size-full" :class="c.lockedAt !== null ? 'grayscale brightness-[0.55]' : ''"><TycoonCampaignArt :id="c.def.id" /></span>
          <span class="badge absolute top-1 left-1" title="How long it runs"><Clock class="size-3" :stroke-width="3" />{{ formatDuration(c.def.ms) }}</span>
          <span v-if="c.lockedAt !== null" class="absolute inset-0 grid place-items-center">
            <span class="grid size-10 place-items-center rounded-full border-2 border-black/50 bg-[#1b1329]/90 shadow-[0_3px_0_rgb(0_0_0/0.4)]"><Lock class="size-5 text-[#ffc93a]" :stroke-width="3" /></span>
          </span>
          <span v-else-if="c.running" class="badge absolute inset-x-1 bottom-1 justify-center bg-[#3fd25a]/90! text-[#0b3a17]" title="Running: time left on every run bought">
            <Timer class="size-3" :stroke-width="3" />{{ formatCountdown(c.leftMs) }}
          </span>
          <span v-if="c.def.goal === 'wealth'" class="badge absolute top-1 right-1" title="Wealth ad: richer guests in the same seats"><Gem class="size-3 text-[#c084fc]" :stroke-width="3" /></span>
        </button>

        <p class="g-title mt-1 truncate text-center leading-5" :class="c.def.name.length > 12 ? 'text-[12.5px] tracking-tight' : 'text-[15px]'" :title="c.def.name">{{ c.def.name }}</p>
        <p
          v-if="c.gain.coins >= 1"
          class="g-num flex min-w-0 items-center justify-center gap-0.5 overflow-hidden text-[13px] leading-5 whitespace-nowrap"
          :title="`On average over its ${formatDuration(c.def.ms)}: ${c.def.goal === 'wealth' ? `+${formatFixed(c.gain.richGuests, 1)} High Rollers and Whales` : `+${Math.round(c.gain.guests)} guests`} and +${formatCoins(c.gain.coins)} coins (it costs ${formatCoins(c.cost)} chips)`"
        >
          <template v-if="c.def.goal === 'wealth'"><template v-if="c.gain.richGuests >= 0.05"><Gem class="size-3.5 shrink-0 text-[#c084fc]" :stroke-width="3" /><span class="mr-1 text-[#c084fc]">+{{ formatFixed(c.gain.richGuests, 1) }}</span></template></template>
          <template v-else><Users class="size-3.5 shrink-0 text-[#7dd3fc]" :stroke-width="3" /><span class="mr-1 text-[#7dd3fc]">+{{ Math.round(c.gain.guests) }}</span></template>
          <CasinoCoinIcon class="size-3.5 shrink-0" /><span :class="payback(c) >= 1 ? 'text-[#7ee08f]' : 'text-[#ffb35c]'">+{{ formatCoins(Math.floor(c.gain.coins), true) }}</span>
        </p>
        <p v-else-if="c.lockedAt === null" class="text-center text-[11px] leading-[14px] font-semibold text-[#ffb35c]" :title="c.def.goal === 'wealth' ? 'No richer guests to bring yet: open their room first' : 'Every seat is taken: more guests would have nowhere to sit. Build seats, or go for richer guests.'">{{ c.def.goal === 'wealth' ? 'Nothing to gain yet' : 'Floor full' }}</p>

        <span v-if="c.lockedAt !== null" class="state-pill mt-1 text-[#ffc93a]" :title="`Needs Marketing level ${c.lockedAt}`">
          <Megaphone class="size-3.5 shrink-0" :stroke-width="3" /><span class="truncate text-[11px] leading-[13px] sm:text-xs">Marketing {{ c.lockedAt }}</span>
        </span>
        <button
          v-else
          type="button"
          class="g-btn mt-1 h-11 w-full rounded-xl px-1 text-[15px]"
          :class="c.blocker ? 'g-dark' : !c.affordable ? 'g-off' : c.running ? 'g-blue' : 'g-green'"
          :aria-disabled="!!c.blocker || !c.affordable"
          :disabled="tycoon.busy.value"
          :title="buttonTitle(c)"
          @click="run(c)"
        >
          <span v-if="weekFull(c)" class="text-[13px] leading-none">Max 1 week</span>
          <template v-else>
            <Plus v-if="c.running" class="size-4 shrink-0" :stroke-width="3.5" />
            <TycoonCost :amount="c.cost" compact />
          </template>
        </button>
        <p
          v-if="c.running && !weekFull(c)"
          class="mt-0.5 flex items-center justify-center gap-1 text-center text-[11px] leading-4 font-semibold text-[var(--g-muted)]"
          :title="`Each run still queued makes the next extension ${stackHint} dearer: after this one it costs about ${formatCoins(nextCost(c))} chips`"
        >
          then <TycoonCost :amount="nextCost(c)" compact />
        </p>
        <p v-else-if="c.blocker && c.lockedAt === null && !weekFull(c)" class="mt-0.5 text-center text-[11px] leading-[14px] font-semibold text-[var(--g-muted)]">{{ c.blocker }}</p>
      </div>
    </div>

    <!-- The preview: who is on the floor without and with a run, and what it brings back against its price. -->
    <div v-if="preview" class="g-well space-y-1.5 rounded-2xl px-3 py-2">
      <p class="flex items-baseline gap-2"><span class="g-title text-[15px]">{{ preview.def.name }}</span><span class="text-[12px] text-[var(--g-muted)]">{{ preview.def.description }}</span></p>
      <ul class="space-y-0.5">
        <li v-for="row in previewRows" :key="row.id" class="flex items-center gap-2 text-[13px] leading-5 font-semibold">
          <span class="size-2.5 shrink-0 rounded-full border border-black/50" :style="{ background: row.color }" />
          <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
          <span class="g-num text-[var(--g-muted)]">{{ row.now }}</span><span class="text-[var(--g-muted)]">→</span>
          <span class="g-num" :class="row.trend > 0 ? 'text-[#7ee08f]' : row.trend < 0 ? 'text-[#ff8a8a]' : 'text-white'">{{ row.next }}</span>
          <span class="w-3 text-xs" :class="row.trend > 0 ? 'text-[#7ee08f]' : 'text-[#ff8a8a]'">{{ row.trend > 0 ? '▲' : row.trend < 0 ? '▼' : '' }}</span>
        </li>
      </ul>
      <p class="flex items-center gap-1.5 border-t border-white/10 pt-1.5 text-[12.5px] leading-4 font-semibold" :title="`${preview.def.goal === 'wealth' ? 'High Rollers and Whales' : 'Guests'} on the floor on average, without and with it, and the coins it adds over its ${formatDuration(preview.def.ms)} (good and quiet hours averaged, before the cage cap)`">
        <template v-if="preview.def.goal === 'wealth'">
          <Gem class="size-3.5 shrink-0 text-[#c084fc]" :stroke-width="3" />
          <span class="g-num">+{{ formatFixed(preview.gain.richGuests, 1) }} rich guests</span>
        </template>
        <template v-else>
          <Users class="size-3.5 shrink-0 text-[#7dd3fc]" :stroke-width="3" />
          <span class="g-num">+{{ Math.round(preview.gain.guests) }} guests</span>
        </template>
        <span class="text-white/40">·</span>
        <CasinoCoinIcon class="size-3.5" /><span class="g-num">+{{ formatCoins(preview.gain.coins) }} over the run</span>
        <span class="ml-auto g-num" :class="payback(preview) >= 1 ? 'text-[#7ee08f]' : 'text-[#ffb35c]'">{{ payback(preview) >= 1 ? `pays ${formatFixed(payback(preview), 1)}×` : 'won\'t pay back' }}</span>
      </p>
      <!-- The cage caps what a run can bring: what collecting every four hours keeps, and how soon it fills. -->
      <p
        v-if="preview.gain.coins >= 1 && preview.gain.kept < preview.gain.coins * 0.95"
        class="text-[12px] leading-4 font-semibold text-[#ffb35c]"
        title="The cage stops filling when it is full: collect more often, or upgrade the Cashier Cage"
      >
        Collecting every 4h you keep ~{{ formatCoins(preview.gain.kept) }}{{ preview.gain.cageFullMs ? `: your cage fills in ${formatDuration(preview.gain.cageFullMs)}` : '' }}
      </p>
    </div>

    <!-- A long run outlasts the cage: say so before the player goes to bed. -->
    <p
      v-if="outlasts"
      class="g-well flex items-center gap-2 rounded-2xl px-2.5 py-2 text-[12.5px] leading-[1.3] font-semibold text-[var(--g-muted)]"
      :title="`The cage stops filling when it is full: collect while ${outlasts.name} runs, or upgrade the cage to hold more`"
    >
      <TycoonChipJar :fill="1" class="h-8 w-7 shrink-0" />
      <span><span class="text-[var(--g-ink)]">{{ outlasts.name }}</span> runs {{ outlasts.runs }}, an empty cage fills in {{ outlasts.fills }}: collect on the way or upgrade the cage.</span>
    </p>
  </div>
</template>

<style scoped>
.tile {
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.tile-running {
  border-color: #1b8a33;
  box-shadow: 0 4px 0 #120c1d, 0 0 0 2px rgb(63 210 90 / 0.6), 0 0 18px rgb(63 210 90 / 0.4), inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgb(18 12 29 / 0.82);
  border: 1.5px solid rgb(0 0 0 / 0.5);
  font-family: var(--font-game);
  font-size: 0.72rem;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
}
.state-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  height: 2.75rem;
  padding: 0 0.4rem;
  border-radius: 0.75rem;
  background: #1b1329;
  box-shadow: inset 0 2px 0 rgb(0 0 0 / 0.35);
  font-weight: 600;
  min-width: 0;
}
.shake { animation: shake 0.36s ease; }
@keyframes shake {
  20% { transform: translateX(-5px); }
  40% { transform: translateX(5px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(2px); }
}
@media (prefers-reduced-motion: reduce) {
  .shake { animation: none; }
}
</style>
