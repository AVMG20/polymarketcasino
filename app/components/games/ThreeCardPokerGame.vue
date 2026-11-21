<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { formatCoins } from '#shared/money'
import { ANTE_BONUS_PAYS, PAIR_PLUS_PAYS, TCP_CATEGORY_LABELS, type TcpAction, type TcpSeat, type TcpShared } from '#shared/tables/three-card-poker'

const sound = useTableSound()
const table = useLiveTable<TcpSeat, TcpShared, TcpAction>('three-card-poker')
const { state, mySeat, phase, connected } = table
const { coins } = useCasinoSession()
const chip = ref(100)

const seats = computed(() => state.value?.seats ?? [])
const me = computed(() => mySeat.value?.game ?? null)
const dealer = computed(() => state.value?.game.dealer ?? null)
const betting = computed(() => phase.value === 'betting' && !!me.value)
const available = computed(() => Math.max(0, coins.value - (me.value ? me.value.pendingAnte + me.value.pendingPairPlus : 0)))
const deciding = computed(() => phase.value === 'decision' && !!me.value?.ante && !me.value.decision)
const showdown = computed(() => phase.value === 'reveal' || phase.value === 'payout')

const pairPlusRows = Object.entries(PAIR_PLUS_PAYS).map(([category, pays]) => ({ label: TCP_CATEGORY_LABELS[category as keyof typeof TCP_CATEGORY_LABELS], pays }))
const anteBonusRows = Object.entries(ANTE_BONUS_PAYS).map(([category, pays]) => ({ label: TCP_CATEGORY_LABELS[category as keyof typeof TCP_CATEGORY_LABELS], pays: pays! }))

