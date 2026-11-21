<script setup lang="ts">
// The old site's Magic Hands page (pages/games/magichands.vue) with the
// casino's plumbing: one round through useGameRound (the bet is the hand value,
// the server stakes a hand per placed tile) and settle() once the reveal is
// done. Nuxt UI's UCard, UButton, UInput, UAlert and USeparator are rebuilt as
// plain elements with the same sizes and colours.
import { CircleHelpIcon, CircleSlashIcon, CoinsIcon, EraserIcon, HandIcon, LoaderCircleIcon, MinusIcon, PartyPopperIcon, RefreshCwIcon, ShuffleIcon, TrendingDownIcon, TrendingUpIcon, XIcon } from 'lucide-vue-next'
import type { MagicHandsResult as MagicHandsOutcome, MhPassSlot as PassSlot } from '#shared/games/magichands'
import { MH_MAX_HANDS as MAGIC_HANDS_MAX_HANDS, MH_MULTIPLIERS as MAGIC_HANDS_MULTIPLIERS, MH_TILE_CAP } from '#shared/games/magichands'
import { findGame } from '#shared/games/registry'

const info = findGame('magichands')!
useHead({ title: info.name })
onMounted(() => useHubBridge().postTitle(info.name))
const RTP = Math.round(info.rtp * 1000) / 10

const round = useGameRound<MagicHandsOutcome>('magichands')
const { coins: balance } = useCasinoSession()

/** The old site's top-bar pass. */
interface TopBarPass {
    index: number
    slots: PassSlot[]
    hasReroll: boolean
}

/**
 * The old site's round result. The casino's server sends the round in
 * multiples of the hand value and the coins in the response, so the old fields
 * are rebuilt from them once per round.
 */
interface MagicHandsResult {
    handCount: number
    handValue: number
    totalStake: number
    placements: number[]
    passes: TopBarPass[]
    multiplierTiles: Record<number, number>
    winnerTiles: number[]
    wins: { tile: number, multiplier: number, amount: number }[]
    payout: number
    won: boolean
    tileCap: number
}

const COLS = 5
const ROWS = 8
const TILES = COLS * ROWS
const MAX_HANDS = MAGIC_HANDS_MAX_HANDS
const tiles = Array.from({ length: TILES }, (_, i) => i)

// Reel geometry for the slot-machine top bar.
const TOP_CELL = 56
const REEL_LEN = 28
const FINAL_INDEX = 24
const SPIN_MS = 850
const STAGGER = 110

