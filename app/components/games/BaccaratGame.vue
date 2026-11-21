<script setup lang="ts">
import { formatCoins } from '#shared/money'
import {
    BAC_PAYS, BAC_SPOTS, bacHandTotal, bacSpotReturn, bacTotal, bigRoadColumns,
    type BacAction, type BacRound, type BacSeat, type BacShared, type BacSpot
} from '#shared/tables/baccarat'
import type { Card } from '#shared/tables/cards'
import { cardBack, cardFace } from '~/utils/live-table/art'

const sound = useTableSound()
const table = useLiveTable<BacSeat, BacShared, BacAction>('baccarat')
const { state, mySeat, phase, connected } = table
const { coins } = useCasinoSession()
const chip = ref(100)

// ─── felt geometry, the old table's 1720-wide stage ─────────────────────────
const SEAT_POS = [
    { x: 222, y: 546 },
    { x: 541, y: 604 },
    { x: 860, y: 630 },
    { x: 1179, y: 604 },
    { x: 1498, y: 546 }
]
const SHOE_POS = { x: 1431, y: 196 }
const DISCARD_POS = { x: 289, y: 196 }
const PLAYER_HAND_POS = { x: 668, y: 196 }
const BANKER_HAND_POS = { x: 1052, y: 196 }
const HOUSE_POS = { x: 860, y: 300 }
const CHIP_SIZE = 64

/**
 * Player, Tie and Banker in a row with the pair bets above the side they ride
 * on. PLAYER, TIE and BANKER print under their ring, where a bet can't cover them.
 */
const SPOT_DEFS: { key: BacSpot, dx: number, dy: number, r: number, label: string, below: boolean }[] = [
    { key: 'playerPair', dx: -100, dy: -108, r: 42, label: 'P PAIR', below: false },
    { key: 'player', dx: -100, dy: 0, r: 52, label: 'PLAYER', below: true },
    { key: 'tie', dx: 0, dy: 0, r: 44, label: 'TIE', below: true },
    { key: 'banker', dx: 100, dy: 0, r: 52, label: 'BANKER', below: true },
    { key: 'bankerPair', dx: 100, dy: -108, r: 42, label: 'B PAIR', below: false }
]
const spotAt = (seat: number, def: { dx: number, dy: number }) => ({ x: SEAT_POS[seat]!.x + def.dx, y: SEAT_POS[seat]!.y + 106 + def.dy })

/** Cards fly in from the shoe and out to the discard tray along one vector per hand. */
function handStyle(pos: { x: number, y: number }) {
    return {
        'left': `${pos.x}px`,
        'top': `${pos.y}px`,
        '--deal-from': `translate(${SHOE_POS.x - pos.x}px, ${SHOE_POS.y - pos.y}px)`,
        '--discard-to': `translate(${DISCARD_POS.x - pos.x}px, ${DISCARD_POS.y - pos.y}px)`
    }
}

const seats = computed(() => state.value?.seats ?? [])
const me = computed(() => mySeat.value?.game ?? null)
const round = computed(() => state.value?.game.round ?? null)
const history = computed(() => state.value?.game.history ?? [])
const betting = computed(() => phase.value === 'betting' && !!me.value)
const available = computed(() => Math.max(0, coins.value - (me.value ? bacTotal(me.value.bets) : 0)))
const openSeat = computed(() => {
    const index = seats.value.findIndex(s => !s)
    return mySeat.value || index === -1 ? null : index
})

// ─── the reveal: cards land face down, then turn over one by one ─────────────
// Steps: 0-3 deal P1 B1 P2 B2 face down; 4-5 turn the player's two; 6-7 the
// banker's two; 8 the player's third; 9 the banker's third.
const step = ref(99)
let timers: ReturnType<typeof setTimeout>[] = []
const STEP_AT = [0, 150, 300, 450, 1_000, 1_400, 1_850, 2_250, 2_800, 3_400]

