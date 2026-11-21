import type { Card, Face, Rank } from './cards'

/**
 * Three card poker: hand ranking, dealer qualification, the paytables and the
 * settlement of one seat. Three-card ranking is not five-card ranking: a
 * straight beats a flush, because three cards make fewer straights.
 */

export const TCP_TIMERS = {
    betting: 15_000,
    bettingCut: 3_000,
    dealing: 1_800,
    decision: 20_000,
    decisionCut: 700,
    reveal: 1_500,
    payoutBase: 3_500,
    payoutPerExtraSeat: 600,
    payoutMax: 6_000,
    disconnectGrace: 45_000,
    disconnectGraceIdle: 10_000
} as const

export type TcpSpot = 'ante' | 'pairPlus'
export type TcpCategory = 'highCard' | 'pair' | 'flush' | 'straight' | 'trips' | 'straightFlush'
const CATEGORIES: readonly TcpCategory[] = ['highCard', 'pair', 'flush', 'straight', 'trips', 'straightFlush']

export interface TcpHand {
    category: TcpCategory
    strength: number
    /** Tie-break values, most significant first. */
    values: number[]
    label: string
}

const VALUES: Record<Rank, number> = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 }
const NAMES: Record<number, string> = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' }
const PLURALS: Record<number, string> = { 2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' }

function straightHigh(high: number, mid: number, low: number): number | null {
    if (high - mid === 1 && mid - low === 1) return high
    // A-2-3 is the lowest straight.
    return high === 14 && mid === 3 && low === 2 ? 3 : null
}

function hand(category: TcpCategory, values: number[], label: string): TcpHand {
    return { category, strength: CATEGORIES.indexOf(category), values, label }
}

export function evaluateTcp(cards: readonly Face[]): TcpHand {
    const values = cards.map(card => VALUES[card.rank]).sort((a, b) => b - a)
    const [high, mid, low] = values as [number, number, number]
    const flush = cards.every(card => card.suit === cards[0]!.suit)
    const run = straightHigh(high, mid, low)
    if (run !== null && flush) return hand('straightFlush', [run], `Straight flush, ${NAMES[run]} high`)
    if (high === low) return hand('trips', [high], `Three ${PLURALS[high]}`)
    if (run !== null) return hand('straight', [run], `Straight, ${NAMES[run]} high`)
    if (flush) return hand('flush', [high, mid, low], `Flush, ${NAMES[high]} high`)
    if (high === mid) return hand('pair', [high, low], `Pair of ${PLURALS[high]}`)
    if (mid === low) return hand('pair', [mid, high], `Pair of ${PLURALS[mid]}`)
    return hand('highCard', [high, mid, low], `${NAMES[high]} high`)
}

export function compareTcp(a: TcpHand, b: TcpHand): number {
    if (a.strength !== b.strength) return a.strength - b.strength
    for (let i = 0; i < a.values.length; i++) {
        const diff = a.values[i]! - b.values[i]!
        if (diff) return diff
    }
    return 0
}

/** The dealer plays with queen high or better. */
export function tcpDealerQualifies(dealer: TcpHand): boolean {
    return dealer.category !== 'highCard' || dealer.values[0]! >= VALUES.Q
}

/** Multiples paid on top of the stake. */
export const PAIR_PLUS_PAYS: Record<Exclude<TcpCategory, 'highCard'>, number> = { straightFlush: 40, trips: 30, straight: 6, flush: 4, pair: 1 }
export const ANTE_BONUS_PAYS: Partial<Record<TcpCategory, number>> = { straightFlush: 5, trips: 4, straight: 1 }
export const TCP_CATEGORY_LABELS: Record<TcpCategory, string> = {
    straightFlush: 'Straight flush',
    trips: 'Three of a kind',
    straight: 'Straight',
    flush: 'Flush',
    pair: 'Pair',
    highCard: 'High card'
}

export type TcpLegResult = 'win' | 'lose' | 'push' | 'fold' | 'none'

export interface TcpResolution {
    staked: number
    payout: number
    net: number
    dealerQualified: boolean
    ante: TcpLegResult
    play: TcpLegResult
    anteBonus: number
    pairPlus: number
}

/**
 * One seat against the dealer. Pair plus never looks at the dealer, so it pays
 * a folded seat too. The ante bonus rides on the ante, so folding loses it.
 * A dealer who doesn't qualify pays the ante even money and pushes the play.
 */
export function resolveTcp(bets: { ante: number, pairPlus: number, played: boolean }, player: TcpHand, dealer: TcpHand): TcpResolution {
    const pp = player.category === 'highCard' ? 0 : PAIR_PLUS_PAYS[player.category]
    const pairPlus = bets.pairPlus > 0 && pp ? bets.pairPlus * (1 + pp) : 0
    const qualified = tcpDealerQualifies(dealer)
    if (!bets.played) {
        const staked = bets.ante + bets.pairPlus
        return { staked, payout: pairPlus, net: pairPlus - staked, dealerQualified: qualified, ante: 'fold', play: 'none', anteBonus: 0, pairPlus }
    }
    const anteBonus = bets.ante * (ANTE_BONUS_PAYS[player.category] ?? 0)
    let ante: TcpLegResult
    let play: TcpLegResult
    let legs: number
    if (!qualified) {
        ante = 'win'
        play = 'push'
        legs = bets.ante * 2 + bets.ante
    } else {
        const verdict = compareTcp(player, dealer)
        ante = play = verdict > 0 ? 'win' : verdict < 0 ? 'lose' : 'push'
        legs = verdict > 0 ? bets.ante * 4 : verdict < 0 ? 0 : bets.ante * 2
    }
    const staked = bets.ante * 2 + bets.pairPlus
    const payout = legs + anteBonus + pairPlus
    return { staked, payout, net: payout - staked, dealerQualified: qualified, ante, play, anteBonus, pairPlus }
}

/** Optimal play is one threshold: Q-6-4 or better plays, anything lower folds. */
const PLAY_THRESHOLD = evaluateTcp([{ rank: 'Q', suit: 'spades' }, { rank: '6', suit: 'hearts' }, { rank: '4', suit: 'clubs' }])

export function tcpShouldPlay(cards: readonly Face[]): boolean {
    return compareTcp(evaluateTcp(cards), PLAY_THRESHOLD) >= 0
}

// ─── the table's slots in the shared protocol ───────────────────────────────

export interface TcpSeatResult {
    net: number
    dealerQualified: boolean
    ante: TcpLegResult
    play: TcpLegResult
    anteBonus: number
    pairPlus: number
}

export interface TcpSeat {
    /** Chips on the layout during betting; staked when betting closes. */
    pendingAnte: number
    pendingPairPlus: number
    chips: { spot: TcpSpot, amount: number }[]
    ante: number
    pairPlus: number
    play: number
    lastAnte: number
    lastPairPlus: number
    /** Face down to everyone but the seat itself until the showdown. */
    cards: Card[]
    hand: { category: TcpCategory, label: string } | null
    decision: 'play' | 'fold' | null
    result: TcpSeatResult | null
}

export interface TcpShared {
    dealer: { cards: Card[], hand: { category: TcpCategory, label: string } | null, qualified: boolean | null }
}

export type TcpAction =
    | { t: 'bet', spot: TcpSpot, amount: number }
    | { t: 'undo' }
    | { t: 'clear' }
    | { t: 'repeat' }
    | { t: 'scale', factor: 0.5 | 2 }
    | { t: 'decide', play: boolean }
