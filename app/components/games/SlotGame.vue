<script setup lang="ts">
import { Play, Square, Volume2, VolumeX, Zap } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import { SLOT_CONFIGS, triggerCount, type Cell, type Grid, type SlotOutcome, type SlotSpin } from '#shared/slots'
import { reelWeights } from '#shared/slots/grid'
import { SLOT_THEMES } from '~/utils/slot-themes'

/**
 * Every slot, driven by its engine config and skinned by its theme. The
 * server resolves the whole round (base spin, tumbles, free spins); this
 * component only replays it, then settles the balance.
 */
const props = defineProps<{ slug: string }>()
const config = SLOT_CONFIGS[props.slug]!
const theme = SLOT_THEMES[props.slug]!
const info = findGame(props.slug)!
const round = useGameRound<SlotOutcome>(props.slug)
const sound = useSlotSound(theme.sounds)
const { coins } = useCasinoSession()

const bet = ref(info.minBet)
const turbo = ref(false)
const autoLeft = ref(0)
const buyOpen = ref(false)

// What is on screen.
const grid = ref<Grid>(randomGrid())
const spinning = ref<boolean[]>(Array(config.cols).fill(false))
const lit = ref(new Set<string>())
const popping = ref(new Set<string>())
const sticky = ref(new Set<string>())
const lines = ref<number[]>([])
const dropKey = ref(0)
const runningWin = ref(0)
const banner = ref('')
const feature = ref<{ index: number, total: number, multiplier: number } | null>(null)
const bigWin = ref<{ coins: number, multiple: number } | null>(null)

const key = (col: number, row: number) => `${col}:${row}`
const cellsKeys = (cells: readonly Cell[]) => cells.map(([c, r]) => key(c, r))
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, turbo.value ? ms * 0.4 : ms))
const reduced = import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Cosmetic only (idle grid, blur while spinning): Math.random is fine here.
function randomSymbol(col: number) {
    const table = Object.entries(reelWeights(config.weights, col))
    const total = table.reduce((sum, [, w]) => sum + w, 0)
    let roll = Math.random() * total
    for (const [id, w] of table) {
        roll -= w
        if (roll < 0) return id
    }
    return table[0]![0]
}
function randomGrid(): Grid {
    return Array.from({ length: config.cols }, (_, col) => Array.from({ length: config.rows }, () => randomSymbol(col)))
}

const canAfford = computed(() => coins.value >= bet.value)
const buyCost = computed(() => (config.buyCost ? bet.value * config.buyCost : 0))

async function spinTo(target: Grid, held: Set<string>) {
    if (reduced) {
        grid.value = target
        return
    }
    spinning.value = Array(config.cols).fill(true)
    sound.play('spin', 0.4)
    const blur = setInterval(() => {
        grid.value = grid.value.map((reel, col) => (spinning.value[col]
            ? reel.map((s, row) => (held.has(key(col, row)) ? s : randomSymbol(col)))
            : reel))
    }, 70)
    await wait(380)
    for (let col = 0; col < config.cols; col++) {
        grid.value = grid.value.map((reel, c) => (c === col ? target[col]!.slice() : reel))
        spinning.value = spinning.value.map((s, c) => (c === col ? false : s))
        sound.play('stop', 0.35)
        if (config.scatter && target[col]!.includes(config.scatter.symbol)) sound.play('scatter', 0.5)
        await wait(config.cols > 5 ? 90 : 170)
    }
    clearInterval(blur)
    grid.value = target
}

async function showSpin(spin: SlotSpin) {
    for (let i = 0; i < spin.steps.length; i++) {
        const step = spin.steps[i]!
        if (step.wins.length) {
            lit.value = new Set(step.wins.flatMap(win => cellsKeys(win.cells)))
            lines.value = step.wins.flatMap(win => (win.line === undefined ? [] : [win.line]))
            // The server caps the round at maxWin; never count past it.
            runningWin.value = Math.min(config.maxWin, runningWin.value + step.win)
            if (feature.value && config.tumble) feature.value.multiplier = step.multiplier
            sound.play('win', 0.5)
            await wait(config.tumble ? 650 : 1000)
        }
        const next = spin.steps[i + 1]
        if (next) {
            popping.value = new Set(lit.value)
            await wait(260)
            popping.value = new Set()
            lit.value = new Set()
            grid.value = next.grid
            dropKey.value++
            await wait(320)
        }
    }
    if (spin.scatterWin > 0 && config.scatter) {
        lit.value = new Set(grid.value.flatMap((reel, col) => reel.flatMap((s, row) => (s === config.scatter!.symbol ? [key(col, row)] : []))))
        runningWin.value = Math.min(config.maxWin, runningWin.value + spin.scatterWin)
        await wait(800)
    }
    lit.value = new Set()
    lines.value = []
}

