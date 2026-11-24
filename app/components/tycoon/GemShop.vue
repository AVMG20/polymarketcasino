<script setup lang="ts">
import { ArrowRight, Check, Clock, Crown, Lock } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import type { IlloName } from '~/utils/tycoon-art'
import { BUILDER_GEMS, GOLDEN_GEMS, RUSH_MS, type GemItem } from '#shared/tycoon'

/**
 * The Gems tab: convert a gem into coins (one per tap), then Big Spenders
 * (the rush: guest income ×2), the gem builder and the gold finish, as glowing tiles.
 */
const tycoon = useTycoon()
const session = useCasinoSession()
const sound = useTycoonSound()
const { wallet, convert } = useWallet()
const state = computed(() => tycoon.state.value)
const gems = computed(() => tycoon.gems.value)
const enabled = computed(() => !!state.value?.gemsEnabled)

// ── Convert: one gem per tap ────────────────────────────────────────────
const coinsPerGem = computed(() => wallet.value?.coinsPerGem ?? 1_000)
const converting = ref(false)
/** The coin pill holds the old balance while a convert is out, then counts up with a "+1.000" (like a collect). */
const coinsHeld = useState<number | null>('tycoon:coins-held', () => null)
const convertBlocked = computed(() => {
    if (!enabled.value || (wallet.value && !wallet.value.hubAccount)) return 'Gems need a Polynux account'
    if (gems.value === null) return 'Gems unavailable right now'
    if (gems.value < 1) return 'No gems left'
    return null
})

async function convertOne() {
    if (convertBlocked.value || converting.value) return
    converting.value = true
    const hold = coinsHeld.value === null
    if (hold) coinsHeld.value = session.coins.value
    try {
        await convert(1)
        sound.play('kaching')
    } catch (error) {
        toast.error(apiErrorMessage(error, 'Conversion failed'))
    } finally {
        if (hold) coinsHeld.value = null
        converting.value = false
    }
}

// ── Gold finish: pick a game, then pay ──────────────────────────────────
const goldenOpen = ref(false)
const goldenTarget = ref('')
const goldenPanel = ref<HTMLElement | null>(null)
const builtGames = computed(() => Object.keys(state.value?.games ?? {}).filter(slug => findGame(slug) && !state.value?.golden.includes(slug)))
const goldenName = computed(() => findGame(goldenTarget.value)?.name ?? '')

interface Offer {
    item: GemItem
    name: string
    badge: string
    /** What it does, in one short line under the name. */
    blurb: string
    title: string
    illo: IlloName
    color: string
    price: number
    owned: boolean
}

const offers = computed<Offer[]>(() => {
    const rushOn = tycoon.rushActive.value
    return [
        { item: 'rush', name: 'Big Spenders', badge: rushOn ? formatCountdown(tycoon.rushLeftMs.value) : `×2 income · ${formatDuration(RUSH_MS)}`, blurb: 'Every guest spends double', title: `Big spenders night: every guest spends double, so guest income is ×2 for ${formatDuration(RUSH_MS)}`, illo: 'rush', color: '#ff9a2e', price: tycoon.rushPrice.value, owned: false },
        { item: 'builder', name: 'Builder', badge: '+1', blurb: 'One more build at once, for good', title: 'One more builder for good: one more construction at once (on top of the Construction Crew)', illo: 'builder', color: '#ffc93a', price: BUILDER_GEMS, owned: !!state.value?.gemBuilder },
        { item: 'golden', name: 'Gold machine', badge: 'looks only', blurb: 'Turn one game gold. Looks only', title: 'A gold finish for one of your built games. It only changes the look: the game earns and plays the same', illo: 'golden', color: '#eab308', price: GOLDEN_GEMS, owned: builtGames.value.length === 0 }
    ]
})

const short = (price: number) => gems.value === null || gems.value < price
/** Why an offer can't be bought now, or null. */
function blocked(offer: Offer): string | null {
    if (!enabled.value) return 'Gems need a Polynux account'
    if (offer.owned) return offer.item === 'golden' ? (state.value?.golden.length ? 'Every game is gold already' : 'Build a game first') : 'Owned'
    if (short(offer.price)) return `Need ${formatCoins(offer.price - (gems.value ?? 0))} more gems`
    return null
}