// Multiplier colour by magnitude — a game-style rarity ladder that deliberately
// avoids green (win) and red (loss). Covers stacked values too.
//   2,5 → common (slate) · 10,15 → uncommon (blue) · 25 → rare (purple)
//   50 → epic (pink) · 100+ → legendary (gold) · 500+ → mythic (bright gold glow)
function tierColors(v: number): { bg: string, border: string, text: string, glow: string } {
    if (v >= 500) return { bg: 'bg-amber-400/25', border: 'border-amber-300', text: 'text-amber-200', glow: 'shadow-[0_0_24px_-2px_var(--warning)]' }
    if (v >= 100) return { bg: 'bg-amber-500/20', border: 'border-amber-400', text: 'text-amber-300', glow: 'shadow-[0_0_16px_-3px_var(--warning)]' }
    if (v >= 50) return { bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-400', text: 'text-fuchsia-300', glow: '' }
    if (v >= 25) return { bg: 'bg-violet-500/15', border: 'border-violet-400', text: 'text-violet-300', glow: '' }
    if (v >= 10) return { bg: 'bg-sky-500/15', border: 'border-sky-400', text: 'text-sky-300', glow: '' }
    return { bg: 'bg-slate-500/15', border: 'border-slate-400', text: 'text-slate-300', glow: '' }
}
function tierClass(v: number): string {
    const t = tierColors(v)
    return `${t.bg} ${t.border} ${t.text} ${t.glow}`.trim()
}

// --- bet config -------------------------------------------------------------
// The casino's bet bounds (the old site started at 5 with a 1-coin minimum).
const handValue = ref(info.minBet)
const handValueText = useAmountInput(handValue)
const placements = ref<number[]>([])
const placedSet = computed(() => new Set(placements.value))
const totalStake = computed(() => placements.value.length * handValue.value)

// --- round state ------------------------------------------------------------
type ReelSym = { kind: 'pending' | 'nothing' | 'reroll' | 'mult', value?: number }
type Reel = { items: ReelSym[], offset: number, transition: boolean }

function placeholderReels(): Reel[] {
    return Array.from({ length: COLS }, () => ({ items: [{ kind: 'pending' }], offset: 0, transition: false }))
}

const phase = ref<'idle' | 'fetching' | 'topbar' | 'winners' | 'done'>('idle')
const subPhase = ref<'' | 'spinning' | 'applying' | 'reroll'>('')
const topReels = ref<Reel[]>(placeholderReels())
const topLocked = ref<(PassSlot | null)[]>(Array(COLS).fill(null))
const activeApplyCol = ref(-1)
const passLabel = ref('')
const tileMult = ref<Record<number, number>>({})
const stampedTile = ref<number | null>(null)
const revealedWinners = ref<Set<number>>(new Set())
const result = ref<MagicHandsResult | null>(null)
const showPayout = ref(false)
const showHelp = ref(false)
const errorMsg = ref('')

const history = ref<{ won: boolean, payout: number, stake: number, net: number }[]>([])

const isBusy = computed(() => ['fetching', 'topbar', 'winners'].includes(phase.value))
const canEdit = computed(() => phase.value === 'idle' || phase.value === 'done')
const canPlay = computed(() =>
    canEdit.value
    && placements.value.length >= 1
    && balance.value >= totalStake.value
    && totalStake.value > 0
)

// --- helpers ----------------------------------------------------------------
let timers: ReturnType<typeof setTimeout>[] = []
function sleep(ms: number) {
    return new Promise<void>((r) => {
        timers.push(setTimeout(r, ms))
    })
}
function clearTimers() {
    timers.forEach(clearTimeout)
    timers = []
}

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[a[i], a[j]] = [a[j]!, a[i]!]
    }
    return a
}

function multValue(i: number): number | undefined {
    return tileMult.value[i]
}

// Tile background reflects the board (multipliers / winners). The bright green
// celebration is reserved for the player's OWN winning hand; other winning tiles
// just get a muted green border so they read as "a winner, not your win".
function tileClass(i: number): string {
    const mv = multValue(i)
    const isWin = revealedWinners.value.has(i)
    const placed = placedSet.value.has(i)

    // Your own winning hand — the only bright, celebratory state.
    if (isWin && placed) {
        return mv !== undefined
            ? `${tierColors(mv).bg} ${tierColors(mv).text} border-success ring-2 ring-success scale-[1.05] z-10 shadow-[0_0_18px_-2px_var(--success)]`
            : 'bg-success/25 border-success text-success ring-2 ring-success scale-[1.05] z-10 shadow-[0_0_16px_-3px_var(--success)]'
    }
    // A winning tile you have no hand on — keep its fill but use a muted green border.
    if (isWin) {
        return mv !== undefined
            ? `${tierColors(mv).bg} ${tierColors(mv).text} border-success/40`
            : 'bg-success/5 border-success/40 text-success/60'
    }
    // A multiplier tile that didn't win.
    if (mv !== undefined) return tierClass(mv)
    return 'bg-muted border-border text-muted-foreground'
}

// Hand icon colour: primary when placed, success once its tile is a revealed winner,
// danger once the round is over and it lost.
function handColor(i: number): string {
    if (revealedWinners.value.has(i)) return 'text-success'
    if (phase.value === 'done') return 'text-error'
    return 'text-primary'
}

