<script setup lang="ts">
// Trash Panda Heist rules and paytable, built from the live game constants so
// the numbers can't drift from shared/slots/trashpanda. The measured figures
// come from scripts/trashpanda-rtp.ts.
//
// Nuxt UI's UModal and pill UTabs, rebuilt on reka-ui with their look.
import { CoinsIcon, InfoIcon, ShoppingCartIcon, VaultIcon, XIcon } from 'lucide-vue-next'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, TabsContent, TabsIndicator, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import type { TphPaySymbol } from '#shared/slots/trashpanda'
import {
    DIVE_BINS,
    DIVE_CASH,
    DIVE_DOGS,
    DIVE_KEY_SPINS,
    FS_AWARD,
    FS_MAX_SPINS,
    FS_RETRIGGER_SPINS,
    FS_TRIGGER,
    FS_WILD_MULTS,
    PAYTABLE,
    TPH_BUY_DIVE_COST,
    TPH_BUY_FREE_SPINS_COST,
    TPH_COLS,
    TPH_MAX_WIN_MULT,
    TPH_ROWS,
    TPH_WAYS,
    trashPandaStake
} from '#shared/slots/trashpanda'
import { TPH_SYMBOLS, tphArtDataUrl, type TphArtId } from '~/utils/slots/trashpanda-art'
import { TPH_STATS } from '~/utils/slots/trashpanda-stats'

const props = defineProps<{ bet: number }>()

const open = defineModel<boolean>('open', { default: false })
const tab = ref('pays')
const tabs = [
    { label: 'Symbol pays', value: 'pays', icon: CoinsIcon },
    { label: 'Bonuses', value: 'features', icon: VaultIcon },
    { label: 'Game info', value: 'info', icon: InfoIcon }
]

const PREMIUM: TphPaySymbol[] = ['boss', 'gem', 'bag', 'cash']
const LOW: TphPaySymbol[] = ['donut', 'pizza', 'apple', 'can', 'banana', 'fish']

const row = (sym: TphPaySymbol) => ({
    sym,
    name: TPH_SYMBOLS[sym].name,
    color: TPH_SYMBOLS[sym].color,
    pays: PAYTABLE[sym].map(p => p * props.bet)
})

const premium = computed(() => PREMIUM.map(row))
const lows = computed(() => LOW.map(row))

const art = (id: TphArtId) => tphArtDataUrl(id, 128)

const multOdds = computed(() => {
    const total = FS_WILD_MULTS.reduce((a, m) => a + m.weight, 0)
    return FS_WILD_MULTS.map(m => ({ mult: m.mult, pct: Math.round(m.weight / total * 100) }))
})

