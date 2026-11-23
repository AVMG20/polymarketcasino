<script setup lang="ts">
import { formatCoins, sumCoins } from '#shared/money'
import {
    BAC_PAYS, BAC_SPOTS, bacHandTotal, bacSpotReturn, bacTotal, bigRoadColumns,
    type BacAction, type BacRound, type BacSeat, type BacShared, type BacSpot
} from '#shared/tables/baccarat'
import type { Card } from '#shared/tables/cards'
import { cardBack, cardFace } from '~/utils/live-table/art'

const sound = useTableSound()
const table = useLiveTable<BacSeat, BacShared, BacAction>('baccarat', undefined, seat => bacTotal(seat.staked))
const { state, mySeat, phase, connected } = table
/** What the player can stake: coins first, then chips (the name stays for the checks below). */
const coins = useBankroll().total
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
/**
 * The hands grow outward from the middle, where the house's chips sit between
 * them: the Player's inner edge at 770, the Banker's at 950. A third card is
 * laid sideways on the outer end, so it never reaches the chips.
 */
const HAND_Y = 196
const PLAYER_EDGE = 770
const BANKER_EDGE = 950
/** Centre x of each card as laid (two upright, the third sideways). */
const CARD_X = { player: [714, 642, 548], banker: [1006, 1078, 1172] } as const
/** Over the two upright cards: where the side's name and total sit. */
const PLAYER_HAND_POS = { x: 678, y: HAND_Y }
const BANKER_HAND_POS = { x: 1042, y: HAND_Y }
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

