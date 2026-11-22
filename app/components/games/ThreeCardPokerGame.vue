<script setup lang="ts">
import { Lightbulb, LightbulbOff } from 'lucide-vue-next'
import { formatNumber } from '#shared/money'
import type { Card } from '#shared/tables/cards'
import { faceOf } from '#shared/tables/cards'
import {
    ANTE_BONUS_PAYS, PAIR_PLUS_PAYS, TCP_CATEGORY_LABELS, tcpShouldPlay,
    type TcpAction, type TcpCategory, type TcpSeat, type TcpShared, type TcpSpot
} from '#shared/tables/three-card-poker'
import { cardBack, cardFace } from '~/utils/live-table/art'

const sound = useTableSound()
const table = useLiveTable<TcpSeat, TcpShared, TcpAction>('three-card-poker')
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
/** Where a seat's hand sits above its betting spots. */
const HAND_DY = -55
const SPOT_DY = 112
const SPOT_DX = 98
const DEALER_POS = { x: 860, y: 196 }
const SHOE_POS = { x: 1431, y: 170 }
const DISCARD_POS = { x: 289, y: 170 }
const HOUSE_POS = { x: 610, y: 262 }
const DEAL_STAGGER_MS = 90

const seats = computed(() => state.value?.seats ?? [])
const me = computed(() => mySeat.value?.game ?? null)
const dealer = computed(() => state.value?.game.dealer ?? null)
const betting = computed(() => phase.value === 'betting' && !!me.value)
const available = computed(() => Math.max(0, coins.value - (me.value ? me.value.pendingAnte + me.value.pendingPairPlus : 0)))
const deciding = computed(() => phase.value === 'decision' && !!me.value?.ante && !me.value.decision)
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

/** The opening deal goes round the table a card at a time, the dealer last. */
const dealOrder = computed(() => seats.value.filter(s => s?.game.cards.length).map(s => s!.index))
function dealDelay(seatIndex: number, cardIndex: number) {
    if (phase.value !== 'dealing') return '0ms'
    const order = dealOrder.value
    const position = seatIndex < 0 ? order.length : Math.max(0, order.indexOf(seatIndex))
    return `${(cardIndex * (order.length + 1) + position) * DEAL_STAGGER_MS}ms`
}

const CARD_BACK = cardBack()
const face = (card: Card) => (card.rank && card.suit ? cardFace(card.rank, card.suit) : '')

/** What a seat's chips on a spot read as: the bet, then what the leg returned once it is settled. */
function onSpot(seat: TcpSeat, spot: 'ante' | 'pairPlus' | 'play'): number {
    if (spot === 'pairPlus') {
        const stake = seat.pairPlus || seat.pendingPairPlus
        return showdown.value && seat.result ? seat.result.pairPlus : stake
    }
    if (spot === 'play') {
        if (!showdown.value || !seat.result) return seat.play
        return seat.result.play === 'win' ? seat.play * 2 : seat.result.play === 'push' ? seat.play : 0
    }
    const stake = seat.ante || seat.pendingAnte
    if (!showdown.value || !seat.result) return stake
    const leg = seat.result.ante
    return (leg === 'win' ? stake * 2 : leg === 'push' ? stake : 0) + seat.result.anteBonus
}

function legState(seat: TcpSeat, spot: 'ante' | 'pairPlus' | 'play'): 'won' | 'lost' | null {
    const result = seat.result
    if (!showdown.value || !result) return null
    if (spot === 'pairPlus') return seat.pairPlus ? (result.pairPlus ? 'won' : 'lost') : null
    const leg = spot === 'ante' ? result.ante : result.play
    return leg === 'win' ? 'won' : leg === 'lose' || leg === 'fold' ? 'lost' : null
}

function badgeFor(seat: TcpSeat): { text: string, tone: string } | null {
    const result = seat.result
    if (showdown.value && result) {
        if (result.ante === 'fold') return { text: result.net >= 0 ? `FOLD +${formatNumber(result.net)}` : 'FOLD', tone: 'lose' }
        if (result.net === 0) return { text: 'PUSH', tone: 'push' }
        const amount = `${result.net > 0 ? '+' : '−'}${formatNumber(Math.abs(result.net))}`
        if (!result.dealerQualified) return { text: `NO QUALIFY ${amount}`, tone: 'win' }
        return { text: `${result.net > 0 ? 'WIN' : 'LOSE'} ${amount}`, tone: result.net > 0 ? 'win' : 'lose' }
    }
    if (seat.decision === 'play') return { text: 'PLAY', tone: 'win' }
    if (seat.decision === 'fold') return { text: 'FOLD', tone: 'lose' }
    return null
}