const cashRange = computed(() => {
    const values = DIVE_CASH.map(c => c.value)
    return { min: Math.min(...values), max: Math.max(...values) }
})

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogContent class="tph-modal fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden shadow-lg focus:outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-h-[calc(100dvh-4rem)]">
        <DialogTitle class="sr-only">Paytable & rules</DialogTitle>
        <DialogDescription class="sr-only">How Trash Panda Heist pays</DialogDescription>
        <div class="flex-1 overflow-y-auto">
          <div class="tph-pt">
            <div class="tph-pt__head">
              <div>
                <p class="tph-pt__h">Trash Panda Heist</p>
                <p class="tph-pt__title">The heist handbook</p>
              </div>
              <!-- Nuxt UI's ghost neutral icon UButton. -->
              <button type="button" aria-label="Close paytable" class="ml-auto inline-flex items-center rounded-md p-1.5 text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" @click="open = false">
                <XIcon class="size-5 shrink-0" />
              </button>
            </div>

            <TabsRoot v-model="tab" class="flex min-h-0 flex-col items-center gap-0">
              <TabsList class="group relative mx-4 mt-4 flex w-[calc(100%-2rem)] rounded-lg bg-muted p-1">
                <TabsIndicator class="absolute inset-y-1 left-0 w-(--reka-tabs-indicator-size) translate-x-(--reka-tabs-indicator-position) rounded-md bg-primary shadow-xs transition-[translate,width] duration-200" />
                <TabsTrigger
                  v-for="item in tabs"
                  :key="item.value"
                  :value="item.value"
                  class="group relative inline-flex min-w-0 grow items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground hover:data-[state=inactive]:text-foreground"
                >
                  <component :is="item.icon" class="size-5 shrink-0" />
                  <span class="truncate">{{ item.label }}</span>
                </TabsTrigger>
              </TabsList>
              <TabsContent v-for="item in tabs" :key="item.value" :value="item.value" class="tph-pt__scroll w-full focus:outline-none">
                <section v-if="item.value === 'pays'" class="space-y-5">
                  <p class="tph-pt__lead">
                    {{ formatNumber(TPH_WAYS, false) }} ways. A symbol wins when it lands on 3 or more reels in a row, starting from the left, in any row.
                    Two of it on one reel doubles the ways. Amounts are per way at your bet of <strong>{{ formatNumber(bet) }}</strong>.
                  </p>

                  <div class="tph-pt__premium">
                    <div v-for="r in premium" :key="r.sym" class="tph-pt__card">
                      <img :src="art(r.sym)" :alt="r.name" class="tph-pt__art">
                      <div class="min-w-0 flex-1">
                        <p class="tph-pt__name">
                          {{ r.name }}
                        </p>
                        <dl class="tph-pt__pays">
                          <template v-for="(amount, i) in r.pays" :key="i">
                            <dt>{{ 3 + i }} reels</dt>
                            <dd :class="{ 'is-top': i === 2 }">
                              {{ formatNumber(amount) }}
                            </dd>
                          </template>
                        </dl>
                      </div>
                    </div>
                  </div>

                  <div class="tph-pt__lows">
                    <div v-for="r in lows" :key="r.sym" class="tph-pt__low">
                      <img :src="art(r.sym)" :alt="r.name" class="size-16">
                      <p class="tph-pt__low-name">{{ r.name }}</p>
                      <dl class="tph-pt__pays tph-pt__pays--stack">
                        <template v-for="(amount, i) in r.pays" :key="i">
                          <dt>{{ 3 + i }}</dt>
                          <dd :class="{ 'is-top': i === 2 }">
                            {{ formatNumber(amount) }}
                          </dd>
                        </template>
                      </dl>
                    </div>
                  </div>

                  <div class="tph-pt__specials">
                    <div class="tph-pt__special">
                      <img :src="art('wild')" alt="Mask Wild" class="size-14 shrink-0">
                      <p><strong>Mask Wild</strong> lands on reels 2 to 5 and stands in for every paying symbol.</p>
                    </div>
                    <div class="tph-pt__special">
                      <img :src="art('safe')" alt="Safe" class="size-14 shrink-0">
                      <p><strong>Safe</strong>: {{ FS_TRIGGER }} or more anywhere start the Night Heist free spins.</p>
                    </div>
                    <div class="tph-pt__special">
                      <img :src="art('bin')" alt="Dumpster" class="size-14 shrink-0">
                      <p><strong>Dumpster</strong> lands anywhere. Three or more start the Dumpster Dive.</p>
                    </div>
                  </div>
                </section>

                <section v-else-if="item.value === 'features'" class="space-y-5">
                  <div class="tph-pt__step">
                    <img :src="art('wild5')" alt="" class="size-16 shrink-0">
                    <div>
                      <p class="tph-pt__name">
                        Night Heist free spins
                      </p>
                      <p>
                        {{ FS_TRIGGER }}, 4 or 5 Safes award {{ FS_AWARD[3] }}, {{ FS_AWARD[4] }} or {{ FS_AWARD[5] }} free spins (about 1 in {{ TPH_STATS.freeSpinsOdds }} spins).
                        Every Wild that lands carries a multiplier and <strong>sticks</strong> until the feature ends.
                        Each way pays the <strong>sum</strong> of the Wild multipliers on it: a way through a ×2 and a ×3 Wild pays ×5. A way without a Wild pays ×1.
                        {{ FS_TRIGGER }}+ Safes during the feature add {{ FS_RETRIGGER_SPINS }} spins, up to {{ FS_MAX_SPINS }} spins in total.
                      </p>
                      <ul class="tph-pt__tiers">
                        <li v-for="m in multOdds" :key="m.mult">
                          <img :src="art(`wild${m.mult}` as TphArtId)" alt="" class="size-6">×{{ m.mult }} · {{ m.pct }}%
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div class="tph-pt__step">
                    <img :src="art('can-closed')" alt="" class="size-16 shrink-0">
                    <div>
                      <p class="tph-pt__name">
                        Dumpster Dive
                      </p>
                      <p>
                        Three or more Dumpsters anywhere open {{ DIVE_BINS }} trash cans (about 1 in {{ TPH_STATS.diveOdds }} spins). Pick cans until a guard dog catches you or only dogs are left.
                        There are {{ DIVE_DOGS }} dogs. Cans can hold:
                      </p>
                      <ul class="tph-pt__items">
                        <li><img :src="art('coins')" alt="" class="size-7"><span><strong>Cash</strong> {{ cashRange.min }}× to {{ cashRange.max }}× bet</span></li>
                        <li><img :src="art('double')" alt="" class="size-7"><span><strong>Double</strong> doubles the haul so far</span></li>
                        <li><img :src="art('donut')" alt="" class="size-7"><span><strong>Donut</strong> the next dog eats it and you keep digging</span></li>
                        <li><img :src="art('key')" alt="" class="size-7"><span><strong>Golden key</strong> {{ DIVE_KEY_SPINS }} Night Heist free spins after the dive</span></li>
                        <li><img :src="art('dog')" alt="" class="size-7"><span><strong>Guard dog</strong> ends the dive. You keep the haul</span></li>
                      </ul>
                      <p class="mt-2">
                        The can you pick doesn't change the result. What comes out is decided before the reels stop.
                      </p>
                    </div>
                  </div>

                  <div class="tph-pt__step">
                    <ShoppingCartIcon class="size-8 shrink-0 text-primary" />
                    <div>
                      <p class="tph-pt__name">
                        Buy a bonus
                      </p>
                      <p>
                        Night Heist: {{ TPH_BUY_FREE_SPINS_COST }}× bet ({{ formatNumber(bet * TPH_BUY_FREE_SPINS_COST) }}) for {{ FS_AWARD[3] }} free spins, RTP {{ pct(TPH_STATS.buyFreeSpinsRtp) }}.<br>
                        Dumpster Dive: {{ TPH_BUY_DIVE_COST }}× bet ({{ formatNumber(trashPandaStake(bet, { feature: 'buyDive' })) }}), RTP {{ pct(TPH_STATS.buyDiveRtp) }}.
                      </p>
                    </div>
                  </div>
                </section>

                <section v-else class="space-y-4">
                  <dl class="tph-pt__facts">
                    <div><dt>Grid</dt><dd>{{ TPH_COLS }} reels × {{ TPH_ROWS }} rows</dd></div>
                    <div><dt>Ways</dt><dd>{{ formatNumber(TPH_WAYS, false) }}</dd></div>
                    <div><dt>RTP</dt><dd>{{ pct(TPH_STATS.rtp) }}</dd></div>
                    <div><dt>Volatility</dt><dd>High · {{ TPH_STATS.volatility }} / 5</dd></div>
                    <div><dt>Max win</dt><dd>{{ formatNumber(TPH_MAX_WIN_MULT, false) }}× bet</dd></div>
                    <div><dt>Any win</dt><dd>{{ pct(TPH_STATS.hitRate) }} of spins</dd></div>
                  </dl>
                  <div>
                    <p class="tph-pt__h">
                      Where the RTP comes from
                    </p>
                    <dl class="tph-pt__facts">
                      <div><dt>Base game</dt><dd>{{ pct(TPH_STATS.baseRtp) }}</dd></div>
                      <div><dt>Dumpster Dive</dt><dd>{{ pct(TPH_STATS.diveRtp) }}</dd></div>
                      <div><dt>Night Heist</dt><dd>{{ pct(TPH_STATS.freeSpinsRtp) }}</dd></div>
                    </dl>
                  </div>
                  <ul class="tph-pt__list">
                    <li>Base wins, the dive and free spins add up. A round pays at most {{ formatNumber(TPH_MAX_WIN_MULT, false) }}× bet; free spins stop once that is reached.</li>
                    <li>RTP is measured over {{ TPH_STATS.rounds }} simulated spins of the real game code.</li>
                    <li>Every outcome is drawn on the server before the reels start. Turbo, quick stop and skipping never change a result.</li>
                    <li>Wins are paid in whole coins, rounded down.</li>
                    <li>Space spins. Press it again while the reels turn to stop them early. In the Dumpster Dive it picks cans for you.</li>
                  </ul>
                </section>
              </TabsContent>
            </TabsRoot>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