watch(() => round.value?.playerCards[0]?.id, (id, before) => {
    timers.forEach(clearTimeout)
    timers = []
    if (!id || (!before && phase.value !== 'dealing')) {
        step.value = 99
        return
    }
    step.value = -1
    STEP_AT.forEach((at, i) => timers.push(setTimeout(() => {
        step.value = i
        if (i < 4 || (i >= 8 && i <= 9)) sound.play('card')
        else sound.play('flip')
    }, at)))
    timers.push(setTimeout(() => (step.value = 99), 3_700))
})
onBeforeUnmount(() => timers.forEach(clearTimeout))

interface ShownCard { card: Card, up: boolean, third: boolean }
/** A hand as far as the reveal has got: undealt cards absent, unturned ones face down. */
function shown(cards: Card[], side: 'player' | 'banker'): ShownCard[] {
    const dealAt = side === 'player' ? [0, 2, 8] : [1, 3, 9]
    const turnAt = side === 'player' ? [4, 5, 8] : [6, 7, 9]
    return cards
        .filter((_, i) => step.value >= dealAt[i]!)
        .map((card, i) => ({ card, up: step.value >= turnAt[i]!, third: i === 2 }))
}
const playerCards = computed(() => (round.value ? shown(round.value.playerCards, 'player') : []))
const bankerCards = computed(() => (round.value ? shown(round.value.bankerCards, 'banker') : []))
const revealed = computed(() => !!round.value && step.value >= 99)
const winner = computed(() => (revealed.value ? round.value!.winner : null))
const total = (cards: ShownCard[]) => bacHandTotal(cards.filter(c => c.up).map(c => c.card))

/** A seat's chips on a spot: the bet while betting, the stake in play, then what it returned. */
function amountOn(seat: BacSeat, spot: BacSpot): number {
    if (phase.value === 'betting') return seat.bets[spot]
    if (revealed.value) return bacSpotReturn(spot, seat.staked[spot], round.value as BacRound)
    return seat.staked[spot]
}

function spotState(seat: BacSeat, spot: BacSpot): 'won' | 'lost' | null {
    if (!revealed.value || !seat.staked[spot]) return null
    return bacSpotReturn(spot, seat.staked[spot], round.value as BacRound) > seat.staked[spot] ? 'won' : bacSpotReturn(spot, seat.staked[spot], round.value as BacRound) === 0 ? 'lost' : null
}

// ─── chips crossing the felt once the hand is turned over ────────────────────
const flights = ref<{ fly: (from: { x: number, y: number }, to: { x: number, y: number }, amount: number, options?: { delay?: number, size?: number }) => void } | null>(null)
watch(revealed, (done) => {
    if (!done || !round.value) return
    seats.value.forEach((seat, index) => {
        if (!seat) return
        for (const def of SPOT_DEFS) {
            const stake = seat.game.staked[def.key]
            if (!stake) continue
            const back = bacSpotReturn(def.key, stake, round.value!)
            const spot = spotAt(index, def)
            if (back === 0) flights.value?.fly(spot, HOUSE_POS, stake, { size: 44 })
            else if (back > stake) flights.value?.fly(HOUSE_POS, spot, back - stake, { size: 44, delay: 450 })
        }
    })
    if (!me.value) return
    const staked = bacTotal(me.value.staked)
    if (!staked) return
    const back = BAC_SPOTS.reduce((sum, spot) => sum + bacSpotReturn(spot, me.value!.staked[spot], round.value!), 0)
    if (back !== staked) sound.play(back > staked ? 'win' : 'lose')
})

function place(spot: BacSpot) {
    if (!betting.value) return
    table.act({ t: 'bet', spot, amount: chip.value })
    sound.play('chip')
}

const votes = computed(() => {
    const seated = seats.value.filter(s => s && !s.leaving)
    return seated.length > 1 ? ` ${seated.filter(s => s!.votedStart).length}/${seated.length}` : ''
})