function place(spot: TcpSpot) {
    if (!betting.value) return
    table.act({ t: 'bet', spot, amount: chip.value })
    sound.play('chip')
}

function decide(play: boolean) {
    table.act({ t: 'decide', play })
    if (play) sound.play('chip')
}

const votes = computed(() => {
    const seated = seats.value.filter(s => s && !s.leaving)
    return seated.length > 1 ? ` ${seated.filter(s => s!.votedStart).length}/${seated.length}` : ''
})

// Basic strategy is one threshold (Q-6-4), shown only when asked for.
const hints = ref(false)
onMounted(() => {
    try {
        hints.value = localStorage.getItem('casino:tcp-hints') === '1'
    } catch {
        // Private mode: hints start off.
    }
})
function toggleHints() {
    hints.value = !hints.value
    try {
        localStorage.setItem('casino:tcp-hints', hints.value ? '1' : '0')
    } catch {
        // The switch still works for this visit.
    }
}
const hint = computed(() => {
    const cards = me.value?.cards ?? []
    if (!hints.value || !deciding.value || cards.length !== 3 || cards.some(c => !c.rank)) return null
    return tcpShouldPlay(cards.map(faceOf))
})

const phaseLabel = computed(() => {
    if (showdown.value && state.value?.message) return state.value.message.toUpperCase()
    return ({ betting: 'PLACE YOUR BETS', dealing: 'DEALING', decision: 'PLAY OR FOLD' } as Record<string, string>)[phase.value] ?? (state.value?.message ?? 'Waiting').toUpperCase()
})
const myTone = computed(() => {
    const result = me.value?.result
    if (!showdown.value || !result || result.net === 0) return ''
    return result.net > 0 ? 'win' : 'lose'
})

// ─── chips crossing the felt at the showdown ──────────────────────────────────
const flights = ref<{ fly: (from: { x: number, y: number }, to: { x: number, y: number }, amount: number, options?: { delay?: number, size?: number }) => void } | null>(null)
let settledRound = -1
watch(() => [phase.value, state.value?.roundId] as const, ([now, roundId]) => {
    if (now !== 'reveal' || roundId === undefined || roundId === settledRound) return
    settledRound = roundId
    seats.value.forEach((seat, index) => {
        const result = seat?.game.result
        if (!seat || !result) return
        const { x, y } = SEAT_POS[index]!
        const spots = { pairPlus: { x: x - SPOT_DX, y: y + SPOT_DY }, ante: { x, y: y + SPOT_DY }, play: { x: x + SPOT_DX, y: y + SPOT_DY } }
        const g = seat.game
        const take = (spot: { x: number, y: number }, amount: number) => flights.value?.fly(spot, HOUSE_POS, amount, { size: 48, delay: 700 })
        const pay = (spot: { x: number, y: number }, amount: number) => flights.value?.fly(HOUSE_POS, spot, amount, { size: 48, delay: 1_200 })
        if (g.pairPlus) {
            if (result.pairPlus) pay(spots.pairPlus, result.pairPlus - g.pairPlus)
            else take(spots.pairPlus, g.pairPlus)
        }
        if (result.ante === 'win') pay(spots.ante, g.ante + result.anteBonus)
        else if (result.ante === 'lose' || result.ante === 'fold') take(spots.ante, g.ante)
        if (result.play === 'win') pay(spots.play, g.play)
        else if (result.play === 'lose') take(spots.play, g.play)
    })
})

watch(phase, (now) => {
    if (now === 'dealing') sound.play('card')
    if (now === 'reveal') sound.play('flip')
    if (now === 'decision' && me.value?.ante) sound.play('turn')
})
watch(() => mySeat.value?.roundsPlayed, (played, before) => {
    if (!played || played === before) return
    const net = mySeat.value?.lastNet ?? 0
    if (net) sound.play(net > 0 ? 'win' : 'lose')
})