function topCellClass(c: number): string {
    if (activeApplyCol.value === c) return 'border-primary ring-2 ring-primary/50'
    const slot = topLocked.value[c]
    if (!slot) return 'border-border'
    if (slot.type === 'multiplier') return tierClass(slot.value ?? 0)
    if (slot.type === 'reroll') return 'bg-info/15 border-info text-info'
    if (slot.type === 'nothing') return 'border-border text-muted-foreground'
    return 'border-border'
}

function randomSym(): ReelSym {
    const r = Math.random()
    if (r < 0.30) return { kind: 'nothing' }
    if (r < 0.40) return { kind: 'reroll' }
    return { kind: 'mult', value: MAGIC_HANDS_MULTIPLIERS[Math.floor(Math.random() * MAGIC_HANDS_MULTIPLIERS.length)] }
}
function symFor(slot: PassSlot): ReelSym {
    if (slot.type === 'multiplier') return { kind: 'mult', value: slot.value ?? 0 }
    if (slot.type === 'reroll') return { kind: 'reroll' }
    return { kind: 'nothing' }
}

function resetBoard() {
    clearTimers()
    topReels.value = placeholderReels()
    topLocked.value = Array(COLS).fill(null)
    activeApplyCol.value = -1
    passLabel.value = ''
    tileMult.value = {}
    stampedTile.value = null
    revealedWinners.value = new Set()
    result.value = null
    showPayout.value = false
    subPhase.value = ''
    phase.value = 'idle'
}

// --- placement actions ------------------------------------------------------
function toggleTile(i: number) {
    if (!canEdit.value) return
    if (phase.value === 'done') resetBoard()
    errorMsg.value = ''
    const idx = placements.value.indexOf(i)
    if (idx >= 0) {
        placements.value.splice(idx, 1)
    } else if (placements.value.length < MAX_HANDS) {
        placements.value.push(i)
    }
}

function clearPlacements() {
    if (!canEdit.value) return
    if (phase.value === 'done') resetBoard()
    placements.value = []
}

function autoPlace() {
    if (!canEdit.value) return
    if (phase.value === 'done') resetBoard()
    placements.value = shuffle(tiles).slice(0, 10)
}

// --- round flow -------------------------------------------------------------
async function play() {
    if (!canPlay.value) {
        if (placements.value.length === 0) errorMsg.value = 'Place at least one hand before playing'
        return
    }

    resetBoard()
    phase.value = 'fetching'
    errorMsg.value = ''
    const hand = handValue.value
    // The bet is one hand; the server stakes a hand per placed tile.
    const data = await round.play({ bet: hand, options: { placements: [...placements.value] } })
    if (!data) {
        clearTimers()
        phase.value = 'idle'
        errorMsg.value = round.error.value || 'Something went wrong'
        return
    }
    const res = data.result
    const legacy: MagicHandsResult = {
        handCount: res.placements.length,
        handValue: hand,
        totalStake: data.stake,
        placements: res.placements,
        passes: res.passes.map((pass, i) => ({ index: i + 1, slots: pass.slots, hasReroll: pass.reroll })),
        multiplierTiles: res.multipliers,
        winnerTiles: res.winners,
        wins: res.wins.map(w => ({ ...w, amount: hand * w.multiplier })),
        payout: data.payout,
        won: data.payout > data.stake,
        tileCap: MH_TILE_CAP
    }
    result.value = legacy
    try {
        await runReveal({ gameData: legacy, balance: data.balance })
    } catch (e: unknown) {
        clearTimers()
        round.settle()
        phase.value = 'idle'
        errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
    }
}

async function spinTopBar(pass: TopBarPass) {
    subPhase.value = 'spinning'
    topLocked.value = Array(COLS).fill(null)
    // Build a fresh reel per column with the real result fixed at FINAL_INDEX.
    topReels.value = pass.slots.map((slot) => {
        const items = Array.from({ length: REEL_LEN }, (_, i) => (i === FINAL_INDEX ? symFor(slot) : randomSym()))
        return { items, offset: 0, transition: false }
    })
    await nextTick()
    await sleep(40)
    for (let c = 0; c < COLS; c++) {
        topReels.value[c]!.transition = true
        topReels.value[c]!.offset = -(FINAL_INDEX * TOP_CELL)
    }
    await sleep(SPIN_MS + STAGGER * (COLS - 1) + 220)
    topLocked.value = pass.slots.map(s => s)
}