/* Teleported content: keep every selector scoped to this handbook. */
.tph-modal {
  background: var(--ui-bg);
  color: var(--ui-text);
  border: 1px solid var(--ui-border-accented);
  border-radius: 24px;
  font-family: 'Fredoka', system-ui, sans-serif;
}
.tph-pt { display: flex; flex-direction: column; max-height: min(85dvh, 820px); }
.tph-pt__head { display: flex; align-items: center; gap: 12px; padding: 22px 24px 18px; border-bottom: 1px solid var(--ui-border); }
.tph-pt__title { font-size: 25px; font-weight: 600; line-height: 1.15; letter-spacing: -0.025em; color: var(--ui-text-highlighted); }
.tph-pt__h { margin-bottom: 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ui-text-muted); }
.tph-pt__scroll { overflow-y: auto; min-height: 0; padding: 20px 24px 24px; font-size: 14px; line-height: 1.65; scrollbar-width: thin; }
.tph-pt__lead { color: var(--ui-text-muted); }
.tph-pt__scroll strong { color: var(--ui-text-highlighted); font-weight: 600; }
.tph-pt__premium { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.tph-pt__card { display: flex; align-items: center; gap: 14px; padding: 16px 12px; border-radius: 16px; background: var(--ui-bg-elevated); border: 1px solid var(--ui-border); }
.tph-pt__art { width: 88px; height: 88px; flex-shrink: 0; filter: drop-shadow(0 6px 5px color-mix(in srgb, var(--ui-bg-inverted) 12%, transparent)); }
.tph-pt__name { font-weight: 600; color: var(--ui-text-highlighted); margin-bottom: 4px; }
.tph-pt__pays { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; font-variant-numeric: tabular-nums; font-size: 13px; }
.tph-pt__pays dt { color: var(--ui-text-muted); }
.tph-pt__pays dd { color: var(--ui-text-highlighted); text-align: right; font-weight: 600; }
.tph-pt__pays dd.is-top { color: var(--ui-primary); }
.tph-pt__lows { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.tph-pt__low { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px; border-radius: 14px; background: var(--ui-bg-muted); border: 1px solid var(--ui-border); }
.tph-pt__low-name { font-size: 12px; color: var(--ui-text-highlighted); font-weight: 500; text-align: center; }
.tph-pt__pays--stack { width: 100%; margin-top: 4px; font-size: 12px; }
.tph-pt__specials { display: grid; gap: 10px; }
.tph-pt__special, .tph-pt__step { display: flex; align-items: center; gap: 14px; padding: 16px; border-radius: 14px; background: var(--ui-bg-muted); border: 1px solid var(--ui-border); color: var(--ui-text-muted); }
.tph-pt__step { align-items: flex-start; }
.tph-pt__tiers { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 12px; font-size: 13px; }
.tph-pt__tiers li { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-text); }
.tph-pt__items { display: grid; gap: 8px; margin-top: 12px; }
.tph-pt__items li { display: flex; align-items: center; gap: 8px; }
.tph-pt__facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.tph-pt__facts > div { padding: 14px; border-radius: 12px; background: var(--ui-bg-muted); border: 1px solid var(--ui-border); }
.tph-pt__facts dt { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ui-text-muted); }
.tph-pt__facts dd { font-size: 17px; font-weight: 600; color: var(--ui-text-highlighted); }
.tph-pt__list { display: grid; gap: 8px; padding-left: 18px; list-style: disc; color: var(--ui-text-muted); }
@media (max-width: 520px) {
  .tph-pt__head { padding: 18px 16px; }
  .tph-pt__scroll { padding: 16px; }
  .tph-pt__premium { grid-template-columns: 1fr; }
  .tph-pt__facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tph-pt__step { gap: 10px; padding: 12px; }
  .tph-pt__step > img { width: 44px; height: 44px; }
}
</style>
