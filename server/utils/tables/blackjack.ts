import { payFor } from '#shared/money'
import { cryptoRng, type Rng } from '#shared/rng'
import { redact, Shoe } from '#shared/tables/cards'
import { isChip, scaleAmount, TABLE_MAX_BET, TABLE_MIN_BET } from '#shared/tables/chips'
import {
    BJ_RULES, BJ_SIDE_BET_LABELS, BJ_SIDE_BETS, BJ_TIMERS, canDouble, canSplit, canSurrender, cardValue,
    dealerHasBlackjack, dealerShouldHit, handScore, handStake, insuranceCost, isBjSpot, isBlackjack,
    settleHand, settleSideBets, type BjHand, type BjSideBet, type BjSpot
} from '#shared/tables/blackjack'
import type { BjGameEvent, BjSeat, BjShared, BjTableAction } from '#shared/tables/blackjack-wire'
import { bestMultiple, type BetReturn } from '#shared/missions'
import type { TablePayout } from '#shared/tables/protocol'
import { fail, LiveTable, type TableConfig, type TablePlayer } from './table'

const noSides = (): Record<BjSideBet, number> => ({ perfectPairs: 0, twentyOnePlusThree: 0 })
const sum = (sides: Record<BjSideBet, number>) => BJ_SIDE_BETS.reduce((total, key) => total + sides[key], 0)

type Player = TablePlayer<BjSeat>

/**
 * Live blackjack: up to five seats against one dealer. Chips sit on the
 * layout during betting and are escrowed when betting closes; doubles, splits
 * and insurance are escrowed when taken. Turns run seat by seat on a clock
 * that stands the hand when it runs out, so a player who drops still gets
 * settled.
 */
export class BlackjackTable extends LiveTable<BjSeat, BjShared, BjTableAction> {
    readonly config: TableConfig = {
        slug: 'blackjack',
        seats: BJ_RULES.seats,
        minBet: TABLE_MIN_BET,
        maxBet: TABLE_MAX_BET,
        disconnectGrace: BJ_TIMERS.disconnectGrace,
        disconnectGraceIdle: BJ_TIMERS.disconnectGraceIdle
    }

    private shoe: Shoe
    private dealerCards: BjHand['cards'] = []
    private activeSeat: number | null = null
    private activeHand: number | null = null
    private handSeq = 0

    constructor(rng: Rng = cryptoRng) {
        super()
        this.shoe = new Shoe(rng, BJ_RULES.decks, BJ_RULES.penetration)
    }

    protected createSeat(): BjSeat {
        return {
            pendingBet: 0,
            pendingSide: noSides(),
            chips: [],
            lastBet: 0,
            lastSide: noSides(),
            hands: [],
            sideResults: null,
            insurance: 0,
            insuranceDecided: false
        }
    }

    protected override seatGame(player: Player): BjSeat {
        return { ...player.game, hands: player.game.hands.map(hand => ({ ...hand, ...handScoreView(hand) })) }
    }

    protected shared(): BjShared {
        const cards = this.dealerCards.map(redact)
        const { total, soft } = handScore(cards)
        return {
            dealer: { cards, score: total, soft, blackjack: !cards.some(c => c.hidden) && dealerHasBlackjack(cards), busted: total > 21 },
            activeSeat: this.activeSeat,
            activeHand: this.activeHand,
            shoe: this.shoe.info()
        }
    }

    protected onTableActive() {
        this.enterBetting()
    }

    protected onAction(player: Player, action: BjTableAction) {
        switch (action.t) {
            case 'bet': return this.placeBet(player, action.spot, action.amount)
            case 'undo': return this.undo(player)
            case 'clear': return this.clear(player)
            case 'repeat': return this.repeat(player)
            case 'scale': return this.scale(player, action.factor)
            case 'insurance': return this.takeInsurance(player, action.take === true)
            case 'play': return this.play(player, action.action)
            default: fail('Unknown action')
        }
    }

