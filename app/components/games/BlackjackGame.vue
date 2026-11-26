<script setup lang="ts">
import { Lightbulb, LightbulbOff } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import {
    basicStrategy, BJ_SIDE_BETS, canDouble, handStake, canSplit, canSurrender, insuranceCost,
    PERFECT_PAIRS_LABELS, PERFECT_PAIRS_PAYS, TWENTY_ONE_PLUS_THREE_LABELS, TWENTY_ONE_PLUS_THREE_PAYS,
    type BjAction, type BjHand, type BjSpot, type PerfectPairsTier, type TwentyOnePlusThreeTier
} from '#shared/tables/blackjack'
import type { BjGameEvent, BjSeat, BjShared, BjTableAction } from '#shared/tables/blackjack-wire'
import { buildTextures, type LbTextures } from '~/utils/live-blackjack/art'
import { BET_Y_OFFSET, LiveBlackjackScene, PLATE_Y_OFFSET, SEAT_LAYOUT, STAGE_H, STAGE_W } from '~/utils/live-blackjack/scene'
import { safeDestroy } from '~/utils/slot-pixi'

const sound = useTableSound()
let sideWinSounded = false
const table = useLiveTable<BjSeat, BjShared, BjTableAction>('blackjack', (payload) => {
    const event = payload as BjGameEvent
    if (event.type === 'action') scene?.flashAction(event.seat, event.action)
    if (event.type === 'side' && event.seat === mySeat.value?.index) {
        // The round-end win sound would play a second time for the same win.
        sideWinSounded = true
        sound.play('win')
    }
}, seat => seat.hands.reduce((sum, hand) => sum + handStake(hand), 0) + seat.insurance
    + (seat.sideResults ? seat.sideResults.reduce((sum, side) => sum + side.stake, 0) : BJ_SIDE_BETS.reduce((sum, key) => sum + seat.pendingSide[key], 0)))
const { state, mySeat, phase, connected } = table
/** What the player can stake: coins first, then chips (the name stays for the checks below). */
const coins = useBankroll().total
const chip = ref(100)

const seats = computed(() => state.value?.seats ?? [])
const game = computed(() => state.value?.game ?? null)
const me = computed(() => mySeat.value?.game ?? null)
const activeSeats = computed(() => seats.value.filter(s => s && !s.leaving).length)
const betting = computed(() => phase.value === 'betting' && !!me.value)
const canBetNow = computed(() => !!me.value && (phase.value === 'betting' || (phase.value === 'payout' && activeSeats.value <= 1)))
const showBetDock = computed(() => !!me.value && (phase.value === 'betting' || phase.value === 'payout'))
const sideTotal = computed(() => (me.value && phase.value === 'betting' ? BJ_SIDE_BETS.reduce((sum, key) => sum + me.value!.pendingSide[key], 0) : 0))
const displayMainBet = computed(() => {
    if (!me.value) return 0
    if (phase.value === 'betting') return me.value.pendingBet
    if (phase.value === 'payout') return 0
    return me.value.hands.reduce((sum, hand) => sum + handStake(hand), 0)
})
const displaySideBet = computed(() => {
    if (!me.value || phase.value === 'payout') return 0
    if (phase.value === 'betting') return sideTotal.value
    return me.value.sideResults
        ? me.value.sideResults.reduce((sum, side) => sum + side.stake, 0)
        : BJ_SIDE_BETS.reduce((sum, key) => sum + me.value!.pendingSide[key], 0)
})
const available = computed(() => Math.max(0, coins.value - (phase.value === 'betting' && me.value ? me.value.pendingBet + sideTotal.value : 0)))
const openSeat = computed(() => {
    const index = seats.value.findIndex(s => !s)
    return mySeat.value || index === -1 ? null : index
})

const myTurn = computed(() => phase.value === 'playing' && game.value?.activeSeat === mySeat.value?.index && game.value?.activeHand !== null)
const activeHand = computed<BjHand | null>(() => (myTurn.value && me.value ? me.value.hands[game.value!.activeHand!] ?? null : null))
const offerInsurance = computed(() => phase.value === 'insurance' && !!me.value?.hands.length && !me.value.insuranceDecided)

