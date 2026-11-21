import type { Card, Rank, Suit } from './cards'
import { isRed } from './cards'

/**
 * Live blackjack: house rules, hand maths, settlement and the two side bets.
 * Shared so the client can grey out what the server would refuse, and so the
 * RTP script plays exactly these rules.
 *
 * Six decks, dealer stands on all 17s, blackjack pays 3:2, double on any two
 * cards (also after a split), split to four hands, split aces take one card
 * each, late surrender on the first two cards, insurance 2:1.
 */
export const BJ_RULES = {
    decks: 6,
    penetration: 0.75,
    seats: 5,
    maxHands: 4,
    insurancePays: 2
} as const

export const BJ_TIMERS = {
    betting: 15_000,
    dealing: 2_200,
    insurance: 10_000,
    turn: 20_000,
    dealerDraw: 900,
    /** A beat after a hand finishes before the turn moves on. */
    actionBeat: 900,
    payoutBase: 3_000,
    payoutPerExtraSeat: 800,
    payoutMax: 6_000,
    disconnectGrace: 45_000,
    disconnectGraceIdle: 10_000
} as const

export type BjSideBet = 'perfectPairs' | 'twentyOnePlusThree'
export type BjSpot = 'main' | BjSideBet
export const BJ_SIDE_BETS: readonly BjSideBet[] = ['perfectPairs', 'twentyOnePlusThree']
export const BJ_SIDE_BET_LABELS: Record<BjSideBet, string> = { perfectPairs: 'Perfect Pairs', twentyOnePlusThree: '21+3' }

export function isBjSpot(value: unknown): value is BjSpot {
    return value === 'main' || value === 'perfectPairs' || value === 'twentyOnePlusThree'
}

export type BjHandStatus = 'playing' | 'stood' | 'busted' | 'blackjack' | 'surrendered' | 'won' | 'lost' | 'push'

export interface BjHand {
    id: string
    cards: Card[]
    bet: number
    status: BjHandStatus
    doubled: boolean
    fromSplit: boolean
    /** Best total of the face-up cards. */
    score: number
    soft: boolean
    /** Returned once settled, stake included. */
    payout?: number
    net?: number
}

const TENS: readonly Rank[] = ['10', 'J', 'Q', 'K']

export function cardValue(rank: Rank): number {
    if (rank === 'A') return 11
    return TENS.includes(rank) ? 10 : Number(rank)
}

/** Best total of the face-up cards, and whether an ace still counts 11. */
export function handScore(cards: readonly Card[]): { total: number, soft: boolean } {
    let total = 0
    let aces = 0
    for (const card of cards) {
        if (!card.rank || card.hidden) continue
        if (card.rank === 'A') aces++
        total += cardValue(card.rank)
    }
    while (total > 21 && aces > 0) {
        total -= 10
        aces--
    }
    return { total, soft: aces > 0 }
}

export function isBlackjack(hand: Pick<BjHand, 'cards' | 'fromSplit'>): boolean {
    return !hand.fromSplit && hand.cards.length === 2 && handScore(hand.cards).total === 21
}

function isAcePair(hand: Pick<BjHand, 'cards'>): boolean {
    return hand.cards.length === 2 && hand.cards[0]?.rank === 'A' && hand.cards[1]?.rank === 'A'
}

export function canDouble(hand: BjHand): boolean {
    return hand.status === 'playing' && !hand.doubled && hand.cards.length === 2
}

export function canSplit(hand: BjHand, seatHands: readonly BjHand[]): boolean {
    if (hand.status !== 'playing' || hand.cards.length !== 2 || seatHands.length >= BJ_RULES.maxHands) return false
    const [a, b] = hand.cards
    if (!a?.rank || !b?.rank || cardValue(a.rank) !== cardValue(b.rank)) return false
    // Split aces take one card and stand, so a split ace never reaches here
    // playing; the check keeps resplitting aces off even if that changes.
    return !(hand.fromSplit && isAcePair(hand))
}

export function canSurrender(hand: BjHand, seatHands: readonly BjHand[]): boolean {
    return hand.status === 'playing' && hand.cards.length === 2 && !hand.fromSplit && seatHands.length === 1
}

export function canHit(hand: BjHand): boolean {
    return hand.status === 'playing' && handScore(hand.cards).total < 21
}

/** The dealer draws to 16 and stands on every 17, soft ones too. */
export function dealerShouldHit(cards: readonly Card[]): boolean {
    return handScore(cards).total < 17
}

