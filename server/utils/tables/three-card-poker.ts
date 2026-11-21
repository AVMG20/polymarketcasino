import { cryptoRng, type Rng } from '#shared/rng'
import { faceOf, Shoe, type Card } from '#shared/tables/cards'
import { isChip, scaleAmount, TABLE_MAX_BET, TABLE_MIN_BET } from '#shared/tables/chips'
import {
    evaluateTcp, resolveTcp, TCP_TIMERS, tcpDealerQualifies,
    type TcpAction, type TcpHand, type TcpSeat, type TcpShared, type TcpSpot
} from '#shared/tables/three-card-poker'
import type { TablePayout } from '#shared/tables/protocol'
import { fail, LiveTable, type TableConfig, type TablePlayer } from './table'

type Player = TablePlayer<TcpSeat>

const view = (hand: TcpHand) => ({ category: hand.category, label: hand.label })
const faceDown = (cards: Card[]) => cards.map(card => ({ id: card.id, hidden: true }))

/**
 * Three card poker. Every seat plays its own three cards against the dealer,
 * so there is no turn order: one shared play-or-fold window, and a seat that
 * lets it run out folds. A fresh shuffled deck every hand.
 */
export class ThreeCardPokerTable extends LiveTable<TcpSeat, TcpShared, TcpAction> {
    readonly config: TableConfig = {
        slug: 'three-card-poker',
        seats: 5,
        minBet: TABLE_MIN_BET,
        maxBet: TABLE_MAX_BET,
        disconnectGrace: TCP_TIMERS.disconnectGrace,
        disconnectGraceIdle: TCP_TIMERS.disconnectGraceIdle
    }

    private shoe: Shoe
    private dealerCards: Card[] = []
    private dealerHand: TcpHand | null = null

    constructor(rng: Rng = cryptoRng) {
        super()
        this.shoe = new Shoe(rng, 1, 0)
    }

    private get showdown() {
        return this.phase === 'reveal' || this.phase === 'payout'
    }

    protected createSeat(): TcpSeat {
        return {
            pendingAnte: 0,
            pendingPairPlus: 0,
            chips: [],
            ante: 0,
            pairPlus: 0,
            play: 0,
            lastAnte: 0,
            lastPairPlus: 0,
            cards: [],
            hand: null,
            decision: null,
            result: null
        }
    }

    /** Hole cards are the seat's own until the showdown. */
    protected override seatGame(player: Player, viewer: string | null): TcpSeat {
        if (this.showdown || player.playerId === viewer) return player.game
        return { ...player.game, cards: faceDown(player.game.cards), hand: null }
    }

    protected shared(): TcpShared {
        const shown = this.showdown && this.dealerHand
        return {
            dealer: {
                cards: shown ? this.dealerCards : faceDown(this.dealerCards),
                hand: shown ? view(this.dealerHand!) : null,
                qualified: shown ? tcpDealerQualifies(this.dealerHand!) : null
            }
        }
    }

    protected onTableActive() {
        this.startBetting()
    }

    protected onAction(player: Player, action: TcpAction) {
        if (action.t === 'decide') return this.decide(player, action.play === true)
        if (this.phase !== 'betting') fail('Betting is closed')
        const seat = player.game
        switch (action.t) {
            case 'bet':
                return this.placeBet(player, action.spot, action.amount)
            case 'undo': {
                const last = seat.chips.pop()
                if (!last) return
                if (last.spot === 'ante') seat.pendingAnte -= last.amount
                else seat.pendingPairPlus -= last.amount
                if (!seat.pendingAnte) player.votedStart = false
                return
            }
            case 'clear':
                seat.pendingAnte = 0
                seat.pendingPairPlus = 0
                seat.chips = []
                player.votedStart = false
                return
            case 'repeat':
                if (!seat.lastAnte) fail('No previous bet')
                return this.setLayout(player, seat.lastAnte, seat.lastPairPlus)
            case 'scale': {
                if (action.factor !== 0.5 && action.factor !== 2) fail('Invalid scale')
                const fromLayout = seat.pendingAnte > 0
                const ante = fromLayout ? seat.pendingAnte : seat.lastAnte
                const pairPlus = fromLayout ? seat.pendingPairPlus : seat.lastPairPlus
                if (!ante) fail('No bet to scale')
                const scaledPairPlus = scaleAmount(pairPlus, action.factor)
                return this.setLayout(player, scaleAmount(ante, action.factor), scaledPairPlus >= this.config.minBet ? scaledPairPlus : 0)
            }
            default:
                fail('Unknown action')
        }
    }

