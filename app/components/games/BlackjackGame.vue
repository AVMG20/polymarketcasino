<script setup lang="ts">
import { Lightbulb, LightbulbOff } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import {
    basicStrategy, BJ_SIDE_BETS, canDouble, canSplit, canSurrender, insuranceCost,
    PERFECT_PAIRS_LABELS, PERFECT_PAIRS_PAYS, TWENTY_ONE_PLUS_THREE_LABELS, TWENTY_ONE_PLUS_THREE_PAYS,
    type BjAction, type BjHand, type BjSpot, type PerfectPairsTier, type TwentyOnePlusThreeTier
} from '#shared/tables/blackjack'
import type { BjGameEvent, BjSeat, BjShared, BjTableAction } from '#shared/tables/blackjack-wire'
import { buildTextures } from '~/utils/live-blackjack/art'
import { LiveBlackjackScene, STAGE_H, STAGE_W } from '~/utils/live-blackjack/scene'
import { safeDestroy } from '~/utils/slot-pixi'

const sound = useTableSound()
const table = useLiveTable<BjSeat, BjShared, BjTableAction>('blackjack', (payload) => {
    const event = payload as BjGameEvent
    if (event.type === 'action') scene?.flashAction(event.seat, event.action)
    if (event.type === 'side' && event.seat === mySeat.value?.index) sound.play('win')
})
const { state, mySeat, phase, connected } = table
const { coins } = useCasinoSession()
const chip = ref(100)

const seats = computed(() => state.value?.seats ?? [])
const game = computed(() => state.value?.game ?? null)
const me = computed(() => mySeat.value?.game ?? null)
const betting = computed(() => phase.value === 'betting' && !!me.value)
const sideTotal = computed(() => (me.value ? BJ_SIDE_BETS.reduce((sum, key) => sum + me.value!.pendingSide[key], 0) : 0))
const available = computed(() => Math.max(0, coins.value - (me.value ? me.value.pendingBet + sideTotal.value : 0)))
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
    if (!betting.value) return
    if (spot !== 'main' && !me.value!.pendingBet) return
    table.act({ t: 'bet', spot, amount: chip.value })
    sound.play('chip')
}

function play(action: BjAction) {
    table.act({ t: 'play', action })
    if (action === 'double' || action === 'split') sound.play('chip')
}

const votes = computed(() => {
    const seated = seats.value.filter(s => s && !s.leaving)
    return seated.length > 1 ? ` ${seated.filter(s => s!.votedStart).length}/${seated.length}` : ''
})

const shoe = computed(() => game.value?.shoe ?? null)
const cardsLeft = computed(() => (shoe.value ? Math.max(0, shoe.value.total - shoe.value.dealt) : 0))

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

/** What each seat made on the round that just ended, best first. */
const roundResults = computed(() => seats.value
    .filter(seat => !!seat && seat.lastNet !== null && seat.game.hands.length)
    .map(seat => ({
        playerId: seat!.playerId,
        name: seat!.name,
        image: seat!.image,
        net: seat!.lastNet!,
        blackjack: seat!.game.hands.some(hand => hand.status === 'blackjack'),
        sideWins: (seat!.game.sideResults ?? []).filter(result => result.payout > 0)
    }))
    .sort((a, b) => b.net - a.net))
const showRoundResults = computed(() => phase.value === 'payout' && roundResults.value.length > 0)

// ─── the Pixi table ──────────────────────────────────────────────────────────
const canvasWrap = ref<HTMLDivElement | null>(null)
let app: import('pixi.js').Application | null = null
let scene: LiveBlackjackScene | null = null
let destroyed = false

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
    if (destroyed) {
        safeDestroy(() => instance.destroy(true))
        return
    }
    app = instance
    app.canvas.style.width = '100%'
    app.canvas.style.height = '100%'
    app.canvas.style.display = 'block'
    canvasWrap.value?.appendChild(app.canvas)

    const textures = buildTextures(PIXI, app.renderer)
    scene = new LiveBlackjackScene(PIXI, app, textures, {
        onSit: seat => !mySeat.value && table.sit(seat),
        onPlace: spot => place(spot)
    })
    if (state.value) scene.update(state.value, table.me.value)
})

onBeforeUnmount(() => {
    destroyed = true
    scene?.destroy()
    scene = null
    const instance = app
    app = null
    if (instance) safeDestroy(() => instance.destroy(true, { children: true, texture: true }))
})

// ─── sound, off the same snapshots the table draws ──────────────────────────
const cardCount = computed(() => (game.value?.dealer.cards.length ?? 0) + seats.value.reduce((sum, s) => sum + (s?.game.hands.reduce((n, h) => n + h.cards.length, 0) ?? 0), 0))
const hiddenCount = computed(() => game.value?.dealer.cards.filter(c => c.hidden).length ?? 0)
watch([cardCount, hiddenCount], ([count, hidden], [before, hiddenBefore]) => {
    if (count > (before ?? 0)) sound.play('card')
    else if (hidden < (hiddenBefore ?? 0)) sound.play('flip')
})
watch(myTurn, turn => turn && sound.play('turn'))
watch(() => mySeat.value?.roundsPlayed, (played, before) => {
    if (!played || played === before) return
    const net = mySeat.value?.lastNet ?? 0
    if (net) sound.play(net > 0 ? 'win' : 'lose')
})
</script>

