import { payFor } from '#shared/money'
import { cryptoRng, type Rng } from '#shared/rng'
import { faceOf, Shoe, type Card } from '#shared/tables/cards'
import { isChip, scaleAmount, TABLE_MAX_BET, TABLE_MIN_BET } from '#shared/tables/chips'
import {
    bestHand, CH_CALL_MULTIPLIER, CH_TIMERS, chDealerQualifies, evaluateFive, resolveCh,
    type ChAction, type ChHand, type ChSeat, type ChShared, type ChSpot
} from '#shared/tables/casino-holdem'
import { bestMultiple } from '#shared/missions'
import type { TablePayout } from '#shared/tables/protocol'
import { fail, LiveTable, type TableConfig, type TablePlayer } from './table'

type Player = TablePlayer<ChSeat>

const faceDown = (cards: Card[]) => cards.map(card => ({ id: card.id, hidden: true }))

/**
 * Casino Hold'em. Every seat plays the dealer, never another seat: two hole
 * cards and the flop, then one call-or-fold decision for everyone on the same
 * clock, then the turn and river and the showdown. A fresh deck every hand.
 */
export class CasinoHoldemTable extends LiveTable<ChSeat, ChShared, ChAction> {
    readonly config: TableConfig = {
        slug: 'casino-holdem',
        seats: 5,
        minBet: TABLE_MIN_BET,
        maxBet: TABLE_MAX_BET,
        disconnectGrace: CH_TIMERS.disconnectGrace,
        disconnectGraceIdle: CH_TIMERS.disconnectGraceIdle
    }

    private shoe: Shoe
    private board: Card[] = []
    private dealerCards: Card[] = []
    private dealerHand: ChHand | null = null

    constructor(rng: Rng = cryptoRng) {
        super()
        this.shoe = new Shoe(rng, 1, 0)
    }

    private get showdown() {
        return this.phase === 'reveal' || this.phase === 'payout'
    }

    protected createSeat(): ChSeat {
        return {
            pendingAnte: 0,
            pendingAa: 0,
            chips: [],
            ante: 0,
            aa: 0,
            call: 0,
            lastAnte: 0,
            lastAa: 0,
            cards: [],
            decision: null,
            handLabel: null,
            outcome: null,
            net: null,
            aaLabel: null,
            aaMultiplier: null
        }
    }

    protected override seatGame(player: Player, viewer: string | null): ChSeat {
        if (this.showdown || player.playerId === viewer) return player.game
        return { ...player.game, cards: faceDown(player.game.cards) }
    }

    protected shared(): ChShared {
        const shown = this.showdown && this.dealerHand
        return {
            board: this.board,
            dealer: {
                cards: shown ? this.dealerCards : faceDown(this.dealerCards),
                label: shown ? this.dealerHand!.label : null,
                qualified: shown ? chDealerQualifies(this.dealerHand!) : null
            }
        }
    }

    protected onTableActive() {
        this.startBetting()
    }

    protected onAction(player: Player, action: ChAction) {
        if (action.t === 'decide') return this.decide(player, action.call === true)
        if (this.phase !== 'betting') fail('Betting is closed')
        const seat = player.game
        switch (action.t) {
            case 'bet': {
                if (action.spot !== 'ante' && action.spot !== 'aa') fail('Invalid bet spot')
                if (!isChip(action.amount)) fail('Invalid chip')
                const ante = seat.pendingAnte + (action.spot === 'ante' ? action.amount : 0)
                const aa = seat.pendingAa + (action.spot === 'aa' ? action.amount : 0)
                if (action.spot === 'aa' && !seat.pendingAnte) fail('Place an ante first')
                this.check(player, ante, aa)
                seat.pendingAnte = ante
                seat.pendingAa = aa
                seat.chips.push({ spot: action.spot, amount: action.amount })
                return this.maybeCut()
            }
            case 'undo': {
                const last = seat.chips.pop()
                if (!last) return
                if (last.spot === 'ante') seat.pendingAnte -= last.amount
                else seat.pendingAa -= last.amount
                // The bonus can't outgrow the ante left behind it.
                seat.pendingAa = Math.min(seat.pendingAa, seat.pendingAnte)
                if (!seat.pendingAnte) {
                    seat.chips = []
                    player.votedStart = false
                }
                return
            }
            case 'clear':
                seat.pendingAnte = 0
                seat.pendingAa = 0
                seat.chips = []
                player.votedStart = false
                return
            case 'repeat':
                if (!seat.lastAnte) fail('No previous bet')
                return this.setLayout(player, seat.lastAnte, seat.lastAa)
            case 'scale': {
                if (action.factor !== 0.5 && action.factor !== 2) fail('Invalid scale')
                const fromLayout = seat.pendingAnte > 0
                const ante = fromLayout ? seat.pendingAnte : seat.lastAnte
                const aa = fromLayout ? seat.pendingAa : seat.lastAa
                if (!ante) fail('No bet to scale')
                const scaledAa = scaleAmount(aa, action.factor)
                return this.setLayout(player, scaleAmount(ante, action.factor), scaledAa >= this.config.minBet ? scaledAa : 0)
            }
            default:
                fail('Unknown action')
        }
    }

