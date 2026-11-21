<script setup lang="ts">
import type { Card } from '#shared/tables/cards'
import {
    BAC_PAYS, BAC_SPOT_LABELS, BAC_SPOTS, bacHandTotal, bacSpotReturn, bacTotal, bigRoadColumns,
    type BacAction, type BacRound, type BacSeat, type BacShared, type BacSpot
} from '#shared/tables/baccarat'

const sound = useTableSound()
const table = useLiveTable<BacSeat, BacShared, BacAction>('baccarat')
const { state, mySeat, phase, connected } = table
const { coins } = useCasinoSession()
const chip = ref(100)

const seats = computed(() => state.value?.seats ?? [])
const me = computed(() => mySeat.value?.game ?? null)
const round = computed(() => state.value?.game.round ?? null)
const history = computed(() => state.value?.game.history ?? [])
const betting = computed(() => phase.value === 'betting' && !!me.value)
const available = computed(() => Math.max(0, coins.value - (me.value ? bacTotal(me.value.bets) : 0)))

// ─── the reveal: cards land face down, then turn over one by one ─────────────
// Steps: 0-3 deal P1 B1 P2 B2 face down; 4-5 turn the player's two; 6-7 the
// banker's two; 8 the player's third; 9 the banker's third.
const step = ref(99)
let timers: ReturnType<typeof setTimeout>[] = []
const STEP_AT = [0, 150, 300, 450, 900, 1_250, 1_650, 2_000, 2_500, 3_050]

watch(() => round.value?.playerCards[0]?.id, (id, before) => {
    timers.forEach(clearTimeout)
    timers = []
    if (!id || !before && phase.value !== 'dealing') {
        step.value = 99
        return
    }
    step.value = -1
    STEP_AT.forEach((at, i) => timers.push(setTimeout(() => {
        step.value = i
        if (i < 4 || (i >= 8 && i <= 9)) sound.play('card')
        else sound.play('flip')
    }, at)))
    timers.push(setTimeout(() => (step.value = 99), 3_300))
})
onBeforeUnmount(() => timers.forEach(clearTimeout))

/** A hand as far as the reveal has got: undealt cards absent, unturned ones face down. */
function shown(cards: Card[], side: 'player' | 'banker'): Card[] {
    const dealAt = side === 'player' ? [0, 2, 8] : [1, 3, 9]
    const turnAt = side === 'player' ? [4, 5, 8] : [6, 7, 9]
    return cards
        .filter((_, i) => step.value >= dealAt[i]!)
        .map((card, i) => (step.value >= turnAt[i]! ? card : { id: card.id, hidden: true }))
}

const playerCards = computed(() => (round.value ? shown(round.value.playerCards, 'player') : []))
const bankerCards = computed(() => (round.value ? shown(round.value.bankerCards, 'banker') : []))
const revealed = computed(() => !!round.value && step.value >= 99)
const winner = computed(() => (revealed.value ? round.value!.winner : null))

function spotHighlight(spot: BacSpot): 'win' | 'lose' | null {
    if (!revealed.value || !me.value?.staked[spot]) return null
    return bacSpotReturn(spot, me.value.staked[spot], round.value as BacRound) > me.value.staked[spot] ? 'win' : 'lose'
}

