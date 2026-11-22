import { normalizeCoins, payFor, sumCoins } from '../money'
import type { Card, Face, Rank } from './cards'

/**
 * Casino Hold'em: five-card evaluation (best five of seven), the two
 * paytables, dealer qualification and the settlement of one seat. Seats play
 * the dealer, never each other.
 */

export const CH_TIMERS = {
    betting: 15_000,
    bettingCut: 3_000,
    deal: 2_400,
    decision: 20_000,
    decisionCut: 700,
    board: 2_600,
    reveal: 1_500,
    payoutBase: 3_200,
    payoutPerExtraSeat: 600,
    payoutMax: 6_000,
    disconnectGrace: 45_000,
    disconnectGraceIdle: 10_000
} as const

/** The call is twice the ante. */
export const CH_CALL_MULTIPLIER = 2

export type ChSpot = 'ante' | 'aa'
export type ChCategory =
    | 'high-card' | 'pair' | 'two-pair' | 'three-of-a-kind' | 'straight'
    | 'flush' | 'full-house' | 'four-of-a-kind' | 'straight-flush' | 'royal-flush'

const CATEGORY_RANK: Record<ChCategory, number> = {
    'high-card': 1,
    'pair': 2,
    'two-pair': 3,
    'three-of-a-kind': 4,
    'straight': 5,
    'flush': 6,
    'full-house': 7,
    'four-of-a-kind': 8,
    'straight-flush': 9,
    'royal-flush': 10
}

export interface ChHand {
    category: ChCategory
    rank: number
    /** Rank values that separate two hands in a category, best first. */
    tiebreak: number[]
    label: string
}

const ORDER: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace']
const PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces']

export function chValue(rank: Rank): number {
    return ORDER.indexOf(rank) + 2
}
const name = (v: number) => NAMES[v - 2]!
const plural = (v: number) => PLURALS[v - 2]!

function make(category: ChCategory, tiebreak: number[], label: string): ChHand {
    return { category, rank: CATEGORY_RANK[category], tiebreak, label }
}

export function evaluateFive(cards: readonly Face[]): ChHand {
    if (cards.length !== 5) throw new Error('evaluateFive needs five cards')
    const values = cards.map(card => chValue(card.rank)).sort((a, b) => b - a)
    const counts = new Map<number, number>()
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
    // By count, then rank: exactly the tiebreak order of every paired hand.
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
    const ordered = groups.map(g => g[0])
    const shape = groups.map(g => g[1]).join('')
    const flush = cards.every(card => card.suit === cards[0]!.suit)
    let high: number | null = null
    if (counts.size === 5) {
        if (values[0]! - values[4]! === 4) high = values[0]!
        // The wheel: the ace plays low, and it is the weakest straight.
        else if (values[0] === 14 && values[1] === 5) high = 5
    }
    if (flush && high !== null) return high === 14 ? make('royal-flush', [14], 'Royal flush') : make('straight-flush', [high], `Straight flush, ${name(high)} high`)
    if (shape === '41') return make('four-of-a-kind', ordered, `Four ${plural(ordered[0]!)}`)
    if (shape === '32') return make('full-house', ordered, `${plural(ordered[0]!)} full of ${plural(ordered[1]!)}`)
    if (flush) return make('flush', values, `Flush, ${name(values[0]!)} high`)
    if (high !== null) return make('straight', [high], `Straight, ${name(high)} high`)
    if (shape === '311') return make('three-of-a-kind', ordered, `Three ${plural(ordered[0]!)}`)
    if (shape === '221') return make('two-pair', ordered, `${plural(ordered[0]!)} and ${plural(ordered[1]!)}`)
    if (shape === '2111') return make('pair', ordered, `Pair of ${plural(ordered[0]!)}`)
    return make('high-card', values, `${name(values[0]!)} high`)
}

export function compareCh(a: ChHand, b: ChHand): number {
    if (a.rank !== b.rank) return a.rank - b.rank
    for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
        const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0)
        if (diff) return diff
    }
    return 0
}

const FIVE_OF_SEVEN: number[][] = (() => {
    const out: number[][] = []
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
        out.push([0, 1, 2, 3, 4, 5, 6].filter(i => i !== a && i !== b))
    }
    return out
})()

/** Best five-card hand from five or seven cards. */
export function bestHand(cards: readonly Face[]): ChHand {
    if (cards.length === 5) return evaluateFive(cards)
    if (cards.length !== 7) throw new Error('bestHand needs five or seven cards')
    let best: ChHand | null = null
    for (const pick of FIVE_OF_SEVEN) {
        const value = evaluateFive(pick.map(i => cards[i]!))
        if (!best || compareCh(value, best) > 0) best = value
    }
    return best!
}

/** Ante pays on the player's own hand when the seat wins (or the dealer doesn't qualify). */
export function antePays(hand: ChHand): number {
    switch (hand.category) {
        case 'royal-flush': return 100
        case 'straight-flush': return 20
        case 'four-of-a-kind': return 10
        case 'full-house': return 3
        case 'flush': return 2
        default: return 1
    }
}

/** The AA bonus reads the two hole cards and the flop: a pair of aces or better. */
export function aaPays(hand: ChHand): number {
    switch (hand.category) {
        case 'royal-flush': return 100
        case 'straight-flush': return 50
        case 'four-of-a-kind': return 40
        case 'full-house': return 30
        case 'flush': return 20
        case 'straight':
        case 'three-of-a-kind':
        case 'two-pair': return 7
        case 'pair': return hand.tiebreak[0] === 14 ? 7 : 0
        default: return 0
    }
}