async function buy(offer: Offer) {
    if (blocked(offer)) return
    if (offer.item === 'golden') {
        goldenOpen.value = !goldenOpen.value
        if (!builtGames.value.includes(goldenTarget.value)) goldenTarget.value = builtGames.value[0] ?? ''
        // The picker opens under the tiles: bring it into view.
        if (goldenOpen.value) {
            await nextTick()
            goldenPanel.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
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

    <!-- Convert: one gem into coins per tap. -->
    <div class="tile flex items-center gap-3 rounded-[20px] p-1.5" :class="convertBlocked ? 'opacity-60' : 'g-gem-glow'">
      <span class="convert-art relative grid size-14 shrink-0 place-items-center rounded-[14px] border-2 border-black/50" aria-hidden="true">
        <CasinoGemIcon class="size-8 -translate-x-1.5 -translate-y-1 text-[#2fe0d0] drop-shadow-[0_2px_0_rgb(0_0_0/0.4)]" />
        <CasinoCoinIcon class="absolute right-1 bottom-1 size-6 drop-shadow-[0_2px_0_rgb(0_0_0/0.4)]" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="g-title text-lg leading-6">Convert</p>
        <p class="flex flex-wrap items-center gap-x-1 text-sm leading-5 font-semibold">
          <TycoonCost :amount="1" currency="gems" /> <ArrowRight class="size-3.5 text-[var(--g-muted)]" :stroke-width="3" /> <TycoonCost :amount="coinsPerGem" currency="coins" />
        </p>
        <p v-if="convertBlocked" class="truncate text-xs leading-4 text-[var(--g-muted)]">{{ convertBlocked }}</p>
      </div>
      <button
        type="button"
        class="g-btn h-11 shrink-0 rounded-xl px-4 text-lg"
        :class="convertBlocked ? 'g-off' : 'g-gem'"
        :aria-disabled="!!convertBlocked"
        :disabled="converting"
        :title="convertBlocked ?? `Convert 1 gem into ${formatCoins(coinsPerGem)} coins. Coins never turn back into gems`"
        :aria-label="`Convert 1 gem into ${formatCoins(coinsPerGem)} coins`"
        @click="convertOne"
      >
        <TycoonCost :amount="1" currency="gems" />
      </button>
    </div>

    <div class="grid grid-cols-2 gap-2.5">
      <div v-for="offer in offers" :key="offer.item" class="tile flex flex-col rounded-[20px] p-1.5" :class="enabled && !offer.owned ? 'g-gem-glow' : 'opacity-60'" :title="offer.title">
        <div class="relative aspect-[4/3] overflow-hidden rounded-[14px] border-2 border-black/50">
          <TycoonIllo :name="offer.illo" :color="offer.color" class="absolute inset-0" />
          <span class="g-num absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full border-[1.5px] border-black/50 bg-[#120c1d]/85 px-1.5 text-xs leading-5"><Clock v-if="offer.item === 'rush'" class="size-3" :stroke-width="3" />{{ offer.badge }}</span>
        </div>
        <p class="g-title mt-1 truncate text-center text-base leading-6">{{ offer.name }}</p>
        <p class="mb-1.5 line-clamp-2 min-h-8 px-0.5 text-center text-[12px] leading-4 text-[var(--g-muted)]">{{ offer.blurb }}</p>
        <button v-if="offer.owned && offer.item === 'builder'" type="button" class="g-btn g-dark mt-auto h-11 rounded-xl" aria-disabled="true"><Check class="size-5" :stroke-width="3.5" /></button>
        <button
          v-else
          type="button"
          class="g-btn mt-auto h-11 rounded-xl text-lg"
          :class="blocked(offer) ? 'g-off' : 'g-gem'"
          :aria-disabled="!!blocked(offer)"
          :disabled="tycoon.busy.value"
          :title="blocked(offer) ?? undefined"
          :aria-expanded="offer.item === 'golden' ? goldenOpen : undefined"
          :aria-label="offer.item === 'golden' ? `Gold machine, ${GOLDEN_GEMS} gems: pick a game` : undefined"
          @click="buy(offer)"
        >
          <TycoonCost :amount="offer.price" currency="gems" />
        </button>
      </div>
    </div>

    <!-- Gold machine: pick the game first, then pay. -->
    <Transition name="pop">
      <div v-if="goldenOpen" ref="goldenPanel" class="g-well space-y-2 rounded-2xl p-2.5">
        <p class="g-title flex items-center gap-1.5 text-base leading-5"><Crown class="size-4 text-[#ffc93a]" :stroke-width="3" /> Pick a game to turn gold</p>
        <p class="text-xs leading-4 text-[var(--g-muted)]">Only the look changes: the game plays and earns the same. It stays gold for good.</p>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="slug in builtGames"
            :key="slug"
            type="button"
            class="relative aspect-square overflow-hidden rounded-xl border-[3px] transition-transform active:scale-95"
            :class="goldenTarget === slug ? 'border-[#ffc93a] shadow-[0_0_12px_rgb(255_201_58/0.7)]' : 'border-black/50'"
            :title="findGame(slug)?.name"
            :aria-label="findGame(slug)?.name"
            :aria-pressed="goldenTarget === slug"
            @click="goldenTarget = slug"
          >
            <TycoonItemArt kind="game" :id="slug" />
            <span v-if="goldenTarget === slug" class="absolute top-1 right-1 grid size-5 place-items-center rounded-full border-2 border-white bg-[#eab308]"><Check class="size-3 text-white" :stroke-width="4" /></span>
          </button>
        </div>
        <button type="button" class="g-btn h-12 w-full rounded-xl text-lg" :class="short(GOLDEN_GEMS) ? 'g-off' : 'g-gold'" :disabled="!goldenTarget || short(GOLDEN_GEMS) || tycoon.busy.value" :title="short(GOLDEN_GEMS) ? 'Not enough gems' : undefined" @click="gild">
          <span class="min-w-0 truncate">Make {{ goldenName || 'it' }} gold</span> <TycoonCost :amount="GOLDEN_GEMS" currency="gems" />
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
.convert-art { background: radial-gradient(circle at 35% 35%, #2a6b77, #17213a 75%); }
.pop-enter-active { transition: transform 0.2s cubic-bezier(0.3, 1.4, 0.5, 1), opacity 0.15s ease; }
.pop-enter-from { opacity: 0; transform: scale(0.94); }
</style>
