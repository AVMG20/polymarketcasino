<script setup lang="ts">
import { Gem, TrendingUp } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import { GEM_COLOR as GEM, lockedTiersHint, tierList, type SpecialLift } from '~/utils/tycoon-art'

/**
 * A special's effect as compact stat chips, the same everywhere: rarity (a gem,
 * "+12% richer guests", with a muted line under it saying what that does per
 * richer tier now, "Regulars +10%", and which tiers come later), spend (a
 * rising arrow, "+3% spend"), and the coins an hour it adds when that is at
 * least 1.
 */
const props = defineProps<{
    lifts: (SpecialLift | null | undefined)[]
    /** Coins an hour it adds (or would, placed); shown from 1 up. */
    gain?: number | null
    /** In storage: the gain only counts once it is placed. */
    stored?: boolean
}>()

const chips = computed(() => props.lifts.filter((l): l is SpecialLift => !!l))
/** Per rarity lift, one muted line under the chips: what it does for each richer tier now, and the tiers still locked. */
const details = computed(() => chips.value.flatMap(l => (l.kind === 'rarity' ? [{ rises: l.rises, later: lockedTiersHint(l) }] : [])))
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
          class="chip"
          :title="`Richer guests: more of every guest type above Tourists (${tierList([...l.rises.map(x => x.tier), ...l.locked])})`"
        >
          <Gem class="size-3.5 shrink-0" :style="{ color: GEM }" :stroke-width="2.75" />
          <span class="g-num" :style="{ color: GEM }">+{{ pct(l.bonus) }}</span>
          <span class="truncate">richer guests</span>
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
    <span v-for="(d, i) in details" :key="`d${i}`" class="hint" title="What that does for each richer guest type">
      <template v-for="(r, j) in d.rises" :key="r.tier.id"><template v-if="j"> · </template>{{ tierPlural(r.tier.id, 2) }} <span class="g-num" :style="{ color: r.tier.color }">+{{ pct(r.rise) }}</span></template><template v-if="d.rises.length && d.later"> now · </template>{{ d.later ? (d.rises.length ? d.later.replace(/^more /, '') : d.later) : '' }}
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
