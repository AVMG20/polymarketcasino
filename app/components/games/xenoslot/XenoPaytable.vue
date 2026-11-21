<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCoins } from '#shared/money'
import {
    XS_BONUS_SPINS,
    XS_BONUS_TRIGGER,
    XS_BUY_COST,
    XS_CELLS,
    XS_LINES,
    XS_MAX_WIN,
    XS_PAYTABLE,
    XS_WEIGHTS,
    type XsPaySymbol
} from '#shared/slots/xenoslot'
import { XENO_SYMBOLS, xenoArtDataUrl, type XenoArtId } from '~/utils/slots/xenoslot-art'
import { XENO_LINE_COLORS, XENO_PAYLINES } from '~/utils/slots/xenoslot-lines'

/** Xeno Slot's paytable, built from the game constants (shown in the rules dialog). */
const props = defineProps<{ bet: number }>()

const PAY_ORDER: XsPaySymbol[] = ['wild', 'diamond', 'seven', 'bell', 'ace', 'king', 'queen', 'jack', 'ten']

// The paytable is in line bets: bet / lines.
const rows = computed(() => PAY_ORDER.map(sym => ({
    sym,
    name: XENO_SYMBOLS[sym].name,
    pays: XS_PAYTABLE[sym].map(p => Math.floor(p * props.bet / XS_LINES))
})))

// Chance of 3+ portals on 15 independent cells.
const bonusOdds = (() => {
    const total = Object.values(XS_WEIGHTS).reduce((a, b) => a + b, 0)
    const p = XS_WEIGHTS.bonus / total
    const choose = (n: number, k: number) => {
        let r = 1
        for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
        return r
    }
    let below = 0
    for (let k = 0; k < XS_BONUS_TRIGGER; k++) below += choose(XS_CELLS, k) * p ** k * (1 - p) ** (XS_CELLS - k)
    return Math.round(1 / (1 - below))
})()

const art = (id: XenoArtId) => xenoArtDataUrl(id, 128)
const COINS: XenoArtId[] = ['coin-bronze', 'coin-silver', 'coin-gold', 'coin-xenium']
const CORES: XenoArtId[] = ['core-2', 'core-5', 'core-10']
</script>

<template>
  <Tabs default-value="pays" class="gap-3">
    <TabsList class="w-full">
      <TabsTrigger value="pays">Pays</TabsTrigger>
      <TabsTrigger value="bonus">Hold &amp; Win</TabsTrigger>
    </TabsList>

    <TabsContent value="pays" class="space-y-3">
      <div class="divide-y rounded-xl border">
        <div v-for="row in rows" :key="row.sym" class="flex items-center gap-3 p-2">
          <img :src="art(row.sym)" :alt="row.name" class="size-11 shrink-0">
          <div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
            <span v-for="(amount, i) in row.pays" :key="i"><span class="text-muted-foreground">{{ 3 + i }}×</span> {{ formatCoins(amount) }}</span>
          </div>
        </div>
      </div>
      <p class="flex items-center gap-2">
        <img :src="art('wild')" alt="" class="size-9 shrink-0">
        Wild stands in for every symbol but the portal.
      </p>
      <div class="grid grid-cols-5 gap-2">
        <div v-for="(line, i) in XENO_PAYLINES" :key="i" class="flex flex-col items-center gap-1 rounded-lg bg-muted p-1.5 text-xs font-semibold">
          <svg viewBox="0 0 50 30" class="w-full" aria-hidden="true">
            <rect
              v-for="c in 15"
              :key="c"
              :x="((c - 1) % 5) * 10 + 1"
              :y="Math.floor((c - 1) / 5) * 10 + 1"
              width="8"
              height="8"
              rx="1.5"
              :fill="line[(c - 1) % 5] === Math.floor((c - 1) / 5) ? XENO_LINE_COLORS[i] : 'color-mix(in oklch, currentColor 12%, transparent)'"
            />
          </svg>
          <span :style="{ color: XENO_LINE_COLORS[i] }">{{ i + 1 }}</span>
        </div>
      </div>
    </TabsContent>

    <TabsContent value="bonus" class="space-y-3">
      <p class="flex items-center gap-2">
        <img :src="art('bonus')" alt="" class="size-9 shrink-0">
        {{ XS_BONUS_TRIGGER }}+ portals (1 in {{ bonusOdds }}): {{ XS_BONUS_SPINS }} spins, each portal a coin.
      </p>
      <p class="flex items-center gap-2">
        <span class="flex shrink-0 -space-x-3"><img v-for="c in COINS" :key="c" :src="art(c)" alt="" class="size-9"></span>
        Coins stick.
      </p>
      <p class="flex items-center gap-2">
        <span class="flex shrink-0 -space-x-3"><img v-for="c in CORES" :key="c" :src="art(c)" alt="" class="size-9"></span>
        Cores multiply the coins around them.
      </p>
      <p class="flex items-center gap-2">
        <img :src="art('ufo-on')" alt="" class="size-9 shrink-0">
        A UFO collects every coin, then clears the board. Only collected coins pay.
      </p>
      <p class="text-muted-foreground">Buy: {{ XS_BUY_COST }}× bet, 3 coins. Max win {{ formatCoins(XS_MAX_WIN, false) }}× bet.</p>
    </TabsContent>
  </Tabs>
</template>