    /** The call costs twice the ante, so the layout has to leave room for it. */
    private check(player: Player, ante: number, aa: number) {
        if (ante > this.config.maxBet) fail('Table maximum reached')
        if (aa > ante) fail('The AA bonus can\'t exceed your ante')
        if (ante + aa + ante * CH_CALL_MULTIPLIER > player.balance) fail(`${this.notEnough(player)} (the call costs ${CH_CALL_MULTIPLIER}× your ante)`)
    }

    private setLayout(player: Player, ante: number, aa: number) {
        if (ante < this.config.minBet) fail(`Minimum ante is ${this.config.minBet}`)
        this.check(player, ante, aa)
        player.game.pendingAnte = ante
        player.game.pendingAa = aa
        player.game.chips = [{ spot: 'ante', amount: ante }, ...(aa ? [{ spot: 'aa' as ChSpot, amount: aa }] : [])]
        this.maybeCut()
    }

    private maybeCut() {
        const seats = this.seated().filter(p => !p.leaving)
        if (seats.length && seats.every(p => p.game.pendingAnte > 0)) this.shortenPhase(CH_TIMERS.bettingCut)
    }

    protected override onVoteStart() {
        if (this.phase !== 'betting') return
        const seats = this.seated().filter(p => !p.leaving)
        if (seats.length && seats.every(p => p.game.pendingAnte > 0 && p.votedStart)) this.dealHand()
    }

    protected onPhaseEnd(phase: string) {
        switch (phase) {
            case 'betting': return this.dealHand()
            case 'deal': return this.openDecision()
            case 'decision': return this.dealTurnAndRiver()
            case 'board': return this.reveal()
            case 'reveal': return this.payRound()
            case 'payout': return this.startBetting()
        }
    }

    private startBetting() {
        this.releaseLeavers()
        if (!this.players.size) return
        this.roundId++
        this.board = []
        this.dealerCards = []
        this.dealerHand = null
        this.nextRoundAt = null
        this.clearVotes()
        for (const player of this.seated()) {
            const { lastAnte, lastAa } = player.game
            player.game = { ...this.createSeat(), lastAnte, lastAa }
        }
        this.message = 'Place your ante'
        this.advance('betting', CH_TIMERS.betting)
    }

    private inHand(): Player[] {
        return this.seated().filter(p => p.game.cards.length > 0)
    }

    private dealHand() {
        for (const player of this.seated()) {
            const seat = player.game
            if (seat.pendingAnte <= 0 || !player.connected) continue
            try {
                this.stake(player, [{ amount: seat.pendingAnte, kind: 'ante' }, ...(seat.pendingAa ? [{ amount: seat.pendingAa, kind: 'aa' }] : [])])
                seat.aa = seat.pendingAa
            } catch {
                try {
                    this.stake(player, [{ amount: seat.pendingAnte, kind: 'ante' }])
                } catch {
                    this.tell(player.playerId, `${this.notEnough(player)}: you sit this one out`)
                    seat.pendingAnte = 0
                }
            }
            if (seat.pendingAnte) {
                seat.ante = seat.lastAnte = seat.pendingAnte
                seat.lastAa = seat.aa
            }
            seat.pendingAnte = 0
            seat.pendingAa = 0
            seat.chips = []
        }
        for (const player of this.seated()) if (!player.game.ante) this.release(player)
        const entrants = this.seated()
        if (!entrants.length) return
        this.shoe.shuffle()
        for (let i = 0; i < 2; i++) {
            for (const player of entrants) player.game.cards.push(this.shoe.draw())
            this.dealerCards.push(this.shoe.draw())
        }
        this.board = [this.shoe.draw(), this.shoe.draw(), this.shoe.draw()]
        this.message = 'The flop is out'
        this.advance('deal', CH_TIMERS.deal)
    }

