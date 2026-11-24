<script setup lang="ts">
import { Gem, TrendingUp } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import type { SpecialLift } from '~/utils/tycoon-art'

/**
 * A special's effect as compact stat chips, the same everywhere: rarity (a gem
 * in the guest tier's colour, "+15% High Rollers"), spend (a rising arrow,
 * "+3% spend"), and the coins an hour it adds when that is at least 1.
 */
const props = defineProps<{
    lifts: (SpecialLift | null | undefined)[]
    /** Coins an hour it adds (or would, placed); shown from 1 up. */
    gain?: number | null
    /** In storage: the gain only counts once it is placed. */
    stored?: boolean
}>()

const chips = computed(() => props.lifts.filter((l): l is SpecialLift => !!l))
const pct = (share: number) => {
    const n = Math.round(share * 100)
    return n < 1 && share > 0 ? '<1%' : `${n}%`
}
</script>

<template>
  <span class="inline-flex max-w-full flex-wrap items-center gap-1">
    <template v-for="(l, i) in chips" :key="i">
      <span
        v-if="l.kind === 'rarity'"
        class="chip"
        :title="`Richer guests: ${pct(l.rise)} more ${tierPlural(l.tier.id, 2)} come in`"
      >
        <Gem class="size-3.5 shrink-0" :style="{ color: l.tier.color }" :stroke-width="2.75" />
        <span class="g-num" :style="{ color: l.tier.color }">+{{ pct(l.rise) }}</span>
        <span class="truncate">{{ tierPlural(l.tier.id, 2) }}</span>
      </span>
      <span
        v-else-if="l.kind === 'rarity-locked'"
        class="chip text-[var(--g-muted)]"
        :title="`Richer guests: brings more ${tierPlural(l.tier.id, 2)} once you open the ${l.room}`"
      >
        <Gem class="size-3.5 shrink-0" :style="{ color: l.tier.color }" :stroke-width="2.75" />
        <span class="truncate">{{ tierPlural(l.tier.id, 2) }}: open the {{ l.room }}</span>
      </span>
      <span v-else class="chip" :title="`Every guest spends ${pct(l.share)} more`">
        <TrendingUp class="size-3.5 shrink-0 text-[#ffc93a]" :stroke-width="2.75" />
        <span class="g-num text-[#ffc93a]">+{{ pct(l.share) }}</span>
        <span>spend</span>
      </span>
    </template>
    <span v-if="gain && gain >= 1" class="chip text-[#7ee08f]" :title="`About ${formatCoins(gain)} more coins an hour on average for your cage${stored ? ' once it stands on the floor' : ''}`">
      <CasinoCoinIcon class="size-3.5 shrink-0" />
      <span class="g-num">+{{ formatCoins(gain) }}/h</span>
      <span v-if="stored" class="font-normal">placed</span>
    </span>
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  max-width: 100%;
  height: 1.5rem;
  padding: 0 0.5rem;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.3);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
</style>
