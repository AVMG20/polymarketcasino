<script setup lang="ts">
import { formatCoins } from '#shared/money'
import type { Card } from '#shared/tables/cards'
import { CH_AA_TABLE, CH_ANTE_TABLE, CH_CALL_MULTIPLIER, type ChAction, type ChSeat, type ChShared, type ChSpot } from '#shared/tables/casino-holdem'
import { cardBack, cardFace } from '~/utils/live-table/art'

const sound = useTableSound()
const table = useLiveTable<ChSeat, ChShared, ChAction>('casino-holdem', undefined, seat => seat.ante + seat.aa + seat.call)
const { state, mySeat, phase, connected } = table
/** What the player can stake: coins first, then chips (the name stays for the checks below). */
const coins = useBankroll().total
const chip = ref(100)

// ─── felt geometry, the shared 1720-wide stage ──────────────────────────────
const SEAT_POS = [
    { x: 222, y: 546 },
    { x: 541, y: 604 },
    { x: 860, y: 630 },
    { x: 1179, y: 604 },
    { x: 1498, y: 546 }
]
/** Where a seat's hand sits above its betting spots. */
const HAND_DY = -55
const SPOT_DY = 112
const SPOT_DX = 98
const DEALER_POS = { x: 860, y: 150 }
const BOARD_POS = { x: 860, y: 326 }
const SHOE_POS = { x: 1431, y: 170 }
const DISCARD_POS = { x: 289, y: 170 }
const HOUSE_POS = { x: 470, y: 352 }
/** One board slot: a card and its gap, at the board's 0.86 scale. */
const BOARD_STEP = (112 + 10) * 0.86
const DEAL_STAGGER_MS = 140
/** The three spots under every seat, left to right. */
const SPOTS = ['aa', 'ante', 'call'] as const
type Leg = typeof SPOTS[number]
const SPOT_LABEL: Record<Leg, string> = { aa: 'AA Bonus', ante: 'Ante', call: 'Call' }

const seats = computed(() => state.value?.seats ?? [])
const me = computed(() => mySeat.value?.game ?? null)
const shared = computed(() => state.value?.game ?? null)
const betting = computed(() => phase.value === 'betting' && !!me.value)
const available = computed(() => Math.max(0, coins.value - (me.value ? me.value.pendingAnte + me.value.pendingAa : 0)))
const deciding = computed(() => phase.value === 'decision' && !!me.value?.cards.length && !me.value.decision)
const showdown = computed(() => phase.value === 'reveal' || phase.value === 'payout')
const openSeat = computed(() => {
    const index = seats.value.findIndex(s => !s)
    return mySeat.value || index === -1 ? null : index
})

const pos = (x: number, y: number) => ({ left: `${x}px`, top: `${y}px` })

/** Cards fly in from the shoe and out to the discard tray along one vector per hand. */
function handStyle(x: number, y: number) {
    return {
        'left': `${x}px`,
        'top': `${y}px`,
        '--deal-from': `translate(${SHOE_POS.x - x}px, ${SHOE_POS.y - y}px)`,
        '--discard-to': `translate(${DISCARD_POS.x - x}px, ${DISCARD_POS.y - y}px)`
    }
}

/** The opening deal goes round the table a card at a time, the dealer last, then the flop. */
const dealOrder = computed(() => seats.value.filter(s => s?.game.cards.length).map(s => s!.index))
function dealDelay(seatIndex: number, cardIndex: number) {
    if (phase.value !== 'deal') return '0ms'
    const order = dealOrder.value
    const position = seatIndex < 0 ? order.length : Math.max(0, order.indexOf(seatIndex))
    return `${(cardIndex * (order.length + 1) + position) * DEAL_STAGGER_MS}ms`
}
function boardDelay(i: number) {
    if (phase.value === 'deal') return `${(2 * (dealOrder.value.length + 1) + i) * DEAL_STAGGER_MS}ms`
    if (phase.value === 'board') return `${Math.max(0, i - 3) * 450}ms`
    return '0ms'
}

const CARD_BACK = cardBack()
const face = (card: Card) => (card.rank && card.suit ? cardFace(card.rank, card.suit) : '')