// Basic strategy, shown only on your own turn and only when asked for.
const hints = ref(false)
onMounted(() => {
    try {
        hints.value = localStorage.getItem('casino:bj-hints') === '1'
    } catch {
        // Private mode: hints start off.
    }
})
function toggleHints() {
    hints.value = !hints.value
    try {
        localStorage.setItem('casino:bj-hints', hints.value ? '1' : '0')
    } catch {
        // The switch still works for this visit.
    }
}
const hint = computed<BjAction | null>(() => {
    const up = game.value?.dealer.cards[0]?.rank
    if (!hints.value || !activeHand.value || !up || !me.value) return null
    return basicStrategy(activeHand.value, up, me.value.hands)
})

function place(spot: BjSpot) {
    if (!canBetNow.value) return
    if (spot !== 'main' && (!betting.value || !me.value!.pendingBet)) return
    table.act({ t: 'bet', spot, amount: chip.value })
    sound.play('chip')
}

// One decision per snapshot: a double tap must not hit twice or re-split.
const lock = useActionLock(() => `${phase.value}|${game.value?.activeSeat}|${game.value?.activeHand}|${JSON.stringify(me.value?.hands)}|${me.value?.insuranceDecided}`)
function play(action: BjAction) {
    if (!lock.run(() => table.act({ t: 'play', action }))) return
    if (action === 'double' || action === 'split') sound.play('chip')
}
function insure(take: boolean) {
    if (!lock.run(() => table.act({ t: 'insurance', take }))) return
    if (take) sound.play('chip')
}

const votes = computed(() => {
    const seated = seats.value.filter(s => s && !s.leaving)
    return seated.length > 1 ? ` ${seated.filter(s => s!.votedStart).length}/${seated.length}` : ''
})

// ─── side bet reference, the old corner panel ─────────────────────────────────
const SUIT_GLYPH: Record<string, { pip: string, red: boolean }> = {
    s: { pip: '♠', red: false },
    c: { pip: '♣', red: false },
    h: { pip: '♥', red: true },
    d: { pip: '♦', red: true }
}
const PERFECT_PAIRS_EXAMPLES: Record<PerfectPairsTier, string> = { perfect: 'Qh Qh', coloured: 'Qh Qd', mixed: 'Qh Qs' }
const TWENTY_ONE_PLUS_THREE_EXAMPLES: Record<TwentyOnePlusThreeTier, string> = {
    suitedTrips: '7h 7h 7h',
    straightFlush: '9s 10s Js',
    trips: '7h 7d 7s',
    straight: '9s 10h Jd',
    flush: '2c 7c Kc'
}
const sideBetTables = [
    {
        title: 'Perfect Pairs',
        note: 'Your first two cards',
        rows: (Object.keys(PERFECT_PAIRS_EXAMPLES) as PerfectPairsTier[]).map(tier => ({ label: PERFECT_PAIRS_LABELS[tier], example: PERFECT_PAIRS_EXAMPLES[tier], pays: `${PERFECT_PAIRS_PAYS[tier]}:1` }))
    },
    {
        title: '21+3',
        note: 'Your two cards + dealer upcard',
        rows: (Object.keys(TWENTY_ONE_PLUS_THREE_EXAMPLES) as TwentyOnePlusThreeTier[]).map(tier => ({ label: TWENTY_ONE_PLUS_THREE_LABELS[tier], example: TWENTY_ONE_PLUS_THREE_EXAMPLES[tier], pays: `${TWENTY_ONE_PLUS_THREE_PAYS[tier]}:1` }))
    }
]
const showSideBets = ref(false)
function exampleCards(example: string) {
    return example.split(' ').filter(Boolean).map((token, i) => {
        const suit = SUIT_GLYPH[token.slice(-1)] ?? SUIT_GLYPH.s!
        return { key: `${token}-${i}`, rank: token.slice(0, -1), pip: suit.pip, red: suit.red }
    })
}

