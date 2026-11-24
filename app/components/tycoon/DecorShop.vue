<script setup lang="ts">
import { Check, Gem, Lock, Package, Sofa, Sparkles, TrendingUp } from 'lucide-vue-next'
import { DECOR, type DecorDef } from '#shared/decor'
import { formatCoins } from '#shared/money'
import { specialGain, specialLift, specialsGain, specialsLift, type SpecialLift } from '~/utils/tycoon-art'

/**
 * The decor shop: Specials (one each, they lift the whole casino while they
 * stand on the floor) and Decorations (just for looks, as many as you like).
 * Buying one closes the shop and puts it in your hands on the floor: drop it
 * where it goes to buy it.
 */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const tycoon = useTycoon()
const arrange = useArrange()
const level = computed(() => tycoon.level.value.level)

const specials = computed(() => DECOR.filter(def => def.special))
const plain = computed(() => DECOR.filter(def => !def.special))
/** Coins an hour each special adds on the floor, against the casino as it is (read at the state's clock). */
const gains = computed<Record<string, number>>(() => {
    const st = tycoon.state.value
    if (!st) return {}
    return Object.fromEntries(specials.value.map(def => [def.type, specialGain(st, def.type, st.serverNow)]))
})
/** Each special's stat (rarity or spend), against the casino as it is. */
const lifts = computed<Record<string, SpecialLift | null>>(() => {
    const st = tycoon.state.value
    if (!st) return {}
    return Object.fromEntries(specials.value.map(def => [def.type, specialLift(st, def.type, st.serverNow)]))
})
/** What the specials on the floor do together. */
const placed = computed(() => {
    const st = tycoon.state.value
    if (!st) return null
    const lift = specialsLift(st, st.serverNow)
    return lift.rarity || lift.spend ? { lifts: [lift.rarity, lift.spend], gain: specialsGain(st, st.serverNow) } : null
})

interface Card {
    def: DecorDef
    locked: boolean
    /** Owned copies (a special: 0 or 1). */
    owned: number
    /** A special's copy, when owned: where it is. */
    state: 'placed' | 'stored' | null
    storedId: number | null
    affordable: boolean
}

function card(def: DecorDef): Card {
    const mine = tycoon.decor.value.filter(d => d.type === def.type)
    const stored = mine.find(d => d.x === null)
    return {
        def,
        locked: def.level > level.value,
        owned: mine.length,
        state: def.special && mine.length ? (stored ? 'stored' : 'placed') : null,
        storedId: stored?.id ?? null,
        affordable: tycoon.chips.value >= def.chips
    }
}

const shake = ref<string | null>(null)
function tap(c: Card) {
    if (c.locked) return
    if (c.state === 'stored' && c.storedId !== null) return arrange.carry({ kind: 'decor', id: c.storedId, type: c.def.type })
    if (c.state === 'placed') return
    if (!c.affordable) {
        shake.value = null
        void nextTick(() => (shake.value = c.def.type))
        return
    }
    arrange.buy(c.def.type)
}
</script>

