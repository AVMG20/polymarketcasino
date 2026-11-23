<script setup lang="ts">
import { Eraser, Shuffle } from 'lucide-vue-next'
import type { MagicHandsResult, MhPass, MhPassSlot } from '#shared/games/magichands'
import { MH_COLS, MH_MAX_HANDS, MH_MULTIPLIERS, MH_TILE_CAP, MH_TILES, MH_WINNERS } from '#shared/games/magichands'
import { findGame } from '#shared/games/registry'
import { costFor, formatCoins, formatCoinsExact, payFor } from '#shared/money'
import type { WinShow } from '~/components/game/WinBurst.vue'
import MhGlove from '~/components/games/magichands/MhGlove.vue'

/**
 * Magic Hands: put hands on a 5 × 8 board, then a slot bar spins one reel per
 * column and stamps multipliers onto its tiles (stacking), and 2-8 tiles are
 * revealed as winners. A hand on a winner pays hand value × its multiplier.
 * One round through useGameRound (the bet is one hand; the server stakes a
 * hand per placed tile); settle() once the reveal is done.
 */
const info = findGame('magichands')!
const round = useGameRound<MagicHandsResult>('magichands')
const bankroll = useBankroll()
const sound = useTableSound()

const tiles = Array.from({ length: MH_TILES }, (_, i) => i)

// ─── bet and hands ───────────────────────────────────────────────────────────
const hand = ref(info.minBet)
const placements = ref<number[]>([])
const placedSet = computed(() => new Set(placements.value))
const totalStake = computed(() => costFor(hand.value, placements.value.length))
const overMax = computed(() => totalStake.value > info.maxBet)

// ─── round state ─────────────────────────────────────────────────────────────
type Sym = { kind: 'pending' | 'nothing' | 'reroll' | 'mult', value?: number }
type Reel = { items: Sym[], moving: boolean }
const CELL = 3.5 // rem, one reel symbol
const REEL_LEN = 22
const FINAL = 18
const SPIN_MS = 700
const STAGGER = 90

const phase = ref<'idle' | 'fetching' | 'topbar' | 'winners' | 'done'>('idle')
const sub = ref<'' | 'spinning' | 'applying' | 'reroll'>('')
const reels = ref<Reel[]>(idleReels())
const locked = ref<(MhPassSlot | null)[]>(Array(MH_COLS).fill(null))
const applyCol = ref(-1)
const passNo = ref(0)
const passCount = ref(0)
const tileMult = ref<Record<number, number>>({})
const stamped = ref<{ tile: number, id: number } | null>(null)
const revealed = ref<Set<number>>(new Set())
const result = ref<{ outcome: MagicHandsResult, stake: number, payout: number, hand: number } | null>(null)
const win = ref<WinShow | null>(null)
const errorMsg = ref('')
const history = ref<{ id: string, label: string, won: boolean }[]>([])
const nudge = ref(0)

const busy = computed(() => ['fetching', 'topbar', 'winners'].includes(phase.value))
const canEdit = computed(() => !busy.value)
const canPlay = computed(() => canEdit.value && placements.value.length > 0 && !overMax.value && bankroll.total.value >= totalStake.value)
const winningTiles = computed(() => new Map((result.value?.outcome.wins ?? []).map(w => [w.tile, w.multiplier])))

function idleReels(): Reel[] {
    return Array.from({ length: MH_COLS }, () => ({ items: [{ kind: 'pending' }], moving: false }))
}

let timers: ReturnType<typeof setTimeout>[] = []
let fast = false
function sleep(ms: number) {
    return new Promise<void>(resolve => timers.push(setTimeout(resolve, fast ? Math.min(ms, 30) : ms)))
}
function clearTimers() {
    timers.forEach(clearTimeout)
    timers = []
}

/** Rarity by size: blue, purple, pink, gold, and a glowing gold past 500×. */
function rarity(v: number): string {
    if (v >= 500) return 'r-mythic'
    if (v >= 100) return 'r-gold'
    if (v >= 50) return 'r-pink'
    if (v >= 20) return 'r-purple'
    if (v >= 10) return 'r-blue'
    return 'r-slate'
}

const multFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 })
const mult = (v: number) => `×${multFormat.format(v)}`

function resetBoard() {
    clearTimers()
    reels.value = idleReels()
    locked.value = Array(MH_COLS).fill(null)
    applyCol.value = -1
    passNo.value = 0
    tileMult.value = {}
    stamped.value = null
    revealed.value = new Set()
    result.value = null
    win.value = null
    sub.value = ''
    phase.value = 'idle'
}

// ─── placing hands ───────────────────────────────────────────────────────────
function toggle(tile: number) {
    if (!canEdit.value) return
    if (phase.value === 'done') resetBoard()
    errorMsg.value = ''
    const at = placements.value.indexOf(tile)
    if (at >= 0) {
        placements.value.splice(at, 1)
    } else if (placements.value.length < MH_MAX_HANDS) {
        placements.value.push(tile)
        sound.play('chip')
    } else {
        nudge.value++
    }
}

function clearHands() {
    if (!canEdit.value) return
    if (phase.value === 'done') resetBoard()
    placements.value = []
}

/** Random hands (the player's own pick, so Math.random). */
function autoPlace(count: number) {
    if (!canEdit.value) return
    if (phase.value === 'done') resetBoard()
    const pool = [...tiles]
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
    }
    placements.value = pool.slice(0, Math.min(count, MH_MAX_HANDS))
    sound.play('chip')
}

// ─── a round ─────────────────────────────────────────────────────────────────
async function play() {
    if (!canPlay.value) {
        if (canEdit.value && !placements.value.length) nudge.value++
        return
    }
    resetBoard()
    phase.value = 'fetching'
    errorMsg.value = ''
    fast = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const value = hand.value
    const data = await round.play({ bet: value, options: { placements: [...placements.value] } })
    if (!data) {
        phase.value = 'idle'
        errorMsg.value = round.error.value || 'Something went wrong'
        return
    }
    result.value = { outcome: data.result, stake: data.stake, payout: data.payout, hand: value }
    await reveal(data.result)

    phase.value = 'done'
    const multiple = data.stake > 0 ? Math.floor((data.payout / data.stake) * 100) / 100 : 0
    win.value = { id: data.roundId, payout: data.payout, multiplier: multiple }
    history.value = [{ id: data.roundId, label: data.payout > 0 ? `×${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(multiple)}` : '×0', won: data.payout > data.stake }, ...history.value].slice(0, 20)
    sound.play(data.payout > 0 ? 'win' : 'lose')
    // The balance (and any star) lands now the reveal is done.
    round.settle()
}

function symFor(slot: MhPassSlot): Sym {
    if (slot.type === 'multiplier') return { kind: 'mult', value: slot.value ?? 0 }
    if (slot.type === 'reroll') return { kind: 'reroll' }
    return { kind: 'nothing' }
}

/** Filler for the reels while they spin (cosmetic, so Math.random). */
function fillerSym(): Sym {
    const r = Math.random()
    if (r < 0.3) return { kind: 'nothing' }
    if (r < 0.42) return { kind: 'reroll' }
    return { kind: 'mult', value: MH_MULTIPLIERS[Math.floor(Math.random() * MH_MULTIPLIERS.length)] }
}

async function spinReels(pass: MhPass) {
    sub.value = 'spinning'
    locked.value = Array(MH_COLS).fill(null)
    reels.value = pass.slots.map(slot => ({ items: Array.from({ length: REEL_LEN }, (_, i) => (i === FINAL ? symFor(slot) : fillerSym())), moving: false }))
    await nextTick()
    await sleep(30)
    for (const reel of reels.value) reel.moving = true
    for (let c = 0; c < MH_COLS; c++) {
        timers.push(setTimeout(() => {
            locked.value[c] = pass.slots[c]!
            sound.play('tick')
        }, fast ? 0 : SPIN_MS + STAGGER * c))
    }
    await sleep(SPIN_MS + STAGGER * (MH_COLS - 1) + 160)
}