const phaseLabel = computed(() => {
    if (phase.value === 'betting') return 'PLACE YOUR BETS'
    if (winner.value) return winner.value === 'tie' ? 'TIE' : `${winner.value.toUpperCase()} WINS`
    if (round.value) return 'DEALING'
    return (state.value?.message ?? 'Waiting for players').toUpperCase()
})

const shoe = computed(() => state.value?.game.shoe ?? null)
const cardsLeft = computed(() => (shoe.value ? Math.max(0, shoe.value.total - shoe.value.dealt) : 0))
const pays = (spot: BacSpot) => `${BAC_PAYS[spot]}:1`
const bigRoad = computed(() => bigRoadColumns(history.value).slice(-20))
const CARD_BACK = cardBack()
</script>

<template>
  <LiveTableShell
    slug="baccarat"
    :connected="connected"
    :message="revealed || !round ? (state?.message ?? 'Connecting') : 'Dealing'"
    :seconds="table.secondsLeft.value"
    :progress="table.phaseProgress.value"
    :next-round-in="table.nextRoundIn.value"
    :watching="state?.watching ?? 0"
    :seated="!!mySeat"
    :leaving="!!mySeat?.leaving"
    :open-seat="openSeat"
    :feed="table.feed.value"
    :scoreboard="state?.scoreboard ?? []"
    @chat="table.chat"
    @leave="table.leave"
    @sit="table.sit"
  >
    <template #felt>
      <LiveTableStage>
        <!-- Shoe and discard: the trays every card is dealt from and swept to. -->
        <div class="lt-tray" :style="{ left: `${DISCARD_POS.x}px`, top: `${DISCARD_POS.y}px` }">
          <template v-if="(shoe?.dealt ?? 0) > 0">
            <span style="left: 16px; top: 14px" v-html="CARD_BACK" />
            <span style="left: 10px; top: 10px" v-html="CARD_BACK" />
          </template>
        </div>
        <div class="lt-tray-label" :style="{ left: `${DISCARD_POS.x}px`, top: `${DISCARD_POS.y + 98}px` }">Discard</div>
        <div class="lt-tray" :style="{ left: `${SHOE_POS.x}px`, top: `${SHOE_POS.y}px` }">
          <span style="left: 18px; top: 16px" v-html="CARD_BACK" />
          <span style="left: 14px; top: 13px" v-html="CARD_BACK" />
          <span style="left: 10px; top: 10px" v-html="CARD_BACK" />
          <div class="lt-shoe-cut" :style="{ top: `${20 + 136 * (1 - (shoe ? cardsLeft / shoe.total : 1))}px` }" />
        </div>
        <div class="lt-tray-label" :style="{ left: `${SHOE_POS.x}px`, top: `${SHOE_POS.y + 98}px` }">Shoe · {{ cardsLeft }}</div>

        <!-- Player and Banker: dealt face down, turned over one by one. -->
        <div class="bac-side player" :class="{ won: winner === 'player' }" :style="{ left: `${PLAYER_HAND_POS.x}px` }">PLAYER</div>
        <div class="bac-side banker" :class="{ won: winner === 'banker' }" :style="{ left: `${BANKER_HAND_POS.x}px` }">BANKER</div>
        <TransitionGroup v-for="side in (['player', 'banker'] as const)" :key="side" name="lt-deal" tag="div" class="lt-hand bac-hand" :style="handStyle(side === 'player' ? PLAYER_HAND_POS : BANKER_HAND_POS)">
          <span v-for="item in (side === 'player' ? playerCards : bankerCards)" :key="item.card.id" class="block">
            <span class="block" :class="{ 'bac-third': item.third }">
              <span class="lt-flip" :class="{ down: !item.up }">
                <span class="lt-flip-face" v-html="item.card.rank && item.card.suit ? cardFace(item.card.rank, item.card.suit) : CARD_BACK" />
                <span class="lt-flip-face lt-flip-back" v-html="CARD_BACK" />
              </span>
            </span>
          </span>
        </TransitionGroup>
        <template v-if="round && step >= 4">
          <div class="lt-badge" :class="winner ? (winner === 'tie' ? 'push' : winner === 'player' ? 'win' : 'lose') : ''" :style="{ left: `${PLAYER_HAND_POS.x}px`, top: '318px', fontSize: '24px' }">
            {{ total(playerCards) }}<span v-if="revealed && round.natural && round.playerTotal >= 8"> · NATURAL</span>
          </div>
          <div v-if="step >= 6" class="lt-badge" :class="winner ? (winner === 'tie' ? 'push' : winner === 'banker' ? 'win' : 'lose') : ''" :style="{ left: `${BANKER_HAND_POS.x}px`, top: '318px', fontSize: '24px' }">
            {{ total(bankerCards) }}<span v-if="revealed && round.natural && round.bankerTotal >= 8"> · NATURAL</span>
          </div>
        </template>

        <!-- The house's chips: winners are paid from here, losers swept back. -->
        <div class="lt-house-well" :style="{ left: `${HOUSE_POS.x}px`, top: `${HOUSE_POS.y + 6}px`, width: '150px' }" />
        <div class="lt-house" :style="{ left: `${HOUSE_POS.x}px`, top: `${HOUSE_POS.y + 10}px` }">
          <LiveTableChipPile :column="[5_000, 7]" :size="38" />
          <LiveTableChipPile :column="[100_000, 10]" :size="38" />
          <LiveTableChipPile :column="[1_000, 5]" :size="38" />
        </div>

        <div class="lt-rules" style="top: 372px">PLAYER PAYS 1:1 · BANKER PAYS 0.95:1 · TIE PAYS 8:1 · PAIRS PAY 11:1</div>
        <div class="lt-phase" style="top: 412px">
          <span class="label" :class="{ win: !!winner }">{{ phaseLabel }}</span>
          <template v-if="table.nextRoundIn.value !== null">
            <span class="next">NEXT HAND</span>
            <span class="count">{{ table.nextRoundIn.value }}</span>
          </template>
          <span v-else-if="table.secondsLeft.value !== null && phase === 'betting'" class="count" :class="{ urgent: table.secondsLeft.value <= 5 }">{{ table.secondsLeft.value }}</span>
        </div>

        <template v-for="(pos, i) in SEAT_POS" :key="i">
          <div v-if="!seats[i]" class="lt-sit" :class="{ taken: !!mySeat || !connected }" :style="{ left: `${pos.x}px`, top: `${pos.y + 106}px` }" @click="!mySeat && connected && table.sit(i)">
            <span class="lbl">SIT</span>
          </div>
          <template v-else>
            <div
              v-for="def in SPOT_DEFS"
              :key="def.key"
              class="lt-spot"
              :class="[
                spotState(seats[i]!.game, def.key) ?? '',
                { clickable: seats[i]!.playerId === table.me.value && betting, lit: winner && (def.key === winner || (def.key === 'playerPair' && round?.playerPair) || (def.key === 'bankerPair' && round?.bankerPair)) }
              ]"
              :style="{ left: `${spotAt(i, def).x}px`, top: `${spotAt(i, def).y}px`, width: `${def.r * 2}px`, height: `${def.r * 2}px`, margin: `${-def.r}px 0 0 ${-def.r}px` }"
              @click="seats[i]!.playerId === table.me.value && place(def.key)"
            >
              <span v-if="!def.below && !amountOn(seats[i]!.game, def.key)" class="lt-spot-label" style="font-size: 12px">{{ def.label }}</span>
              <LiveTableChipPile class="lt-spot-chips" :amount="amountOn(seats[i]!.game, def.key)" :size="def.r > 50 ? CHIP_SIZE : 54" :max="4" />
            </div>
            <div v-for="def in SPOT_DEFS.filter(d => d.below)" :key="`${def.key}-cap`" class="lt-cap" :style="{ left: `${spotAt(i, def).x}px`, top: `${spotAt(i, def).y + def.r + 14}px` }">
              {{ def.label }}
            </div>
            <div v-if="bacTotal(phase === 'betting' ? seats[i]!.game.bets : seats[i]!.game.staked)" class="lt-amt" :style="{ left: `${pos.x}px`, top: `${pos.y + 192}px` }">
              {{ formatCoins(bacTotal(phase === 'betting' ? seats[i]!.game.bets : seats[i]!.game.staked)) }}
            </div>
            <LiveTablePlate :seat="seats[i]!" :x="pos.x" :y="pos.y + 240" :mine="seats[i]!.playerId === table.me.value" :ready="phase === 'betting' && seats[i]!.votedStart" />
          </template>
        </template>

        <LiveTableCorner title="Roadmap">
          <div class="bac-road-label">Bead plate</div>
          <div class="bac-grid" style="--cell: 22px">
            <span v-for="(entry, idx) in history.slice(-60)" :key="idx" class="bac-dot" :class="`bac-fill-${entry.winner}`">
              {{ entry.winner === 'tie' ? 'T' : entry.winner === 'player' ? 'P' : 'B' }}
              <i v-if="entry.playerPair" class="pp" />
              <i v-if="entry.bankerPair" class="bp" />
            </span>
          </div>
          <div class="bac-road-label">Big road</div>
          <div class="flex gap-[3px]">
            <div v-for="(column, c) in bigRoad" :key="c" class="grid grid-rows-6 gap-[3px]">
              <span v-for="row in Math.min(6, column.rows)" :key="row" class="bac-ring" :class="`bac-ring-${column.result}`">
                <i v-if="row === Math.min(6, column.rows) && column.ties" class="tie" />
              </span>
            </div>
            <span v-if="!history.length" class="text-sm text-white/50">The roads fill as the shoe plays.</span>
          </div>
        </LiveTableCorner>

        <LiveTableChipFlights ref="flights" />
      </LiveTableStage>
    </template>

    <template #controls>
      <p v-if="!connected" class="lt-hint-text">Connecting…</p>
      <p v-else-if="!mySeat" class="lt-hint-text">Click an open <b>SIT</b> spot to join the table.</p>
      <template v-else-if="betting">
        <div class="lt-touch-spots grid-cols-6">
          <button type="button" class="lt-touch-spot col-span-2" @click="place('playerPair')">P Pair<small>{{ pays('playerPair') }}</small><span v-if="me!.bets.playerPair" class="amt">{{ formatCoins(me!.bets.playerPair) }}</span></button>
          <button type="button" class="lt-touch-spot col-span-2" @click="place('tie')">Tie<small>{{ pays('tie') }}</small><span v-if="me!.bets.tie" class="amt">{{ formatCoins(me!.bets.tie) }}</span></button>
          <button type="button" class="lt-touch-spot col-span-2" @click="place('bankerPair')">B Pair<small>{{ pays('bankerPair') }}</small><span v-if="me!.bets.bankerPair" class="amt">{{ formatCoins(me!.bets.bankerPair) }}</span></button>
          <button type="button" class="lt-touch-spot col-span-3 !border-sky-400/70" @click="place('player')">Player<small>{{ pays('player') }}</small><span v-if="me!.bets.player" class="amt">{{ formatCoins(me!.bets.player) }}</span></button>
          <button type="button" class="lt-touch-spot col-span-3 !border-red-400/70" @click="place('banker')">Banker<small>{{ pays('banker') }}</small><span v-if="me!.bets.banker" class="amt">{{ formatCoins(me!.bets.banker) }}</span></button>
        </div>
        <div class="flex items-stretch gap-2">
          <div class="lt-panel shrink-0">
            <span class="lt-panel-label">Your bet</span>
            <span class="lt-panel-value lt-mono">{{ formatCoins(bacTotal(me!.bets)) }}</span>
          </div>
          <LiveTableRack v-model="chip" :available="available" class="min-w-0 flex-1" />
        </div>
        <LiveTableBetBar
          :can-repeat="bacTotal(me!.lastBets) > 0"
          :can-scale="bacTotal(me!.bets) > 0 || bacTotal(me!.lastBets) > 0"
          :can-undo="me!.chips.length > 0"
          :can-clear="me!.chips.length > 0"
          :can-deal="bacTotal(me!.bets) > 0"
          :voted="mySeat.votedStart"
          :votes="votes"
          @repeat="table.act({ t: 'repeat' }); sound.play('chip')"
          @scale="factor => { table.act({ t: 'scale', factor }); sound.play('chip') }"
          @undo="table.act({ t: 'undo' })"
          @clear="table.act({ t: 'clear' })"
          @deal="table.voteStart"
        />
      </template>
      <p v-else class="lt-hint-text">
        <template v-if="winner && me && bacTotal(me.staked)">
          {{ winner === 'tie' ? 'Tie' : `${winner === 'player' ? 'Player' : 'Banker'} wins` }}.
          <b>{{ formatCoins(BAC_SPOTS.reduce((sum, spot) => sum + bacSpotReturn(spot, me!.staked[spot], round!), 0)) }}</b> back on {{ formatCoins(bacTotal(me.staked)) }}.
        </template>
        <template v-else-if="me && bacTotal(me.staked)">Your bets are in.</template>
        <template v-else>Betting opens with the next hand.</template>
      </p>
    </template>

    <template #rules>
      <p>Back the hand you think finishes closer to 9: Player or Banker, or a Tie. Cards count their pip value, tens and faces count zero, and only the last digit of the total counts (7 + 8 = 5).</p>
      <p>Both hands get two cards; a natural 8 or 9 stands. Otherwise the Player draws on 0-5 and the Banker draws by the fixed third-card table. Nobody makes a decision.</p>
      <p>Player pays 1:1, Banker 0.95:1 (a 5% commission), Tie 8:1, and Player and Banker bets come back on a tie. Player Pair and Banker Pair pay 11:1 when that hand's first two cards share a rank. Eight decks.</p>
      <p>Return to player: Banker 98.9%, Player 98.8%, Tie 85.6%, pairs 89.6%.</p>
    </template>
  </LiveTableShell>
