<script setup lang="ts">
// Ember Portals paytable for the rules dialog, built from the live game
// constants so the numbers can't drift from shared/slots/emberportals.
import { formatCoins } from '#shared/money'
import {
    clusterPay,
    EP_ANTE_COST,
    EP_BRACKETS,
    EP_BUY_COST,
    EP_MAX_WIN_MULT,
    EP_MIN_CLUSTER,
    EP_PAY_SYMBOLS,
    EP_WILD_MAX_MULT,
    FS_AWARD,
    FS_RETRIGGER_SPINS,
    FS_TRIGGER,
    type EpPaySymbol
} from '#shared/slots/emberportals'
import { EP_SYMBOLS, epArtDataUrl } from '~/utils/slots/emberportals-art'

const props = defineProps<{ bet: number }>()

const bracketLabels = EP_BRACKETS.map((start, i) => {
    const next = EP_BRACKETS[i + 1]
    if (next === undefined) return `${start}+`
    return next - 1 > start ? `${start}-${next - 1}` : `${start}`
})

const rows = computed(() => [...EP_PAY_SYMBOLS].reverse().map((sym: EpPaySymbol) => ({
    sym,
    name: EP_SYMBOLS[sym].name,
    pays: EP_BRACKETS.map(size => Math.floor(clusterPay(sym, size) * props.bet + 1e-9))
})))

const art = (id: Parameters<typeof epArtDataUrl>[0]) => epArtDataUrl(id, 128)
const awards = FS_AWARD.map((spins, i) => `${FS_TRIGGER + i}${i === FS_AWARD.length - 1 ? '+' : ''}: ${spins}`).join(' · ')
</script>

<template>
  <div class="space-y-3">
    <ul class="list-disc space-y-1 pl-5 text-muted-foreground">
      <li>{{ EP_MIN_CLUSTER }}+ touching symbols pay, then burn and tumble.</li>
      <li>A win opens a ×1 portal (wild). A portal in a win grows +1 and jumps; portals in one win merge by multiplying, up to ×{{ EP_WILD_MAX_MULT }}.</li>
      <li>{{ FS_TRIGGER }}+ scatters: free spins ({{ awards }}). Portals stay open all feature; {{ FS_TRIGGER }}+ scatters add {{ FS_RETRIGGER_SPINS }}.</li>
      <li>Extra chance: {{ EP_ANTE_COST }}× bet, more scatters. Buy: {{ EP_BUY_COST }}× bet. Max win {{ formatCoins(EP_MAX_WIN_MULT, false) }}×.</li>
    </ul>
    <div class="grid grid-cols-1 gap-2">
      <div v-for="r in rows" :key="r.sym" class="flex items-center gap-3 rounded-xl border p-2">
        <img :src="art(r.sym)" :alt="r.name" class="size-12 shrink-0">
        <dl class="grid min-w-0 flex-1 grid-cols-3 gap-x-3 font-mono text-[11px] tabular-nums">
          <div v-for="(amount, i) in r.pays" :key="i" class="flex justify-between gap-1 whitespace-nowrap">
            <dt class="text-muted-foreground">{{ bracketLabels[i] }}</dt>
            <dd :class="i === r.pays.length - 1 ? 'font-semibold text-star' : ''">{{ formatCoins(amount) }}</dd>
          </div>
        </dl>
      </div>
    </div>
    <div class="flex items-center gap-4 text-xs text-muted-foreground">
      <span class="flex items-center gap-2"><img :src="art('wild')" alt="" class="size-10">{{ EP_SYMBOLS.wild.name }}</span>
      <span class="flex items-center gap-2"><img :src="art('scatter')" alt="" class="size-10">{{ EP_SYMBOLS.scatter.name }}</span>
    </div>
  </div>
</template>