    private openDecision() {
        this.message = 'Call or fold'
        this.advance('decision', CH_TIMERS.decision)
        this.maybeEndDecision()
    }

    private decide(player: Player, call: boolean) {
        if (this.phase !== 'decision') fail('Not the time to decide')
        const seat = player.game
        if (!seat.cards.length) fail('You are not in this hand')
        if (seat.decision) fail('You already decided')
        if (call) {
            const amount = seat.ante * CH_CALL_MULTIPLIER
            // Staked before the decision is recorded: a seat that can't cover it can still fold.
            this.stake(player, [{ amount, kind: 'call' }])
            seat.call = amount
        }
        seat.decision = call ? 'call' : 'fold'
        this.maybeEndDecision()
    }

    private maybeEndDecision() {
        if (this.phase !== 'decision') return
        if (this.inHand().every(p => p.game.decision || !p.connected)) this.shortenPhase(CH_TIMERS.decisionCut)
    }

    private dealTurnAndRiver() {
        // Running out the clock is a fold.
        for (const player of this.inHand()) if (!player.game.decision) player.game.decision = 'fold'
        this.board.push(this.shoe.draw(), this.shoe.draw())
        this.message = 'Turn and river'
        this.advance('board', CH_TIMERS.board)
    }

    private resolve(player: Player) {
        const seat = player.game
        const hole = seat.cards.map(faceOf)
        const board = this.board.map(faceOf)
        const folded = seat.decision !== 'call'
        const aaHand = seat.aa > 0 ? evaluateFive([...hole, ...board.slice(0, 3)]) : null
        const hand = bestHand([...hole, ...board])
        return { hand, aaHand, result: resolveCh({ ante: seat.ante, call: seat.call, aa: seat.aa }, { folded, player: folded ? null : hand, dealer: this.dealerHand!, aa: aaHand }) }
    }

    private reveal() {
        this.dealerHand = bestHand([...this.dealerCards, ...this.board].map(faceOf))
        for (const player of this.inHand()) {
            const { hand, aaHand, result } = this.resolve(player)
            const seat = player.game
            seat.handLabel = hand.label
            seat.outcome = result.outcome
            seat.net = result.net
            seat.aaLabel = aaHand?.label ?? null
            seat.aaMultiplier = aaHand ? result.aaMultiplier : null
        }
        this.message = chDealerQualifies(this.dealerHand) ? `Dealer: ${this.dealerHand.label}` : `Dealer doesn't qualify: ${this.dealerHand.label}`
        this.nextRoundAt = Date.now() + CH_TIMERS.reveal + this.payoutHold()
        this.advance('reveal', CH_TIMERS.reveal)
    }

    private payoutHold() {
        return Math.min(CH_TIMERS.payoutMax, CH_TIMERS.payoutBase + Math.max(0, this.inHand().length - 1) * CH_TIMERS.payoutPerExtraSeat)
    }

    private payRound() {
        const payouts: TablePayout[] = []
        for (const player of this.inHand()) {
            const { hand, result } = this.resolve(player)
            const seat = player.game
            payouts.push({
                playerId: player.playerId,
                staked: result.staked,
                payout: result.payout,
                multiple: bestMultiple([
                    { stake: seat.aa, payout: result.aaMultiplier ? payFor(seat.aa, 1 + result.aaMultiplier) : 0 },
                    { stake: seat.ante + seat.call, payout: result.payout - (result.aaMultiplier ? payFor(seat.aa, 1 + result.aaMultiplier) : 0) }
                ]),
                summary: { hand: hand.label, dealer: this.dealerHand!.label, outcome: result.outcome, ante: seat.ante, call: seat.call, aa: seat.aa }
            })
        }
        const hold = this.payoutHold()
        this.settle(payouts)
        if (!this.players.size) return
        this.nextRoundAt = Date.now() + hold
        this.advance('payout', hold)
    }
}

export const casinoHoldemTable = new CasinoHoldemTable()