async function applyPass(pass: MhPass, cap: number) {
    sub.value = 'applying'
    for (let c = 0; c < MH_COLS; c++) {
        const slot = pass.slots[c]!
        if (slot.type !== 'multiplier') continue
        applyCol.value = c
        await sleep(90)
        for (const tile of slot.tiles) {
            tileMult.value = { ...tileMult.value, [tile]: Math.min((tileMult.value[tile] ?? 1) * (slot.value ?? 1), cap) }
            stamped.value = { tile, id: (stamped.value?.id ?? 0) + 1 }
            sound.play('flip')
            await sleep(120)
        }
        await sleep(50)
    }
    applyCol.value = -1
}

async function reveal(outcome: MagicHandsResult) {
    phase.value = 'topbar'
    passCount.value = outcome.passes.length
    for (let p = 0; p < outcome.passes.length; p++) {
        const pass = outcome.passes[p]!
        passNo.value = p + 1
        await spinReels(pass)
        await applyPass(pass, MH_TILE_CAP)
        if (pass.reroll && p < outcome.passes.length - 1) {
            sub.value = 'reroll'
            sound.play('turn')
            await sleep(800)
        }
    }
    sub.value = ''

    // Winners: the empty ones quickly, then the player's own hits one by one.
    phase.value = 'winners'
    await sleep(250)
    const placed = new Set(outcome.placements)
    const blanks = outcome.winners.filter(t => !placed.has(t))
    const hits = outcome.winners.filter(t => placed.has(t))
    for (const t of blanks) {
        revealed.value = new Set([...revealed.value, t])
        sound.play('tick')
        await sleep(100)
    }
    for (const t of hits) {
        await sleep(200)
        revealed.value = new Set([...revealed.value, t])
        sound.play('chip')
        await sleep(240)
    }
    await sleep(250)
}

const status = computed(() => {
    if (phase.value === 'fetching') return 'Shuffling…'
    if (phase.value === 'topbar') return sub.value === 'reroll' ? 'Reroll!' : passCount.value > 1 ? `Spin ${passNo.value}` : 'Spinning…'
    if (phase.value === 'winners') return 'Revealing…'
    return placements.value.length ? `${placements.value.length} hand${placements.value.length === 1 ? '' : 's'} on the board` : 'Tap tiles to place hands'
})

function onKey(event: KeyboardEvent) {
    if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault()
        void play()
    }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    clearTimers()
})

const presets = [5, 10, 20, MH_MAX_HANDS].map(n => ({ n, label: n === MH_MAX_HANDS ? 'All' : String(n) }))
</script>