<template>
  <LiveTableShell
    slug="blackjack"
    :connected="connected"
    :message="state?.message ?? 'Connecting'"
    :seconds="table.secondsLeft.value"
    :progress="table.phaseProgress.value"
    :next-round-in="table.nextRoundIn.value"
    :watching="state?.watching ?? 0"
    :seated="!!mySeat"
    :leaving="!!mySeat?.leaving"
    :open-seat="openSeat"
    :aspect="STAGE_W / STAGE_H"
    :feed="table.feed.value"
    :scoreboard="state?.scoreboard ?? []"
    @chat="table.chat"
    @leave="table.leave"
    @sit="table.sit"
  >
    <template #felt>
      <div class="relative">
        <div ref="canvasWrap" class="w-full" :style="{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }" />

        <!-- Side-bet reference: top corner, dimmed and collapsed to its header. -->
        <div class="bj-corner absolute top-[4%] right-[5%] hidden max-w-[48%] rounded-xl bg-black/80 ring-1 ring-amber-400/25 backdrop-blur-sm md:block" :class="{ open: showSideBets }">
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

        <!-- What the round just paid, up between hands only. -->
        <Transition
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="-translate-x-3 opacity-0"
          leave-active-class="transition duration-200 ease-in"
          leave-to-class="-translate-x-3 opacity-0"
        >
          <div v-if="showRoundResults" class="absolute top-[4%] left-[5%] hidden w-[24%] min-w-52 rounded-xl bg-black/80 p-2.5 ring-1 ring-amber-400/25 backdrop-blur-sm md:block">
            <div class="mb-1.5 flex items-center justify-between border-b border-white/10 pb-1">
              <span class="text-xs font-bold tracking-wider text-amber-300 uppercase">Round results</span>
              <span class="text-[10px] text-white/50">Hand {{ state?.roundId }}</span>
            </div>
            <ul class="space-y-0.5">
              <li v-for="entry in roundResults" :key="entry.playerId" class="flex items-center gap-2 rounded-md px-1.5 py-1" :class="entry.playerId === table.me.value ? 'bg-amber-400/10 ring-1 ring-amber-400/30' : ''">
                <TableAvatar :name="entry.name" :image="entry.image" :size="20" />
                <div class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] font-semibold text-white">{{ entry.name }}</span>
                  <div v-if="entry.blackjack || entry.sideWins.length" class="flex flex-wrap gap-1">
                    <span v-if="entry.blackjack" class="rounded-sm bg-amber-500/20 px-1 text-[9px] font-bold text-amber-300 uppercase">Blackjack</span>
                    <span v-for="win in entry.sideWins" :key="win.key" class="rounded-sm bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-300">{{ win.label }}</span>
                  </div>
                </div>
                <span class="shrink-0 font-mono text-sm font-bold tabular-nums" :class="entry.net > 0 ? 'text-green-400' : entry.net < 0 ? 'text-red-400' : 'text-white/50'">
                  {{ entry.net > 0 ? '+' : entry.net < 0 ? '−' : '' }}{{ formatCoins(Math.abs(entry.net)) }}
                </span>
              </li>
            </ul>
          </div>
        </Transition>
      </div>
    </template>

    <template #controls>
      <p v-if="!connected" class="lt-hint-text">Connecting…</p>
      <p v-else-if="!mySeat" class="lt-hint-text">Click an open <b>SIT</b> spot to join the table.</p>

      <template v-else-if="betting">
        <div class="lt-touch-spots grid-cols-3">
          <button type="button" class="lt-touch-spot" :disabled="!me!.pendingBet" @click="place('perfectPairs')">
            PP<small>up to {{ PERFECT_PAIRS_PAYS.perfect }}:1</small>
            <span v-if="me!.pendingSide.perfectPairs" class="amt">{{ formatCoins(me!.pendingSide.perfectPairs) }}</span>
          </button>
          <button type="button" class="lt-touch-spot !border-[var(--lt-gold)]" @click="place('main')">
            Bet<small>3:2 · 1:1</small>
            <span v-if="me!.pendingBet" class="amt">{{ formatCoins(me!.pendingBet) }}</span>
          </button>
          <button type="button" class="lt-touch-spot" :disabled="!me!.pendingBet" @click="place('twentyOnePlusThree')">
            21+3<small>up to {{ TWENTY_ONE_PLUS_THREE_PAYS.suitedTrips }}:1</small>
            <span v-if="me!.pendingSide.twentyOnePlusThree" class="amt">{{ formatCoins(me!.pendingSide.twentyOnePlusThree) }}</span>
          </button>
        </div>
        <div class="flex items-stretch gap-2">
          <div class="lt-panel shrink-0">
            <span class="lt-panel-label">Your bet</span>
            <span class="lt-panel-value lt-mono">{{ formatCoins(me!.pendingBet) }}</span>
            <span v-if="sideTotal" class="text-[10px] text-white/55">+{{ formatCoins(sideTotal) }} side</span>
          </div>
          <LiveTableRack v-model="chip" :available="available" class="min-w-0 flex-1" />
        </div>
        <LiveTableBetBar
          :can-repeat="me!.lastBet > 0"
          :can-scale="me!.pendingBet > 0 || me!.lastBet > 0"
          :can-undo="me!.chips.length > 0"
          :can-clear="me!.chips.length > 0"
          :can-deal="me!.pendingBet > 0"
          :voted="mySeat.votedStart"
          :votes="votes"
          @repeat="table.act({ t: 'repeat' }); sound.play('chip')"
          @scale="factor => { table.act({ t: 'scale', factor }); sound.play('chip') }"
          @undo="table.act({ t: 'undo' })"
          @clear="table.act({ t: 'clear' })"
          @deal="table.voteStart"
        />
      </template>

      <div v-else-if="offerInsurance" class="rounded-xl bg-amber-500/15 p-2.5 text-center ring-2 ring-amber-400/70">
        <p class="mb-2 text-sm font-bold text-amber-200">Dealer shows an ace. Insure for {{ formatCoins(insuranceCost(me!.hands[0]!.bet)) }}?</p>
        <div class="mx-auto flex max-w-96 gap-2">
          <button type="button" class="lb-tile lb-tile-amber flex-1" :disabled="insuranceCost(me!.hands[0]!.bet) > coins" @click="table.act({ t: 'insurance', take: true }); sound.play('chip')">INSURANCE</button>
          <button type="button" class="lb-tile lb-tile-slate flex-1" @click="table.act({ t: 'insurance', take: false })">NO THANKS</button>
        </div>
      </div>

      <div v-else-if="myTurn && activeHand" class="grid grid-cols-2 gap-2 sm:flex">
        <button type="button" class="lb-tile lb-tile-green min-h-12 sm:flex-1" :class="{ 'lb-hint': hint === 'hit' }" @click="play('hit')">HIT</button>
        <button type="button" class="lb-tile lb-tile-blue min-h-12 sm:flex-1" :class="{ 'lb-hint': hint === 'stand' }" @click="play('stand')">STAND</button>
        <button type="button" class="lb-tile lb-tile-amber min-h-12 sm:flex-1" :class="{ 'lb-hint': hint === 'double' }" :disabled="!canDouble(activeHand) || activeHand.bet > coins" @click="play('double')">DOUBLE</button>
        <button type="button" class="lb-tile lb-tile-yellow min-h-12 sm:flex-1" :class="{ 'lb-hint': hint === 'split' }" :disabled="!canSplit(activeHand, me!.hands) || activeHand.bet > coins" @click="play('split')">SPLIT</button>
        <button type="button" class="lb-tile lb-tile-red col-span-2 min-h-12 sm:flex-1" :class="{ 'lb-hint': hint === 'surrender' }" :disabled="!canSurrender(activeHand, me!.hands)" @click="play('surrender')">SURRENDER</button>
      </div>

      <p v-else class="lt-hint-text">
        <template v-if="phase === 'playing'">Waiting for <b>{{ seats[game?.activeSeat ?? -1]?.name ?? 'the table' }}</b>.</template>
        <template v-else-if="me?.hands.length">Your hand is in.</template>
        <template v-else>{{ state?.message ?? 'Next round soon.' }}</template>
      </p>

    </template>

    <template #footer>
      <button v-if="mySeat" type="button" class="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 font-semibold transition" :class="hints ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/60' : 'bg-white/5 text-white/60 hover:bg-white/10'" @click="toggleHints">
        <Lightbulb v-if="hints" class="size-3.5" /><LightbulbOff v-else class="size-3.5" /> Hints {{ hints ? 'on' : 'off' }}
      </button>
      <div v-if="shoe" class="flex min-w-40 items-center gap-2">
        <span class="font-bold tracking-wider text-amber-300/80 uppercase">Shoe</span>
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div class="h-full bg-amber-400/70 transition-[width] duration-500" :style="{ width: `${Math.round((cardsLeft / shoe.total) * 100)}%` }" />
        </div>
        <span class="font-mono text-white/60 tabular-nums">{{ (cardsLeft / 52).toFixed(1) }}/{{ shoe.decks }} decks</span>
      </div>
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
.bj-corner {
    opacity: 0.6;
    transition: opacity 0.15s ease;
}
.bj-corner:hover,
.bj-corner.open {
    opacity: 1;
}
</style>