<template>
  <TycoonDrawer :open="open" title="Decor" :icon="Sofa" color="#ff7ab0" height="72dvh" @close="emit('close')">
    <div class="space-y-4 px-3 pb-5">
      <section class="space-y-2">
        <div class="px-1">
          <h3 class="flex items-center gap-1.5"><Sparkles class="size-4 text-[#ffc93a]" :stroke-width="3" /><span class="g-title text-lg">Specials</span></h3>
          <p class="text-[12.5px] leading-4 text-[var(--g-muted)]">Specials: one of each. Some bring richer guests, some make every guest spend more.</p>
          <p class="mt-1 flex items-center gap-3 text-[11.5px] font-semibold text-[var(--g-muted)]">
            <span class="flex items-center gap-1" title="Richer guests: more of the rich guest tiers come in"><Gem class="size-3.5 text-[#c084fc]" :stroke-width="2.75" />Rarity</span>
            <span class="flex items-center gap-1" title="Every guest spends more"><TrendingUp class="size-3.5 text-[#ffc93a]" :stroke-width="2.75" />Spend</span>
          </p>
          <p v-if="placed" class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] font-semibold" title="What the specials on your floor do together">
            Now: <TycoonSpecialStat :lifts="placed.lifts" :gain="placed.gain" />
          </p>
        </div>
        <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <li v-for="c in specials.map(card)" :key="c.def.type" class="tile flex min-w-0 flex-col rounded-[20px] p-1.5" :class="c.state === 'placed' ? 'tile-owned' : ''">
            <span class="relative block aspect-[4/3] overflow-hidden rounded-[14px] border-2 border-black/50">
              <TycoonDecorArt :type="c.def.type" :dim="c.locked" />
              <span v-if="c.locked" class="absolute inset-0 grid place-items-center"><span class="grid size-9 place-items-center rounded-full border-2 border-black/50 bg-[#1b1329]/90"><Lock class="size-4 text-[#ffc93a]" :stroke-width="3" /></span></span>
              <span v-if="c.state === 'placed'" class="absolute top-1 right-1 grid size-6 place-items-center rounded-full border-2 border-black/50 bg-[#3fd25a]"><Check class="size-3.5 text-white" :stroke-width="4" /></span>
            </span>
            <p class="mt-1 truncate px-0.5 text-center text-[13px] font-semibold" :title="c.def.blurb">{{ c.def.name }}</p>
            <TycoonSpecialStat class="mt-0.5 justify-center" :class="c.locked ? 'opacity-60' : ''" :lifts="[lifts[c.def.type]]" :gain="gains[c.def.type]" :stored="c.state === 'stored'" />
            <span v-if="c.locked" class="state-pill mt-1 text-[#ffc93a]" :title="`Reach casino level ${c.def.level}`"><Lock class="size-3.5" :stroke-width="3" /><span class="g-num">Level {{ c.def.level }}</span></span>
            <span v-else-if="c.state === 'placed'" class="state-pill mt-1 text-[#7ee08f]" title="It stands on your floor: its bonus counts"><Check class="size-3.5" :stroke-width="3" />On the floor</span>
            <button v-else-if="c.state === 'stored'" type="button" class="g-btn g-blue mt-1 h-11 w-full rounded-xl px-1 text-[14px]" title="In storage: its bonus only counts on the floor" @click="tap(c)">
              <Package class="size-4" :stroke-width="2.75" /> Place it
            </button>
            <button
              v-else
              :key="shake === c.def.type ? 'shake' : 'still'"
              type="button"
              class="g-btn mt-1 h-11 w-full rounded-xl px-1 text-[15px]"
              :class="[c.affordable ? 'g-green' : 'g-off', shake === c.def.type ? 'shake' : '']"
              :aria-disabled="!c.affordable"
              :title="c.affordable ? `Buy the ${c.def.name}, then put it on your floor` : `Need ${formatCoins(c.def.chips - tycoon.chips.value)} more chips`"
              @click="tap(c)"
            >
              <TycoonCost :amount="c.def.chips" compact />
            </button>
          </li>
        </ul>
      </section>

      <section class="space-y-2">
        <div class="px-1">
          <h3 class="flex items-center gap-1.5"><Sofa class="size-4 text-[#ff7ab0]" :stroke-width="3" /><span class="g-title text-lg">Decorations</span></h3>
          <p class="text-[12.5px] leading-4 text-[var(--g-muted)]">Just for looks. Place as many as you like.</p>
        </div>
        <ul class="grid grid-cols-3 gap-2 sm:grid-cols-4">
          <li v-for="c in plain.map(card)" :key="c.def.type" class="tile flex min-w-0 flex-col rounded-[20px] p-1.5">
            <span class="relative block aspect-square overflow-hidden rounded-[14px] border-2 border-black/50">
              <TycoonDecorArt :type="c.def.type" :dim="c.locked" />
              <span v-if="c.locked" class="absolute inset-0 grid place-items-center"><span class="grid size-9 place-items-center rounded-full border-2 border-black/50 bg-[#1b1329]/90"><Lock class="size-4 text-[#ffc93a]" :stroke-width="3" /></span></span>
              <span v-if="c.owned" class="g-num absolute top-1 right-1 rounded-full border-2 border-black/50 bg-[#1b1329]/90 px-1.5 text-[11px] leading-4" :title="`You own ${c.owned}`">×{{ c.owned }}</span>
            </span>
            <p class="mt-1 truncate px-0.5 text-center text-[12.5px] font-semibold" :title="c.def.blurb">{{ c.def.name }}</p>
            <span v-if="c.locked" class="state-pill mt-1 text-[#ffc93a]" :title="`Reach casino level ${c.def.level}`"><Lock class="size-3.5" :stroke-width="3" /><span class="g-num">Level {{ c.def.level }}</span></span>
            <button
              v-else
              :key="shake === c.def.type ? 'shake' : 'still'"
              type="button"
              class="g-btn mt-1 h-11 w-full rounded-xl px-1 text-[15px]"
              :class="[c.affordable ? 'g-green' : 'g-off', shake === c.def.type ? 'shake' : '']"
              :aria-disabled="!c.affordable"
              :title="c.affordable ? `Buy a ${c.def.name}, then put it on your floor` : `Need ${formatCoins(c.def.chips - tycoon.chips.value)} more chips`"
              @click="tap(c)"
            >
              <TycoonCost :amount="c.def.chips" compact />
            </button>
          </li>
        </ul>
      </section>
    </div>
  </TycoonDrawer>
</template>

<style scoped>
.tile {
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.tile-owned { border-color: #1b8a33; }
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
  font-size: 0.8rem;
  font-weight: 600;
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