<template>
  <GameFrame slug="magichands">
    <div class="@container">
      <div class="flex flex-col gap-3 @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_20rem] @3xl:grid-rows-[auto_1fr] @3xl:items-start">
        <GameWinBurst :show="win" class="rounded-[1.5rem] @3xl:row-span-2">
          <GameFelt tone="plum" class="h-full">
            <div class="flex flex-col gap-2 p-3 sm:p-4">
              <GameRoundHistory :items="history" />

              <div class="mx-auto flex w-full max-w-[min(30rem,calc((100svh-16rem)*0.6))] min-w-[min(100%,17rem)] flex-col gap-2.5">
                <!-- The slot bar: one reel per column. -->
                <div class="mh-bar relative grid grid-cols-5 gap-1.5 rounded-2xl p-1.5">
                  <div
                    v-for="(reel, c) in reels" :key="c"
                    class="mh-window relative overflow-hidden rounded-xl"
                    :class="[locked[c] ? `mh-landed-${locked[c]!.type}` : '', applyCol === c ? 'mh-applying' : '', locked[c]?.type === 'multiplier' ? rarity(locked[c]!.value ?? 0) : '']"
                    :style="{ height: `${CELL}rem` }"
                  >
                    <div
                      class="flex flex-col will-change-transform"
                      :style="{
                        transform: reel.moving ? `translateY(-${FINAL * CELL}rem)` : 'translateY(0)',
                        transition: reel.moving ? `transform ${SPIN_MS + c * STAGGER}ms cubic-bezier(0.15, 0.75, 0.25, 1.06)` : 'none'
                      }"
                    >
                      <div v-for="(sym, si) in reel.items" :key="si" class="grid shrink-0 place-items-center" :style="{ height: `${CELL}rem` }">
                        <span v-if="sym.kind === 'pending'" class="mh-q">?</span>
                        <svg v-else-if="sym.kind === 'reroll'" viewBox="0 0 24 24" class="size-7 text-[#7dd3fc]" aria-label="Reroll">
                          <path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
                          <path d="M18.5 3v4.5H14M5.5 21v-4.5H10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                        <span v-else-if="sym.kind === 'nothing'" class="h-1.5 w-6 rounded-full bg-white/20" />
                        <span v-else class="mh-reel-mult g-num" :class="rarity(sym.value ?? 0)">{{ mult(sym.value ?? 0) }}</span>
                      </div>
                    </div>
                  </div>
                  <Transition name="mh-pop">
                    <div v-if="sub === 'reroll'" class="pointer-events-none absolute inset-0 grid place-items-center">
                      <span class="mh-reroll g-title rounded-full px-4 py-1 text-xl uppercase">Reroll!</span>
                    </div>
                  </Transition>
                </div>

                <!-- The board. -->
                <div :key="nudge" class="relative grid grid-cols-5 gap-1.5" :class="nudge ? 'mh-nudge' : ''">
                  <div
                    v-if="applyCol >= 0"
                    class="mh-beam pointer-events-none absolute inset-y-0 z-10 rounded-xl"
                    :style="{ left: `calc(${applyCol} * (100% + 0.375rem) / 5)`, width: 'calc((100% - 1.5rem) / 5)' }"
                  />
                  <button
                    v-for="i in tiles" :key="i"
                    type="button"
                    class="mh-tile relative grid aspect-square place-items-center rounded-xl"
                    :class="[
                      tileMult[i] !== undefined ? `mh-mult ${rarity(tileMult[i]!)}` : '',
                      {
                        'mh-placed': placedSet.has(i),
                        'mh-winner': revealed.has(i),
                        'mh-hit': revealed.has(i) && placedSet.has(i),
                        'mh-dud': phase === 'done' && placedSet.has(i) && !revealed.has(i),
                        'mh-editable': canEdit
                      }
                    ]"
                    :disabled="!canEdit"
                    :aria-pressed="placedSet.has(i)"
                    :aria-label="`Tile ${i + 1}${placedSet.has(i) ? ', hand on it' : ''}${tileMult[i] ? `, ${mult(tileMult[i]!)}` : ''}${revealed.has(i) ? ', winner' : ''}`"
                    @click="toggle(i)"
                  >
                    <span v-if="stamped?.tile === i" :key="stamped.id" class="mh-stamp pointer-events-none absolute inset-0 rounded-xl" />
                    <span v-if="revealed.has(i) && !placedSet.has(i) && tileMult[i] === undefined" class="mh-star" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" fill="currentColor" /></svg>
                    </span>
                    <span v-if="tileMult[i] !== undefined" :key="`m${tileMult[i]}`" class="mh-mult-num g-num" :class="placedSet.has(i) ? 'with-hand' : ''">{{ mult(tileMult[i]!) }}</span>
                    <MhGlove
                      v-if="placedSet.has(i)"
                      class="mh-glove-on"
                      :class="tileMult[i] !== undefined ? 'small' : ''"
                      :tone="revealed.has(i) ? 'won' : phase === 'done' ? 'lost' : 'live'"
                    />
                    <span v-if="revealed.has(i) && placedSet.has(i) && result" class="mh-paid g-num">+{{ formatCoins(payFor(result.hand, winningTiles.get(i) ?? 1)) }}</span>
                  </button>
                </div>

                <div class="flex h-8 items-center justify-center">
                  <p v-if="phase === 'done' && result && result.payout <= 0" class="mh-zero g-title text-base text-[#ffc2cc] sm:text-lg">
                    ×0 <span class="text-sm text-white/55">no hand on a winner</span>
                  </p>
                  <p v-else-if="phase === 'done' && result" class="g-title text-sm text-white/70 sm:text-base">
                    {{ result.outcome.wins.length }}/{{ result.outcome.placements.length }} hands won
                  </p>
                  <p v-else class="g-title inline-flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-0.5 text-sm text-white/85 sm:text-base">{{ status }}</p>
                </div>
              </div>
            </div>
          </GameFelt>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <GameBetInput v-model="hand" :min="info.minBet" :max="info.maxBet" :disabled="busy" label="Per hand" />

          <div class="grid grid-cols-5 gap-1.5">
            <button
              v-for="p in presets" :key="p.n"
              type="button"
              class="g-btn h-12 rounded-2xl text-lg"
              :class="placements.length === p.n ? 'g-purple' : 'g-dark'"
              :disabled="busy"
              :title="`${p.n} random hands`"
              @click="autoPlace(p.n)"
            >
              <Shuffle v-if="p.n === 5" class="size-4" :stroke-width="3" />{{ p.label }}
            </button>
            <button type="button" class="g-btn g-dark h-12 rounded-2xl" :disabled="busy || !placements.length" title="Lift every hand" aria-label="Clear hands" @click="clearHands">
              <Eraser class="size-5" :stroke-width="2.75" />
            </button>
          </div>

          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Hands</p>
              <p class="g-num truncate text-2xl">{{ placements.length }}<span class="text-sm text-[var(--g-muted)]">/{{ MH_MAX_HANDS }}</span></p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Cost</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl" :class="overMax || bankroll.total.value < totalStake ? 'text-[var(--g-red)]' : ''" :title="`${formatCoinsExact(totalStake)}`">
                <GameStakeIcons :amount="totalStake" class="text-base" />{{ formatCoins(totalStake) }}
              </p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2" :title="`${MH_WINNERS[0]}-${MH_WINNERS[1]} winning tiles; multipliers stack up to ${MH_TILE_CAP}× a tile`">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Per hand</p>
              <p class="g-num truncate text-2xl text-[var(--g-gold)]">×{{ formatCoins(MH_TILE_CAP) }}</p>
            </div>
          </div>

          <div class="flex flex-wrap justify-center gap-1" aria-label="Multipliers">
            <span v-for="m in MH_MULTIPLIERS" :key="m" class="mh-legend g-num rounded-lg px-1.5 py-0.5 text-xs" :class="rarity(m)">{{ mult(m) }}</span>
          </div>

          <p v-if="overMax" class="rounded-xl bg-destructive/15 p-2.5 text-sm text-[#ff8da0]">At most {{ formatCoins(info.maxBet) }} a round</p>
          <p v-if="errorMsg" role="alert" class="rounded-xl bg-destructive/15 p-3 text-sm text-[#ff8da0]">{{ errorMsg }}</p>
        </div>

        <!-- Play sticks to the bottom of the screen on a phone, under the board. -->
        <div class="g-ui g-panel sticky bottom-2 z-20 rounded-[1.5rem] p-2 sm:p-3 @3xl:static @3xl:col-start-2">
          <button type="button" class="g-btn g-gold h-14 w-full rounded-2xl text-2xl uppercase" :disabled="!canPlay" @click="play">
            <template v-if="busy">{{ status }}</template>
            <template v-else>
              Play
              <span class="inline-flex items-center gap-1 text-lg normal-case opacity-80"><GameStakeIcons :amount="totalStake" />{{ formatCoins(totalStake) }}</span>
            </template>
          </button>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Pick a value per hand and tap tiles to place hands (up to the whole board). A round costs hands × value.</p>
      <p>On Play the slot bar spins one reel per column. A reel lands on nothing, a <strong>multiplier</strong> (stamped onto 1-4 tiles of its column) or a <strong>reroll</strong> (the bar spins again afterwards). Multipliers on the same tile stack, up to {{ MH_TILE_CAP }}× a tile.</p>
      <p>Then {{ MH_WINNERS[0] }}-{{ MH_WINNERS[1] }} tiles are revealed as winners. A hand on a winner pays value × that tile's multiplier (1× without one). The odds are the same however many hands you place. Space plays.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