export const CH_ANTE_TABLE = [
    { label: 'Royal flush', pays: 100 },
    { label: 'Straight flush', pays: 20 },
    { label: 'Four of a kind', pays: 10 },
    { label: 'Full house', pays: 3 },
    { label: 'Flush', pays: 2 },
    { label: 'Straight or less', pays: 1 }
] as const

export const CH_AA_TABLE = [
    { label: 'Royal flush', pays: 100 },
    { label: 'Straight flush', pays: 50 },
    { label: 'Four of a kind', pays: 40 },
    { label: 'Full house', pays: 30 },
    { label: 'Flush', pays: 20 },
    { label: 'Straight, trips, two pair', pays: 7 },
    { label: 'Pair of aces', pays: 7 }
] as const

/** The dealer plays with a pair of fours or better. */
export function chDealerQualifies(dealer: ChHand): boolean {
    if (dealer.category === 'high-card') return false
    return dealer.category !== 'pair' || dealer.tiebreak[0]! >= 4
}

export type ChOutcome = 'win' | 'lose' | 'push' | 'folded'

export interface ChResolution {
    outcome: ChOutcome
    dealerQualified: boolean
    anteMultiplier: number
    aaMultiplier: number
    staked: number
    payout: number
    net: number
}

/**
 * One seat against the dealer. A folded seat loses ante (and has no call) but
 * still collects its AA bonus, which was decided on the flop. A dealer who
 * doesn't qualify pays the ante by the paytable and pushes the call.
 */
export function resolveCh(
    bets: { ante: number, call: number, aa: number },
    showdown: { folded: boolean, player: ChHand | null, dealer: ChHand, aa: ChHand | null }
): ChResolution {
    const aaMultiplier = bets.aa > 0 && showdown.aa ? aaPays(showdown.aa) : 0
    const aaReturn = aaMultiplier ? payFor(bets.aa, 1 + aaMultiplier) : 0
    const staked = sumCoins([bets.ante, bets.call, bets.aa])
    const dealerQualified = chDealerQualifies(showdown.dealer)
    const done = (outcome: ChOutcome, anteMultiplier: number, legs: number): ChResolution => {
        const payout = sumCoins([legs, aaReturn])
        return { outcome, dealerQualified, anteMultiplier, aaMultiplier, staked, payout, net: normalizeCoins(payout - staked) }
    }
    if (showdown.folded || !showdown.player) return done('folded', 0, 0)
    const anteMultiplier = antePays(showdown.player)
    if (!dealerQualified) return done('win', anteMultiplier, sumCoins([payFor(bets.ante, 1 + anteMultiplier), bets.call]))
    const verdict = compareCh(showdown.player, showdown.dealer)
    if (verdict > 0) return done('win', anteMultiplier, sumCoins([payFor(bets.ante, 1 + anteMultiplier), payFor(bets.call, 2)]))
    if (verdict === 0) return done('push', 0, sumCoins([bets.ante, bets.call]))
    return done('lose', 0, 0)
}

/**
 * A simple calling strategy for the RTP script: call with any pair, a hole
 * card that pairs the flop, a jack or better, four to a flush or straight with
 * a hole card in it, or an overcard to the flop. Close to optimal (which folds
 * under a fifth of the time).
 */
export function chShouldCall(hole: readonly Face[], flop: readonly Face[]): boolean {
    const holeValues = hole.map(card => chValue(card.rank))
    const boardValues = flop.map(card => chValue(card.rank))
    if (holeValues[0] === holeValues[1]) return true
    if (holeValues.some(v => boardValues.includes(v))) return true
    if (holeValues.some(v => v >= 11)) return true
    const suits = [...hole, ...flop].map(card => card.suit)
    if (hole.some(card => suits.filter(suit => suit === card.suit).length >= 4)) return true
    const values = new Set([...holeValues, ...boardValues])
    if (values.has(14)) values.add(1)
    for (let low = 1; low <= 10; low++) {
        let hits = 0
        for (let i = low; i < low + 5; i++) if (values.has(i)) hits++
        if (hits >= 4 && holeValues.some(v => (v >= low && v < low + 5) || (v === 14 && low === 1))) return true
    }
    return holeValues.some(v => v > Math.max(...boardValues))
}

// ─── the table's slots in the shared protocol ───────────────────────────────

export interface ChSeat {
    /** Chips on the layout during betting; staked when betting closes. */
    pendingAnte: number
    pendingAa: number
    chips: { spot: ChSpot, amount: number }[]
    ante: number
    aa: number
    call: number
    lastAnte: number
    lastAa: number
    /** Face down to everyone but the seat itself until the showdown. */
    cards: Card[]
    decision: 'call' | 'fold' | null
    handLabel: string | null
    outcome: ChOutcome | null
    net: number | null
    aaLabel: string | null
    aaMultiplier: number | null
}

export interface ChShared {
    board: Card[]
    dealer: { cards: Card[], label: string | null, qualified: boolean | null }
}

export type ChAction =
    | { t: 'bet', spot: ChSpot, amount: number }
    | { t: 'undo' }
    | { t: 'clear' }
    | { t: 'repeat' }
    | { t: 'scale', factor: 0.5 | 2 }
    | { t: 'decide', call: boolean }
