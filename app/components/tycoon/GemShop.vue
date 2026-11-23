<script setup lang="ts">
import { Check, ChevronRight, Clock, Crown, Lock } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import type { IlloName } from '~/utils/tycoon-art'
import { BUILDER_GEMS, GOLDEN_GEMS, RUSH_MS, type GemItem } from '#shared/tycoon'

/** The Gems tab: High Rollers (the rush: guest income ×2), the gem builder and golden skins, as glowing tiles. */
const tycoon = useTycoon()
const cosmetics = useCosmetics()
const state = computed(() => tycoon.state.value)
const gems = computed(() => tycoon.gems.value)
const enabled = computed(() => !!state.value?.gemsEnabled)

const goldenOpen = ref(false)
const goldenTarget = ref('')
const builtGames = computed(() => Object.keys(state.value?.games ?? {}).filter(slug => findGame(slug) && !state.value?.golden.includes(slug)))

interface Offer {
    item: GemItem
    name: string
    badge: string
    title: string
    illo: IlloName
    color: string
    price: number
    owned: boolean
}

const offers = computed<Offer[]>(() => {
    const rushOn = tycoon.rushActive.value
    return [
        { item: 'rush', name: 'High Rollers', badge: rushOn ? formatCountdown(tycoon.rushLeftMs.value) : `×2 income · ${formatDuration(RUSH_MS)}`, title: `High rollers visit: every guest spends double, so guest income is ×2 for ${formatDuration(RUSH_MS)}`, illo: 'rush', color: '#ff9a2e', price: tycoon.rushPrice.value, owned: false },
        { item: 'builder', name: 'Builder', badge: '+1', title: 'One more builder for good: one more construction at once (on top of the Construction Crew)', illo: 'builder', color: '#ffc93a', price: BUILDER_GEMS, owned: !!state.value?.gemBuilder },
        { item: 'golden', name: 'Golden', badge: 'skin', title: 'A gold finish for one built game (cosmetic)', illo: 'golden', color: '#eab308', price: GOLDEN_GEMS, owned: builtGames.value.length === 0 }
    ]
})

const short = (price: number) => gems.value === null || gems.value < price
/** Why an offer can't be bought now, or null. */
function blocked(offer: Offer): string | null {
    if (!enabled.value) return 'Gems need a Polynux account'
    if (offer.owned) return offer.item === 'golden' ? 'Build a game first' : 'Owned'
    if (short(offer.price)) return `Need ${formatCoins(offer.price - (gems.value ?? 0))} more gems`
    return null
}

async function buy(offer: Offer) {
    if (blocked(offer)) return
    if (offer.item === 'golden') {
        goldenOpen.value = !goldenOpen.value
        if (!builtGames.value.includes(goldenTarget.value)) goldenTarget.value = builtGames.value[0] ?? ''
        return
    }
    await tycoon.buyGem(offer.item)
}

async function gild() {
    if (!goldenTarget.value) return
    const done = await tycoon.buyGem('golden', goldenTarget.value)
    if (done) goldenOpen.value = false
}
</script>

<template>
  <div class="space-y-3 px-3 pb-4">
    <div class="g-well flex items-center justify-between rounded-2xl px-3 py-2">
      <span v-if="!enabled" class="flex items-center gap-1.5 text-sm font-semibold text-[var(--g-muted)]" title="Gems come from your Polynux account"><Lock class="size-4" :stroke-width="3" /> Polynux account</span>
      <span v-else />
      <span class="g-num flex items-center gap-1.5 text-xl text-[#2fe0d0]"><CasinoGemIcon class="size-6" /> {{ gems === null ? '–' : formatCoins(gems) }}</span>
    </div>

    <div class="grid grid-cols-2 gap-2.5">
      <div v-for="offer in offers" :key="offer.item" class="tile flex flex-col rounded-[20px] p-1.5" :class="enabled && !offer.owned ? 'g-gem-glow' : 'opacity-60'" :title="offer.title">
        <div class="relative aspect-[4/3] overflow-hidden rounded-[14px] border-2 border-black/50">
          <TycoonIllo :name="offer.illo" :color="offer.color" class="absolute inset-0" />
          <span class="g-num absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full border-[1.5px] border-black/50 bg-[#120c1d]/85 px-1.5 text-xs leading-5"><Clock v-if="offer.item === 'rush'" class="size-3" :stroke-width="3" />{{ offer.badge }}</span>
        </div>
        <p class="g-title mt-1 text-center text-base leading-6">{{ offer.name }}</p>
        <button v-if="offer.owned && offer.item === 'builder'" type="button" class="g-btn g-dark h-11 rounded-xl" aria-disabled="true"><Check class="size-5" :stroke-width="3.5" /></button>
        <button
          v-else
          type="button"
          class="g-btn h-11 rounded-xl text-lg"
          :class="blocked(offer) ? 'g-off' : 'g-gem'"
          :aria-disabled="!!blocked(offer)"
          :disabled="tycoon.busy.value"
          :title="blocked(offer) ?? undefined"
          :aria-expanded="offer.item === 'golden' ? goldenOpen : undefined"
          @click="buy(offer)"
        >
          <TycoonCost :amount="offer.price" currency="gems" />
        </button>
      </div>
    </div>

    <!-- Cosmetics: the wardrobe (avatar items, room skins). -->
    <button type="button" class="tile g-gem-glow flex w-full items-center gap-3 rounded-[20px] p-1.5 pr-3 text-left transition-transform active:scale-[0.98]" @click="cosmetics.show()">
      <span class="block size-14 shrink-0 overflow-hidden rounded-[14px] border-2 border-black/50"><TycoonIllo name="wardrobe" color="#a879ff" /></span>
      <span class="g-title min-w-0 flex-1 truncate text-lg">Wardrobe</span>
      <ChevronRight class="size-6 shrink-0 text-[var(--g-muted)]" :stroke-width="3" />
    </button>

    <Transition name="pop">
      <div v-if="goldenOpen" class="g-well space-y-2 rounded-2xl p-2.5">
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="slug in builtGames"
            :key="slug"
            type="button"
            class="relative aspect-square overflow-hidden rounded-xl border-[3px] transition-transform active:scale-95"
            :class="goldenTarget === slug ? 'border-[#ffc93a] shadow-[0_0_12px_rgb(255_201_58/0.7)]' : 'border-black/50'"
            :title="findGame(slug)?.name"
            :aria-pressed="goldenTarget === slug"
            @click="goldenTarget = slug"
          >
            <TycoonItemArt kind="game" :id="slug" />
          </button>
        </div>
        <button type="button" class="g-btn h-12 w-full rounded-xl text-lg" :class="short(GOLDEN_GEMS) ? 'g-off' : 'g-gold'" :disabled="!goldenTarget || short(GOLDEN_GEMS) || tycoon.busy.value" :title="short(GOLDEN_GEMS) ? 'Not enough gems' : undefined" @click="gild">
          <Crown class="size-5" :stroke-width="3" /> <TycoonCost :amount="GOLDEN_GEMS" currency="gems" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tile {
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.pop-enter-active { transition: transform 0.2s cubic-bezier(0.3, 1.4, 0.5, 1), opacity 0.15s ease; }
.pop-enter-from { opacity: 0; transform: scale(0.94); }
</style>
