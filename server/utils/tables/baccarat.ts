import { cryptoRng, type Rng } from '#shared/rng'
import { Shoe } from '#shared/tables/cards'
import { isChip, scaleAmount, TABLE_MAX_BET, TABLE_MIN_BET } from '#shared/tables/chips'
import {
    BAC_SPOTS, BAC_TIMERS, bacTotal, dealBaccarat, emptyBacBets, isBacSpot, resolveBacBets, bacSpotReturn,
    type BacAction, type BacBets, type BacGameEvent, type BacHistoryEntry, type BacRound, type BacSeat, type BacShared
} from '#shared/tables/baccarat'
import { bestMultiple } from '#shared/missions'
import type { TablePayout } from '#shared/tables/protocol'
import { fail, LiveTable, type TableConfig, type TablePlayer } from './table'

const HISTORY_LIMIT = 72

type Player = TablePlayer<BacSeat>

/**
 * Live baccarat (punto banco): no decisions, so a round is betting, then one
 * hand dealt in full and revealed at the client's pace, then settlement.
 * Eight decks, reshuffled at the cut card; the roads reset with the shoe.
 */
export class BaccaratTable extends LiveTable<BacSeat, BacShared, BacAction> {
    readonly config: TableConfig = {
        slug: 'baccarat',
        seats: 5,
        minBet: TABLE_MIN_BET,
        maxBet: TABLE_MAX_BET,
        disconnectGrace: BAC_TIMERS.disconnectGrace,
        disconnectGraceIdle: BAC_TIMERS.disconnectGraceIdle
    }

    private shoe: Shoe
    private round: BacRound | null = null
    private history: BacHistoryEntry[] = []

    constructor(rng: Rng = cryptoRng) {
        super()
        this.shoe = new Shoe(rng, 8, 0.85)
    }

    protected createSeat(): BacSeat {
        return { bets: emptyBacBets(), chips: [], lastBets: emptyBacBets(), staked: emptyBacBets() }
    }

    protected shared(): BacShared {
        return { round: this.round, history: this.history, shoe: this.shoe.info() }
    }

    protected onTableActive() {
        this.startBetting()
    }

    protected onAction(player: Player, action: BacAction) {
        if (this.phase !== 'betting') fail('Betting is closed')
        const seat = player.game
        switch (action.t) {
            case 'bet': {
                if (!isBacSpot(action.spot)) fail('Invalid bet')
                if (!isChip(action.amount)) fail('Invalid chip')
                const next = seat.bets[action.spot] + action.amount
                if (next > this.config.maxBet) fail('Table maximum reached')
                if (bacTotal(seat.bets) + action.amount > player.balance) fail(this.notEnough(player))
                seat.bets[action.spot] = next
                seat.chips.push({ spot: action.spot, amount: action.amount })
                return
            }
            case 'undo': {
                const last = seat.chips.pop()
                if (last) seat.bets[last.spot] -= last.amount
                if (!bacTotal(seat.bets)) player.votedStart = false
                return
            }
            case 'clear':
                seat.bets = emptyBacBets()
                seat.chips = []
                player.votedStart = false
                return
            case 'repeat':
                if (!bacTotal(seat.lastBets)) fail('No previous bet')
                return this.setLayout(player, seat.lastBets)
            case 'scale': {
                if (action.factor !== 0.5 && action.factor !== 2) fail('Invalid scale')
                const base = bacTotal(seat.bets) ? seat.bets : seat.lastBets
                if (!bacTotal(base)) fail('No bet to scale')
                const target = emptyBacBets()
                for (const spot of BAC_SPOTS) {
                    const scaled = scaleAmount(base[spot], action.factor)
                    target[spot] = scaled >= this.config.minBet ? scaled : 0
                }
                return this.setLayout(player, target)
            }
            default:
                fail('Unknown action')
        }
    }

    private setLayout(player: Player, bets: BacBets) {
        const total = bacTotal(bets)
        if (!total) fail(`Minimum bet is ${this.config.minBet}`)
        for (const spot of BAC_SPOTS) if (bets[spot] > this.config.maxBet) fail('Table maximum reached')
        if (total > player.balance) fail(this.notEnough(player))
        player.game.bets = { ...bets }
        player.game.chips = BAC_SPOTS.filter(spot => bets[spot] > 0).map(spot => ({ spot, amount: bets[spot] }))
    }

    protected override onVoteStart() {
        if (this.phase !== 'betting') return
        const seats = this.seated().filter(p => !p.leaving)
        if (seats.length && seats.every(p => bacTotal(p.game.bets) > 0 && p.votedStart)) this.deal()
    }

    protected onPhaseEnd(phase: string) {
        switch (phase) {
            case 'betting': return this.deal()
            case 'dealing': return this.advance('resolve', BAC_TIMERS.resolve)
            case 'resolve': return this.settleRound()
            case 'payout': return this.startBetting()
        }
    }

    private startBetting() {
        this.releaseLeavers()
        if (!this.players.size) return
        if (this.shoe.needsShuffle) {
            this.shoe.shuffle()
            this.history = []
            this.event({ type: 'shuffle' } satisfies BacGameEvent)
        }
        this.roundId++
        this.round = null
        this.nextRoundAt = null
        this.clearVotes()
        for (const player of this.seated()) {
            const { lastBets } = player.game
            player.game = { ...this.createSeat(), lastBets }
        }
        this.message = 'Place your bets'
        this.advance('betting', BAC_TIMERS.betting)
    }

    private deal() {
        for (const player of this.seated()) {
            const seat = player.game
            const total = bacTotal(seat.bets)
            if (!total || !player.connected) continue
            try {
                this.stake(player, BAC_SPOTS.filter(spot => seat.bets[spot] > 0).map(spot => ({ amount: seat.bets[spot], kind: spot })))
                seat.staked = { ...seat.bets }
                seat.lastBets = { ...seat.bets }
            } catch {
                this.tell(player.playerId, `${this.notEnough(player)}: you sit this one out`)
            }
            seat.bets = emptyBacBets()
            seat.chips = []
        }
        for (const player of this.seated()) if (!bacTotal(player.game.staked)) this.release(player)
        if (!this.players.size) return
        this.round = dealBaccarat(this.shoe)
        const { winner } = this.round
        this.message = winner === 'tie' ? 'Tie' : `${winner === 'player' ? 'Player' : 'Banker'} wins`
        this.advance('dealing', BAC_TIMERS.dealing)
    }

    private settleRound() {
        const round = this.round!
        const payouts: TablePayout[] = []
        for (const player of this.seated()) {
            const bets = player.game.staked
            if (!bacTotal(bets)) continue
            const { staked, payout } = resolveBacBets(bets, round)
            const multiple = bestMultiple(BAC_SPOTS.map(spot => ({ stake: bets[spot], payout: bacSpotReturn(spot, bets[spot], round) })))
            payouts.push({ playerId: player.playerId, staked, payout, multiple, summary: { bets, winner: round.winner, player: round.playerTotal, banker: round.bankerTotal } })
        }
        this.settle(payouts)
        this.history.push({ winner: round.winner, playerPair: round.playerPair, bankerPair: round.bankerPair })
        if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT)
        if (!this.players.size) return
        this.nextRoundAt = Date.now() + BAC_TIMERS.payout
        this.advance('payout', BAC_TIMERS.payout)
    }
}

export const baccaratTable = new BaccaratTable()
