<script setup lang="ts">
import { CircleHelp, Coins, Eraser, Hand, Minus, RefreshCw, Shuffle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { MH_COLS, MH_MAX_HANDS, MH_MULTIPLIERS, MH_TILE_CAP, MH_TILES, type MagicHandsResult, type MhPass, type MhPassSlot } from '#shared/games/magichands'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'

const info = findGame('magichands')!
const round = useGameRound<MagicHandsResult>('magichands')
const { coins } = useCasinoSession()

const tiles = Array.from({ length: MH_TILES }, (_, i) => i)

// The top bar spins like a reel strip: REEL_LEN symbols, the real one at FINAL_INDEX.
const TOP_CELL = 52
const REEL_LEN = 28
const FINAL_INDEX = 24
const SPIN_MS = 850
const STAGGER = 110

/** Multiplier colour by size: a rarity ladder that stays clear of win green. */
function tier(value: number) {
    if (value >= 500) return 'bg-amber-400/25 border-amber-300 text-amber-500 dark:text-amber-200 shadow-[0_0_22px_-2px_var(--star)]'
    if (value >= 100) return 'bg-amber-500/20 border-amber-400 text-amber-600 dark:text-amber-300 shadow-[0_0_14px_-3px_var(--star)]'
    if (value >= 50) return 'bg-fuchsia-500/15 border-fuchsia-400 text-fuchsia-600 dark:text-fuchsia-300'
    if (value >= 25) return 'bg-violet-500/15 border-violet-400 text-violet-600 dark:text-violet-300'
    if (value >= 10) return 'bg-sky-500/15 border-sky-400 text-sky-600 dark:text-sky-300'
    return 'bg-slate-500/15 border-slate-400 text-slate-600 dark:text-slate-300'
}
const tierText = (value: number) => tier(value).split(' ').filter(c => c.startsWith('text-') || c.startsWith('dark:text-')).join(' ')

const handValue = ref(Math.max(info.minBet, 100))
const placements = ref<number[]>([])
const placed = computed(() => new Set(placements.value))
const stake = computed(() => placements.value.length * handValue.value)

type ReelSym = { kind: 'pending' | 'nothing' | 'reroll' | 'mult', value?: number }
type Reel = { items: ReelSym[], offset: number, moving: boolean }
const idleReels = (): Reel[] => Array.from({ length: MH_COLS }, () => ({ items: [{ kind: 'pending' }], offset: 0, moving: false }))

const phase = ref<'idle' | 'topbar' | 'winners' | 'done'>('idle')
const rerolling = ref(false)
const reels = ref<Reel[]>(idleReels())
const locked = ref<(MhPassSlot | null)[]>(Array(MH_COLS).fill(null))
const applyCol = ref(-1)
const tileMult = ref<Record<number, number>>({})
const stamped = ref<number | null>(null)
const revealed = ref(new Set<number>())
const result = ref<MagicHandsResult | null>(null)
const payout = ref(0)
const bigWin = ref<{ coins: number, multiple: number } | null>(null)
const history = ref<{ id: string, label: string, won: boolean }[]>([])

const busy = computed(() => round.busy.value)
const canEdit = computed(() => !busy.value)
const canPlay = computed(() => !busy.value && placements.value.length > 0 && stake.value <= info.maxBet && coins.value >= stake.value)

let timers: ReturnType<typeof setTimeout>[] = []
const reduced = import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches
function sleep(ms: number) {
    return new Promise<void>(resolve => timers.push(setTimeout(resolve, reduced ? 0 : ms)))
}

// Cosmetic shuffles (idle reels, auto placement): Math.random is fine here.
function shuffle<T>(items: T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[out[i], out[j]] = [out[j]!, out[i]!]
    }
    return out
}
function randomSym(): ReelSym {
    const roll = Math.random()
    if (roll < 0.3) return { kind: 'nothing' }
    if (roll < 0.4) return { kind: 'reroll' }
    return { kind: 'mult', value: MH_MULTIPLIERS[Math.floor(Math.random() * MH_MULTIPLIERS.length)] }
}
function symFor(slot: MhPassSlot): ReelSym {
    if (slot.type === 'multiplier') return { kind: 'mult', value: slot.value ?? 0 }
    return { kind: slot.type }
}