    protected onPhaseEnd(phase: string) {
        switch (phase) {
            case 'betting': return this.closeBetting()
            case 'dealing': return this.afterDeal()
            case 'insurance': return this.peek()
            case 'playing': return this.autoStand()
            case 'beat': return this.nextTurn()
            case 'dealer': return this.dealerStep()
            case 'payout': return this.enterBetting()
        }
    }

    // ─── betting ─────────────────────────────────────────────────────────────

    private requireBetting() {
        if (this.phase !== 'betting') fail('Betting is closed')
    }

    private committed(seat: BjSeat) {
        return seat.pendingBet + sum(seat.pendingSide)
    }

    private placeBet(player: Player, spot: unknown, amount: unknown) {
        this.requireBetting()
        if (!isChip(amount)) fail('Invalid chip')
        if (!isBjSpot(spot)) fail('Invalid bet spot')
        const seat = player.game
        if (spot !== 'main' && seat.pendingBet <= 0) fail('Place your main bet first')
        const next = (spot === 'main' ? seat.pendingBet : seat.pendingSide[spot]) + amount
        if (next > this.config.maxBet) fail('Table maximum reached')
        if (this.committed(seat) + amount > player.balance) fail(this.notEnough(player))
        if (spot === 'main') seat.pendingBet = next
        else seat.pendingSide[spot] = next
        seat.chips.push({ spot, amount })
    }

    private undo(player: Player) {
        this.requireBetting()
        const seat = player.game
        const last = seat.chips.pop()
        if (!last) return
        if (last.spot === 'main') seat.pendingBet -= last.amount
        else seat.pendingSide[last.spot] -= last.amount
        // Side bets ride on a main bet.
        if (seat.pendingBet <= 0) this.clear(player)
    }

    private clear(player: Player) {
        this.requireBetting()
        player.game.pendingBet = 0
        player.game.pendingSide = noSides()
        player.game.chips = []
        player.votedStart = false
    }