export function dealerHasBlackjack(cards: readonly Card[]): boolean {
    return cards.length === 2 && handScore(cards.map(card => ({ ...card, hidden: false }))).total === 21
}

/** What a hand put up: its bet, twice over once doubled. */
export function handStake(hand: Pick<BjHand, 'bet' | 'doubled'>): number {
    return hand.doubled ? hand.bet * 2 : hand.bet
}

export interface BjSettlement {
    status: BjHandStatus
    /** Returned to the player, stake included, in whole coins. */
    payout: number
    net: number
}

/** Settle one hand against the dealer's final cards. Pays round down to the coin. */
export function settleHand(hand: BjHand, dealerCards: readonly Card[]): BjSettlement {
    const staked = handStake(hand)
    const result = (status: BjHandStatus, payout: number): BjSettlement => ({ status, payout, net: payout - staked })

    if (hand.status === 'surrendered') return result('surrendered', Math.floor(staked / 2))
    const player = handScore(hand.cards).total
    if (player > 21) return result('busted', 0)

    const dealerBj = dealerHasBlackjack(dealerCards)
    if (isBlackjack(hand)) return dealerBj ? result('push', staked) : result('blackjack', Math.floor(staked * 2.5))
    if (dealerBj) return result('lost', 0)

    const dealer = handScore(dealerCards.map(card => ({ ...card, hidden: false }))).total
    if (dealer > 21 || player > dealer) return result('won', staked * 2)
    if (player === dealer) return result('push', staked)
    return result('lost', 0)
}

/** Insurance costs half the bet, rounded down. */
export function insuranceCost(bet: number): number {
    return Math.floor(bet / 2)
}

// ─── side bets ───────────────────────────────────────────────────────────────

/** Both side bets read only the player's first two cards and the dealer's upcard. */
export type PerfectPairsTier = 'perfect' | 'coloured' | 'mixed'
export type TwentyOnePlusThreeTier = 'suitedTrips' | 'straightFlush' | 'trips' | 'straight' | 'flush'

/** Multiples of the side bet, paid on top of the returned stake. */
export const PERFECT_PAIRS_PAYS: Record<PerfectPairsTier, number> = { perfect: 25, coloured: 12, mixed: 6 }
export const TWENTY_ONE_PLUS_THREE_PAYS: Record<TwentyOnePlusThreeTier, number> = {
    suitedTrips: 100,
    straightFlush: 40,
    trips: 30,
    straight: 10,
    flush: 5
}

export const PERFECT_PAIRS_LABELS: Record<PerfectPairsTier, string> = { perfect: 'Perfect pair', coloured: 'Coloured pair', mixed: 'Mixed pair' }
export const TWENTY_ONE_PLUS_THREE_LABELS: Record<TwentyOnePlusThreeTier, string> = {
    suitedTrips: 'Suited trips',
    straightFlush: 'Straight flush',
    trips: 'Three of a kind',
    straight: 'Straight',
    flush: 'Flush'
}

export function perfectPairsTier(a: Card, b: Card): PerfectPairsTier | null {
    if (!a.rank || !b.rank || !a.suit || !b.suit || a.rank !== b.rank) return null
    if (a.suit === b.suit) return 'perfect'
    return isRed(a.suit) === isRed(b.suit) ? 'coloured' : 'mixed'
}

const STRAIGHT_ORDER: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

function isRun(values: number[]): boolean {
    const [a, b, c] = [...values].sort((x, y) => x - y)
    return b === a! + 1 && c === b! + 1
}

/** The ace plays at both ends: A-2-3 and Q-K-A are both straights. */
function isStraight(ranks: Rank[]): boolean {
    const low = ranks.map(rank => STRAIGHT_ORDER.indexOf(rank) + 1)
    if (isRun(low)) return true
    return isRun(ranks.map(rank => (rank === 'A' ? 14 : STRAIGHT_ORDER.indexOf(rank) + 1)))
}

export function twentyOnePlusThreeTier(a: Card, b: Card, upcard: Card): TwentyOnePlusThreeTier | null {
    const cards = [a, b, upcard]
    if (cards.some(card => !card.rank || !card.suit)) return null
    const ranks = cards.map(card => card.rank!)
    const suits = cards.map(card => card.suit!) as Suit[]
    const flush = suits[0] === suits[1] && suits[1] === suits[2]
    const trips = ranks[0] === ranks[1] && ranks[1] === ranks[2]
    if (trips && flush) return 'suitedTrips'
    const straight = isStraight(ranks)
    if (straight && flush) return 'straightFlush'
    if (trips) return 'trips'
    if (straight) return 'straight'
    return flush ? 'flush' : null
}