const phaseTone = computed(() => {
    const net = phase.value === 'payout' ? mySeat.value?.lastNet : null
    return net ? (net > 0 ? 'win' : 'lose') : ''
})

// ─── the Pixi table ──────────────────────────────────────────────────────────
const canvasWrap = ref<HTMLDivElement | null>(null)
let app: import('pixi.js').Application | null = null
let scene: LiveBlackjackScene | null = null
let destroyed = false
let textures: LbTextures | null = null
let warmFrame = 0

watch(state, (snapshot) => {
    if (snapshot) scene?.update(snapshot, table.me.value)
})

onMounted(async () => {
    const PIXI = await import('pixi.js')
    if (destroyed) return
    const instance = new PIXI.Application()
    await instance.init({
        width: STAGE_W,
        height: STAGE_H,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        // Never below native resolution on dpr 1, capped at 2 on Retina.
        resolution: Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)
    })
    // The canvas labels use the casino's game font: have it before they are drawn.
    await Promise.all(['40px "Lilita One"', '40px Fredoka'].map(font => document.fonts.load(font))).catch(() => {})
    if (destroyed) {
        safeDestroy(() => instance.destroy({ removeView: true }))
        return
    }
    app = instance
    app.canvas.style.width = '100%'
    app.canvas.style.height = '100%'
    app.canvas.style.display = 'block'
    canvasWrap.value?.appendChild(app.canvas)

    textures = buildTextures(PIXI, app.renderer)
    // Faces bake on first use; the rest fill in a few per frame, off the open.
    const warm = () => {
        if (destroyed || !textures) return
        if (textures.warm(4)) warmFrame = requestAnimationFrame(warm)
    }
    warmFrame = requestAnimationFrame(warm)
    scene = new LiveBlackjackScene(PIXI, app, textures, {
        onPlace: spot => place(spot)
    })
    if (state.value) scene.update(state.value, table.me.value)
})

onBeforeUnmount(() => {
    destroyed = true
    cancelAnimationFrame(warmFrame)
    scene?.destroy()
    scene = null
    const instance = app
    app = null
    // removeView, not `true`: `true` also releases Pixi's global pools under any other live canvas.
    if (instance) safeDestroy(() => instance.destroy({ removeView: true }, { children: true, texture: true }))
    const baked = textures
    textures = null
    if (baked) safeDestroy(() => baked.destroy())
})

// ─── sound, off the same snapshots the table draws ──────────────────────────
const cardCount = computed(() => (game.value?.dealer.cards.length ?? 0) + seats.value.reduce((sum, s) => sum + (s?.game.hands.reduce((n, h) => n + h.cards.length, 0) ?? 0), 0))
const hiddenCount = computed(() => game.value?.dealer.cards.filter(c => c.hidden).length ?? 0)
watch([cardCount, hiddenCount], ([count, hidden], [before, hiddenBefore]) => {
    if (count > (before ?? 0)) sound.play('card')
    else if (hidden < (hiddenBefore ?? 0)) sound.play('flip')
})
watch(myTurn, turn => turn && sound.play('turn'))
let resultSoundTimer: ReturnType<typeof setTimeout> | null = null
watch(() => mySeat.value?.roundsPlayed, (played, before) => {
    if (!played || played === before) return
    const net = mySeat.value?.lastNet ?? 0
    const alreadySounded = sideWinSounded
    sideWinSounded = false
    if (net > 0 && alreadySounded) return
    if (!net) return
    if (resultSoundTimer) clearTimeout(resultSoundTimer)
    resultSoundTimer = setTimeout(() => {
        resultSoundTimer = null
        sound.play(net > 0 ? 'win' : 'lose')
    }, 200)
})
onBeforeUnmount(() => {
    if (resultSoundTimer) clearTimeout(resultSoundTimer)
})
</script>