watch(revealed, (done) => {
    if (!done || !me.value) return
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

const pays = (spot: BacSpot) => `${BAC_PAYS[spot]}:1`
const bigRoad = computed(() => bigRoadColumns(history.value).slice(-18))
const dot = { player: 'bg-blue-500', banker: 'bg-red-500', tie: 'bg-emerald-500' }
</script>

<template>
  <TableShell
    slug="baccarat"
    felt="red"
    :connected="connected"
    :message="revealed || !round ? (state?.message ?? 'Connecting') : 'Dealing'"
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
      <div class="grid grid-cols-2 gap-2 pb-3 sm:gap-6">
        <div v-for="side in (['player', 'banker'] as const)" :key="side" class="flex flex-col items-center gap-1.5 rounded-2xl p-2 transition-all" :class="winner === side ? 'bg-white/15 ring-2 ring-star' : ''">
          <span class="rounded-full px-3 py-0.5 font-display text-xs font-extrabold tracking-wider uppercase" :class="side === 'player' ? 'bg-blue-600' : 'bg-red-600'">{{ side }}</span>
          <div class="flex min-h-[4.5rem] items-center">
            <TablePlayingCard
              v-for="(card, i) in (side === 'player' ? playerCards : bankerCards)"
              :key="card.id"
              :card="card"
              :class="[i ? '-ml-3 sm:ml-1' : '', i === 2 ? 'rotate-90' : '']"
            />
          </div>
          <span class="grid size-9 place-items-center rounded-full bg-white font-display text-lg font-extrabold" :class="side === 'player' ? 'text-blue-600' : 'text-red-600'">
            {{ round ? bacHandTotal(side === 'player' ? playerCards : bankerCards) : '–' }}
          </span>
        </div>
      </div>
      <p v-if="winner === 'tie'" class="-mt-1 mb-2 text-center font-display font-extrabold text-star">Tie</p>

      <div class="mb-3 grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
        <TableSeat
          v-for="(seat, index) in seats"
          :key="index"
          :seat="seat"
          :index="index"
          :mine="seat?.playerId === table.me.value"
          :can-sit="connected && !mySeat"
          @sit="table.sit"
        >
          <div v-if="seat" class="flex flex-wrap items-end justify-center gap-1">
            <div v-for="spot in BAC_SPOTS" :key="spot" class="flex flex-col items-center">
              <TableChipStack :amount="phase === 'betting' ? seat.game.bets[spot] : seat.game.staked[spot]" size="sm" :label="false" />
              <span v-if="(phase === 'betting' ? seat.game.bets[spot] : seat.game.staked[spot]) > 0" class="text-[9px] font-bold text-white/70 uppercase">{{ BAC_SPOT_LABELS[spot] }}</span>
            </div>
          </div>
        </TableSeat>
      </div>

      <div class="grid grid-cols-1 gap-2 rounded-xl bg-black/25 p-2 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div class="grid grid-flow-col grid-rows-6 justify-start gap-0.5 overflow-x-auto" title="Bead plate">
          <span v-for="(entry, i) in history.slice(-48)" :key="i" class="relative grid size-4 place-items-center rounded-full text-[8px] font-bold" :class="dot[entry.winner]">
            {{ entry.winner[0]!.toUpperCase() }}
            <span v-if="entry.playerPair" class="absolute -top-px -left-px size-1.5 rounded-full bg-blue-200" />
            <span v-if="entry.bankerPair" class="absolute -right-px -bottom-px size-1.5 rounded-full bg-red-200" />
          </span>
        </div>
        <div class="flex gap-0.5 overflow-x-auto" title="Big road">
          <div v-for="(column, c) in bigRoad" :key="c" class="grid grid-rows-6 gap-0.5">
            <span v-for="row in Math.min(6, column.rows)" :key="row" class="relative size-4 rounded-full border-[3px]" :class="column.result === 'player' ? 'border-blue-400' : 'border-red-400'">
              <span v-if="row === Math.min(6, column.rows) && column.ties" class="absolute inset-0 m-auto h-0.5 w-3 -rotate-45 bg-emerald-400" />
            </span>
          </div>
          <p v-if="!history.length" class="text-xs text-white/50">The roads fill as the shoe plays.</p>
        </div>
      </div>
    </template>

    <template #controls>
      <p v-if="!mySeat" class="text-sm text-muted-foreground">Tap an open seat on the table to play. You can watch from here.</p>
      <template v-else>
        <TableChipRack v-if="betting" v-model="chip" :available="available" />
        <div class="grid grid-cols-3 gap-2">
          <TableBetSpot label="P Pair" :pays="pays('playerPair')" :amount="betting ? me!.bets.playerPair : me!.staked.playerPair" :disabled="!betting" :highlight="spotHighlight('playerPair')" @place="place('playerPair')" />
          <TableBetSpot label="Tie" :pays="pays('tie')" :amount="betting ? me!.bets.tie : me!.staked.tie" :disabled="!betting" :highlight="spotHighlight('tie')" tone="text-emerald-500" @place="place('tie')" />
          <TableBetSpot label="B Pair" :pays="pays('bankerPair')" :amount="betting ? me!.bets.bankerPair : me!.staked.bankerPair" :disabled="!betting" :highlight="spotHighlight('bankerPair')" @place="place('bankerPair')" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <TableBetSpot label="Player" :pays="pays('player')" :amount="betting ? me!.bets.player : me!.staked.player" :disabled="!betting" :highlight="spotHighlight('player')" tone="min-h-20 text-blue-500" @place="place('player')" />
          <TableBetSpot label="Banker" :pays="pays('banker')" :amount="betting ? me!.bets.banker : me!.staked.banker" :disabled="!betting" :highlight="spotHighlight('banker')" tone="min-h-20 text-red-500" @place="place('banker')" />
        </div>
        <TableBetBar
          v-if="betting"
          :can-undo="me!.chips.length > 0"
          :can-repeat="bacTotal(me!.lastBets) > 0"
          :can-scale="bacTotal(me!.bets) > 0 || bacTotal(me!.lastBets) > 0"
          :can-deal="bacTotal(me!.bets) > 0"
          :voted="mySeat.votedStart"
          :votes="votes"
          @undo="table.act({ t: 'undo' })"
          @clear="table.act({ t: 'clear' })"
          @repeat="table.act({ t: 'repeat' }); sound.play('chip')"
          @scale="factor => { table.act({ t: 'scale', factor }); sound.play('chip') }"
          @deal="table.voteStart"
        />
        <p v-else class="text-sm text-muted-foreground">{{ bacTotal(me!.staked) ? 'Your bets are in.' : 'Betting opens with the next hand.' }}</p>
      </template>
    </template>

    <template #rules>
      <p>Back the hand you think finishes closer to 9: Player or Banker, or a Tie. Cards count their pip value, tens and faces count zero, and only the last digit of the total counts (7 + 8 = 5).</p>
      <p>Both hands get two cards; a natural 8 or 9 stands. Otherwise the Player draws on 0-5 and the Banker draws by the fixed third-card table. Nobody makes a decision.</p>
      <p>Player pays 1:1, Banker 0.95:1 (a 5% commission), Tie 8:1, and Player and Banker bets come back on a tie. Player Pair and Banker Pair pay 11:1 when that hand's first two cards share a rank. Eight decks.</p>
      <p>Return to player: Banker 98.9%, Player 98.8%, Tie 85.6%, pairs 89.6%.</p>
    </template>
  </TableShell>
</template>