export interface BjSideResult {
    key: BjSideBet
    stake: number
    /** The winning combination, null when the bet lost. */
    label: string | null
    multiplier: number
    /** Stake plus winnings, zero on a loss. */
    payout: number
}

export function settleSideBets(stakes: Record<BjSideBet, number>, playerCards: readonly Card[], upcard: Card): BjSideResult[] {
    const [first, second] = playerCards
    const pp = first && second ? perfectPairsTier(first, second) : null
    const tp = first && second ? twentyOnePlusThreeTier(first, second, upcard) : null
    return [
        {
            key: 'perfectPairs',
            stake: stakes.perfectPairs,
            label: pp ? PERFECT_PAIRS_LABELS[pp] : null,
            multiplier: pp ? PERFECT_PAIRS_PAYS[pp] : 0,
            payout: pp ? stakes.perfectPairs * (1 + PERFECT_PAIRS_PAYS[pp]) : 0
        },
        {
            key: 'twentyOnePlusThree',
            stake: stakes.twentyOnePlusThree,
            label: tp ? TWENTY_ONE_PLUS_THREE_LABELS[tp] : null,
            multiplier: tp ? TWENTY_ONE_PLUS_THREE_PAYS[tp] : 0,
            payout: tp ? stakes.twentyOnePlusThree * (1 + TWENTY_ONE_PLUS_THREE_PAYS[tp]) : 0
        }
    ]
}

// ─── basic strategy (the RTP script plays it) ────────────────────────────────

export type BjAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender'

function pairAdvice(rank: Rank, up: number): BjAction | null {
    const pair = cardValue(rank)
    if (rank === 'A' || pair === 8) return 'split'
    if (pair === 10 || pair === 5) return null
    if (pair === 9) return up === 7 || up >= 10 ? 'stand' : 'split'
    if (pair === 7) return up <= 7 ? 'split' : null
    if (pair === 6) return up <= 6 ? 'split' : null
    if (pair === 4) return up === 5 || up === 6 ? 'split' : null
    return up <= 7 ? 'split' : null
}

function softAdvice(total: number, up: number): BjAction {
    if (total >= 19) return 'stand'
    if (total === 18) return up >= 3 && up <= 6 ? 'double' : up <= 8 ? 'stand' : 'hit'
    if (total === 17) return up >= 3 && up <= 6 ? 'double' : 'hit'
    if (total >= 15) return up >= 4 && up <= 6 ? 'double' : 'hit'
    return up >= 5 && up <= 6 ? 'double' : 'hit'
}

function hardAdvice(total: number, up: number): BjAction {
    if (total >= 17) return 'stand'
    if (total >= 13) return up <= 6 ? 'stand' : 'hit'
    if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit'
    if (total === 11) return up === 11 ? 'hit' : 'double'
    if (total === 10) return up <= 9 ? 'double' : 'hit'
    if (total === 9) return up >= 3 && up <= 6 ? 'double' : 'hit'
    return 'hit'
}

/** Six-deck, stand-on-17, double-after-split, late-surrender basic strategy. */
export function basicStrategy(hand: BjHand, upcard: Rank, seatHands: readonly BjHand[]): BjAction {
    const up = cardValue(upcard)
    const { total, soft } = handScore(hand.cards)
    if (canSurrender(hand, seatHands) && !soft) {
        const [a] = hand.cards
        const pairOfEights = hand.cards.length === 2 && a?.rank === '8' && hand.cards[1]?.rank === '8'
        if (!pairOfEights && ((total === 16 && up >= 9) || (total === 15 && up === 10))) return 'surrender'
    }
    const [first, second] = hand.cards
    if (hand.cards.length === 2 && first?.rank && second?.rank && cardValue(first.rank) === cardValue(second.rank)) {
        const advice = pairAdvice(first.rank, up)
        if (advice === 'split' && canSplit(hand, seatHands)) return 'split'
        if (advice === 'stand') return 'stand'
    }
    const want = soft ? softAdvice(total, up) : hardAdvice(total, up)
    if (want === 'double' && !canDouble(hand)) return soft && total === 18 ? 'stand' : 'hit'
    return want
}