<template>
  <LiveTableShell
    slug="blackjack"
    :connected="connected"
    :message="state?.message ?? 'Connecting'"
    :clock="table.clock.value"
    :watching="state?.watching ?? 0"
    :seated="!!mySeat"
    :leaving="!!mySeat?.leaving"
    :open-seat="openSeat"
    :aspect="STAGE_W / STAGE_H"
    :feed="table.feed.value"
    :scoreboard="state?.scoreboard ?? []"
    tone="green"
    :can-sit="table.canSit.value"
    :players="seats.filter(Boolean).length"
    :win="table.win.value"
    :send-chat="table.chat"
    @leave="table.leave"
    @sit="table.sit"
    @build="table.build"
  >
    <template #felt>
      <div class="relative">
        <!-- The Pixi table, with the seats, open chairs and the phase banner over it: the same DOM pieces as every table. -->
        <LiveTableStage class="lt-canvas-host" :width="STAGE_W" :height="STAGE_H" :felt="false" :focus="mySeat ? SEAT_LAYOUT[mySeat.index]!.x : null">
          <div ref="canvasWrap" class="lt-canvas" :style="{ width: `${STAGE_W}px`, height: `${STAGE_H}px` }" />
          <LiveTablePhase
            :label="(state?.message ?? 'Connecting').toUpperCase()"
            :tone="phaseTone"
            :top="334"
            :clock="table.clock.value"
            :timed="phase !== 'dealing'"
          />
          <template v-for="(p, i) in SEAT_LAYOUT" :key="i">
            <LiveTableSit v-if="!seats[i]" :x="p.x" :y="p.y + BET_Y_OFFSET" :mode="!!mySeat || !connected ? 'taken' : table.canSit.value ? 'open' : 'locked'" @sit="table.canSit.value ? table.sit(i) : table.build()" />
            <LiveTablePlate
              v-else
              :seat="seats[i]!"
              :x="p.x"
              :y="p.y + PLATE_Y_OFFSET + 20"
              :mine="seats[i]!.playerId === table.me.value"
              :turn="(phase === 'playing' && game?.activeSeat === i) || (phase === 'insurance' && !!seats[i]!.game.hands.length && !seats[i]!.game.insuranceDecided)"
              :ready="phase === 'betting' && seats[i]!.votedStart"
            />
          </template>
        </LiveTableStage>

        <!-- Side-bet reference: top corner, dimmed and collapsed to its header. -->
        <div class="bj-corner absolute top-[21%] right-[4%] hidden max-w-[48%] rounded-xl bg-black/80 ring-1 ring-amber-400/25 backdrop-blur-sm md:block" :class="{ open: showSideBets }">
          <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-xs font-bold tracking-wider text-amber-300 uppercase lg:text-sm" @click="showSideBets = !showSideBets">
            <span class="inline-block transition-transform" :class="showSideBets ? 'rotate-90' : ''">›</span> Side bets
          </button>
          <div v-if="showSideBets" class="space-y-3 px-3 pb-3">
            <div v-for="paytable in sideBetTables" :key="paytable.title">
              <div class="mb-1.5 flex items-baseline justify-between gap-5 border-b border-white/10 pb-1.5">
                <span class="text-sm font-bold text-white">{{ paytable.title }}</span>
                <span class="text-[10px] tracking-wider text-white/55 uppercase">{{ paytable.note }}</span>
              </div>
              <div class="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1">
                <template v-for="row in paytable.rows" :key="row.label">
                  <span class="text-[13px] leading-tight text-white">{{ row.label }}</span>
                  <span class="flex justify-end gap-0.5">
                    <span v-for="card in exampleCards(row.example)" :key="card.key" class="lt-eg-card !text-xs" :class="{ red: card.red }">{{ card.rank }}{{ card.pip }}</span>
                  </span>
                  <span class="font-mono text-[13px] font-bold text-amber-300 tabular-nums">{{ row.pays }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #controls>
      <template v-if="!connected || !mySeat" />

      <template v-else>
        <!-- Persistent Dice-style dark recessed bet bar + Hints toggle -->
        <div class="lt-bet-strip-row">
          <div class="lt-bet-strip">
            <div class="lt-strip-cell">
              <span class="lt-strip-lbl">Bet</span>
              <span class="lt-strip-val">{{ formatCoins(displayMainBet) }}</span>
              <span v-if="displaySideBet" class="lt-strip-side">+{{ formatCoins(displaySideBet) }} side</span>
            </div>
            <button type="button" class="lt-strip-btn" title="Halve every bet" :disabled="!canBetNow || (displayMainBet <= 0 && me!.lastBet <= 0)" @click="table.act({ t: 'scale', factor: 0.5 }); sound.play('chip')">½</button>
            <button type="button" class="lt-strip-btn" title="Double every bet" :disabled="!canBetNow || (displayMainBet <= 0 && me!.lastBet <= 0)" @click="table.act({ t: 'scale', factor: 2 }); sound.play('chip')">2×</button>
            <button type="button" class="lt-strip-btn" :disabled="!betting || me!.chips.length === 0" @click="table.act({ t: 'undo' })">Undo</button>
            <button type="button" class="lt-strip-btn clear" :disabled="!betting || me!.chips.length === 0" @click="table.act({ t: 'clear' })">Clear</button>
          </div>
          <button type="button" class="lt-hints-pill" :class="{ on: hints }" @click="toggleHints">
            <Lightbulb v-if="hints" class="size-3.5" /><LightbulbOff v-else class="size-3.5" />
            <span>Hints</span>
          </button>
        </div>

        <!-- Betting & Payout (goes straight back to betting) -->
        <template v-if="showBetDock">
          <div class="lt-touch-spots grid-cols-3">
            <button type="button" class="lt-touch-spot" :disabled="!betting || !me!.pendingBet" @click="place('perfectPairs')">
              PP<small>up to {{ PERFECT_PAIRS_PAYS.perfect }}:1</small>
              <span v-if="betting && me!.pendingSide.perfectPairs" class="amt">{{ formatCoins(me!.pendingSide.perfectPairs) }}</span>
            </button>
            <button type="button" class="lt-touch-spot !border-[var(--lt-gold)]" :disabled="!canBetNow" @click="place('main')">
              Bet<small>3:2 · 1:1</small>
              <span v-if="betting && me!.pendingBet" class="amt">{{ formatCoins(me!.pendingBet) }}</span>
            </button>
            <button type="button" class="lt-touch-spot" :disabled="!betting || !me!.pendingBet" @click="place('twentyOnePlusThree')">
              21+3<small>up to {{ TWENTY_ONE_PLUS_THREE_PAYS.suitedTrips }}:1</small>
              <span v-if="betting && me!.pendingSide.twentyOnePlusThree" class="amt">{{ formatCoins(me!.pendingSide.twentyOnePlusThree) }}</span>
            </button>
          </div>
          <div class="lt-chips-cta">
            <LiveTableRack v-model="chip" :available="available" :muted="!canBetNow" class="min-w-0 flex-1" />
            <div class="lt-cta-pair">
              <button
                type="button"
                class="lb-tile lb-tile-yellow lt-repeat-hero"
                :disabled="!canBetNow || me!.lastBet <= 0"
                @click="table.act({ t: 'repeat' }); sound.play('chip')"
              >
                REPEAT
              </button>
              <button
                type="button"
                class="lb-tile lb-tile-green lt-deal-hero"
                :disabled="!betting || me!.pendingBet <= 0 || mySeat.votedStart"
                @click="table.voteStart"
              >
                {{ mySeat.votedStart ? 'READY' : 'DEAL NOW' }}<span v-if="votes" class="ml-1 font-mono text-xs font-semibold opacity-80">{{ votes }}</span>
              </button>
            </div>
          </div>
        </template>

        <!-- Insurance -->
        <div v-else-if="offerInsurance" class="lt-ins-row">
          <p class="lt-hint-text">Dealer shows an <b>ace</b>. Insure for <b>{{ formatCoins(insuranceCost(me!.hands[0]!.bet)) }}</b>?</p>
          <div class="flex shrink-0 gap-2">
            <button type="button" class="lb-tile lb-tile-slate" :disabled="lock.locked.value" @click="insure(false)">NO THANKS</button>
            <button type="button" class="lb-tile lb-tile-yellow" :disabled="lock.locked.value || insuranceCost(me!.hands[0]!.bet) > coins" @click="insure(true)">INSURE<small>pays 2:1</small></button>
          </div>
        </div>

        <!-- Your Turn (directly below the betting strip) -->
        <div v-else-if="myTurn && activeHand" class="lt-actions bj-actions">
          <button type="button" class="lb-tile lb-tile-green" :class="{ 'lb-hint': hint === 'hit' }" :disabled="lock.locked.value" @click="play('hit')">
            <span v-if="hint === 'hit'" class="lb-best-tag">BEST</span>HIT
          </button>
          <button type="button" class="lb-tile lb-tile-blue" :class="{ 'lb-hint': hint === 'stand' }" :disabled="lock.locked.value" @click="play('stand')">
            <span v-if="hint === 'stand'" class="lb-best-tag">BEST</span>STAND
          </button>
          <button type="button" class="lb-tile lb-tile-yellow" :class="{ 'lb-hint': hint === 'double' }" :disabled="lock.locked.value || !canDouble(activeHand) || activeHand.bet > coins" @click="play('double')">
            <span v-if="hint === 'double'" class="lb-best-tag">BEST</span>DOUBLE<small>{{ formatCoins(activeHand.bet) }}</small>
          </button>
          <button type="button" class="lb-tile lb-tile-violet" :class="{ 'lb-hint': hint === 'split' }" :disabled="lock.locked.value || !canSplit(activeHand, me!.hands) || activeHand.bet > coins" @click="play('split')">
            <span v-if="hint === 'split'" class="lb-best-tag">BEST</span>SPLIT
          </button>
          <button type="button" class="lb-tile lb-tile-slate col-span-2 bj-surrender" :class="{ 'lb-hint': hint === 'surrender' }" :disabled="lock.locked.value || !canSurrender(activeHand, me!.hands)" @click="play('surrender')">
            <span v-if="hint === 'surrender'" class="lb-best-tag">BEST</span>SURRENDER<small>half back</small>
          </button>
        </div>

        <!-- Between decisions -->
        <LiveTableStake v-else :amount="0">
          <template v-if="phase === 'playing'">Waiting for <b>{{ seats[game?.activeSeat ?? -1]?.name ?? 'the table' }}</b></template>
          <template v-else-if="me?.hands.length">{{ phase === 'dealing' ? 'Cards are coming' : 'Dealer plays' }}</template>
          <template v-else>Betting opens with the next hand</template>
        </LiveTableStake>
      </template>
    </template>

    <template #rules>
      <p>Get closer to 21 than the dealer without going over. Six decks, the dealer stands on every 17. Blackjack pays 3 to 2, a win 1 to 1.</p>
      <p>Double on any first two cards (also after a split), split pairs up to four hands (split aces get one card each), surrender your first two cards for half your bet back. With an ace showing, insurance costs half your bet and pays 2 to 1.</p>
      <p>Side bets read your first two cards: Perfect Pairs pays 25:1 (same suit), 12:1 (same colour), 6:1 (mixed). 21+3 adds the dealer's upcard: suited trips 100:1, straight flush 40:1, three of a kind 30:1, straight 10:1, flush 5:1.</p>
      <p>Return to player about 99.6% with basic strategy; Perfect Pairs 93.9%, 21+3 95.4%.</p>
    </template>
  </LiveTableShell>
</template>

<style scoped>
.bj-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 640px) {
    .bj-actions .lb-tile { max-width: 170px; }
    .bj-actions .bj-surrender { max-width: 140px; font-size: 1rem; }
}
.bj-corner {
    opacity: 0.6;
    transition: opacity 0.15s ease;
}
.bj-corner:hover,
.bj-corner.open {
    opacity: 1;
}
</style>
