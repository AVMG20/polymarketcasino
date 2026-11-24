<script setup lang="ts">
import { Gem, TrendingUp } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import { lockedTiersHint, tierList, type SpecialLift } from '~/utils/tycoon-art'

/**
 * A special's effect as compact stat chips, the same everywhere: rarity (a gem
 * in each richer guest tier's colour, "+12% Regulars", "+25% High Rollers",
 * with a muted line for the tiers whose room isn't open yet), spend (a rising
 * arrow, "+3% spend"), and the coins an hour it adds when that is at least 1.
 */
const props = defineProps<{
    lifts: (SpecialLift | null | undefined)[]
    /** Coins an hour it adds (or would, placed); shown from 1 up. */
    gain?: number | null
    /** In storage: the gain only counts once it is placed. */
    stored?: boolean
}>()

const chips = computed(() => props.lifts.filter((l): l is SpecialLift => !!l))
/** Richer tiers still locked, one line under the chips. */
const hints = computed(() => chips.value.flatMap((l) => {
    const text = lockedTiersHint(l)
    // Nothing richer comes yet: the gem goes on the hint, it is the whole stat.
    return text && l.kind === 'rarity' ? [{ text, gem: l.locked[0]!.color, alone: !l.rises.length }] : []
}))
const pct = (share: number) => {
    const n = Math.round(share * 100)
    return n < 1 && share > 0 ? '<1%' : `${n}%`
}
</script>

<template>
  <span class="inline-flex max-w-full flex-wrap items-center gap-1">
    <template v-for="(l, i) in chips" :key="i">
      <template v-if="l.kind === 'rarity'">
        <span
          v-for="r in l.rises"
          :key="r.tier.id"
          class="chip"
          :title="`Rarity: more of every richer guest type (${tierList([...l.rises.map(x => x.tier), ...l.locked])}). ${pct(r.rise)} more ${tierPlural(r.tier.id, 2)} come in.`"
        >
          <Gem class="size-3.5 shrink-0" :style="{ color: r.tier.color }" :stroke-width="2.75" />
          <span class="g-num" :style="{ color: r.tier.color }">+{{ pct(r.rise) }}</span>
          <span class="truncate">{{ tierPlural(r.tier.id, 2) }}</span>
        </span>
      </template>
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
    <span v-for="h in hints" :key="h.text" class="hint" title="Rarity: more of every richer guest type, once it can come">
      <Gem v-if="h.alone" class="mr-0.5 inline size-3.5 align-[-2px]" :style="{ color: h.gem }" :stroke-width="2.75" />{{ h.text }}
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
.hint {
  flex-basis: 100%;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--g-muted);
  text-align: inherit;
}
</style>
