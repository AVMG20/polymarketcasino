<script setup lang="ts">
import { Gem, TrendingUp } from 'lucide-vue-next'
import { DECOR, isSpecial, placedSpecials } from '#shared/decor'
import { formatCoins } from '#shared/money'
import type { ArrangeItem } from '~/utils/floor/types'
import { specialsSummary, type SpecialLift } from '~/utils/tycoon-art'

/**
 * Arrange mode's specials stats: one line per boost of the specials standing
 * on the floor (rarity per guest tier, spend, coins an hour). With a special
 * in hand that isn't standing yet, a line it would change shows ▲ and its new number.
 */
const props = defineProps<{ carrying: ArrangeItem | null }>()
const emit = defineEmits<{ shop: [] }>()

const tycoon = useTycoon()
const TOTAL = DECOR.filter(def => def.special).length
const placed = computed(() => placedSpecials(tycoon.decor.value))

interface Line { key: string, kind: 'rarity' | 'spend' | 'gain', color: string, value: string, word: string }

const pct = (share: number) => {
    const n = Math.round(share * 100)
    return n < 1 && share > 0 ? '<1%' : `${n}%`
}

function linesOf(types: readonly string[]): Line[] {
    const st = tycoon.state.value
    if (!st || !types.length) return []
    const { lifts, gain } = specialsSummary(st, types, st.serverNow)
    const lines = lifts.map((l: SpecialLift): Line => {
        if (l.kind === 'rarity') return { key: l.tier.id, kind: 'rarity', color: l.tier.color, value: `+${pct(l.rise)}`, word: tierPlural(l.tier.id, 2) }
        if (l.kind === 'rarity-locked') return { key: l.tier.id, kind: 'rarity', color: l.tier.color, value: tierPlural(l.tier.id, 2), word: `open ${l.room}` }
        return { key: 'spend', kind: 'spend', color: '#ffc93a', value: `+${pct(l.share)}`, word: 'spend' }
    })
    if (gain >= 1) lines.push({ key: 'gain', kind: 'gain', color: '#7ee08f', value: `+${formatCoins(gain)}`, word: '/h' })
    return lines
}

/** A special in hand that isn't standing yet (bought now, or from storage). */
const carried = computed(() => {
    const item = props.carrying
    if (!item || item.kind === 'game' || !isSpecial(item.type)) return null
    if (item.kind === 'decor' && tycoon.decor.value.some(d => d.id === item.id && d.x !== null)) return null
    return item.type
})

/** Today's lines, each with the number it would become with the special in hand (when that differs). */
const lines = computed(() => {
    const now = linesOf(placed.value)
    if (!carried.value) return now.map(line => ({ ...line, next: null as string | null, fresh: false }))
    const withIt = linesOf([...placed.value, carried.value])
    const merged = withIt.map((line) => {
        const before = now.find(l => l.key === line.key)
        return before
            ? { ...before, next: before.value !== line.value ? line.value : null, fresh: false }
            : { ...line, next: null, fresh: true }
    })
    return [...merged, ...now.filter(l => !withIt.some(w => w.key === l.key)).map(l => ({ ...l, next: null, fresh: false }))]
})
</script>

<template>
  <div class="panel pointer-events-auto rounded-2xl px-2.5 py-1.5 text-[12.5px] leading-5 font-semibold">
    <p class="text-[10.5px] tracking-wide text-[var(--g-muted)] uppercase">Specials <span class="g-num">{{ placed.length }}/{{ TOTAL }}</span></p>
    <ul v-if="lines.length">
      <li v-for="line in lines" :key="line.key" class="flex items-center gap-1.5 whitespace-nowrap" :class="line.fresh ? 'opacity-80' : ''">
        <Gem v-if="line.kind === 'rarity'" class="size-3.5 shrink-0" :style="{ color: line.color }" :stroke-width="2.75" />
        <TrendingUp v-else-if="line.kind === 'spend'" class="size-3.5 shrink-0" :style="{ color: line.color }" :stroke-width="2.75" />
        <CasinoCoinIcon v-else class="size-3.5 shrink-0" />
        <span :key="line.value" class="g-num g-pop" :style="{ color: line.fresh ? '#7ee08f' : line.color }">{{ line.fresh ? '▲ ' : '' }}{{ line.value }}</span>
        <span :class="line.kind === 'gain' ? '-ml-1 text-[var(--g-muted)]' : ''">{{ line.word }}</span>
        <span v-if="line.next" class="g-num text-[#7ee08f]">▲ {{ line.next }}</span>
      </li>
    </ul>
    <button v-else type="button" class="flex min-h-9 items-center gap-1 text-left text-[var(--g-muted)]" @click="emit('shop')">
      Place specials to boost your casino · <span class="text-[#ff9ac4] underline">Shop</span>
    </button>
  </div>
</template>

<style scoped>
.panel {
  background: rgb(18 12 29 / 0.82);
  border: 2px solid rgb(0 0 0 / 0.5);
  box-shadow: 0 3px 0 rgb(0 0 0 / 0.35);
}
</style>