async function present(outcome: SlotOutcome) {
    runningWin.value = 0
    sticky.value = new Set()
    await spinTo(outcome.base.steps[0]!.grid, sticky.value)
    await showSpin(outcome.base)

    if (outcome.freeSpins.length) {
        sound.play('feature', 0.7)
        banner.value = `${outcome.base.awarded} free spins`
        await wait(1400)
        banner.value = ''
        let total = outcome.base.awarded
        for (let i = 0; i < outcome.freeSpins.length; i++) {
            const spin = outcome.freeSpins[i]!
            feature.value = { index: i + 1, total, multiplier: feature.value?.multiplier ?? 1 }
            await spinTo(spin.steps[0]!.grid, sticky.value)
            if (config.freeSpins?.wildMultiplierStep) feature.value.multiplier = spin.steps[0]!.multiplier
            await showSpin(spin)
            if (spin.sticky) sticky.value = new Set(cellsKeys(spin.sticky))
            if (spin.awarded) {
                total += spin.awarded
                feature.value.total = total
                banner.value = `+${spin.awarded} spins`
                await wait(1000)
                banner.value = ''
            }
        }
        await wait(500)
        feature.value = null
        sticky.value = new Set()
    }
}

async function spin(buy = false) {
    buyOpen.value = false
    if (buy) sound.play('buy')
    const response = await round.play({ bet: bet.value, options: buy ? { buy: true } : {} })
    if (!response) {
        autoLeft.value = 0
        return
    }
    await present(response.result)
    if (response.result.win >= 20) {
        sound.play('bigWin', 0.7)
        bigWin.value = { coins: response.payout, multiple: response.result.win }
        await new Promise<void>((resolve) => {
            const stop = watch(bigWin, (value) => {
                if (!value) {
                    stop()
                    resolve()
                }
            })
            setTimeout(() => (bigWin.value = null), turbo.value ? 1500 : 3200)
        })
    }
    runningWin.value = response.result.win
    round.settle()
    if (response.result.freeSpins.length) autoLeft.value = 0
}

async function autoplay(count: number) {
    autoLeft.value = count
    while (autoLeft.value > 0 && canAfford.value) {
        await spin()
        if (autoLeft.value > 0) autoLeft.value--
        await wait(250)
    }
    autoLeft.value = 0
}

function onKey(event: KeyboardEvent) {
    if (event.code === 'Space' && event.target === document.body && !round.busy.value) {
        event.preventDefault()
        void spin()
    }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    autoLeft.value = 0
})

// Paytable rows: symbol, then what each count pays at the current bet.
const paytable = computed(() => Object.entries(config.symbols)
    .filter(([, def]) => def.pays)
    .map(([id, def]) => ({
        id,
        skin: theme.symbols[id],
        pays: Object.entries(def.pays!).map(([count, pay]) => ({ count, coins: Math.floor(bet.value * pay * config.payScale) }))
    }))
    .reverse())

const payModel = computed(() => {
    switch (config.pay.type) {
        case 'lines': return `${config.pay.lines.length} paylines, left to right from the first reel.`
        case 'ways': return `${config.rows ** config.cols} ways: matching symbols on adjacent reels from the left, anywhere on each reel.`
        case 'cluster': return `Clusters of ${config.pay.minSize} or more touching symbols (up, down, left, right) pay; winners pop and new symbols fall in.`
    }
    return ''
})

const linePaths = computed(() => (config.pay.type === 'lines'
    ? lines.value.map(index => (config.pay as { lines: readonly (readonly number[])[] }).lines[index]!
        .map((row, col) => `${col + 0.5},${row + 0.5}`).join(' '))
    : []))
</script>