    /** Playing costs a second ante, so the layout keeps room for it. */
    private affordable(player: Player, ante: number, pairPlus: number) {
        if (ante * 2 + pairPlus > player.balance) fail('Not enough coins (playing costs another ante)')
    }

    private placeBet(player: Player, spot: unknown, amount: unknown) {
        if (spot !== 'ante' && spot !== 'pairPlus') fail('Invalid bet spot')
        if (!isChip(amount)) fail('Invalid chip')
        const seat = player.game
        const ante = seat.pendingAnte + (spot === 'ante' ? amount : 0)
        const pairPlus = seat.pendingPairPlus + (spot === 'pairPlus' ? amount : 0)
        if (Math.max(ante, pairPlus) > this.config.maxBet) fail('Table maximum reached')
        this.affordable(player, ante, pairPlus)
        seat.pendingAnte = ante
        seat.pendingPairPlus = pairPlus
        seat.chips.push({ spot: spot as TcpSpot, amount })
        this.maybeCut()
    }

    private setLayout(player: Player, ante: number, pairPlus: number) {
        if (ante < this.config.minBet) fail(`Minimum ante is ${this.config.minBet}`)
        if (Math.max(ante, pairPlus) > this.config.maxBet) fail('Table maximum reached')
        this.affordable(player, ante, pairPlus)
        const seat = player.game
        seat.pendingAnte = ante
        seat.pendingPairPlus = pairPlus
        seat.chips = [{ spot: 'ante', amount: ante }, ...(pairPlus ? [{ spot: 'pairPlus' as TcpSpot, amount: pairPlus }] : [])]
        this.maybeCut()
    }

    /** Every seat has an ante down: no need to sit through the whole clock. */
    private maybeCut() {
        const seats = this.seated().filter(p => !p.leaving)
        if (seats.length && seats.every(p => p.game.pendingAnte > 0)) this.shortenPhase(TCP_TIMERS.bettingCut)
    }

    protected override onVoteStart() {
        if (this.phase !== 'betting') return
        const seats = this.seated().filter(p => !p.leaving)
        if (seats.length && seats.every(p => p.game.pendingAnte > 0 && p.votedStart)) this.dealRound()
    }

    protected onPhaseEnd(phase: string) {
        switch (phase) {
            case 'betting': return this.dealRound()
            case 'dealing': return this.openDecision()
            case 'decision': return this.closeDecision()
            case 'reveal': return this.payRound()
            case 'payout': return this.startBetting()
        }
    }

    private startBetting() {
        this.releaseLeavers()
        if (!this.players.size) return
        this.roundId++
        this.dealerCards = []
        this.dealerHand = null
        this.nextRoundAt = null
        this.clearVotes()
        for (const player of this.seated()) {
            const { lastAnte, lastPairPlus } = player.game
            player.game = { ...this.createSeat(), lastAnte, lastPairPlus }
        }
        this.message = 'Place your ante'
        this.advance('betting', TCP_TIMERS.betting)
    }

    private inRound(): Player[] {
        return this.seated().filter(p => p.game.ante > 0)
    }