/** Each card flies in from the shoe along an arc and out to the discard tray, from where it lies. */
function cardStyle(side: 'player' | 'banker', i: number) {
    const x = CARD_X[side][Math.min(i, 2)]!
    const dx = SHOE_POS.x - x
    const dy = SHOE_POS.y - HAND_Y
    return {
        '--deal-from': `translate(${dx}px, ${dy}px)`,
        '--deal-mid': `translate(${Math.round(dx * 0.4)}px, ${Math.round(dy * 0.4 - 70)}px)`,
        '--discard-to': `translate(${DISCARD_POS.x - x}px, ${DISCARD_POS.y - HAND_Y}px)`
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

/** What the revealed hand returns on your bets, less what they cost. */
const myNet = computed(() => {
    if (!me.value || !round.value) return 0
    const back = sumCoins(BAC_SPOTS.map(spot => bacSpotReturn(spot, me.value!.staked[spot], round.value!)))
    return sumCoins([back, -bacTotal(me.value.staked)])
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
    :clock="table.clock.value"
    :watching="state?.watching ?? 0"
    :seated="!!mySeat"
    :leaving="!!mySeat?.leaving"
    :open-seat="openSeat"
    :feed="table.feed.value"
    :scoreboard="state?.scoreboard ?? []"
    tone="red"
    :can-sit="table.canSit.value"
    :players="seats.filter(Boolean).length"
    :win="table.win.value"
    :send-chat="table.chat"
    @leave="table.leave"
    @sit="table.sit"
    @build="table.build"
  >
    <template #felt>
      <LiveTableStage tone="red" :focus="mySeat ? SEAT_POS[mySeat.index]!.x : null" :camera="{ span: 0.78, tall: 0.9, top: 0.045 }">
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
        <div v-for="side in (['player', 'banker'] as const)" v-show="winner === side || winner === 'tie'" :key="`${side}-glow`" class="bac-glow" :class="winner === 'tie' ? 'tie' : side" :style="{ left: `${side === 'player' ? PLAYER_HAND_POS.x - 40 : BANKER_HAND_POS.x + 40}px`, top: `${HAND_Y}px` }" />
        <div class="bac-side player" :class="{ won: winner === 'player' }" :style="{ left: `${PLAYER_HAND_POS.x}px` }">PLAYER</div>
        <div class="bac-side banker" :class="{ won: winner === 'banker' }" :style="{ left: `${BANKER_HAND_POS.x}px` }">BANKER</div>
        <TransitionGroup
          v-for="side in (['player', 'banker'] as const)"
          :key="side"
          name="lt-deal"
          tag="div"
          class="lt-hand bac-hand"
          :class="[side, { lost: winner && winner !== side && winner !== 'tie' }]"
          :style="{ left: `${side === 'player' ? PLAYER_EDGE : BANKER_EDGE}px`, top: `${HAND_Y}px` }"
        >
          <span v-for="(item, i) in (side === 'player' ? playerCards : bankerCards)" :key="item.card.id" class="block" :style="cardStyle(side, i)">
            <span class="block" :class="{ 'bac-third': item.third }">
              <span class="lt-flip" :class="{ down: !item.up }">
                <span class="lt-flip-face" v-html="item.card.rank && item.card.suit ? cardFace(item.card.rank, item.card.suit) : CARD_BACK" />
                <span class="lt-flip-face lt-flip-back" v-html="CARD_BACK" />
              </span>
            </span>
          </span>
        </TransitionGroup>
        <template v-if="round && step >= 4">
          <div :key="`p${total(playerCards)}${winner}`" class="lt-badge bac-total lt-tick" :class="winner ? (winner === 'tie' ? 'push' : winner === 'player' ? 'win' : 'lose') : ''" :style="{ left: `${PLAYER_HAND_POS.x}px`, top: '318px' }">
            {{ total(playerCards) }}<span v-if="revealed && round.natural && round.playerTotal >= 8"> · NATURAL</span>
          </div>
          <div v-if="step >= 6" :key="`b${total(bankerCards)}${winner}`" class="lt-badge bac-total lt-tick" :class="winner ? (winner === 'tie' ? 'push' : winner === 'banker' ? 'win' : 'lose') : ''" :style="{ left: `${BANKER_HAND_POS.x}px`, top: '318px' }">
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
        <LiveTablePhase
          :label="phaseLabel"
          :tone="winner ? 'win' : ''"
          :top="400"
          :clock="table.clock.value"
          :timed="phase === 'betting'"
        />

        <template v-for="(pos, i) in SEAT_POS" :key="i">
          <LiveTableSit v-if="!seats[i]" :x="pos.x" :y="pos.y + 106" :mode="!!mySeat || !connected ? 'taken' : table.canSit.value ? 'open' : 'locked'" @sit="table.canSit.value ? table.sit(i) : table.build()" />
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
              <span v-if="!def.below && !amountOn(seats[i]!.game, def.key)" class="lt-spot-label">{{ def.label }}</span>
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
      <template v-if="!connected || !mySeat" />
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
            <span class="lt-panel-value">{{ formatCoins(bacTotal(me!.bets)) }}</span>
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
      <div v-else-if="winner && me && bacTotal(me.staked)" class="flex flex-col items-center gap-1">
        <span class="lt-result" :class="myNet > 0 ? 'win' : myNet === 0 ? 'push' : ''">
          {{ myNet > 0 ? `WIN +${formatCoins(myNet)}` : myNet < 0 ? `LOSE −${formatCoins(-myNet)}` : 'PUSH' }}<CasinoChipIcon v-if="myNet > 0" />
        </span>
        <span class="lt-result-note">Player {{ round!.playerTotal }} · Banker {{ round!.bankerTotal }}<template v-if="round!.natural"> · natural</template></span>
      </div>
      <LiveTableStake v-else :amount="table.inPlay.value">
        <template v-if="me && bacTotal(me.staked)">The cards are coming</template>
        <template v-else>Betting opens with the next hand</template>
      </LiveTableStake>
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
    padding: 3px 22px;
    font-family: var(--font-game);
    font-size: 22px;
    letter-spacing: 0.12em;
    color: #fff;
    text-shadow: 0 2px 0 rgb(0 0 0 / 0.35);
    border: 3px solid rgb(255 255 255 / 0.85);
    transition: box-shadow 0.3s ease, transform 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.5);
}
.bac-side.player { background: linear-gradient(180deg, #5b9bff, #2563eb); box-shadow: 0 4px 0 #173f9a; }
.bac-side.banker { background: linear-gradient(180deg, #ff6b6b, #c81e1e); box-shadow: 0 4px 0 #7a1010; }
.bac-side.won { transform: translate(-50%, -50%) scale(1.12); box-shadow: 0 4px 0 rgb(0 0 0 / 0.4), 0 0 0 3px #ffd36b, 0 0 30px 6px rgb(255 200 80 / 0.75); }
/* Baccarat times its own turns (the reveal steps): no extra flip delay. */
.bac-hand { --flip-delay: 0ms; transition: filter 0.4s ease; }
/* The Player's hand grows leftward from its inner edge, the Banker's rightward. */
.bac-hand.player { flex-direction: row-reverse; transform: translate(-100%, -50%); }
.bac-hand.player > * + * { margin-left: 0; margin-right: -40px; }
.bac-hand.banker { transform: translate(0, -50%); }
.bac-hand.banker > * + * { margin-left: -40px; }
/* Earlier cards on top, so every card's corner index stays in sight. */
.bac-hand.player > :nth-child(1) { z-index: 3; }
.bac-hand.player > :nth-child(2) { z-index: 2; }
.bac-hand.lost { filter: brightness(0.6) saturate(0.6); }
.bac-total { min-width: 64px; text-align: center; font-size: 34px; padding: 2px 18px; }
/* The winning hand glows from the felt under its cards. */
.bac-glow {
    position: absolute;
    width: 440px;
    height: 260px;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    pointer-events: none;
    animation: bac-glow 1.4s ease-in-out infinite alternate;
}
/* Gold, whichever side won: on the red felt a red glow would vanish. */
.bac-glow.player, .bac-glow.banker { background: radial-gradient(closest-side, rgb(255 222 140 / 0.6), rgb(255 196 60 / 0.22) 62%, transparent); }
.bac-glow.tie { background: radial-gradient(closest-side, rgb(170 240 160 / 0.5), rgb(110 220 120 / 0.18) 62%, transparent); }
@keyframes bac-glow { from { opacity: 0.65; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
    .bac-glow { animation: none; }
}
/* The third card is drawn sideways, the way a baccarat dealer lays it. */
.bac-third { transform: rotate(90deg); margin: 0 22px; }

.bac-road-label {
    font-family: var(--font-game);
    font-size: 15px;
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
