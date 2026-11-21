<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { formatCoins } from '#shared/money'
import {
    BJ_SIDE_BETS, canDouble, canSplit, canSurrender, insuranceCost, PERFECT_PAIRS_PAYS, TWENTY_ONE_PLUS_THREE_PAYS,
    type BjHand, type BjSideBet, type BjSpot
} from '#shared/tables/blackjack'
import type { BjGameEvent, BjSeat, BjShared, BjTableAction } from '#shared/tables/blackjack-wire'

const sound = useTableSound()
const table = useLiveTable<BjSeat, BjShared, BjTableAction>('blackjack', (payload) => {
    const event = payload as BjGameEvent
    if (event.type === 'side' && event.seat === mySeat.value?.index) sound.play('win')
})
const { state, mySeat, phase, connected } = table
const { coins } = useCasinoSession()
const chip = ref(100)

const seats = computed(() => state.value?.seats ?? [])
const game = computed(() => state.value?.game ?? null)
const me = computed(() => mySeat.value?.game ?? null)
const betting = computed(() => phase.value === 'betting' && !!me.value)
const committed = computed(() => (me.value ? me.value.pendingBet + BJ_SIDE_BETS.reduce((sum, key) => sum + me.value!.pendingSide[key], 0) : 0))
const available = computed(() => Math.max(0, coins.value - committed.value))

const myTurn = computed(() => phase.value === 'playing' && game.value?.activeSeat === mySeat.value?.index && game.value?.activeHand !== null)
const activeHand = computed<BjHand | null>(() => (myTurn.value && me.value ? me.value.hands[game.value!.activeHand!] ?? null : null))
const offerInsurance = computed(() => phase.value === 'insurance' && !!me.value?.hands.length && !me.value.insuranceDecided)

const sidePays: Record<BjSideBet, string> = {
    perfectPairs: `up to ${PERFECT_PAIRS_PAYS.perfect}:1`,
    twentyOnePlusThree: `up to ${TWENTY_ONE_PLUS_THREE_PAYS.suitedTrips}:1`
}
const sideLabels: Record<BjSideBet, string> = { perfectPairs: 'Perfect Pairs', twentyOnePlusThree: '21+3' }
const statusLabels: Partial<Record<BjHand['status'], string>> = {
    blackjack: 'Blackjack',
    busted: 'Bust',
    surrendered: 'Surrender',
    won: 'Win',
    lost: 'Lose',
    push: 'Push'
}

function place(spot: BjSpot) {
    if (!betting.value) return
    table.act({ t: 'bet', spot, amount: chip.value })
    sound.play('chip')
}

const votes = computed(() => {
    const seated = seats.value.filter(s => s && !s.leaving)
    return seated.length > 1 ? ` ${seated.filter(s => s!.votedStart).length}/${seated.length}` : ''
})

/** Opening cards land one at a time around the table. */
const dealOrder = computed(() => seats.value.filter(s => s?.game.hands.length).map(s => s!.index))
/** `seatIndex` -1 is the dealer, who takes each card after the seats. */
function dealDelay(seatIndex: number, cardIndex: number) {
    if (phase.value !== 'dealing') return 0
    const order = dealOrder.value
    const position = seatIndex < 0 ? order.length : Math.max(0, order.indexOf(seatIndex))
    return (cardIndex * (order.length + 1) + position) * 200
}

const cardCount = computed(() => (game.value?.dealer.cards.length ?? 0) + seats.value.reduce((sum, s) => sum + (s?.game.hands.reduce((n, h) => n + h.cards.length, 0) ?? 0), 0))
watch(cardCount, (count, before) => {
    if (count > (before ?? 0)) sound.play('card')
})
watch(myTurn, turn => turn && sound.play('turn'))
watch(() => mySeat.value?.roundsPlayed, (played, before) => {
    if (!played || played === before) return
    const net = mySeat.value?.lastNet ?? 0
    if (net) sound.play(net > 0 ? 'win' : 'lose')
})
</script>