</template>

<style scoped>
.bac-side {
    position: absolute;
    top: 82px;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    padding: 3px 18px;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.14em;
    color: #fff;
    transition: box-shadow 0.3s ease;
}
.bac-side.player { background: #2563eb; }
.bac-side.banker { background: #dc2626; }
.bac-side.won { box-shadow: 0 0 0 3px #fff, 0 0 26px 4px rgba(217, 177, 103, 0.8); }
.bac-hand > * + * { margin-left: -40px; }
/* The third card is drawn sideways, the way a baccarat dealer lays it. */
.bac-third { transform: rotate(90deg); margin: 0 22px; }

.bac-road-label {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--lt-gold);
    opacity: 0.8;
    margin: 8px 0 5px;
}
.bac-grid {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(6, var(--cell, 18px));
    grid-auto-columns: var(--cell, 18px);
    gap: 3px;
    overflow: hidden;
}
.bac-dot {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
    color: #fff;
}
.bac-dot .pp, .bac-dot .bp { position: absolute; width: 7px; height: 7px; border-radius: 999px; }
.bac-dot .pp { left: -1px; top: -1px; background: #bfdbfe; }
.bac-dot .bp { right: -1px; bottom: -1px; background: #fecaca; }
.bac-fill-banker { background: #dc2626; }
.bac-fill-player { background: #2563eb; }
.bac-fill-tie { background: #16a34a; }
.bac-ring {
    position: relative;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    border: 3px solid;
}
.bac-ring-banker { border-color: #f87171; }
.bac-ring-player { border-color: #60a5fa; }
.bac-ring .tie {
    position: absolute;
    left: 0;
    top: 50%;
    width: 100%;
    height: 2px;
    background: #4ade80;
    transform: rotate(-45deg);
}
</style>
