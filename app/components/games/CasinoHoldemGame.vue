<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { formatCoins } from '#shared/money'
import { CH_AA_TABLE, CH_ANTE_TABLE, CH_CALL_MULTIPLIER, type ChAction, type ChSeat, type ChShared } from '#shared/tables/casino-holdem'

const sound = useTableSound()
const table = useLiveTable<ChSeat, ChShared, ChAction>('casino-holdem')
const { state, mySeat, phase, connected } = table
const { coins } = useCasinoSession()
const chip = ref(100)

const seats = computed(() => state.value?.seats ?? [])
const me = computed(() => mySeat.value?.game ?? null)
const shared = computed(() => state.value?.game ?? null)
const betting = computed(() => phase.value === 'betting' && !!me.value)
const available = computed(() => Math.max(0, coins.value - (me.value ? me.value.pendingAnte + me.value.pendingAa : 0)))
const deciding = computed(() => phase.value === 'decision' && !!me.value?.cards.length && !me.value.decision)
const showdown = computed(() => phase.value === 'reveal' || phase.value === 'payout')

function place(spot: 'ante' | 'aa') {
    if (!betting.value) return
    table.act({ t: 'bet', spot, amount: chip.value })
    sound.play('chip')
}

function decide(call: boolean) {
    table.act({ t: 'decide', call })
    if (call) sound.play('chip')
}

const votes = computed(() => {
    const seated = seats.value.filter(s => s && !s.leaving)
    return seated.length > 1 ? ` ${seated.filter(s => s!.votedStart).length}/${seated.length}` : ''
})

function dealDelay(seatIndex: number, cardIndex: number) {
    if (phase.value !== 'deal') return 0
    const order = seats.value.filter(s => s?.game.cards.length).map(s => s!.index)
    const position = seatIndex < 0 ? order.length : Math.max(0, order.indexOf(seatIndex))
    return (cardIndex * (order.length + 1) + position) * 140
}
const boardDelay = (i: number) => {
    if (phase.value === 'deal') return (2 * ((seats.value.filter(s => s?.game.cards.length).length) + 1) + i) * 140
    if (phase.value === 'board') return (i - 3) * 450
    return 0
}

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

const outcomeLabel = { win: 'You win', lose: 'Dealer wins', push: 'Push', folded: 'Folded' }
</script>

<template>
  <TableShell
    slug="casino-holdem"
    felt="blue"
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
          <TablePlayingCard v-for="(card, i) in shared?.dealer.cards ?? []" :key="card.id" :card="card" :delay="dealDelay(-1, i)" />
        </div>
        <span v-if="shared?.dealer.label" class="rounded-full bg-black/40 px-2.5 py-0.5 text-xs font-bold">
          {{ shared.dealer.label }}<span v-if="!shared.dealer.qualified" class="text-white/60"> · doesn't qualify</span>
        </span>
        <div class="my-1 flex min-h-[4.5rem] items-center justify-center gap-1 rounded-2xl bg-black/20 px-2 py-1.5 sm:gap-1.5">
          <TablePlayingCard v-for="(card, i) in shared?.board ?? []" :key="card.id" :card="card" :delay="boardDelay(i)" />
          <span v-if="!shared?.board.length" class="text-xs text-white/40">The board</span>
        </div>
        <p class="text-center font-display text-[11px] font-bold tracking-widest text-star/80 uppercase">Dealer plays with a pair of fours or better</p>
      </div>

      <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
        <TableSeat
          v-for="(seat, index) in seats"
          :key="index"
          :seat="seat"
          :index="index"
          :mine="seat?.playerId === table.me.value"
          :active="phase === 'decision' && !!seat?.game.cards.length && !seat.game.decision"
          :can-sit="connected && !mySeat"
          @sit="table.sit"
        >
          <template v-if="seat">
            <div class="flex">
              <TablePlayingCard v-for="(card, c) in seat.game.cards" :key="card.id" :card="card" size="sm" :class="c ? '-ml-3' : ''" :delay="dealDelay(index, c)" :dim="seat.game.decision === 'fold'" />
            </div>
            <span v-if="showdown && seat.game.handLabel" class="max-w-full truncate rounded-full bg-black/40 px-1.5 text-[10px] font-semibold">{{ seat.game.handLabel }}</span>
            <span v-else-if="seat.game.decision" class="rounded-full bg-black/40 px-1.5 text-[10px] font-semibold uppercase">{{ seat.game.decision }}</span>
            <div class="flex items-end gap-1">
              <TableChipStack :amount="seat.game.aa || seat.game.pendingAa" size="sm" :label="false" />
              <TableChipStack :amount="seat.game.ante || seat.game.pendingAnte" size="sm" />
              <TableChipStack :amount="seat.game.call" size="sm" :label="false" />
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
          <TableBetSpot label="AA bonus" pays="up to 100:1" :amount="betting ? me!.pendingAa : me!.aa" :disabled="!betting || !me!.pendingAnte" :highlight="showdown && me!.aa ? (me!.aaMultiplier ? 'win' : 'lose') : null" @place="place('aa')" />
          <TableBetSpot label="Ante" pays="by paytable" :amount="betting ? me!.pendingAnte : me!.ante" :disabled="!betting" tone="border-star/60" :highlight="showdown && me!.ante ? (me!.outcome === 'win' ? 'win' : me!.outcome === 'push' ? null : 'lose') : null" @place="place('ante')" />
          <TableBetSpot label="Call" :pays="`${CH_CALL_MULTIPLIER}× ante · 1:1`" :amount="me!.call" disabled :highlight="showdown && me!.call ? (me!.outcome === 'win' ? 'win' : me!.outcome === 'lose' ? 'lose' : null) : null" />
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
          <p class="mr-auto text-sm">Call costs <span class="font-mono font-semibold">{{ formatCoins(me!.ante * CH_CALL_MULTIPLIER) }}</span>. Fold and you lose the ante.</p>
          <Button variant="outline" class="h-11 min-w-24" @click="decide(false)">Fold</Button>
          <Button class="h-11 min-w-24 font-display" :disabled="me!.ante * CH_CALL_MULTIPLIER > coins" @click="decide(true)">Call</Button>
        </div>

        <p v-else-if="showdown && me!.outcome" class="text-sm">
          {{ outcomeLabel[me!.outcome] }}<template v-if="me!.handLabel && me!.outcome !== 'folded'"> with {{ me!.handLabel }}</template>.
          <template v-if="me!.aaMultiplier"> AA bonus pays {{ me!.aaMultiplier }}:1 ({{ me!.aaLabel }}).</template>
          <span v-if="me!.net !== null" class="font-mono font-semibold" :class="me!.net > 0 ? 'text-success' : me!.net < 0 ? 'text-muted-foreground' : ''"> {{ me!.net > 0 ? '+' : me!.net < 0 ? '−' : '' }}{{ formatCoins(Math.abs(me!.net)) }}</span>
        </p>
        <p v-else class="text-sm text-muted-foreground">{{ me!.cards.length ? (me!.decision ? `You ${me!.decision}. Waiting for the table.` : 'Cards are coming.') : 'Betting opens with the next hand.' }}</p>
      </template>
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
  </TableShell>
</template>