function tileClass(i: number) {
    const value = tileMult.value[i]
    const win = revealed.value.has(i)
    if (win && placed.value.has(i)) {
        return value !== undefined
            ? `${tier(value)} !border-success ring-2 ring-success scale-105 z-10`
            : 'bg-success/25 border-success text-success ring-2 ring-success scale-105 z-10'
    }
    if (win) return value !== undefined ? `${tier(value)} !border-success/50` : 'bg-success/10 border-success/50 text-success/70'
    if (value !== undefined) return tier(value)
    return 'bg-muted/60 border-border text-muted-foreground'
}
function handClass(i: number) {
    if (revealed.value.has(i)) return 'text-success'
    if (phase.value === 'done') return 'text-destructive'
    return 'text-primary'
}
function topClass(col: number) {
    if (applyCol.value === col) return 'border-primary ring-2 ring-primary/50'
    const slot = locked.value[col]
    if (slot?.type === 'multiplier') return tier(slot.value ?? 0)
    if (slot?.type === 'reroll') return 'bg-sky-500/15 border-sky-400 text-sky-500'
    return 'border-border bg-muted/40'
}

function resetBoard() {
    timers.forEach(clearTimeout)
    timers = []
    reels.value = idleReels()
    locked.value = Array(MH_COLS).fill(null)
    applyCol.value = -1
    tileMult.value = {}
    stamped.value = null
    revealed.value = new Set()
    result.value = null
    rerolling.value = false
    phase.value = 'idle'
}

function toggle(i: number) {
    if (!canEdit.value) return
    if (phase.value === 'done') resetBoard()
    const at = placements.value.indexOf(i)
    if (at >= 0) placements.value.splice(at, 1)
    else if (placements.value.length < MH_MAX_HANDS) placements.value.push(i)
}
function autoPlace() {
    if (!canEdit.value) return
    if (phase.value === 'done') resetBoard()
    placements.value = shuffle(tiles).slice(0, 10)
}
function clear() {
    if (!canEdit.value) return
    if (phase.value === 'done') resetBoard()
    placements.value = []
}

async function spinBar(pass: MhPass) {
    locked.value = Array(MH_COLS).fill(null)
    reels.value = pass.slots.map(slot => ({
        items: Array.from({ length: REEL_LEN }, (_, i) => (i === FINAL_INDEX ? symFor(slot) : randomSym())),
        offset: 0,
        moving: false
    }))
    await nextTick()
    await sleep(40)
    for (const reel of reels.value) {
        reel.moving = true
        reel.offset = -FINAL_INDEX * TOP_CELL
    }
    await sleep(SPIN_MS + STAGGER * (MH_COLS - 1) + 200)
    locked.value = [...pass.slots]
}

async function applyPass(pass: MhPass, cap: number) {
    for (let col = 0; col < MH_COLS; col++) {
        applyCol.value = col
        const slot = pass.slots[col]!
        await sleep(140)
        if (slot.type === 'multiplier') {
            for (const tile of slot.tiles) {
                tileMult.value = { ...tileMult.value, [tile]: Math.min((tileMult.value[tile] ?? 1) * (slot.value ?? 1), cap) }
                stamped.value = tile
                await sleep(220)
            }
        } else if (slot.type === 'reroll') {
            await sleep(160)
        }
        await sleep(80)
    }
    applyCol.value = -1
    stamped.value = null
}

async function play() {
    if (!canPlay.value) return
    resetBoard()
    const hand = handValue.value
    const response = await round.play({ bet: hand, options: { placements: [...placements.value] } })
    if (!response) return
    const res = response.result
    result.value = res

    phase.value = 'topbar'
    await sleep(200)
    for (let p = 0; p < res.passes.length; p++) {
        const pass = res.passes[p]!
        await spinBar(pass)
        await sleep(220)
        await applyPass(pass, MH_TILE_CAP)
        if (pass.reroll && p < res.passes.length - 1) {
            rerolling.value = true
            await sleep(900)
            rerolling.value = false
        }
    }

    // Winners: the empty ones first, the player's hits last.
    phase.value = 'winners'
    await sleep(400)
    const mine = new Set(res.placements)
    for (const tile of shuffle(res.winners.filter(t => !mine.has(t)))) {
        revealed.value = new Set([...revealed.value, tile])
        await sleep(150)
    }
    await sleep(220)
    for (const tile of res.winners.filter(t => mine.has(t))) {
        revealed.value = new Set([...revealed.value, tile])
        await sleep(360)
    }
    await sleep(350)

    phase.value = 'done'
    payout.value = response.payout
    const multiple = response.payout / response.stake
    history.value = [{ id: response.roundId, label: `${multiple >= 10 ? multiple.toFixed(0) : multiple.toFixed(2)}×`, won: response.payout > response.stake }, ...history.value].slice(0, 20)
    if (multiple >= 10) {
        bigWin.value = { coins: response.payout, multiple }
        await new Promise<void>((resolve) => {
            const stop = watch(bigWin, (value) => {
                if (!value) {
                    stop()
                    resolve()
                }
            })
            timers.push(setTimeout(() => (bigWin.value = null), 3200))
        })
    }
    round.settle()
}