    private dealRound() {
        for (const player of this.seated()) {
            const seat = player.game
            if (seat.pendingAnte <= 0 || !player.connected) continue
            try {
                this.stake(player, [{ amount: seat.pendingAnte, kind: 'ante' }, ...(seat.pendingPairPlus ? [{ amount: seat.pendingPairPlus, kind: 'pairPlus' }] : [])])
                seat.ante = seat.lastAnte = seat.pendingAnte
                seat.pairPlus = seat.lastPairPlus = seat.pendingPairPlus
            } catch {
                this.tell(player.playerId, 'Not enough coins: you sit this one out')
            }
            seat.pendingAnte = 0
            seat.pendingPairPlus = 0
            seat.chips = []
        }
        for (const player of this.seated()) if (!player.game.ante) this.release(player)
        const active = this.inRound()
        if (!active.length) return
        this.shoe.shuffle()
        for (let i = 0; i < 3; i++) {
            for (const player of active) player.game.cards.push(this.shoe.draw())
            this.dealerCards.push(this.shoe.draw())
        }
        for (const player of active) player.game.hand = view(evaluateTcp(player.game.cards.map(faceOf)))
        this.dealerHand = evaluateTcp(this.dealerCards.map(faceOf))
        this.message = 'Dealing'
        this.advance('dealing', TCP_TIMERS.dealing)
    }

    private openDecision() {
        this.message = 'Play or fold'
        this.advance('decision', TCP_TIMERS.decision)
        this.maybeEndDecision()
    }

    private decide(player: Player, play: boolean) {
        if (this.phase !== 'decision') fail('Not the time to decide')
        const seat = player.game
        if (!seat.ante) fail('You are not in this hand')
        if (seat.decision) fail('You already decided')
        if (play) {
            // Staked before the decision is recorded: a seat that can't cover it can still fold.
            this.stake(player, [{ amount: seat.ante, kind: 'play' }])
            seat.play = seat.ante
        }
        seat.decision = play ? 'play' : 'fold'
        this.maybeEndDecision()
    }

    /** Everyone still able to answer has: show the dealer after a beat. */
    private maybeEndDecision() {
        if (this.phase !== 'decision') return
        if (this.inRound().every(p => p.game.decision || !p.connected)) this.shortenPhase(TCP_TIMERS.decisionCut)
    }

    private closeDecision() {
        for (const player of this.inRound()) if (!player.game.decision) player.game.decision = 'fold'
        const dealer = this.dealerHand!
        for (const player of this.inRound()) {
            const seat = player.game
            const result = resolveTcp({ ante: seat.ante, pairPlus: seat.pairPlus, played: seat.decision === 'play' }, evaluateTcp(seat.cards.map(faceOf)), dealer)
            seat.result = { net: result.net, dealerQualified: result.dealerQualified, ante: result.ante, play: result.play, anteBonus: result.anteBonus, pairPlus: result.pairPlus }
        }
        this.message = tcpDealerQualifies(dealer) ? `Dealer: ${dealer.label}` : `Dealer doesn't qualify: ${dealer.label}`
        this.nextRoundAt = Date.now() + TCP_TIMERS.reveal + this.payoutHold()
        this.advance('reveal', TCP_TIMERS.reveal)
    }

    private payoutHold() {
        return Math.min(TCP_TIMERS.payoutMax, TCP_TIMERS.payoutBase + Math.max(0, this.inRound().length - 1) * TCP_TIMERS.payoutPerExtraSeat)
    }

    private payRound() {
        const dealer = this.dealerHand!
        const payouts: TablePayout[] = []
        for (const player of this.inRound()) {
            const seat = player.game
            const hand = evaluateTcp(seat.cards.map(faceOf))
            const result = resolveTcp({ ante: seat.ante, pairPlus: seat.pairPlus, played: seat.decision === 'play' }, hand, dealer)
            payouts.push({ playerId: player.playerId, staked: result.staked, payout: result.payout, summary: { hand: hand.label, dealer: dealer.label, decision: seat.decision, ante: seat.ante, pairPlus: seat.pairPlus } })
        }
        const hold = this.payoutHold()
        this.settle(payouts)
        if (!this.players.size) return
        this.nextRoundAt = Date.now() + hold
        this.advance('payout', hold)
    }
}

export const threeCardPokerTable = new ThreeCardPokerTable()