const EXAMPLES: Partial<Record<TcpCategory, string>> = {
    straightFlush: 'As Ks Qs',
    trips: 'Kc Kh Kd',
    straight: 'Kc Qh Jd',
    flush: 'Qh Jh 3h',
    pair: 'As Ah 4c'
}
const pairPlusRows = (Object.entries(PAIR_PLUS_PAYS) as [TcpCategory, number][]).map(([category, pays]) => ({ label: TCP_CATEGORY_LABELS[category], example: EXAMPLES[category], pays: `${pays}:1` }))
const anteBonusRows = (Object.entries(ANTE_BONUS_PAYS) as [TcpCategory, number][]).map(([category, pays]) => ({ label: TCP_CATEGORY_LABELS[category], example: EXAMPLES[category], pays: `${pays}:1` }))
</script>

<template>
  <LiveTableShell
    slug="three-card-poker"
    :connected="connected"
    :message="state?.message ?? 'Connecting'"
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
        <LiveTableCorner title="Bonus paytables">
          <div class="tcp-paytable-title">Pair Plus</div>
          <LiveTablePaytable :rows="pairPlusRows" :head="['Hand', 'Pays']" />
          <div class="tcp-paytable-title mt-3 border-t border-[rgba(217,177,103,0.25)] pt-3">Ante bonus</div>
          <LiveTablePaytable :rows="anteBonusRows" :head="['Hand', 'Pays']" />
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

        <!-- The dealer's hand: dealt face down, turned over at the showdown. -->
        <TransitionGroup name="lt-deal" tag="div" class="lt-hand tcp-hand" :style="handStyle(DEALER_POS.x, DEALER_POS.y)">
          <span v-for="(card, i) in dealer?.cards ?? []" :key="card.id" class="block" :style="{ transitionDelay: dealDelay(-1, i) }">
            <span class="lt-flip" :class="{ down: !card.rank }" :style="{ transitionDelay: `${i * 160}ms` }">
              <span class="lt-flip-face" v-html="face(card)" />
              <span class="lt-flip-face lt-flip-back" v-html="CARD_BACK" />
            </span>
          </span>
        </TransitionGroup>
        <div v-if="dealer?.hand" class="tcp-strength lt-mono" :class="myTone" :style="pos(DEALER_POS.x, 310)">
          {{ dealer.hand.label }}<span v-if="dealer.qualified === false" class="tcp-nq"> · does not qualify</span>
        </div>

        <div class="lt-rules" style="top: 350px">DEALER QUALIFIES WITH QUEEN HIGH OR BETTER</div>
        <div class="lt-phase" style="top: 392px">
          <span class="label" :class="myTone">{{ phaseLabel }}</span>
          <template v-if="table.nextRoundIn.value !== null">
            <span class="next">NEW ROUND IN</span>
            <span class="count">{{ table.nextRoundIn.value }}</span>
          </template>
          <span v-else-if="table.secondsLeft.value !== null && phase !== 'dealing'" class="count" :class="{ urgent: table.secondsLeft.value <= 5 }">{{ table.secondsLeft.value }}</span>
        </div>

        <template v-for="(p, i) in SEAT_POS" :key="i">
          <div v-if="!seats[i]" class="lt-sit" :class="{ taken: !!mySeat || !connected }" :style="pos(p.x, p.y + SPOT_DY)" @click="!mySeat && connected && table.sit(i)">
            <span class="lbl">SIT</span>
          </div>
          <template v-else>
            <TransitionGroup name="lt-deal" tag="div" class="lt-hand tcp-hand" :class="{ dim: seats[i]!.game.decision === 'fold' }" :style="handStyle(p.x, p.y + HAND_DY)">
              <span v-for="(card, c) in seats[i]!.game.cards" :key="card.id" class="block" :style="{ transitionDelay: dealDelay(i, c) }">
                <span class="lt-flip" :class="{ down: !card.rank }">
                  <span class="lt-flip-face" v-html="face(card)" />
                  <span class="lt-flip-face lt-flip-back" v-html="CARD_BACK" />
                </span>
              </span>
            </TransitionGroup>
            <div v-if="seats[i]!.game.hand" class="tcp-strength lt-mono" :style="pos(p.x, p.y + 38)">{{ seats[i]!.game.hand!.label }}</div>
            <div v-if="badgeFor(seats[i]!.game)" class="lt-badge pop" :class="badgeFor(seats[i]!.game)!.tone" :style="pos(p.x, p.y - 150)">{{ badgeFor(seats[i]!.game)!.text }}</div>

            <div class="lt-cap" :style="pos(p.x - SPOT_DX, p.y + SPOT_DY - 52)">Pair Plus</div>
            <div class="lt-cap" :style="pos(p.x, p.y + SPOT_DY - 52)">Ante</div>
            <div class="lt-cap" :style="pos(p.x + SPOT_DX, p.y + SPOT_DY - 52)">Play</div>
            <div
              v-for="(spot, s) in (['pairPlus', 'ante', 'play'] as const)"
              :key="spot"
              class="lt-spot tcp-spot"
              :class="[legState(seats[i]!.game, spot) ?? '', { clickable: spot !== 'play' && seats[i]!.playerId === table.me.value && betting, pulse: spot === 'play' && phase === 'decision' && !!seats[i]!.game.ante && !seats[i]!.game.decision }]"
              :style="pos(p.x + (s - 1) * SPOT_DX, p.y + SPOT_DY)"
              @click="spot !== 'play' && seats[i]!.playerId === table.me.value && place(spot)"
            >
              <LiveTableChipPile class="lt-spot-chips" :amount="onSpot(seats[i]!.game, spot)" :size="60" :max="4" />
            </div>
            <div v-for="(spot, s) in (['pairPlus', 'ante', 'play'] as const)" v-show="onSpot(seats[i]!.game, spot) > 0" :key="`${spot}-amt`" class="lt-amt" :style="pos(p.x + (s - 1) * SPOT_DX, p.y + SPOT_DY + 58)">
              {{ formatNumber(onSpot(seats[i]!.game, spot)) }}
            </div>
            <LiveTablePlate :seat="seats[i]!" :x="p.x" :y="p.y + 230" :mine="seats[i]!.playerId === table.me.value" :turn="phase === 'decision' && !!seats[i]!.game.ante && !seats[i]!.game.decision" :ready="phase === 'betting' && seats[i]!.votedStart" />
          </template>
        </template>

        <LiveTableChipFlights ref="flights" />
      </LiveTableStage>
    </template>

    <template #controls>
      <p v-if="!connected" class="lt-hint-text">Connecting…</p>
      <p v-else-if="!mySeat" class="lt-hint-text">Click an open <b>SIT</b> spot to join the table.</p>
      <template v-else-if="betting">
        <div class="lt-touch-spots grid-cols-2">
          <button type="button" class="lt-touch-spot" @click="place('pairPlus')">Pair Plus<small>up to {{ PAIR_PLUS_PAYS.straightFlush }}:1</small><span v-if="me!.pendingPairPlus" class="amt">{{ formatNumber(me!.pendingPairPlus) }}</span></button>
          <button type="button" class="lt-touch-spot !border-[var(--lt-gold)]" @click="place('ante')">Ante<small>1:1 + bonus</small><span v-if="me!.pendingAnte" class="amt">{{ formatNumber(me!.pendingAnte) }}</span></button>
        </div>
        <div class="flex items-stretch gap-2">
          <div class="lt-panel shrink-0">
            <span class="lt-panel-label">Ante</span>
            <span class="lt-panel-value lt-mono">{{ formatNumber(me!.pendingAnte) }}</span>
            <span v-if="me!.pendingPairPlus" class="text-[10px] text-white/55">+{{ formatNumber(me!.pendingPairPlus) }} pair plus</span>
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
        <p class="lt-hint-text">You have <b>{{ me!.hand?.label }}</b>. Play for {{ formatNumber(me!.ante) }} more, or fold your ante.</p>
        <div class="grid grid-cols-2 gap-2 sm:mx-auto sm:w-full sm:max-w-md">
          <button type="button" class="lb-tile lb-tile-green min-h-12" :class="{ 'lb-hint': hint === true }" :disabled="me!.ante > coins" @click="decide(true)">PLAY {{ formatNumber(me!.ante) }}</button>
          <button type="button" class="lb-tile lb-tile-red min-h-12" :class="{ 'lb-hint': hint === false }" @click="decide(false)">FOLD</button>
        </div>
      </template>

      <div v-else-if="showdown && me?.result" class="flex flex-col items-center gap-1">
        <span class="tcp-result" :class="badgeFor(me)?.tone">{{ badgeFor(me)?.text }}</span>
        <span class="text-xs text-white/60">
          <template v-if="me.hand">{{ me.hand.label }}</template>
          <template v-if="me.result.anteBonus"> · ante bonus +{{ formatNumber(me.result.anteBonus) }}</template>
          <template v-if="me.result.pairPlus"> · pair plus pays {{ formatNumber(me.result.pairPlus) }}</template>
        </span>
      </div>

      <p v-else class="lt-hint-text">
        <template v-if="me?.ante">{{ me.decision ? `You ${me.decision}. Waiting for the table.` : 'Cards are coming.' }}</template>
        <template v-else>Betting opens with the next hand.</template>
      </p>
    </template>

    <template #footer>
      <button v-if="mySeat" type="button" class="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 font-semibold transition" :class="hints ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/60' : 'bg-white/5 text-white/60 hover:bg-white/10'" @click="toggleHints">
        <Lightbulb v-if="hints" class="size-3.5" /><LightbulbOff v-else class="size-3.5" /> Hints {{ hints ? 'on' : 'off' }}
      </button>
    </template>

    <template #rules>
      <p>Put down an ante (and Pair Plus if you like). Everyone gets three cards against the dealer's three. Then play (a second bet the size of your ante) or fold your ante.</p>
      <p>The dealer needs queen high to qualify. If not, your ante pays 1:1 and the play bet comes back. If so, the better hand wins both bets 1:1; a tie pushes. Hands rank, high to low: straight flush, three of a kind, straight, flush, pair, high card.</p>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <p class="font-semibold">Pair Plus</p>
          <p v-for="row in pairPlusRows" :key="row.label" class="flex justify-between text-muted-foreground"><span>{{ row.label }}</span><span class="font-mono">{{ row.pays }}</span></p>
        </div>
        <div>
          <p class="font-semibold">Ante bonus</p>
          <p v-for="row in anteBonusRows" :key="row.label" class="flex justify-between text-muted-foreground"><span>{{ row.label }}</span><span class="font-mono">{{ row.pays }}</span></p>
        </div>
      </div>
      <p>Pair Plus pays on your own hand whatever the dealer has, even if you fold. The ante bonus pays when you play, win or lose. Play every hand of queen-six-four or better: return to player about 96.6% of the ante, Pair Plus 97.7%.</p>
    </template>
  </LiveTableShell>
