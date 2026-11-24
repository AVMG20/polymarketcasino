<script setup lang="ts">
import { Flag, Hourglass } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import type { BuildKind } from '#shared/tycoon'

/**
 * The next goal while the player saves up: the cheapest build they can't
 * afford yet, under a "goal" flag, with a ring of chips held against its
 * price and the chips still missing (or "Play!" / "Collect!" when the coins
 * in hand or in the cage should win the rest). The rough time to it is in
 * the tooltip. Tap to open its build card.
 */
const emit = defineEmits<{ open: [kind: BuildKind, id: string] }>()
const tycoon = useTycoon()
const { coins } = useCasinoSession()

/** Coins come back as chips at about this rate (every game's RTP is a bit under 1). */
const RTP = 0.97

const goal = computed(() => tycoon.goal.value)
const price = computed(() => goal.value?.cost?.chips ?? 0)
const progress = computed(() => (price.value > 0 ? tycoon.chips.value / price.value : 0))

/**
 * Where the missing chips come from, roughly: the coins in hand ('play'), the
 * coins waiting in the cage ('collect'), else the cage's income over time.
 */
const source = computed<'play' | 'collect' | 'wait' | null>(() => {
    const g = goal.value
    if (!g) return null
    if (coins.value * RTP >= g.missingChips) return 'play'
    if ((coins.value + tycoon.cageStored.value) * RTP >= g.missingChips) return 'collect'
    return 'wait'
})
/** Hours of cage income still needed after the coins in hand and in the cage; null when there is no income. */
const etaHours = computed(() => {
    const g = goal.value
    if (!g || source.value !== 'wait') return null
    const short = g.missingChips - (coins.value + tycoon.cageStored.value) * RTP
    const perHour = tycoon.perHour.value * RTP
    return perHour > 0 ? short / perHour : null
})

const eta = computed(() => {
    if (source.value === 'play') return 'Play!'
    if (source.value === 'collect') return 'Collect!'
    const h = etaHours.value
    if (h === null) return null
    const min = Math.max(1, Math.round(h * 60))
    if (min < 60) return `~${min} min`
    if (h < 48) return `~${Math.round(h)} h`
    return `~${Math.round(h / 24)} d`
})

const title = computed(() => {
    const g = goal.value
    if (!g) return ''
    const head = `Next: ${g.name} · ${formatCoins(tycoon.chips.value)} / ${formatCoins(price.value)} chips`
    if (source.value === 'play') return `${head} · your coins should win the rest: play!`
    if (source.value === 'collect') return `${head} · the coins in your cage should win the rest: collect and play!`
    return eta.value
        ? `${head} · ${eta.value} (an estimate: your coins and the cage's income, won back at about ${Math.round(RTP * 100)}%)`
        : head
})
</script>

<template>
  <Transition name="goal">
    <button
      v-if="goal"
      type="button"
      class="goal pointer-events-auto relative ml-2 grid size-[60px] shrink-0 place-items-center rounded-[22px] transition-transform active:scale-95"
      :aria-label="title"
      @click="emit('open', goal.kind, goal.id)"
    >
      <!-- The flag says what this is: a goal you are saving chips for. -->
      <span class="flag absolute -top-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border-2 border-black/50 px-1.5 text-[9px] leading-[14px] tracking-wide uppercase">
        <Flag class="size-2.5" :stroke-width="3.5" /><span class="g-num">Goal</span>
      </span>
      <TycoonRing :progress="progress" :size="50" :stroke="4.5" color="#4aa6ff">
        <span class="block size-[38px] overflow-hidden rounded-full border-2 border-black/50">
          <TycoonItemArt :kind="goal.kind" :id="goal.id" />
        </span>
      </TycoonRing>
      <span
        class="g-num absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border-2 border-black/50 px-1.5 text-[11px] leading-4 whitespace-nowrap"
        :class="source === 'play' ? 'bg-[#3fd25a] text-[#0b3a17]' : source === 'collect' ? 'bg-[#ffc93a] text-[#4a2a00]' : 'bg-[#1b1329]'"
      >
        <template v-if="source === 'play'">Play!</template>
        <template v-else-if="source === 'collect'">Collect!</template>
        <template v-else><CasinoChipIcon class="size-3" />{{ formatCoins(goal.missingChips, true) }}</template>
      </span>
      <!-- Desktop: a card with the goal's name, chips and rough time, on hover. -->
      <span class="tip pointer-events-none absolute top-full left-1/2 z-50 mt-3 -translate-x-1/2 hidden w-max max-w-56 rounded-2xl p-2.5 text-left">
        <span class="block text-[10px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Saving for</span>
        <span class="g-title block truncate text-base leading-tight">{{ goal.name }}</span>
        <span class="mt-1 flex items-center gap-1 text-sm"><TycoonCost :amount="tycoon.chips.value" compact /><span class="text-white/50">/</span><TycoonCost :amount="price" compact /></span>
        <span v-if="source === 'wait' && eta" class="mt-1 flex items-center gap-1 text-xs text-white/75"><Hourglass class="size-3.5 text-[#ffc93a]" :stroke-width="3" />{{ eta }} of cage income</span>
        <span v-else-if="source" class="mt-1 block text-xs text-white/75">{{ source === 'play' ? 'Your coins should win the rest' : 'Collect your cage, then play' }}</span>
      </span>
    </button>
  </Transition>
</template>

<style scoped>
.goal {
  background: linear-gradient(180deg, #3b2c58, #2a1f3f 60%);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, 0 10px 20px rgb(0 0 0 / 0.35), inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.flag {
  background: linear-gradient(180deg, #ffd65a, #f4a91f);
  color: #4a2a00;
}
.tip {
  background: linear-gradient(180deg, #3b2c58, #2a1f3f);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, 0 10px 20px rgb(0 0 0 / 0.4);
}
@media (hover: hover) and (pointer: fine) {
  .goal:hover .tip, .goal:focus-visible .tip { display: block; }
}
.goal-enter-active { transition: transform 0.22s cubic-bezier(0.3, 1.4, 0.5, 1), opacity 0.15s ease; }
.goal-leave-active { transition: transform 0.15s ease, opacity 0.15s ease; }
.goal-enter-from, .goal-leave-to { opacity: 0; transform: scale(0.6); }
@media (prefers-reduced-motion: reduce) {
  .goal-enter-active, .goal-leave-active { transition: opacity 0.15s ease; }
  .goal-enter-from, .goal-leave-to { transform: none; }
}
</style>