/* ─── the slot bar ─────────────────────────────────────────────────────────── */
.mh-bar {
    background: linear-gradient(180deg, #ffe27a, #d9a531 45%, #9a6512);
    box-shadow: 0 4px 0 #5e3a06, inset 0 2px 0 rgb(255 255 255 / 0.5), 0 8px 18px rgb(0 0 0 / 0.35);
}
.mh-window {
    background: linear-gradient(180deg, #120a1e, #24143a 50%, #120a1e);
    box-shadow: inset 0 3px 6px rgb(0 0 0 / 0.7), inset 0 -2px 0 rgb(255 255 255 / 0.08);
    transition: box-shadow 0.2s;
}
.mh-window::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgb(0 0 0 / 0.55), transparent 28%, transparent 72%, rgb(0 0 0 / 0.55)); }
.mh-q { font-family: var(--font-game); font-size: 1.4rem; color: rgb(255 255 255 / 0.25); }
.mh-reel-mult { font-size: 1.15rem; }
.mh-landed-multiplier { box-shadow: inset 0 0 0 2px currentColor, inset 0 0 16px rgb(255 255 255 / 0.15); }
.mh-landed-reroll { box-shadow: inset 0 0 0 2px #7dd3fc, inset 0 0 16px rgb(125 211 252 / 0.3); }
.mh-applying { box-shadow: inset 0 0 0 3px #fff, 0 0 16px rgb(255 255 255 / 0.65); }
.mh-reroll { background: #7dd3fc; color: #0c2a3e; box-shadow: 0 3px 0 #1d6fa0, 0 0 22px rgb(125 211 252 / 0.7); }

/* ─── the board ────────────────────────────────────────────────────────────── */
.mh-tile {
    background: linear-gradient(180deg, #4a2b78, #351b5a);
    box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.12), 0 3px 0 #1c0d33;
    container-type: inline-size;
    transition: transform 0.12s, box-shadow 0.15s, background 0.2s;
    -webkit-tap-highlight-color: transparent;
}
.mh-tile::before { content: ''; position: absolute; inset: 28%; border-radius: 50%; background: radial-gradient(circle, rgb(255 255 255 / 0.07), transparent 70%); }
.mh-editable { cursor: pointer; }
.mh-editable:hover { transform: translateY(-1px); background: linear-gradient(180deg, #5a3590, #40216b); }
.mh-editable:active { transform: translateY(2px); box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.12), 0 1px 0 #1c0d33; }
.mh-tile:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.mh-placed { background: linear-gradient(180deg, #6b3fb0, #4b2785); }
.mh-glove-on { width: 62%; animation: mh-glove-in 0.28s cubic-bezier(0.3, 0.7, 0.4, 1.6); }
.mh-glove-on.small { position: absolute; right: 4%; bottom: 4%; width: 38%; }
.mh-mult-num { position: relative; font-size: clamp(0.75rem, 28cqw, 1.35rem); line-height: 1; animation: mh-pop 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.6); }
.mh-mult-num.with-hand { translate: -8% -14%; }
.mh-stamp { animation: mh-stamp 0.45s ease-out both; }
/* Rarity colours (never green or red: those mean win and loss). */
.r-slate { color: #cbd5e1; }
.r-blue { color: #7cc4ff; }
.r-purple { color: #c9a2ff; }
.r-pink { color: #ff8ad8; }
.r-gold { color: #ffd84a; }
.r-mythic { color: #fff3a8; text-shadow: 0 0 10px rgb(255 216 74 / 0.9); }
.mh-mult.r-slate { background: linear-gradient(180deg, #56607a, #3a4256); }
.mh-mult.r-blue { background: linear-gradient(180deg, #2f5fa8, #1d3f78); }
.mh-mult.r-purple { background: linear-gradient(180deg, #7445c4, #4f2a92); }
.mh-mult.r-pink { background: linear-gradient(180deg, #b23e93, #7c2366); }
.mh-mult.r-gold { background: linear-gradient(180deg, #a8730f, #6e4706); box-shadow: inset 0 0 0 2px #ffd84a, 0 3px 0 #3d2700; }
.mh-mult.r-mythic { background: linear-gradient(180deg, #e0a91d, #8a5a06); box-shadow: inset 0 0 0 2px #fff3a8, 0 0 16px rgb(255 216 74 / 0.7), 0 3px 0 #3d2700; }
.mh-winner { background: linear-gradient(180deg, #3a7a4e, #1f4d2f); box-shadow: inset 0 0 0 2px rgb(140 255 170 / 0.45), 0 3px 0 #0e2a18; }
.mh-winner.mh-mult { box-shadow: inset 0 0 0 2px rgb(140 255 170 / 0.7), 0 3px 0 #0e2a18; }
.mh-tile.mh-hit {
    z-index: 5;
    background: linear-gradient(180deg, #5ef07a, #22a845);
    box-shadow: inset 0 0 0 3px #fff, 0 0 0 3px #ffd84a, 0 0 24px 4px rgb(255 216 74 / 0.75), 0 3px 0 #0e5a22;
    animation: mh-hit 0.5s cubic-bezier(0.3, 0.7, 0.4, 1.6);
}
.mh-hit.mh-mult .mh-mult-num { color: #fff; text-shadow: 0 2px 0 rgb(0 0 0 / 0.4); }
.mh-dud { background: linear-gradient(180deg, #3a2554, #2a1840); }
.mh-star { width: 48%; color: #8cffaa; filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.35)); animation: mh-pop 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.6); }
.mh-paid {
    position: absolute;
    left: 50%;
    top: -0.4rem;
    translate: -50% 0;
    z-index: 6;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: #ffd84a;
    color: #4a2a00;
    font-size: 0.75rem;
    white-space: nowrap;
    box-shadow: 0 2px 0 #9a5a00;
    animation: mh-paid 0.45s cubic-bezier(0.3, 0.7, 0.4, 1.6) both;
}
.mh-beam { background: linear-gradient(180deg, rgb(255 255 255 / 0.28), rgb(255 255 255 / 0.04)); box-shadow: 0 0 18px rgb(255 255 255 / 0.25); }

.mh-legend { background: rgb(0 0 0 / 0.3); }

.mh-zero { animation: mh-zero 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.5); }
.mh-nudge { animation: mh-nudge 0.35s ease-out; }
.mh-pop-enter-active { transition: transform 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.6), opacity 0.15s; }
.mh-pop-leave-active { transition: opacity 0.2s; }
.mh-pop-enter-from { transform: scale(0.3); opacity: 0; }
.mh-pop-leave-to { opacity: 0; }

@keyframes mh-glove-in { from { transform: translateY(-8px) scale(0.6); opacity: 0; } }
@keyframes mh-pop { from { transform: scale(0.3); opacity: 0; } }
@keyframes mh-stamp { 0% { box-shadow: inset 0 0 0 4px #fff, 0 0 26px 6px rgb(255 255 255 / 0.85); transform: scale(1.18); } 100% { box-shadow: inset 0 0 0 0 transparent; transform: scale(1); } }
@keyframes mh-hit { 0% { transform: scale(0.85); } 60% { transform: scale(1.14); } 100% { transform: scale(1.04); } }
@keyframes mh-paid { from { transform: translateY(8px) scale(0.5); opacity: 0; } }
@keyframes mh-zero { from { transform: scale(1.25); } }
@keyframes mh-nudge { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 50% { transform: translateX(4px); } 75% { transform: translateX(-2px); } }
@media (prefers-reduced-motion: reduce) {
    .mh-glove-on, .mh-mult-num, .mh-stamp, .mh-hit, .mh-star, .mh-paid, .mh-zero, .mh-nudge { animation: none; }
}
</style>