function place(spot: 'ante' | 'pairPlus') {
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

function dealDelay(seatIndex: number, cardIndex: number) {
    if (phase.value !== 'dealing') return 0
    const order = seats.value.filter(s => s?.game.ante).map(s => s!.index)
    const position = seatIndex < 0 ? order.length : Math.max(0, order.indexOf(seatIndex))
    return (cardIndex * (order.length + 1) + position) * 120
}

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

const legLabel = { win: 'won', lose: 'lost', push: 'push', fold: 'folded', none: '' }
</script>

<template>
  <TableShell
    slug="three-card-poker"
    felt="purple"
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
        <div class="flex min-h-[4.5rem] items-center gap-1">
          <TablePlayingCard v-for="(card, i) in dealer?.cards ?? []" :key="card.id" :card="card" :delay="dealDelay(-1, i)" />
        </div>
        <span v-if="dealer?.hand" class="rounded-full bg-black/40 px-2.5 py-0.5 text-xs font-bold">
          {{ dealer.hand.label }}<span v-if="!dealer.qualified" class="text-white/60"> · doesn't qualify</span>
        </span>
        <p class="text-center font-display text-[11px] font-bold tracking-widest text-star/80 uppercase">Dealer plays with queen high or better</p>
      </div>

      <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
        <TableSeat
          v-for="(seat, index) in seats"
          :key="index"
          :seat="seat"
          :index="index"
          :mine="seat?.playerId === table.me.value"
          :active="phase === 'decision' && !!seat?.game.ante && !seat.game.decision"
          :can-sit="connected && !mySeat"
          @sit="table.sit"
        >
          <template v-if="seat">
            <div class="flex">
              <TablePlayingCard v-for="(card, c) in seat.game.cards" :key="card.id" :card="card" size="sm" :class="c ? '-ml-4' : ''" :delay="dealDelay(index, c)" :dim="seat.game.decision === 'fold'" />
            </div>
            <span v-if="seat.game.hand" class="max-w-full truncate rounded-full bg-black/40 px-1.5 text-[10px] font-semibold">{{ seat.game.hand.label }}</span>
            <span v-else-if="seat.game.decision" class="rounded-full bg-black/40 px-1.5 text-[10px] font-semibold uppercase">{{ seat.game.decision }}</span>
            <div class="flex items-end gap-1">
              <TableChipStack :amount="seat.game.pairPlus || seat.game.pendingPairPlus" size="sm" :label="false" />
              <TableChipStack :amount="seat.game.ante || seat.game.pendingAnte" size="sm" />
              <TableChipStack :amount="seat.game.play" size="sm" :label="false" />
            </div>
          </template>
        </TableSeat>
      </div>
    </template>

    <template #controls>
      <p v-if="!mySeat" class="text-sm text-muted-foreground">Tap an open seat on the table to play. You can watch from here.</p>
      <template v-else>
        <TableChipRack v-if="betting" v-model="chip" :available="available" />
        <div class="grid grid-cols-3 gap-2">
          <TableBetSpot label="Pair Plus" pays="up to 40:1" :amount="betting ? me!.pendingPairPlus : me!.pairPlus" :disabled="!betting" :highlight="showdown && me!.pairPlus ? (me!.result?.pairPlus ? 'win' : 'lose') : null" @place="place('pairPlus')" />
          <TableBetSpot label="Ante" pays="1:1 + bonus" :amount="betting ? me!.pendingAnte : me!.ante" :disabled="!betting" tone="border-star/60" :highlight="showdown && me!.result ? (me!.result.ante === 'win' ? 'win' : me!.result.ante === 'push' ? null : 'lose') : null" @place="place('ante')" />
          <TableBetSpot label="Play" pays="1:1" :amount="me!.play" disabled :highlight="showdown && me!.play ? (me!.result?.play === 'win' ? 'win' : me!.result?.play === 'lose' ? 'lose' : null) : null" />
        </div>

        <TableBetBar
          v-if="betting"
          :can-undo="me!.chips.length > 0"
          :can-repeat="me!.lastAnte > 0"
          :can-scale="me!.pendingAnte > 0 || me!.lastAnte > 0"
          :can-deal="me!.pendingAnte > 0"
          :voted="mySeat.votedStart"
          :votes="votes"
          @undo="table.act({ t: 'undo' })"
          @clear="table.act({ t: 'clear' })"
          @repeat="table.act({ t: 'repeat' }); sound.play('chip')"
          @scale="factor => { table.act({ t: 'scale', factor }); sound.play('chip') }"
          @deal="table.voteStart"
        />

        <div v-else-if="deciding" class="flex flex-wrap items-center gap-2">
          <p class="mr-auto text-sm">You have <span class="font-semibold">{{ me!.hand?.label }}</span>. Playing costs <span class="font-mono font-semibold">{{ formatCoins(me!.ante) }}</span>.</p>
          <Button variant="outline" class="h-11 min-w-24" @click="decide(false)">Fold</Button>
          <Button class="h-11 min-w-24 font-display" :disabled="me!.ante > coins" @click="decide(true)">Play</Button>
        </div>

        <p v-else-if="showdown && me!.result" class="text-sm">
          Ante {{ legLabel[me!.result.ante] }}<template v-if="me!.result.play !== 'none'">, play {{ legLabel[me!.result.play] }}</template>
          <template v-if="me!.result.anteBonus">, ante bonus +{{ formatCoins(me!.result.anteBonus) }}</template>
          <template v-if="me!.result.pairPlus">, pair plus pays {{ formatCoins(me!.result.pairPlus) }}</template>.
          <span class="font-mono font-semibold" :class="me!.result.net > 0 ? 'text-success' : me!.result.net < 0 ? 'text-muted-foreground' : ''"> {{ me!.result.net > 0 ? '+' : me!.result.net < 0 ? '−' : '' }}{{ formatCoins(Math.abs(me!.result.net)) }}</span>
        </p>
        <p v-else class="text-sm text-muted-foreground">{{ me!.ante ? (me!.decision ? `You ${me!.decision === 'play' ? 'play' : 'fold'}. Waiting for the table.` : 'Cards are coming.') : 'Betting opens with the next hand.' }}</p>
      </template>
    </template>

    <template #rules>
      <p>Put down an ante (and Pair Plus if you like). Everyone gets three cards against the dealer's three. Then play (a second bet the size of your ante) or fold your ante.</p>
      <p>The dealer needs queen high to qualify. If not, your ante pays 1:1 and the play bet comes back. If so, the better hand wins both bets 1:1; a tie pushes. Hands rank, high to low: straight flush, three of a kind, straight, flush, pair, high card.</p>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <p class="font-semibold">Pair Plus</p>
          <p v-for="row in pairPlusRows" :key="row.label" class="flex justify-between text-muted-foreground"><span>{{ row.label }}</span><span class="font-mono">{{ row.pays }}:1</span></p>
        </div>
        <div>
          <p class="font-semibold">Ante bonus</p>
          <p v-for="row in anteBonusRows" :key="row.label" class="flex justify-between text-muted-foreground"><span>{{ row.label }}</span><span class="font-mono">{{ row.pays }}:1</span></p>
        </div>
      </div>
      <p>Pair Plus pays on your own hand whatever the dealer has, even if you fold. The ante bonus pays when you play, win or lose. Play every hand of queen-six-four or better: return to player about 96.6% of the ante, Pair Plus 97.7%.</p>
    </template>
  </TableShell>
</template>
