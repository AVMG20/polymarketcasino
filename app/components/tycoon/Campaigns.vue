<script setup lang="ts">
import { Armchair, Clock, Lock, Megaphone, Plus, Timer, TrendingUp, Users } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import { CAMPAIGN_STACK_FACTOR, MAX_CAMPAIGN_QUEUE_MS } from '#shared/tycoon'
import type { CampaignView } from '~/composables/useTycoon'

/**
 * The ad campaign picker: how full the floor is, then one big tile per
 * campaign (art, visitor boost, how long it runs, the chip price on the
 * button). The running one extends; locked ones show the Marketing level
 * they need. Every run already queued makes the next extension dearer
 * (×1,5 each), and the queue stops at a week.
 */
const stackHint = `×${formatFixed(CAMPAIGN_STACK_FACTOR, 1)}`
/** The week cap is what blocks it (not a lock or another campaign). */
const weekFull = (c: CampaignView) => c.running && !!c.blocker && (tycoon.campaign.value?.leftMs ?? 0) + c.def.ms > MAX_CAMPAIGN_QUEUE_MS
const tycoon = useTycoon()

const seats = computed(() => tycoon.seats.value)
const fill = computed(() => tycoon.occupied.value)
const shake = ref<string | null>(null)

// The visitor count pops when it changes (a campaign just started).
const visitorPop = ref(0)
watch(() => tycoon.visitors.value, (to, from) => to > from && visitorPop.value++)

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
        <span :key="visitorPop" class="g-num text-xl leading-none" :class="visitorPop ? 'g-pop' : ''" title="Visitors on your floor / seats">{{ tycoon.visitors.value }}<span class="text-base text-[var(--g-muted)]"> / {{ seats }}</span></span>
        <span v-if="tycoon.waiting.value" class="g-num flex items-center gap-1 rounded-full bg-[#ff9a2e]/20 px-2 text-sm leading-6 text-[#ffb35c]" title="Waiting at the door: build games or level them up for more seats">
          +{{ tycoon.waiting.value }} <Armchair class="size-3.5" :stroke-width="3" />
        </span>
        <span class="g-num ml-auto flex items-center gap-1 text-base text-[#7ee08f]" title="Guest coins an hour (into the cage)"><TrendingUp class="size-4" :stroke-width="3" />+{{ formatCoins(tycoon.perHour.value) }}/h</span>
      </div>
      <span class="block h-2.5 overflow-hidden rounded-full bg-black/50" :title="`${Math.round(fill * 100)}% of the seats taken`">
        <span class="block h-full rounded-full bg-gradient-to-r from-[#4aa6ff] to-[#7dd3fc] transition-[width] duration-500" :style="{ width: `${fill * 100}%` }" />
      </span>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <div
        v-for="c in tycoon.campaigns.value"
        :key="c.def.id"
        class="tile relative flex min-w-0 flex-col rounded-[20px] p-1.5"
        :class="[c.running ? 'tile-running' : '', shake === c.def.id ? 'shake' : '']"
        :title="c.def.description"
      >
        <button type="button" class="relative aspect-square w-full overflow-hidden rounded-[14px] border-2 border-black/50" :aria-label="buttonTitle(c)" @click="run(c)">
          <span class="block size-full" :class="c.lockedAt !== null ? 'grayscale brightness-[0.55]' : ''"><TycoonCampaignArt :id="c.def.id" /></span>
          <span class="badge absolute top-1 left-1" title="How long it runs"><Clock class="size-3" :stroke-width="3" />{{ formatDuration(c.def.ms) }}</span>
          <span v-if="c.lockedAt !== null" class="absolute inset-0 grid place-items-center">
            <span class="grid size-10 place-items-center rounded-full border-2 border-black/50 bg-[#1b1329]/90 shadow-[0_3px_0_rgb(0_0_0/0.4)]"><Lock class="size-5 text-[#ffc93a]" :stroke-width="3" /></span>
          </span>
          <span v-else-if="c.running && tycoon.campaign.value" class="badge absolute inset-x-1 bottom-1 justify-center bg-[#3fd25a]/90! text-[#0b3a17]" title="Queued: time left on every run bought">
            <Timer class="size-3" :stroke-width="3" />{{ formatCountdown(tycoon.campaign.value.leftMs) }}
          </span>
        </button>

        <p class="g-title mt-1 truncate text-center text-[15px] leading-5">{{ c.def.name }}</p>
        <p class="g-num flex items-center justify-center gap-1 text-sm leading-5" :title="`Visitors ${formatBoost(c.boost)}: ${tycoon.visitors.value} → ${c.visitors} · +${formatCoins(c.perHour)}/h`">
          <Users class="size-3.5 text-[#7dd3fc]" :stroke-width="3" /><span class="text-[#7dd3fc]">{{ formatBoost(c.boost) }}</span>
        </p>

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
      </div>
    </div>

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