    private setLayout(player: Player, bet: number, sides: Record<BjSideBet, number>) {
        if (bet < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
        for (const amount of [bet, ...BJ_SIDE_BETS.map(key => sides[key])]) {
            if (amount > this.config.maxBet) fail('Table maximum reached')
            if (amount > 0 && amount < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
        }
        if (bet + sum(sides) > player.balance) fail(this.notEnough(player))
        const seat = player.game
        seat.pendingBet = bet
        seat.pendingSide = { ...sides }
        seat.chips = [{ spot: 'main' as BjSpot, amount: bet }, ...BJ_SIDE_BETS.filter(key => sides[key] > 0).map(key => ({ spot: key as BjSpot, amount: sides[key] }))]
    }

    private repeat(player: Player) {
        this.requireBetting()
        if (!player.game.lastBet) fail('No previous bet')
        this.setLayout(player, player.game.lastBet, player.game.lastSide)
    }

    private scale(player: Player, factor: unknown) {
        this.requireBetting()
        if (factor !== 0.5 && factor !== 2) fail('Invalid scale')
        const seat = player.game
        const fromLayout = seat.pendingBet > 0
        const bet = fromLayout ? seat.pendingBet : seat.lastBet
        const sides = fromLayout ? seat.pendingSide : seat.lastSide
        if (!bet) fail('No bet to scale')
        const scaled = noSides()
        for (const key of BJ_SIDE_BETS) scaled[key] = scaleAmount(sides[key], factor)
        // A side bet halved under the minimum drops off rather than blocking the rest.
        for (const key of BJ_SIDE_BETS) if (scaled[key] < this.config.minBet) scaled[key] = 0
        this.setLayout(player, scaleAmount(bet, factor), scaled)
    }

    /** Everyone with a bet down has asked to deal: skip the rest of the clock. */
    protected override onVoteStart() {
        if (this.phase !== 'betting') return
        const seats = this.seated().filter(p => !p.leaving)
        if (seats.length && seats.every(p => p.game.pendingBet > 0 && p.votedStart)) this.closeBetting()
    }

    private enterBetting() {
        // Seats whose player asked to go, or dropped and never came back.
        this.releaseLeavers()
        if (!this.players.size) return
        this.roundId++
        this.dealerCards = []
        this.activeSeat = null
        this.activeHand = null
        this.nextRoundAt = null
        this.clearVotes()
        for (const player of this.seated()) {
            const { lastBet, lastSide } = player.game
            player.game = { ...this.createSeat(), lastBet, lastSide }
        }
        this.message = 'Place your bets'
        this.advance('betting', BJ_TIMERS.betting)
    }

    private closeBetting() {
        for (const player of this.seated()) {
            const seat = player.game
            if (seat.pendingBet <= 0 || !player.connected) continue
            const stakes = [{ amount: seat.pendingBet, kind: 'bet' }, ...BJ_SIDE_BETS.filter(key => seat.pendingSide[key] > 0).map(key => ({ amount: seat.pendingSide[key], kind: key }))]
            try {
                this.stake(player, stakes)
            } catch {
                // Short for the side bets: play the main bet alone if it fits.
                try {
                    this.stake(player, [stakes[0]!])
                    seat.pendingSide = noSides()
                } catch {
                    this.tell(player.playerId, `${this.notEnough(player)}: you sit this one out`)
                    continue
                }
            }
            seat.hands = [this.newHand(seat.pendingBet, false)]
            seat.lastBet = seat.pendingBet
            seat.lastSide = { ...seat.pendingSide }
            seat.chips = []
        }
        // No bet, no seat: tap a seat again to rejoin.
        for (const player of this.seated()) if (!player.game.hands.length) this.release(player)
        if (!this.inPlay().length) {
            if (this.players.size) this.enterBetting()
            return
        }
        this.deal()
    }

    // ─── the deal ────────────────────────────────────────────────────────────

    private inPlay(): Player[] {
        return this.seated().filter(p => p.game.hands.length > 0)
    }

    private newHand(bet: number, fromSplit: boolean): BjHand {
        return { id: `h${++this.handSeq}`, cards: [], bet, status: 'playing', doubled: false, fromSplit, score: 0, soft: false }
    }

    private deal() {
        if (this.shoe.needsShuffle) {
            this.shoe.shuffle()
            this.event({ type: 'shuffle' } satisfies BjGameEvent)
        }
        const seats = this.inPlay()
        for (const p of seats) p.game.hands[0]!.cards.push(this.shoe.draw())
        this.dealerCards.push(this.shoe.draw())
        for (const p of seats) p.game.hands[0]!.cards.push(this.shoe.draw())
        this.dealerCards.push(this.shoe.draw(true))
        for (const p of seats) {
            const hand = p.game.hands[0]!
            if (isBlackjack(hand)) hand.status = 'blackjack'
        }
        this.message = 'Dealing'
        this.advance('dealing', BJ_TIMERS.dealing)
    }

    private afterDeal() {
        const upcard = this.dealerCards[0]!
        // Side bets are decided by the opening cards; their money moves at settlement.
        for (const p of this.inPlay()) {
            const seat = p.game
            if (!sum(seat.pendingSide)) continue
            seat.sideResults = settleSideBets(seat.pendingSide, seat.hands[0]!.cards, upcard)
            for (const result of seat.sideResults) {
                if (result.stake > 0 && result.payout > 0) {
                    this.event({ type: 'side', seat: p.seatIndex, name: p.name, label: `${BJ_SIDE_BET_LABELS[result.key]}: ${result.label}`, payout: result.payout } satisfies BjGameEvent)
                }
            }
        }
        if (upcard.rank === 'A') {
            this.message = 'Insurance?'
            this.advance('insurance', BJ_TIMERS.insurance)
            return
        }
        if (cardValue(upcard.rank!) === 10) return this.peek()
        this.beginPlay()
    }

    private takeInsurance(player: Player, take: boolean) {
        if (this.phase !== 'insurance') fail('Insurance is closed')
        const seat = player.game
        const hand = seat.hands[0]
        if (!hand) fail('You are not in this round')
        if (seat.insuranceDecided) fail('Already decided')
        if (take) {
            const cost = insuranceCost(hand.bet)
            this.stake(player, [{ amount: cost, kind: 'insurance' }])
            seat.insurance = cost
        }
        seat.insuranceDecided = true
        if (this.inPlay().every(p => p.game.insuranceDecided || !p.connected)) this.peek()
    }

    private peek() {
        if (dealerHasBlackjack(this.dealerCards)) {
            this.revealHole()
            this.message = 'Dealer has blackjack'
            this.setPhase('dealer', BJ_TIMERS.dealerDraw)
            this.schedule(BJ_TIMERS.dealerDraw, () => this.settleRound())
            return
        }
        this.beginPlay()
    }

    private revealHole() {
        const hole = this.dealerCards[1]
        if (hole?.hidden) delete hole.hidden
    }

    // ─── turns ───────────────────────────────────────────────────────────────

    private beginPlay() {
        this.activeSeat = null
        this.activeHand = null
        this.nextTurn()
    }

    /** Move to the next hand still playing, in seat order, or to the dealer. */
    private nextTurn() {
        for (const p of this.inPlay()) {
            if (this.activeSeat !== null && p.seatIndex < this.activeSeat) continue
            const from = p.seatIndex === this.activeSeat ? this.activeHand! : 0
            const index = p.game.hands.findIndex((hand, i) => i >= from && hand.status === 'playing')
            if (index >= 0) {
                this.activeSeat = p.seatIndex
                this.activeHand = index
                return this.startTurn(p)
            }
        }
        this.dealerTurn()
    }

    private startTurn(player: Player) {
        this.message = `${player.name} to act`
        // Nobody to wait for: a dropped player's hands stand after a moment.
        this.advance('playing', player.connected ? BJ_TIMERS.turn : 2_000)
    }

    private current(): { player: Player, hand: BjHand } | null {
        const player = this.seated().find(p => p.seatIndex === this.activeSeat)
        const hand = player?.game.hands[this.activeHand ?? -1]
        return player && hand ? { player, hand } : null
    }

    private autoStand() {
        const turn = this.current()
        if (turn) turn.hand.status = 'stood'
        this.beat()
    }

    /** Hold on the hand that just finished before moving on. */
    private beat() {
        this.setPhase('beat', null)
        this.schedule(BJ_TIMERS.actionBeat, () => this.onPhaseEnd('beat'))
    }

    private play(player: Player, action: unknown) {
        if (this.phase !== 'playing') fail('Not your turn')
        const turn = this.current()
        if (!turn || turn.player !== player) fail('Not your turn')
        const { hand } = turn
        const seat = player.game
        switch (action) {
            case 'hit': {
                hand.cards.push(this.shoe.draw())
                const { total } = handScore(hand.cards)
                if (total >= 21) {
                    hand.status = total > 21 ? 'busted' : 'stood'
                    this.beat()
                } else {
                    this.startTurn(player)
                }
                break
            }
            case 'stand':
                hand.status = 'stood'
                this.beat()
                break
            case 'double':
                if (!canDouble(hand)) fail('You can\'t double now')
                this.stake(player, [{ amount: hand.bet, kind: 'double' }])
                hand.doubled = true
                hand.cards.push(this.shoe.draw())
                hand.status = handScore(hand.cards).total > 21 ? 'busted' : 'stood'
                this.beat()
                break
            case 'split': {
                if (!canSplit(hand, seat.hands)) fail('You can\'t split now')
                this.stake(player, [{ amount: hand.bet, kind: 'split' }])
                const aces = hand.cards[0]!.rank === 'A'
                const sibling = this.newHand(hand.bet, true)
                sibling.cards.push(hand.cards.pop()!)
                hand.fromSplit = true
                hand.cards.push(this.shoe.draw())
                sibling.cards.push(this.shoe.draw())
                seat.hands.splice(this.activeHand! + 1, 0, sibling)
                if (aces) {
                    // Split aces take one card each.
                    hand.status = 'stood'
                    sibling.status = 'stood'
                    this.beat()
                } else if (handScore(hand.cards).total === 21) {
                    hand.status = 'stood'
                    this.beat()
                } else {
                    this.startTurn(player)
                }
                break
            }
            case 'surrender':
                if (!canSurrender(hand, seat.hands)) fail('You can\'t surrender now')
                hand.status = 'surrendered'
                this.beat()
                break
            default:
                fail('Unknown action')
        }
        this.event({ type: 'action', seat: player.seatIndex, name: player.name, action: String(action) } satisfies BjGameEvent)
    }

    // ─── dealer and settlement ───────────────────────────────────────────────

    private dealerTurn() {
        this.activeSeat = null
        this.activeHand = null
        this.revealHole()
        this.message = 'Dealer plays'
        // The dealer only draws when a standing hand could still be beaten.
        const contested = this.inPlay().some(p => p.game.hands.some(hand => hand.status === 'stood'))
        this.setPhase('dealer', BJ_TIMERS.dealerDraw)
        this.schedule(BJ_TIMERS.dealerDraw, () => (contested ? this.dealerStep() : this.settleRound()))
    }

    private dealerStep() {
        if (!dealerShouldHit(this.dealerCards)) return this.settleRound()
        this.dealerCards.push(this.shoe.draw())
        this.setPhase('dealer', BJ_TIMERS.dealerDraw)
        this.schedule(BJ_TIMERS.dealerDraw, () => this.dealerStep())
    }

    private settleRound() {
        this.revealHole()
        const dealerBj = dealerHasBlackjack(this.dealerCards)
        const payouts: TablePayout[] = []
        for (const p of this.inPlay()) {
            const seat = p.game
            let staked = 0
            let payout = 0
            const bets: BetReturn[] = []
            for (const hand of seat.hands) {
                const result = settleHand(hand, this.dealerCards)
                hand.status = result.status
                hand.payout = result.payout
                hand.net = result.net
                staked += handStake(hand)
                payout += result.payout
                bets.push({ stake: handStake(hand), payout: result.payout })
            }
            if (seat.insurance > 0) {
                staked += seat.insurance
                if (dealerBj) payout += payFor(seat.insurance, 1 + BJ_RULES.insurancePays)
            }
            for (const side of seat.sideResults ?? []) {
                staked += side.stake
                payout += side.payout
                bets.push(side)
            }
            // Side bets that were placed but never resolved (no results yet) still count as staked.
            if (!seat.sideResults) staked += sum(seat.pendingSide)
            payouts.push({
                playerId: p.playerId,
                staked,
                payout,
                multiple: bestMultiple(bets),
                summary: { hands: seat.hands.map(hand => ({ cards: hand.cards.map(c => `${c.rank}${c.suit![0]}`), status: hand.status, bet: hand.bet, doubled: hand.doubled })), dealer: handScore(this.dealerCards).total, insurance: seat.insurance }
            })
        }
        this.settle(payouts)
        const seats = this.players.size
        const wait = Math.min(BJ_TIMERS.payoutMax, BJ_TIMERS.payoutBase + Math.max(0, seats - 1) * BJ_TIMERS.payoutPerExtraSeat)
        if (!seats) return
        const dealer = handScore(this.dealerCards).total
        this.message = dealerBj ? 'Dealer has blackjack' : dealer > 21 ? `Dealer busts with ${dealer}` : `Dealer stands on ${dealer}`
        this.nextRoundAt = Date.now() + wait
        this.advance('payout', wait)
    }
}

function handScoreView(hand: BjHand) {
    const { total, soft } = handScore(hand.cards)
    return { score: total, soft }
}

export const blackjackTable = new BlackjackTable()