<template>
  <TableShell
    slug="blackjack"
    felt="green"
    :connected="connected"
    :message="state?.message ?? 'Connecting'"
    :seconds="table.secondsLeft.value"
    :progress="table.phaseProgress.value"
    :next-round-in="table.nextRoundIn.value"
    :watching="state?.watching ?? 0"
    :seated="!!mySeat"
    :leaving="!!mySeat?.leaving"
    :feed="table.feed.value"
    :scoreboard="state?.scoreboard ?? []"
    @chat="table.chat"
    @leave="table.leave"
  >
    <template #felt>
      <div class="flex flex-col items-center gap-1.5 pb-2">
        <div class="flex min-h-[4.5rem] items-center justify-center">
          <TablePlayingCard v-for="(card, i) in game?.dealer.cards ?? []" :key="card.id" :card="card" :class="i ? '-ml-3' : ''" :delay="dealDelay(-1, i)" />
        </div>
        <span v-if="game?.dealer.cards.length" class="rounded-full bg-black/40 px-2.5 py-0.5 font-mono text-xs font-bold">
          {{ game.dealer.blackjack ? 'Blackjack' : game.dealer.busted ? `Bust ${game.dealer.score}` : game.dealer.soft && game.dealer.score < 21 ? `${game.dealer.score - 10}/${game.dealer.score}` : game.dealer.score }}
        </span>
        <p class="text-center font-display text-[11px] font-bold tracking-widest text-star/80 uppercase">Blackjack pays 3 to 2 · Dealer stands on 17 · Insurance pays 2 to 1</p>
      </div>

      <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
        <TableSeat
          v-for="(seat, index) in seats"
          :key="index"
          :seat="seat"
          :index="index"
          :mine="seat?.playerId === table.me.value"
          :active="phase === 'playing' && game?.activeSeat === index"
          :can-sit="connected && !mySeat"
          @sit="table.sit"
        >
          <template v-if="seat">
            <div v-for="(hand, h) in seat.game.hands" :key="hand.id" class="flex flex-col items-center gap-0.5 rounded-lg px-0.5" :class="game?.activeSeat === index && game?.activeHand === h && phase === 'playing' ? 'bg-star/20' : ''">
              <div class="flex">
                <TablePlayingCard v-for="(card, c) in hand.cards" :key="card.id" :card="card" size="sm" :class="c ? '-ml-5' : ''" :delay="dealDelay(index, c)" :dim="hand.status === 'busted' || hand.status === 'lost' || hand.status === 'surrendered'" />
              </div>
              <span class="rounded-full px-1.5 font-mono text-[10px] font-bold" :class="hand.status === 'won' || hand.status === 'blackjack' ? 'bg-star text-black' : 'bg-black/40'">
                {{ statusLabels[hand.status] ?? (hand.soft && hand.score < 21 ? `${hand.score - 10}/${hand.score}` : hand.score) }}<template v-if="hand.doubled"> ×2</template>
              </span>
            </div>
            <div class="flex items-end gap-1">
              <TableChipStack :amount="seat.game.hands.length ? seat.game.hands.reduce((sum, hand) => sum + (hand.doubled ? hand.bet * 2 : hand.bet), 0) : seat.game.pendingBet" size="sm" />
              <TableChipStack v-for="key in BJ_SIDE_BETS" :key="key" :amount="seat.game.hands.length ? (seat.game.sideResults?.find(r => r.key === key)?.stake ?? 0) : seat.game.pendingSide[key]" size="sm" :label="false" />
              <TableChipStack v-if="seat.game.insurance" :amount="seat.game.insurance" size="sm" :label="false" />
            </div>
          </template>
        </TableSeat>
      </div>
    </template>

    <template #controls>
      <p v-if="!mySeat" class="text-sm text-muted-foreground">Tap an open seat on the table to play. You can watch from here.</p>

      <template v-else-if="betting">
        <TableChipRack v-model="chip" :available="available" />
        <div class="grid grid-cols-3 gap-2">
          <TableBetSpot label="Perfect Pairs" :pays="sidePays.perfectPairs" :amount="me!.pendingSide.perfectPairs" :disabled="!me!.pendingBet" @place="place('perfectPairs')" />
          <TableBetSpot label="Bet" pays="1:1 · 3:2" :amount="me!.pendingBet" tone="border-star/60" @place="place('main')" />
          <TableBetSpot label="21+3" :pays="sidePays.twentyOnePlusThree" :amount="me!.pendingSide.twentyOnePlusThree" :disabled="!me!.pendingBet" @place="place('twentyOnePlusThree')" />
        </div>
        <TableBetBar
          :can-undo="me!.chips.length > 0"
          :can-repeat="me!.lastBet > 0"
          :can-scale="me!.pendingBet > 0 || me!.lastBet > 0"
          :can-deal="me!.pendingBet > 0"
          :voted="mySeat.votedStart"
          :votes="votes"
          @undo="table.act({ t: 'undo' })"
          @clear="table.act({ t: 'clear' })"
          @repeat="table.act({ t: 'repeat' }); sound.play('chip')"
          @scale="factor => { table.act({ t: 'scale', factor }); sound.play('chip') }"
          @deal="table.voteStart"
        />
        <p class="text-xs text-muted-foreground">Bets are taken when betting closes. No bet, no seat: sit out a round and you'll need to sit down again.</p>
      </template>

      <div v-else-if="offerInsurance" class="flex flex-wrap items-center gap-2">
        <p class="mr-auto text-sm">Dealer shows an ace. Insurance costs <span class="font-mono font-semibold">{{ formatCoins(insuranceCost(me!.hands[0]!.bet)) }}</span> and pays 2 to 1.</p>
        <Button variant="outline" class="h-11" @click="table.act({ t: 'insurance', take: false })">No thanks</Button>
        <Button class="h-11 font-display" @click="table.act({ t: 'insurance', take: true }); sound.play('chip')">Insure</Button>
      </div>

      <div v-else-if="myTurn && activeHand" class="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Button class="h-12 font-display text-base" @click="table.act({ t: 'play', action: 'hit' })">Hit</Button>
        <Button variant="secondary" class="h-12 font-display text-base" @click="table.act({ t: 'play', action: 'stand' })">Stand</Button>
        <Button variant="outline" class="h-12 font-display" :disabled="!canDouble(activeHand) || activeHand.bet > coins" @click="table.act({ t: 'play', action: 'double' }); sound.play('chip')">Double</Button>
        <Button variant="outline" class="h-12 font-display" :disabled="!canSplit(activeHand, me!.hands) || activeHand.bet > coins" @click="table.act({ t: 'play', action: 'split' }); sound.play('chip')">Split</Button>
        <Button variant="ghost" class="col-span-2 h-12 font-display sm:col-span-1" :disabled="!canSurrender(activeHand, me!.hands)" @click="table.act({ t: 'play', action: 'surrender' })">Surrender</Button>
      </div>

      <p v-else class="text-sm text-muted-foreground">
        <template v-if="phase === 'playing'">Waiting for {{ seats[game?.activeSeat ?? -1]?.name ?? 'the table' }}.</template>
        <template v-else-if="phase === 'betting'">Place your bet.</template>
        <template v-else-if="me?.hands.length">Your hand is in.</template>
        <template v-else>Next round soon.</template>
      </p>
    </template>

    <template #rules>
      <p>Get closer to 21 than the dealer without going over. Six decks, the dealer stands on every 17. Blackjack pays 3 to 2, a win 1 to 1.</p>
      <p>Double on any first two cards (also after a split), split pairs up to four hands (split aces get one card each), surrender your first two cards for half your bet back. With an ace showing, insurance costs half your bet and pays 2 to 1.</p>
      <p>Side bets read your first two cards: Perfect Pairs pays 25:1 (same suit), 12:1 (same colour), 6:1 (mixed). 21+3 adds the dealer's upcard: suited trips 100:1, straight flush 40:1, three of a kind 30:1, straight 10:1, flush 5:1.</p>
      <p>Return to player about 99.6% with basic strategy; Perfect Pairs 93.9%, 21+3 95.4%.</p>
    </template>
  </TableShell>
</template>