/** What a seat has on a spot: the pending bet while betting, the stake after. */
function staked(seat: ChSeat, spot: Leg): number {
    if (spot === 'aa') return seat.aa || seat.pendingAa
    if (spot === 'ante') return seat.ante || seat.pendingAnte
    return seat.call
}
/** The chips standing on a spot: a lost leg's are gone once the house has swept them. */
function onSpot(seat: ChSeat, spot: Leg): number {
    return phase.value === 'payout' && legState(seat, spot) === 'lost' ? 0 : staked(seat, spot)
}

/** How a leg did at the showdown. A dealer who doesn't qualify pushes the call. */
function legState(seat: ChSeat, spot: Leg): 'won' | 'lost' | null {
    if (!showdown.value || !seat.outcome || !staked(seat, spot)) return null
    if (spot === 'aa') return seat.aaMultiplier ? 'won' : 'lost'
    if (seat.outcome === 'folded' || seat.outcome === 'lose') return 'lost'
    if (seat.outcome === 'push') return null
    if (spot === 'call' && shared.value?.dealer.qualified === false) return null
    return 'won'
}

function badgeFor(seat: ChSeat): { text: string, tone: string } | null {
    if (showdown.value && seat.outcome && seat.net !== null) {
        if (seat.outcome === 'folded') return { text: seat.net > 0 ? `FOLD +${formatCoins(seat.net)}` : 'FOLD', tone: 'lose' }
        if (seat.net === 0) return { text: 'PUSH', tone: 'push' }
        return { text: `${seat.net > 0 ? 'WIN' : 'LOSE'} ${seat.net > 0 ? '+' : '−'}${formatCoins(Math.abs(seat.net))}`, tone: seat.net > 0 ? 'win' : 'lose' }
    }
    if (seat.decision === 'call') return { text: 'CALL', tone: 'gold' }
    if (seat.decision === 'fold') return { text: 'FOLD', tone: 'lose' }
    return null
}

function place(spot: ChSpot) {
    if (!betting.value) return
    if (spot === 'aa' && !me.value!.pendingAnte) return
    table.act({ t: 'bet', spot, amount: chip.value })
    sound.play('chip')
}

// One decision per snapshot: a double tap would be refused by the server.
const lock = useActionLock(() => `${phase.value}|${JSON.stringify(me.value)}`)
function decide(call: boolean) {
    if (!lock.run(() => table.act({ t: 'decide', call }))) return
    if (call) sound.play('chip')
}

const votes = computed(() => {
    const seated = seats.value.filter(s => s && !s.leaving)
    return seated.length > 1 ? ` ${seated.filter(s => s!.votedStart).length}/${seated.length}` : ''
})

const phaseLabel = computed(() => {
    if (showdown.value) return 'SHOWDOWN'
    return ({ betting: 'PLACE YOUR BETS', deal: 'DEALING', decision: 'CALL OR FOLD', board: 'TURN AND RIVER' } as Record<string, string>)[phase.value] ?? (state.value?.message ?? 'Waiting').toUpperCase()
})
const myTone = computed(() => {
    const net = me.value?.net
    if (!showdown.value || !net) return ''
    return net > 0 ? 'win' : 'lose'
})

// ─── chips crossing the felt at the showdown ──────────────────────────────────
const flights = ref<{ fly: (from: { x: number, y: number }, to: { x: number, y: number }, amount: number, options?: { delay?: number, size?: number }) => void } | null>(null)
let settledRound = -1
watch(() => [phase.value, state.value?.roundId] as const, ([now, roundId]) => {
    if (now !== 'reveal' || roundId === undefined || roundId === settledRound) return
    settledRound = roundId
    seats.value.forEach((seat, index) => {
        const g = seat?.game
        if (!g?.outcome || g.net === null) return
        const { x, y } = SEAT_POS[index]!
        const at = (spot: Leg) => ({ x: x + (SPOTS.indexOf(spot) - 1) * SPOT_DX, y: y + SPOT_DY })
        // Lost legs go to the house; whatever the house pays on top lands on the ante.
        let lost = 0
        for (const spot of SPOTS) {
            if (legState(g, spot) !== 'lost') continue
            lost += staked(g, spot)
            flights.value?.fly(at(spot), HOUSE_POS, staked(g, spot), { size: 48, delay: 700 })
        }
        const paid = g.net + lost
        if (paid > 0) flights.value?.fly(HOUSE_POS, at(g.aaMultiplier && g.outcome !== 'win' ? 'aa' : 'ante'), paid, { size: 48, delay: 1_200 })
    })
})