async function applyPass(pass: TopBarPass) {
    subPhase.value = 'applying'
    for (let c = 0; c < COLS; c++) {
        activeApplyCol.value = c
        const slot = pass.slots[c]!
        await sleep(150)
        if (slot.type === 'multiplier') {
            for (const tile of slot.tiles) {
                const cur = tileMult.value[tile] ?? 1
                tileMult.value = { ...tileMult.value, [tile]: Math.min(cur * (slot.value ?? 1), result.value!.tileCap) }
                stampedTile.value = tile
                await sleep(230)
            }
        } else if (slot.type === 'reroll') {
            await sleep(160)
        }
        await sleep(90)
    }
    activeApplyCol.value = -1
    stampedTile.value = null
}

async function runReveal(data: { gameData: MagicHandsResult, balance: number }) {
    const res = data.gameData

    // 1. Top bar — spin, process, and re-spin on each reroll pass.
    phase.value = 'topbar'
    await sleep(250)
    for (let p = 0; p < res.passes.length; p++) {
        const pass = res.passes[p]!
        passLabel.value = res.passes.length > 1 ? `Spin ${p + 1}` : ''
        await spinTopBar(pass)
        await sleep(250)
        await applyPass(pass)
        if (pass.hasReroll && p < res.passes.length - 1) {
            subPhase.value = 'reroll'
            await sleep(950)
        }
    }
    passLabel.value = ''
    subPhase.value = ''

    // 2. Reveal the winning tiles one by one — save the player's hits for the climax.
    phase.value = 'winners'
    await sleep(450)
    const placed = new Set(res.placements)
    const blanks = shuffle(res.winnerTiles.filter(t => !placed.has(t)))
    const hits = res.winnerTiles.filter(t => placed.has(t))
    for (const t of blanks) {
        revealedWinners.value.add(t)
        await sleep(160)
    }
    await sleep(250)
    for (const t of hits) {
        revealedWinners.value.add(t)
        await sleep(380)
    }

    // 3. Settle.
    await sleep(500)
    phase.value = 'done'
    // The balance (and any star) lands now the reveal is done.
    round.settle()
    history.value.unshift({
        won: res.won,
        payout: res.payout,
        stake: res.totalStake,
        net: res.payout - res.totalStake
    })
    if (history.value.length > 10) history.value.pop()
}

// --- payout summary ---------------------------------------------------------
const winningHands = computed(() => result.value?.wins ?? [])
const bestHand = computed(() =>
    winningHands.value.reduce((mx, w) => Math.max(mx, w.multiplier), 0)
)
const profit = computed(() => (result.value ? result.value.payout - result.value.totalStake : 0))

function onKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        play()
    }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    clearTimers()
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 p-6 pb-24 lg:pb-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <HandIcon class="size-6 text-warning" />
        Magic Hands
      </h1>
      <p class="mt-0.5 text-sm text-muted-foreground">
        {{ RTP }}% RTP · place hands, chase stacking gold multipliers
      </p>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <!-- Controls -->
      <div class="divide-y divide-border rounded-2xl bg-card ring ring-border">
        <div class="p-4 sm:px-6">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">
              Controls
            </h2>
            <button
              type="button"
              class="rounded-md p-1 text-foreground transition-colors hover:bg-muted"
              aria-label="How Magic Hands works"
              @click="showHelp = true"
            >
              <CircleHelpIcon class="size-4" />
            </button>
          </div>
        </div>

        <div class="space-y-4 p-4 sm:p-6">
          <!-- Hand value -->
          <div>
            <label class="mb-1.5 block text-xs font-medium tracking-wide text-muted-foreground uppercase">Hand Value</label>
            <div class="flex items-center gap-2">
              <div class="relative flex-1 font-mono">
                <CoinsIcon class="pointer-events-none absolute top-1/2 left-2.5 size-5 -translate-y-1/2 text-muted-foreground" />
                <input
                  v-model="handValueText"
                  placeholder="e.g. 10k"
                  autocomplete="off"
                  :disabled="isBusy"
                  class="w-full rounded-md border-0 bg-background py-2 pr-3 pl-10 text-sm text-foreground ring ring-input outline-none ring-inset placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-75"
                  :class="{ 'pr-24': amountPreview(handValueText) }"
                >
                <span
                  v-if="amountPreview(handValueText)"
                  class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
                >{{ amountPreview(handValueText) }}</span>
              </div>
              <div class="flex gap-1">
                <button
                  type="button"
                  class="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-75"
                  :disabled="isBusy"
                  @click="handValue = Math.max(info.minBet, Math.floor(handValue / 2))"
                >
                  ½
                </button>
                <button
                  type="button"
                  class="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-75"
                  :disabled="isBusy"
                  @click="handValue = handValue * 2"
                >
                  2×
                </button>
              </div>
            </div>
          </div>

          <!-- Placement controls -->
          <div class="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-75"
              :disabled="!canEdit"
              @click="autoPlace"
            >
              <ShuffleIcon class="size-4 shrink-0" />
              Auto 10
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-75"
              :disabled="!canEdit || placements.length === 0"
              @click="clearPlacements"
            >
              <EraserIcon class="size-4 shrink-0" />
              Clear
            </button>
          </div>

          <!-- Stats -->
          <div class="space-y-2 rounded-lg border border-border bg-muted p-3">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Hands placed</span>
              <span
                class="font-bold tabular-nums"
                :class="placements.length > 0 ? 'text-primary' : 'text-muted-foreground'"
              >
                {{ placements.length }} / {{ MAX_HANDS }}
              </span>
            </div>
            <div class="h-px w-full bg-border" />
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Total cost</span>
              <span class="font-bold tabular-nums">${{ formatNumber(totalStake, false) }}</span>
            </div>
          </div>

          <!-- Multiplier legend -->
          <div class="rounded-lg border border-border bg-muted p-3">
            <p class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Multipliers · stack &amp; cap {{ MH_TILE_CAP }}×
            </p>
            <div class="grid grid-cols-5 gap-1.5">
              <span
                v-for="m in MAGIC_HANDS_MULTIPLIERS"
                :key="m"
                class="text-center text-xs font-bold font-mono rounded border py-1"
                :class="tierClass(m)"
              >{{ m }}×</span>
            </div>
          </div>

          <!-- Error -->
          <Transition name="fade-up">
            <div v-if="errorMsg" role="alert" class="flex items-start gap-2.5 rounded-lg bg-error/10 p-4 text-sm text-error">
              <p class="flex-1">
                {{ errorMsg }}
              </p>
              <button type="button" class="-m-1 rounded-md p-1 text-foreground hover:bg-muted" aria-label="Dismiss" @click="errorMsg = ''">
                <XIcon class="size-4" />
              </button>
            </div>
          </Transition>

          <!-- Balance -->
          <div class="flex items-center justify-between rounded-lg border border-border bg-muted p-3">
            <span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Balance</span>
            <span class="font-bold text-sm">
              <CoinBalance
                :value="balance"
                :compact="false"
              />
            </span>
          </div>
        </div>
      </div>

      <!-- Game Area -->
      <div class="flex flex-col gap-4 lg:col-span-2">
        <div class="rounded-2xl bg-card ring ring-border">
          <div class="relative flex flex-col overflow-hidden p-4 sm:p-6">
            <div class="w-full max-w-md mx-auto">
              <!-- Top bar (slot-machine reels) -->
              <div class="relative">
                <div class="grid grid-cols-5 gap-2 mb-3">
                  <div
                    v-for="(reel, c) in topReels"
                    :key="c"
                    class="relative rounded-lg border overflow-hidden transition-all duration-200 font-black font-mono"
                    :style="{ height: `${TOP_CELL}px` }"
                    :class="topCellClass(c)"
                  >
                    <div
                      class="flex flex-col"
                      :style="{
                        transform: `translateY(${reel.offset}px)`,
                        transition: reel.transition ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.12, 1) ${c * STAGGER}ms` : 'none'
                      }"
                    >
                      <div
                        v-for="(sym, si) in reel.items"
                        :key="si"
                        class="shrink-0 flex items-center justify-center"
                        :style="{ height: `${TOP_CELL}px` }"
                        :class="sym.kind === 'mult' ? tierClass(sym.value ?? 0).split(' ').filter(x => x.startsWith('text-')).join(' ') : ''"
                      >
                        <CircleHelpIcon v-if="sym.kind === 'pending'" class="size-5 text-muted-foreground/40" />
                        <RefreshCwIcon v-else-if="sym.kind === 'reroll'" class="size-5 text-info" />
                        <MinusIcon v-else-if="sym.kind === 'nothing'" class="size-5 text-muted-foreground" />
                        <span
                          v-else
                          class="text-sm sm:text-base"
                        >{{ sym.value }}×</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Reroll flash -->
                <Transition name="pop">
                  <div
                    v-if="subPhase === 'reroll'"
                    class="absolute inset-0 flex items-center justify-center pointer-events-none"
                  >
                    <span class="px-4 py-1.5 rounded-full bg-info text-background font-black text-sm uppercase tracking-wider shadow-lg animate-pulse">
                      <RefreshCwIcon class="size-4 -mt-0.5 mr-1 inline animate-spin" />Reroll — spin again!
                    </span>
                  </div>
                </Transition>
              </div>

              <!-- Grid -->
              <div class="grid grid-cols-5 gap-2">
                <button
                  v-for="i in tiles"
                  :key="i"
                  type="button"
                  :disabled="!canEdit"
                  class="relative aspect-square rounded-lg border flex items-center justify-center transition-all duration-200 select-none"
                  :class="[tileClass(i), canEdit ? 'cursor-pointer hover:border-primary/60' : 'cursor-default', stampedTile === i ? 'animate-pulse' : '']"
                  @click="toggleTile(i)"
                >
                  <!-- multiplier value -->
                  <span
                    v-if="multValue(i) !== undefined"
                    :key="`m-${i}-${multValue(i)}`"
                    class="font-black text-xs sm:text-base tabular-nums leading-none pop-in"
                  >{{ multValue(i) }}×</span>

                  <!-- winner coin (winner tile, no multiplier) -->
                  <Transition name="pop">
                    <CoinsIcon v-if="revealedWinners.has(i) && multValue(i) === undefined" class="size-5 sm:size-6" />
                  </Transition>

                  <!-- hand marker -->
                  <HandIcon v-if="placedSet.has(i)" class="absolute top-0.5 right-0.5 size-4 sm:size-5 transition-colors duration-200" :class="handColor(i)" />
                </button>
              </div>

              <!-- Status line -->
              <div class="mt-4 text-center text-sm font-mono h-9 flex items-center justify-center">
                <span
                  v-if="phase === 'idle'"
                  class="text-muted-foreground"
                >
                  <template v-if="placements.length === 0">Click tiles to place your hands</template>
                  <template v-else>{{ placements.length }} hand{{ placements.length > 1 ? 's' : '' }} · ${{ formatNumber(totalStake, false) }} — press Play</template>
                </span>
                <span
                  v-else-if="phase === 'fetching'"
                  class="animate-pulse text-muted-foreground"
                >Dealing…</span>
                <span
                  v-else-if="phase === 'topbar' && subPhase === 'spinning'"
                  class="text-primary"
                >Spinning the top bar… {{ passLabel }}</span>
                <span
                  v-else-if="phase === 'topbar' && subPhase === 'applying'"
                  class="text-warning"
                >Stamping multipliers…</span>
                <span
                  v-else-if="phase === 'topbar' && subPhase === 'reroll'"
                  class="text-info"
                >Reroll! Another top bar incoming…</span>
                <span
                  v-else-if="phase === 'winners'"
                  class="text-success"
                >Picking winning tiles…</span>
                <span
                  v-else-if="phase === 'done' && result"
                  class="inline-flex items-center gap-1.5"
                >
                  <span
                    class="text-lg font-bold tabular-nums"
                    :class="result.won ? 'text-success' : 'text-muted-foreground'"
                  >
                    ${{ formatNumber(result.payout, false) }}
                  </span>
                  <button
                    type="button"
                    class="rounded-md p-1 text-foreground transition-colors hover:bg-muted"
                    aria-label="Round details"
                    @click="showPayout = true"
                  >
                    <CircleHelpIcon class="size-4" />
                  </button>
                </span>
              </div>
            </div>

            <!-- Result overlay — sits over the board, click anywhere outside (or Play) to dismiss -->
            <Transition name="result-pop">
              <div
                v-if="showPayout && result"
                class="absolute inset-0 z-30 flex cursor-pointer items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
                @click="showPayout = false"
              >
                <div
                  class="w-full max-w-xs cursor-default space-y-3 rounded-2xl border border-border bg-muted p-5 text-center shadow-2xl"
                  @click.stop
                >
                  <div
                    class="mx-auto size-14 rounded-full flex items-center justify-center"
                    :class="result.won ? 'bg-success/15 text-success' : 'bg-background text-muted-foreground'"
                  >
                    <PartyPopperIcon v-if="result.won" class="size-7" />
                    <CircleSlashIcon v-else class="size-7" />
                  </div>

                  <div>
                    <p class="text-xs font-medium tracking-widest text-muted-foreground uppercase">
                      {{ result.won ? 'You won' : 'Round over' }}
                    </p>
                    <p
                      class="text-3xl font-black tabular-nums mt-1"
                      :class="result.won ? 'text-success' : 'text-foreground'"
                    >
                      ${{ formatNumber(result.payout, false) }}
                    </p>
                    <p
                      class="text-sm font-mono mt-1"
                      :class="profit >= 0 ? 'text-success' : 'text-error'"
                    >
                      {{ profit >= 0 ? '+' : '' }}{{ formatNumber(profit, false) }} net
                    </p>
                  </div>

                  <div class="grid grid-cols-2 gap-2 text-sm">
                    <div class="rounded-lg border border-border bg-background p-2">
                      <p class="text-xs text-muted-foreground">
                        Winning hands
                      </p>
                      <p class="font-bold tabular-nums">
                        {{ winningHands.length }} / {{ result.handCount }}
                      </p>
                    </div>
                    <div class="rounded-lg border border-border bg-background p-2">
                      <p class="text-xs text-muted-foreground">
                        Best winning hand
                      </p>
                      <p
                        class="font-bold tabular-nums"
                        :class="bestHand > 1 ? 'text-warning' : ''"
                      >
                        {{ bestHand > 0 ? `${bestHand}×` : '—' }}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    class="inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/75"
                    @click="showPayout = false"
                  >
                    Continue
                  </button>
                  <p class="text-xs text-muted-foreground/70">
                    Click outside or press Play
                  </p>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- History strip -->
        <div class="rounded-2xl bg-card p-3 ring ring-border">
          <div class="flex items-center gap-2">
            <span class="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">Last 10</span>
            <div class="flex gap-1.5 flex-wrap min-h-[26px] items-center">
              <TransitionGroup name="pill-slide">
                <span
                  v-for="(h, idx) in history"
                  :key="`${idx}-${h.payout}`"
                  class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-mono font-bold"
                  :class="h.won ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'"
                >
                  <TrendingUpIcon v-if="h.won" class="size-3" />
                  <TrendingDownIcon v-else class="size-3" />
                  {{ h.net >= 0 ? '+' : '' }}{{ formatNumber(h.net, false) }}
                </span>
              </TransitionGroup>
              <span
                v-if="history.length === 0"
                class="font-mono text-xs text-muted-foreground/50"
              >No rounds yet</span>
            </div>
          </div>
        </div>

        <!-- Play Button — hidden on mobile, replaced by sticky bar below -->
        <div class="hidden rounded-2xl bg-card p-4 ring ring-border sm:p-6 lg:block">
          <div class="flex items-center gap-4">
            <button
              type="button"
              :disabled="isBusy || !canPlay"
              class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 font-black tracking-widest text-primary-foreground uppercase transition-transform hover:bg-primary/75 disabled:cursor-not-allowed disabled:opacity-75 h-16 flex-1 text-lg active:scale-[0.98]"
              @click="play"
            >
              <LoaderCircleIcon v-if="isBusy" class="size-6 shrink-0 animate-spin" />
              {{ isBusy ? 'Playing…' : `Play · $${formatNumber(totalStake, false)}` }}
            </button>
            <div class="hidden flex-col items-end px-4 font-mono text-sm whitespace-nowrap text-muted-foreground sm:flex">
              <span>Press <kbd class="rounded border border-border bg-muted px-2 py-1 font-sans text-xs font-bold">SPACE</kbd></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile sticky play bar -->
    <div
      class="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm lg:hidden"
      style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))"
    >
      <div class="p-3 max-w-6xl mx-auto">
        <button
          type="button"
          :disabled="isBusy || !canPlay"
          class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 font-black tracking-widest text-primary-foreground uppercase transition-colors hover:bg-primary/75 disabled:cursor-not-allowed disabled:opacity-75 h-14 text-base"
          @click="play"
        >
          <LoaderCircleIcon v-if="isBusy" class="size-6 shrink-0 animate-spin" />
          {{ isBusy ? 'Playing…' : `Play · $${formatNumber(totalStake, false)}` }}
        </button>
      </div>
    </div>

    <!-- Help -->
    <GameHelpModal v-model:open="showHelp" title="How Magic Hands works" :ui="{ content: 'sm:max-w-md' }">
      <li>Pick a <strong class="text-foreground">hand value</strong> and click tiles to place hands (up to the whole board). Cost = hands × value.</li>
      <li>On Play the <strong class="text-foreground">top bar</strong> spins like a slot. Each of the 5 slots lands on nothing, a <strong class="text-warning">multiplier</strong>, or a <strong class="text-info">reroll</strong>.</li>
      <li>Each multiplier stamps its value onto <strong class="text-foreground">1–4 tiles</strong> in that column.</li>
      <li>A <strong class="text-info">reroll</strong> spins a whole new top bar after the current one finishes. Multipliers landing on the same tile <strong class="text-foreground">stack</strong> (e.g. 50× then 10× = 500×) — capped at {{ MH_TILE_CAP }}× per tile.</li>
      <li>Then <strong class="text-success">2–8 tiles</strong> are revealed as winners. A hand on a winning tile pays <strong class="text-foreground">hand value × that tile's multiplier</strong> (a plain winner returns your 1×).</li>
      <li>Max win {{ MH_TILE_CAP }}× total stake — and the odds are identical no matter how many hands you place.</li>
    </GameHelpModal>
  </div>
</template>

<style scoped>
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }

.pill-slide-enter-active { transition: all 0.25s ease; }
.pill-slide-enter-from { opacity: 0; transform: translateX(-8px); }

.pop-enter-active { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.pop-enter-from { opacity: 0; transform: scale(0.3); }

.result-pop-enter-active, .result-pop-leave-active { transition: opacity 0.2s ease; }
.result-pop-enter-from, .result-pop-leave-to { opacity: 0; }
.result-pop-enter-active > div, .result-pop-leave-active > div { transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
.result-pop-enter-from > div, .result-pop-leave-to > div { transform: scale(0.85); }

.pop-in { animation: pop-in 0.32s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes pop-in {
  0% { opacity: 0; transform: scale(0.3); }
  100% { opacity: 1; transform: scale(1); }
}

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