function onKey(event: KeyboardEvent) {
    if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault()
        void play()
    }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    timers.forEach(clearTimeout)
})
</script>

<template>
  <GameFrame slug="magichands">
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div class="order-2 space-y-4 rounded-2xl border bg-card p-4 lg:order-1">
        <GameBetInput v-model="handValue" label="Per hand" :min="info.minBet" :max="info.maxBet" :disabled="busy" />
        <div class="grid grid-cols-2 gap-2">
          <Button variant="outline" class="h-11" :disabled="!canEdit" @click="autoPlace">
            <Shuffle class="size-4" /> Auto 10
          </Button>
          <Button variant="outline" class="h-11" :disabled="!canEdit || !placements.length" @click="clear">
            <Eraser class="size-4" /> Clear
          </Button>
        </div>
        <div class="grid grid-cols-2 gap-2 text-center">
          <div class="rounded-xl bg-muted p-2">
            <p class="text-xs text-muted-foreground">Hands</p>
            <p class="font-mono font-semibold">{{ placements.length }}/{{ MH_MAX_HANDS }}</p>
          </div>
          <div class="rounded-xl bg-muted p-2">
            <p class="text-xs text-muted-foreground">Stake</p>
            <p class="font-mono font-semibold" :class="stake > info.maxBet ? 'text-destructive' : ''">{{ formatCoins(stake) }}</p>
          </div>
        </div>
        <div class="grid grid-cols-5 gap-1.5">
          <span v-for="m in MH_MULTIPLIERS" :key="m" class="rounded-md border py-1 text-center font-mono text-xs font-bold" :class="tier(m)">{{ m }}×</span>
        </div>
        <Button
          size="lg"
          class="h-12 w-full font-display text-base shadow-[0_3px_0_0_color-mix(in_oklch,var(--primary)_60%,black)] active:translate-y-[2px] active:shadow-none"
          :disabled="!canPlay"
          @click="play"
        >
          Play
        </Button>
      </div>

      <div class="order-1 space-y-3 rounded-2xl border bg-card p-3 sm:p-6 lg:order-2">
        <GameRoundHistory :items="history" />
        <div class="relative mx-auto w-full max-w-md">
          <!-- Top bar -->
          <div class="relative mb-3 grid grid-cols-5 gap-1.5 sm:gap-2">
            <div
              v-for="(reel, col) in reels"
              :key="col"
              class="relative overflow-hidden rounded-lg border font-mono font-black transition-all duration-200"
              :style="{ height: `${TOP_CELL}px` }"
              :class="topClass(col)"
            >
              <div
                class="flex flex-col"
                :style="{
                  transform: `translateY(${reel.offset}px)`,
                  transition: reel.moving && !reduced ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.12, 1) ${col * STAGGER}ms` : 'none'
                }"
              >
                <div
                  v-for="(sym, i) in reel.items"
                  :key="i"
                  class="flex shrink-0 items-center justify-center"
                  :style="{ height: `${TOP_CELL}px` }"
                  :class="sym.kind === 'mult' ? tierText(sym.value ?? 0) : ''"
                >
                  <CircleHelp v-if="sym.kind === 'pending'" class="size-5 text-muted-foreground/40" />
                  <RefreshCw v-else-if="sym.kind === 'reroll'" class="size-5 text-sky-500" />
                  <Minus v-else-if="sym.kind === 'nothing'" class="size-5 text-muted-foreground" />
                  <span v-else class="text-sm sm:text-base">{{ sym.value }}×</span>
                </div>
              </div>
            </div>
            <Transition enter-active-class="transition duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]" enter-from-class="opacity-0 scale-50" leave-active-class="transition duration-150" leave-to-class="opacity-0">
              <div v-if="rerolling" class="pointer-events-none absolute inset-0 grid place-items-center">
                <span class="flex items-center gap-1.5 rounded-full bg-sky-500 px-4 py-1.5 text-sm font-black tracking-wider text-white uppercase shadow-lg">
                  <RefreshCw class="size-4 animate-spin" /> Reroll
                </span>
              </div>
            </Transition>
          </div>

          <!-- Grid -->
          <div class="grid grid-cols-5 gap-1.5 sm:gap-2">
            <button
              v-for="i in tiles"
              :key="i"
              type="button"
              :disabled="!canEdit"
              class="relative flex aspect-square items-center justify-center rounded-lg border transition-all duration-200 select-none"
              :class="[tileClass(i), canEdit ? 'cursor-pointer hover:border-primary/60' : 'cursor-default', stamped === i ? 'animate-pulse' : '']"
              @click="toggle(i)"
            >
              <span v-if="tileMult[i] !== undefined" :key="`m-${i}-${tileMult[i]}`" class="mh-pop font-mono text-xs leading-none font-black tabular-nums sm:text-base">{{ tileMult[i] }}×</span>
              <Coins v-else-if="revealed.has(i)" class="mh-pop size-5 sm:size-6" />
              <Hand v-if="placed.has(i)" class="absolute top-0.5 right-0.5 size-4 transition-colors duration-200 sm:size-5" :class="handClass(i)" />
            </button>
          </div>

          <Transition enter-active-class="transition duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]" enter-from-class="opacity-0 scale-75" leave-active-class="transition duration-150" leave-to-class="opacity-0">
            <button v-if="bigWin" type="button" class="absolute inset-0 z-30 grid place-items-center rounded-xl bg-black/65 text-white" @click="bigWin = null">
              <span class="space-y-1 text-center">
                <span class="block font-display text-lg font-bold tracking-wide text-star uppercase">{{ bigWin.multiple >= 100 ? 'Mega win' : 'Big win' }}</span>
                <span class="block font-display text-4xl font-extrabold tabular-nums sm:text-6xl">{{ formatCoins(bigWin.coins, false) }}</span>
                <span class="block text-sm opacity-80">{{ bigWin.multiple.toFixed(1) }}× stake</span>
              </span>
            </button>
          </Transition>
        </div>

        <div class="mx-auto grid max-w-md grid-cols-[minmax(0,1fr)_auto] items-center gap-3 lg:grid-cols-1">
          <div class="flex h-11 items-center font-mono text-sm lg:justify-center">
            <span v-if="phase === 'done' && result" class="text-lg font-bold tabular-nums" :class="payout > 0 ? 'text-success' : 'text-muted-foreground'">
              {{ payout > 0 ? `+${formatCoins(payout)}` : '0' }}
            </span>
          </div>
          <!-- On phones the controls sit below the board: a Play button within thumb reach. -->
          <Button
            size="lg"
            class="h-11 min-w-28 font-display shadow-[0_3px_0_0_color-mix(in_oklch,var(--primary)_60%,black)] active:translate-y-[2px] active:shadow-none lg:hidden"
            :disabled="!canPlay"
            @click="play"
          >
            Play {{ formatCoins(stake) }}
          </Button>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Put hands on tiles; each hand costs your hand value. Then the top bar spins: each of its five slots lands on nothing, a multiplier or a reroll.</p>
      <p>A multiplier stamps itself onto 1 to 4 tiles of its column. A reroll spins the whole bar again; multipliers on the same tile multiply, up to {{ MH_TILE_CAP.toLocaleString('en-US') }}× per tile.</p>
      <p>Then 2 to 8 tiles win. A hand on a winning tile pays hand value × that tile's multiplier (1× without one). The odds per hand are the same however many hands you place.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.mh-pop { animation: mh-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes mh-pop {
  0% { opacity: 0; transform: scale(0.3); }
  100% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .mh-pop { animation: none; }
}
</style>