watch(phase, (now) => {
    if (now === 'deal' || now === 'board') sound.play('card')
    if (now === 'reveal') sound.play('flip')
    if (now === 'decision' && me.value?.cards.length) sound.play('turn')
})
watch(() => mySeat.value?.roundsPlayed, (played, before) => {
    if (!played || played === before) return
    const net = mySeat.value?.lastNet ?? 0
    if (net) sound.play(net > 0 ? 'win' : 'lose')
})

const anteRows = CH_ANTE_TABLE.map(row => ({ label: row.label, pays: `${row.pays}:1` }))
const aaRows = CH_AA_TABLE.map(row => ({ label: row.label, pays: `${row.pays}:1` }))
const outcomeLabel = { win: 'YOU WIN', lose: 'DEALER WINS', push: 'PUSH', folded: 'FOLDED' }
</script>

<template>
  <LiveTableShell
    slug="casino-holdem"
    :connected="connected"
    :message="state?.message ?? 'Connecting'"
    :clock="table.clock.value"
    :watching="state?.watching ?? 0"
    :seated="!!mySeat"
    :leaving="!!mySeat?.leaving"
    :open-seat="openSeat"
    :feed="table.feed.value"
    :scoreboard="state?.scoreboard ?? []"
    tone="blue"
    :can-sit="table.canSit.value"
    :players="seats.filter(Boolean).length"
    :win="table.win.value"
    :send-chat="table.chat"
    @leave="table.leave"
    @sit="table.sit"
    @build="table.build"
  >
    <template #felt>
      <LiveTableStage tone="blue">
        <LiveTableCorner title="Paytables">
          <div class="ch-paytable-title">Ante</div>
          <LiveTablePaytable :rows="anteRows" :head="['Hand', 'Pays']" />
          <div class="ch-paytable-title mt-3 border-t border-[rgba(217,177,103,0.25)] pt-3">AA bonus</div>
          <LiveTablePaytable :rows="aaRows" :head="['Hand', 'Pays']" />
        </LiveTableCorner>

        <div class="lt-tray" :style="pos(DISCARD_POS.x, DISCARD_POS.y)">
          <span v-if="state?.roundId && state.roundId > 1" style="left: 12px; top: 10px" v-html="CARD_BACK" />
        </div>
        <div class="lt-tray-label" :style="pos(DISCARD_POS.x, DISCARD_POS.y + 98)">Discard</div>
        <div class="lt-tray" :style="pos(SHOE_POS.x, SHOE_POS.y)">
          <span style="left: 16px; top: 14px" v-html="CARD_BACK" />
          <span style="left: 12px; top: 10px" v-html="CARD_BACK" />
        </div>
        <div class="lt-tray-label" :style="pos(SHOE_POS.x, SHOE_POS.y + 98)">Shoe</div>

        <!-- The house's chips: winners are paid from here, losers swept back. -->
        <div class="lt-house-well" :style="{ ...pos(HOUSE_POS.x, HOUSE_POS.y + 6), width: '150px' }" />
        <div class="lt-house" :style="pos(HOUSE_POS.x, HOUSE_POS.y + 10)">
          <LiveTableChipPile :column="[1_000, 6]" :size="38" />
          <LiveTableChipPile :column="[25_000, 9]" :size="38" />
          <LiveTableChipPile :column="[5_000, 7]" :size="38" />
        </div>

        <!-- The dealer's two cards: face down until the showdown. -->
        <TransitionGroup name="lt-deal" tag="div" class="lt-hand ch-hand ch-small" :style="handStyle(DEALER_POS.x, DEALER_POS.y)">
          <span v-for="(card, i) in shared?.dealer.cards ?? []" :key="card.id" class="block" :style="{ transitionDelay: dealDelay(-1, i) }">
            <span class="lt-flip" :class="{ down: !card.rank }" :style="{ transitionDelay: `${i * 160}ms` }">
              <span class="lt-flip-face" v-html="face(card)" />
              <span class="lt-flip-face lt-flip-back" v-html="CARD_BACK" />
            </span>
          </span>
        </TransitionGroup>
        <div v-if="shared?.dealer.label" class="ch-strength" :class="myTone" :style="pos(DEALER_POS.x, 236)">
          {{ shared.dealer.label }}<span v-if="shared.dealer.qualified === false" class="ch-nq"> · does not qualify</span>
        </div>

        <!-- The board: the flop with the hole cards, the turn and river after the call. -->
        <div class="ch-board" :style="pos(BOARD_POS.x, BOARD_POS.y)">
          <span v-for="n in 5" :key="n" class="ch-slot" />
        </div>
        <TransitionGroup name="lt-deal" tag="div" class="lt-hand ch-board-cards ch-small" :style="handStyle(BOARD_POS.x - (5 - (shared?.board.length ?? 0)) * BOARD_STEP / 2, BOARD_POS.y)">
          <span v-for="(card, i) in shared?.board ?? []" :key="card.id" class="block" :style="{ transitionDelay: boardDelay(i) }">
            <span class="lt-flip" :class="{ down: !card.rank }">
              <span class="lt-flip-face" v-html="face(card)" />
              <span class="lt-flip-face lt-flip-back" v-html="CARD_BACK" />
            </span>
          </span>
        </TransitionGroup>

        <div class="lt-rules" style="top: 412px">DEALER QUALIFIES WITH A PAIR OF FOURS OR BETTER</div>
        <LiveTablePhase
          :label="phaseLabel"
          :tone="myTone"
          :top="436"
          :clock="table.clock.value"
          :timed="phase !== 'deal'"
        />

        <template v-for="(p, i) in SEAT_POS" :key="i">
          <LiveTableSit v-if="!seats[i]" :x="p.x" :y="p.y + SPOT_DY" :mode="!!mySeat || !connected ? 'taken' : table.canSit.value ? 'open' : 'locked'" @sit="table.canSit.value ? table.sit(i) : table.build()" />
          <template v-else>
            <TransitionGroup name="lt-deal" tag="div" class="lt-hand ch-hand" :class="{ dim: seats[i]!.game.decision === 'fold' }" :style="handStyle(p.x, p.y + HAND_DY)">
              <span v-for="(card, c) in seats[i]!.game.cards" :key="card.id" class="block" :style="{ transitionDelay: dealDelay(i, c) }">
                <span class="lt-flip" :class="{ down: !card.rank }">
                  <span class="lt-flip-face" v-html="face(card)" />
                  <span class="lt-flip-face lt-flip-back" v-html="CARD_BACK" />
                </span>
              </span>
            </TransitionGroup>
            <div v-if="seats[i]!.game.handLabel && (showdown || seats[i]!.playerId === table.me.value)" class="ch-strength" :style="pos(p.x, p.y + 38)">{{ seats[i]!.game.handLabel }}</div>
            <div v-if="badgeFor(seats[i]!.game)" class="lt-badge pop inline-flex items-center gap-1.5" :class="badgeFor(seats[i]!.game)!.tone" :style="pos(p.x, p.y - 150)">
              {{ badgeFor(seats[i]!.game)!.text }}<CasinoChipIcon v-if="badgeFor(seats[i]!.game)!.tone === 'win'" class="size-6" />
            </div>

            <div v-for="(spot, s) in SPOTS" :key="`${spot}-cap`" class="lt-cap" :style="pos(p.x + (s - 1) * SPOT_DX, p.y + SPOT_DY - 52)">{{ SPOT_LABEL[spot] }}</div>
            <div
              v-for="(spot, s) in SPOTS"
              :key="spot"
              class="lt-spot ch-spot"
              :class="[legState(seats[i]!.game, spot) ?? '', { clickable: spot !== 'call' && seats[i]!.playerId === table.me.value && betting, pulse: spot === 'call' && phase === 'decision' && !!seats[i]!.game.cards.length && !seats[i]!.game.decision }]"
              :style="pos(p.x + (s - 1) * SPOT_DX, p.y + SPOT_DY)"
              @click="spot !== 'call' && seats[i]!.playerId === table.me.value && place(spot)"
            >
              <LiveTableChipPile class="lt-spot-chips" :amount="onSpot(seats[i]!.game, spot)" :size="60" :max="4" />
            </div>
            <div v-for="(spot, s) in SPOTS" v-show="onSpot(seats[i]!.game, spot) > 0" :key="`${spot}-amt`" class="lt-amt" :style="pos(p.x + (s - 1) * SPOT_DX, p.y + SPOT_DY + 58)">
              {{ formatCoins(onSpot(seats[i]!.game, spot)) }}
            </div>
            <LiveTablePlate :seat="seats[i]!" :x="p.x" :y="p.y + 230" :mine="seats[i]!.playerId === table.me.value" :turn="phase === 'decision' && !!seats[i]!.game.cards.length && !seats[i]!.game.decision" :ready="phase === 'betting' && seats[i]!.votedStart" />
          </template>
        </template>

        <LiveTableChipFlights ref="flights" />
      </LiveTableStage>
    </template>

    <template #controls>
      <template v-if="!connected || !mySeat" />
      <template v-else-if="betting">
        <div class="lt-touch-spots grid-cols-2">
          <button type="button" class="lt-touch-spot" :disabled="!me!.pendingAnte" @click="place('aa')">AA Bonus<small>up to {{ CH_AA_TABLE[0]!.pays }}:1</small><span v-if="me!.pendingAa" class="amt">{{ formatCoins(me!.pendingAa) }}</span></button>
          <button type="button" class="lt-touch-spot !border-[#ffd36b]" @click="place('ante')">Ante<small>by paytable</small><span v-if="me!.pendingAnte" class="amt">{{ formatCoins(me!.pendingAnte) }}</span></button>
        </div>
        <div class="flex items-stretch gap-2">
          <div class="lt-panel shrink-0">
            <span class="lt-panel-label">Ante</span>
            <span class="lt-panel-value">{{ formatCoins(me!.pendingAnte) }}</span>
            <span v-if="me!.pendingAa" class="text-[10px] text-white/55">+{{ formatCoins(me!.pendingAa) }} AA</span>
          </div>
          <LiveTableRack v-model="chip" :available="available" class="min-w-0 flex-1" />
        </div>
        <LiveTableBetBar
          :can-repeat="me!.lastAnte > 0"
          :can-scale="me!.pendingAnte > 0 || me!.lastAnte > 0"
          :can-undo="me!.chips.length > 0"
          :can-clear="me!.chips.length > 0"
          :can-deal="me!.pendingAnte > 0"
          :voted="mySeat.votedStart"
          :votes="votes"
          @repeat="table.act({ t: 'repeat' }); sound.play('chip')"
          @scale="factor => { table.act({ t: 'scale', factor }); sound.play('chip') }"
          @undo="table.act({ t: 'undo' })"
          @clear="table.act({ t: 'clear' })"
          @deal="table.voteStart"
        />
      </template>

      <template v-else-if="deciding">
        <p class="lt-hint-text"><template v-if="me!.handLabel">You have <b>{{ me!.handLabel }}</b>. </template>Call for {{ formatCoins(me!.ante * CH_CALL_MULTIPLIER) }}, or fold your ante.</p>
        <div class="lt-actions">
          <button type="button" class="lb-tile lb-tile-red" :disabled="lock.locked.value" @click="decide(false)">FOLD<small>lose the ante</small></button>
          <button type="button" class="lb-tile lb-tile-green" :disabled="lock.locked.value || me!.ante * CH_CALL_MULTIPLIER > coins" @click="decide(true)">CALL<small>{{ formatCoins(me!.ante * CH_CALL_MULTIPLIER) }}</small></button>
        </div>
      </template>

      <div v-else-if="showdown && me?.outcome" class="flex flex-col items-center gap-1">
        <span class="lt-result" :class="myTone || (me.outcome === 'push' ? 'push' : '')">
          {{ outcomeLabel[me.outcome] }}<span v-if="me.net" class="ml-2">{{ me.net > 0 ? '+' : '−' }}{{ formatCoins(Math.abs(me.net)) }}</span><CasinoChipIcon v-if="(me.net ?? 0) > 0" />
        </span>
        <span class="text-xs text-white/60">
          <template v-if="me.handLabel && me.outcome !== 'folded'">{{ me.handLabel }}</template>
          <template v-if="me.aaMultiplier"> · AA bonus {{ me.aaLabel }} pays {{ me.aaMultiplier }}:1</template>
        </span>
      </div>

      <p v-else class="lt-hint-text">
        <template v-if="me?.cards.length">{{ me.decision ? `You ${me.decision === 'call' ? 'called' : 'folded'}. Waiting for the table.` : 'Cards are coming.' }}</template>
        <template v-else>Betting opens with the next hand.</template>
      </p>
    </template>

    <template #rules>
      <p>Put down an ante (and the AA bonus if you like, up to your ante). You get two cards and the flop comes out. Then call (twice your ante) or fold your ante. The turn and river follow and you make your best five cards against the dealer's.</p>
      <p>The dealer needs a pair of fours or better to qualify. If not, the ante pays by the paytable and the call comes back. If so and you win, the ante pays by the paytable and the call 1:1; a tie pushes both.</p>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <p class="font-semibold">Ante</p>
          <p v-for="row in CH_ANTE_TABLE" :key="row.label" class="flex justify-between gap-2 text-muted-foreground"><span>{{ row.label }}</span><span class="font-mono">{{ row.pays }}:1</span></p>
        </div>
        <div>
          <p class="font-semibold">AA bonus</p>
          <p v-for="row in CH_AA_TABLE" :key="row.label" class="flex justify-between gap-2 text-muted-foreground"><span>{{ row.label }}</span><span class="font-mono">{{ row.pays }}:1</span></p>
        </div>
      </div>
      <p>The AA bonus reads your two cards and the flop, and pays even if you fold. Return to player about 97.8% of the ante with good play (fold about one hand in five), AA bonus 93.7%.</p>
    </template>
  </LiveTableShell>