<template>
  <GameFrame :slug="slug">
    <template #actions>
      <Button v-if="sound.enabled" size="icon" variant="ghost" :title="sound.muted.value ? 'Sound on' : 'Sound off'" @click="sound.toggle()">
        <VolumeX v-if="sound.muted.value" class="size-5" />
        <Volume2 v-else class="size-5" />
      </Button>
    </template>

    <div class="overflow-hidden rounded-2xl" :style="{ background: theme.backdrop }">
      <div class="mx-auto w-full p-2 sm:p-5" :class="config.cols > 5 ? 'max-w-[34rem]' : 'max-w-[44rem]'">
        <!-- Feature bar -->
        <div class="mb-2 flex h-9 items-center justify-between gap-2 rounded-xl bg-black/35 px-3 text-sm font-semibold text-white" :style="{ fontFamily: theme.font }">
          <template v-if="feature">
            <span>{{ theme.featureName }} · {{ feature.index }}/{{ feature.total }}</span>
            <span v-if="config.freeSpins?.wildMultiplierStep || config.tumble" class="rounded-full px-2 py-0.5 text-xs" :style="{ background: theme.accent }">×{{ feature.multiplier }}</span>
          </template>
          <template v-else>
            <span class="opacity-80">{{ info.name }}</span>
            <span class="font-mono tabular-nums">{{ runningWin > 0 ? `Win ${formatCoins(Math.floor(bet * runningWin))}` : '' }}</span>
          </template>
        </div>

        <!-- Reels -->
        <div class="relative rounded-2xl p-1.5 sm:p-2" :style="{ background: theme.frame }">
          <div class="grid" :style="{ gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))` }">
            <div v-for="(reel, col) in grid" :key="col" class="flex flex-col">
              <div
                v-for="(symbol, row) in reel"
                :key="`${dropKey}-${row}`"
                class="aspect-square p-[3%] transition-[transform,opacity,filter] duration-200"
                :class="[
                  spinning[col] ? 'blur-[1.5px]' : '',
                  popping.has(key(col, row)) ? 'scale-0 opacity-0' : '',
                  lit.size && !lit.has(key(col, row)) && !spinning[col] ? 'opacity-45' : '',
                  lit.has(key(col, row)) ? 'z-10 scale-105' : '',
                  dropKey && !spinning[col] ? 'animate-in slide-in-from-top-4 fade-in duration-300' : ''
                ]"
              >
                <div class="relative size-full" :class="sticky.has(key(col, row)) ? 'rounded-[18%] ring-3 ring-offset-0' : ''" :style="sticky.has(key(col, row)) ? { '--tw-ring-color': theme.accent } : undefined">
                  <GameSlotSymbol :skin="theme.symbols[symbol]" />
                  <div v-if="lit.has(key(col, row))" class="pointer-events-none absolute inset-0 animate-pulse rounded-[18%] ring-4" :style="{ '--tw-ring-color': theme.accent }" />
                </div>
              </div>
            </div>
          </div>
          <svg v-if="linePaths.length" class="pointer-events-none absolute inset-1.5 sm:inset-2" :viewBox="`0 0 ${config.cols} ${config.rows}`" preserveAspectRatio="none">
            <polyline v-for="(points, i) in linePaths" :key="i" :points="points" fill="none" :stroke="theme.accent" stroke-width="0.07" stroke-linejoin="round" stroke-linecap="round" opacity=".85" />
          </svg>

          <!-- Banners -->
          <Transition enter-active-class="transition duration-200" enter-from-class="opacity-0 scale-90" leave-active-class="transition duration-150" leave-to-class="opacity-0">
            <div v-if="banner" class="absolute inset-0 z-20 grid place-items-center">
              <p class="rounded-2xl bg-black/70 px-6 py-3 text-2xl font-extrabold text-white sm:text-4xl" :style="{ fontFamily: theme.font }">{{ banner }}</p>
            </div>
          </Transition>
          <Transition enter-active-class="transition duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]" enter-from-class="opacity-0 scale-75" leave-active-class="transition duration-150" leave-to-class="opacity-0">
            <button v-if="bigWin" type="button" class="absolute inset-0 z-30 grid place-items-center bg-black/60 text-white" @click="bigWin = null">
              <span class="space-y-1 text-center" :style="{ fontFamily: theme.font }">
                <span class="block text-lg font-bold tracking-wide uppercase" :style="{ color: theme.accent }">{{ bigWin.multiple >= 100 ? 'Mega win' : 'Big win' }}</span>
                <span class="block text-4xl font-extrabold tabular-nums sm:text-6xl">{{ formatCoins(bigWin.coins, false) }}</span>
                <span class="block text-sm opacity-80">{{ bigWin.multiple.toFixed(1) }}× bet</span>
              </span>
            </button>
          </Transition>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="grid grid-cols-1 gap-3 rounded-2xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-4">
      <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="round.busy.value || autoLeft > 0" />
      <div class="grid grid-cols-[auto_auto_1fr] gap-2 sm:flex">
        <Button size="icon-lg" :variant="turbo ? 'default' : 'outline'" class="size-12" title="Turbo" @click="turbo = !turbo">
          <Zap class="size-5" />
        </Button>
        <Button v-if="autoLeft > 0" size="icon-lg" variant="outline" class="size-12" title="Stop autoplay" @click="autoLeft = 0">
          <Square class="size-5" />
        </Button>
        <Button v-else size="lg" variant="outline" class="h-12 font-mono" :disabled="round.busy.value || !canAfford" title="Autoplay 10 spins" @click="autoplay(10)">
          Auto 10
        </Button>
        <Button
          size="lg"
          class="h-12 min-w-32 font-display text-base shadow-[0_3px_0_0_color-mix(in_oklch,var(--primary)_60%,black)] active:translate-y-[2px] active:shadow-none"
          :disabled="round.busy.value || autoLeft > 0"
          @click="spin()"
        >
          <Play class="size-4" />
          {{ autoLeft > 0 ? `${autoLeft} left` : 'Spin' }}
        </Button>
      </div>
      <Button v-if="config.buyCost" variant="secondary" class="h-11 sm:col-span-2" :disabled="round.busy.value || autoLeft > 0" @click="buyOpen = true">
        Buy {{ theme.featureName }} · {{ formatCoins(buyCost) }}
      </Button>
    </div>

    <Dialog v-model:open="buyOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle class="font-display">Buy {{ theme.featureName }}</DialogTitle>
          <DialogDescription>
            {{ config.buyCost }}× your bet starts the free spins straight away ({{ triggerCount(config) }} scatters land for sure).
          </DialogDescription>
        </DialogHeader>
        <Button class="h-12 w-full font-display" :disabled="coins < buyCost" @click="spin(true)">
          Buy for {{ formatCoins(buyCost, false) }}
        </Button>
      </DialogContent>
    </Dialog>

    <template #rules>
      <p>{{ payModel }}</p>
      <p v-if="config.freeSpins">
        {{ triggerCount(config) }}+ {{ theme.symbols[config.scatter?.symbol ?? '']?.label }} start {{ theme.featureName }}
        ({{ Object.entries(config.freeSpins.awards).map(([n, s]) => `${n}: ${s} spins`).join(', ') }}).
        <template v-if="config.freeSpins.wildMultiplierStep">Every wild that lands adds ×{{ config.freeSpins.wildMultiplierStep }} to a multiplier that holds for the whole feature (up to ×{{ config.freeSpins.multiplierCap }}).</template>
        <template v-if="config.freeSpins.stickyWilds">Wilds that land stay put until the feature ends.</template>
        <template v-if="config.tumble?.multiplierStep">Each pop in a row raises the multiplier by {{ config.tumble.multiplierStep }}; in free spins it never resets.</template>
      </p>
      <p>Max win {{ formatCoins(config.maxWin, false) }}× bet. Paytable at your current bet:</p>
      <div class="divide-y rounded-xl border">
        <div v-for="row in paytable" :key="row.id" class="flex items-center gap-3 p-2">
          <div class="size-10 shrink-0"><GameSlotSymbol :skin="row.skin" /></div>
          <div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
            <span v-for="pay in row.pays" :key="pay.count"><span class="text-muted-foreground">{{ pay.count }}{{ config.pay.type === 'cluster' ? '+' : '×' }}</span> {{ formatCoins(pay.coins) }}</span>
          </div>
        </div>
      </div>
      <p v-if="config.pay.type === 'ways'" class="text-xs text-muted-foreground">Ways pays are per way; several symbols on one reel multiply the ways.</p>
    </template>
  </GameFrame>
</template>
