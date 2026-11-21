<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { Eraser, Play, RotateCcw, Undo2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import { betKey, betReturn, coveredPockets, pocketColor, type RouletteBet, type RouletteBetKind, type RouletteResult } from '#shared/games/roulette'

const info = findGame('roulette')!
const round = useGameRound<RouletteResult>('roulette')
const { coins } = useCasinoSession()
const wheel = ref<{ spinTo: (pocket: number) => Promise<void> } | null>(null)
// Phones get the board stood upright: 5 columns instead of 14.
const upright = useMediaQuery('(max-width: 767px)')

const CHIPS = [10, 50, 100, 500, 1_000, 5_000, 25_000]
const chip = ref(100)
const bets = ref<Record<string, RouletteBet>>({})
const placed = ref<string[]>([])
const lastLayout = ref<RouletteBet[]>([])
const result = ref<RouletteResult | null>(null)
const payout = ref(0)
const history = ref<{ id: string, label: string, won: boolean, color: string }[]>([])

const stake = computed(() => Object.values(bets.value).reduce((sum, bet) => sum + bet.amount, 0))
const winningKeys = computed(() => new Set(result.value?.bets.filter(bet => bet.won).map(bet => betKey(bet)) ?? []))

interface Spot {
    kind: RouletteBetKind
    value?: number
    label: string
    /** [col, row, colSpan, rowSpan] on the 14×5 landscape board. */
    at: [number, number, number, number]
    tone: 'red' | 'black' | 'green' | 'plain'
}

const spots: Spot[] = [
    { kind: 'straight', value: 0, label: '0', at: [1, 1, 1, 3], tone: 'green' },
    ...Array.from({ length: 36 }, (_, i): Spot => {
        const n = i + 1
        return { kind: 'straight', value: n, label: String(n), at: [Math.ceil(n / 3) + 1, 3 - ((n - 1) % 3), 1, 1], tone: pocketColor(n) as 'red' | 'black' }
    }),
    ...[3, 2, 1].map((column, i): Spot => ({ kind: 'column', value: column, label: '2:1', at: [14, i + 1, 1, 1], tone: 'plain' })),
    ...[1, 2, 3].map((dozen): Spot => ({ kind: 'dozen', value: dozen, label: `${dozen === 1 ? '1st' : dozen === 2 ? '2nd' : '3rd'} 12`, at: [2 + (dozen - 1) * 4, 4, 4, 1], tone: 'plain' })),
    { kind: 'low', label: '1-18', at: [2, 5, 2, 1], tone: 'plain' },
    { kind: 'even', label: 'Even', at: [4, 5, 2, 1], tone: 'plain' },
    { kind: 'red', label: 'Red', at: [6, 5, 2, 1], tone: 'red' },
    { kind: 'black', label: 'Black', at: [8, 5, 2, 1], tone: 'black' },
    { kind: 'odd', label: 'Odd', at: [10, 5, 2, 1], tone: 'plain' },
    { kind: 'high', label: '19-36', at: [12, 5, 2, 1], tone: 'plain' }
]

function spotStyle(spot: Spot) {
    const [col, row, colSpan, rowSpan] = spot.at
    // Upright: swap axes (zero on top), and mirror the number rows so 1, 2, 3 read left to right.
    const across = row <= 3 && rowSpan === 1 ? 4 - row : row
    return upright.value
        ? { gridColumn: `${across} / span ${rowSpan}`, gridRow: `${col} / span ${colSpan}` }
        : { gridColumn: `${col} / span ${colSpan}`, gridRow: `${row} / span ${rowSpan}` }
}

const toneClass: Record<Spot['tone'], string> = {
    red: 'bg-[#c53030] text-white',
    black: 'bg-[#1f2430] text-white',
    green: 'bg-[#1f9d55] text-white',
    plain: 'bg-emerald-900/70 text-emerald-50'
}

function place(spot: Spot) {
    if (round.busy.value) return
    if (stake.value + chip.value > Math.min(info.maxBet, coins.value)) return
    const key = betKey(spot)
    const existing = bets.value[key]
    bets.value = { ...bets.value, [key]: { kind: spot.kind, ...(spot.value === undefined ? {} : { value: spot.value }), amount: (existing?.amount ?? 0) + chip.value } }
    placed.value.push(`${key}|${chip.value}`)
    result.value = null
}

function undo() {
    const last = placed.value.pop()
    if (!last) return
    const [key, amount] = last.split('|') as [string, string]
    const bet = bets.value[key]
    if (!bet) return
    const next = { ...bets.value }
    if (bet.amount - Number(amount) <= 0) delete next[key]
    else next[key] = { ...bet, amount: bet.amount - Number(amount) }
    bets.value = next
}

function clear() {
    bets.value = {}
    placed.value = []
}

function rebet() {
    const total = lastLayout.value.reduce((sum, bet) => sum + bet.amount, 0)
    if (!total || total > coins.value) return
    bets.value = Object.fromEntries(lastLayout.value.map(bet => [betKey(bet), { ...bet }]))
    placed.value = lastLayout.value.map(bet => `${betKey(bet)}|${bet.amount}`)
}

async function spin() {
    const layout = Object.values(bets.value)
    if (!layout.length) return
    const response = await round.play({ options: { bets: layout } })
    if (!response) return
    lastLayout.value = layout.map(bet => ({ ...bet }))
    result.value = null
    await wheel.value?.spinTo(response.result.pocket)
    result.value = response.result
    payout.value = response.payout
    history.value = [{ id: response.roundId, label: String(response.result.pocket), won: response.payout > 0, color: response.result.color }, ...history.value].slice(0, 16)
    round.settle()
    clear()
}

const chipLabel = (amount: number) => formatCoins(amount)
</script>

<template>
  <GameFrame slug="roulette">
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div class="space-y-3 rounded-2xl border bg-card p-3 sm:p-4">
        <div class="mx-auto w-full max-w-64">
          <GameRouletteWheel ref="wheel" />
        </div>
        <div class="flex min-h-8 flex-wrap justify-center gap-1">
          <span
            v-for="item in history"
            :key="item.id"
            class="grid size-7 place-items-center rounded-full font-mono text-xs font-bold text-white"
            :class="item.color === 'red' ? 'bg-[#c53030]' : item.color === 'black' ? 'bg-[#1f2430]' : 'bg-[#1f9d55]'"
          >{{ item.label }}</span>
        </div>
        <p class="h-6 text-center font-display text-lg font-bold" :class="payout > 0 ? 'text-success' : 'text-muted-foreground'">
          <template v-if="result">{{ result.pocket }} {{ result.color }} · {{ payout > 0 ? `won ${formatCoins(payout)}` : 'no win' }}</template>
        </p>
      </div>

      <div class="min-w-0 space-y-3">
        <div
          class="grid gap-1 rounded-2xl bg-emerald-800 p-2 select-none"
          :style="upright
            ? { gridTemplateColumns: 'repeat(3, minmax(0, 1fr)) 1.2fr 1.2fr', gridTemplateRows: 'repeat(14, minmax(2.5rem, auto))' }
            : { gridTemplateColumns: 'repeat(14, minmax(0, 1fr))', gridTemplateRows: 'repeat(5, minmax(2.75rem, auto))' }"
        >
          <button
            v-for="spot in spots"
            :key="betKey(spot)"
            type="button"
            class="relative grid place-items-center rounded-md text-sm font-bold transition-transform active:scale-95"
            :class="[toneClass[spot.tone], winningKeys.has(betKey(spot)) ? 'ring-4 ring-star' : '', result && spot.kind === 'straight' && spot.value === result.pocket ? 'ring-4 ring-white' : '']"
            :style="spotStyle(spot)"
            :title="`${spot.label}: pays ${betReturn(spot)}× (${coveredPockets(spot).length} pockets)`"
            @click="place(spot)"
          >
            <span :class="upright && spot.at[3] === 1 && spot.at[2] > 1 ? '[writing-mode:vertical-rl]' : ''">{{ spot.label }}</span>
            <span
              v-if="bets[betKey(spot)]"
              class="absolute -top-1.5 -right-1.5 z-10 grid min-w-6 place-items-center rounded-full border-2 border-white bg-primary px-1 font-mono text-[10px] text-primary-foreground shadow"
            >{{ chipLabel(bets[betKey(spot)]!.amount) }}</span>
          </button>
        </div>

        <div class="space-y-3 rounded-2xl border bg-card p-3 sm:p-4">
          <div class="flex gap-2 overflow-x-auto pb-1">
            <button
              v-for="value in CHIPS"
              :key="value"
              type="button"
              class="grid size-12 shrink-0 place-items-center rounded-full border-4 border-dashed font-mono text-xs font-bold transition-transform"
              :class="chip === value ? 'scale-110 border-primary bg-primary text-primary-foreground' : 'border-border bg-muted'"
              @click="chip = value"
            >{{ chipLabel(value) }}</button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="mr-auto text-sm">Stake <span class="font-mono font-semibold">{{ formatCoins(stake, false) }}</span></span>
            <Button size="icon-lg" variant="outline" class="size-11" title="Undo" :disabled="!placed.length || round.busy.value" @click="undo"><Undo2 class="size-5" /></Button>
            <Button size="icon-lg" variant="outline" class="size-11" title="Clear" :disabled="!placed.length || round.busy.value" @click="clear"><Eraser class="size-5" /></Button>
            <Button size="icon-lg" variant="outline" class="size-11" title="Rebet" :disabled="!lastLayout.length || round.busy.value" @click="rebet"><RotateCcw class="size-5" /></Button>
            <Button size="lg" class="h-11 min-w-28 basis-full font-display sm:basis-auto shadow-[0_3px_0_0_color-mix(in_oklch,var(--primary)_60%,black)] active:translate-y-[2px] active:shadow-none" :disabled="!stake || round.busy.value" @click="spin">
              <Play class="size-4" /> Spin
            </Button>
          </div>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Single-zero European roulette. Pick a chip, tap the layout to place it, then spin. One spin settles every bet.</p>
      <p>A bet returns 36 ÷ the pockets it covers: a number 36×, a dozen or column 3×, red, black, odd, even, 1-18 and 19-36 2×. Zero loses every outside bet.</p>
    </template>
  </GameFrame>
</template>