</template>

<style scoped>
.ch-hand > * + * { margin-left: -40px; }
/* The dealer's cards and the board sit a little smaller, so the middle of the felt breathes. */
.ch-small { scale: 0.86; }
.ch-board-cards > * + * { margin-left: 10px; }
.ch-board {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    gap: 10px;
    padding: 10px;
    border-radius: 18px;
    border: 2.5px solid rgb(240 200 120 / 0.3);
    background: rgb(0 0 0 / 0.12);
    scale: 0.86;
    pointer-events: none;
}
.ch-slot {
    width: 112px;
    height: 156px;
    border-radius: 9px;
    border: 2px dashed rgb(240 200 120 / 0.22);
}
.lt-spot.ch-spot {
    width: 84px;
    height: 84px;
    margin: -42px 0 0 -42px;
}
.lt-spot.ch-spot.pulse {
    border-color: rgb(255 214 120 / 0.9);
    animation: ch-pulse 1.3s ease-in-out infinite;
}
@keyframes ch-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgb(255 214 120 / 0.5); }
    50% { box-shadow: 0 0 20px 6px rgb(255 214 120 / 0.45); }
}
.ch-strength {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    padding: 2px 14px;
    background: rgb(20 10 5 / 0.8);
    box-shadow: 0 3px 0 rgb(0 0 0 / 0.4);
    font-family: var(--font-game);
    font-size: 20px;
    letter-spacing: 0.03em;
    color: #ffe9b0;
    white-space: nowrap;
    pointer-events: none;
    z-index: 3;
}
.ch-strength.win { color: #fff; text-shadow: 0 0 12px rgb(255 196 40 / 0.9); }
.ch-strength.lose { color: rgb(255 247 234 / 0.6); }
.ch-nq { color: #ffb4b4; }
.ch-paytable-title {
    margin: 0 0 6px;
    font-family: var(--font-game);
    font-size: 16px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--lt-gold);
    opacity: 0.85;
}

@media (prefers-reduced-motion: reduce) {
    .lt-spot.ch-spot.pulse { animation: none; }
}
</style>