</template>

<style scoped>
.tcp-hand > * + * { margin-left: -36px; }
.lt-spot.tcp-spot {
    width: 84px;
    height: 84px;
    margin: -42px 0 0 -42px;
}
.lt-spot.tcp-spot.pulse {
    border-color: rgba(217, 177, 103, 0.8);
    animation: tcp-pulse 1.3s ease-in-out infinite;
}
@keyframes tcp-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(217, 177, 103, 0.5); }
    50% { box-shadow: 0 0 20px 6px rgba(217, 177, 103, 0.4); }
}
.tcp-strength {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 10px;
    padding: 1px 10px;
    background: rgba(11, 8, 6, 0.7);
    font-size: 17px;
    font-weight: 800;
    color: var(--lt-gold);
    white-space: nowrap;
    pointer-events: none;
    z-index: 3;
}
.tcp-strength.win { color: var(--lt-win); }
.tcp-strength.lose { color: #f87171; }
.tcp-nq { color: #fca5a5; }
.tcp-paytable-title {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--lt-gold);
    opacity: 0.85;
}
.tcp-result {
    border-radius: 14px;
    padding: 6px 18px;
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.03em;
    background: rgba(11, 8, 6, 0.94);
    border: 2px solid rgba(217, 177, 103, 0.9);
}
.tcp-result.win { background: var(--lt-win); border-color: #fff; color: #052e16; }
.tcp-result.lose { background: rgba(127, 29, 29, 0.94); border-color: rgba(248, 113, 113, 0.8); color: #fecaca; }
.tcp-result.push { background: rgba(30, 41, 59, 0.94); border-color: rgba(148, 163, 184, 0.7); }
</style>
