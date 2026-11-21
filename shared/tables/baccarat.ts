import type { Card, Rank } from './cards'
import type { Shoe } from './cards'

/**
 * Punto banco: hand totals, the fixed third-card table, the five bets and
 * the roadmap reads. There is no player decision anywhere, so a round is one
 * call to `dealBaccarat`.
 */

export const BAC_TIMERS = {
    betting: 15_000,
    dealing: 4_000,
    resolve: 2_500,
    payout: 3_500,
    disconnectGrace: 45_000,
    disconnectGraceIdle: 10_000
} as const

export type BacWinner = 'player' | 'banker' | 'tie'
export type BacSpot = 'player' | 'banker' | 'tie' | 'playerPair' | 'bankerPair'
export const BAC_SPOTS: readonly BacSpot[] = ['player', 'banker', 'tie', 'playerPair', 'bankerPair']
export type BacBets = Record<BacSpot, number>

export function isBacSpot(value: unknown): value is BacSpot {
    return typeof value === 'string' && (BAC_SPOTS as readonly string[]).includes(value)
}

/**
 * Winnings per coin staked, on top of the returned stake. Banker pays 0.95
 * (the 5% commission is what keeps its edge near Player's even though it wins
 * more often). Chips start at 100, so 0.95 always lands on a whole coin.
 */
export const BAC_PAYS: Record<BacSpot, number> = { player: 1, banker: 0.95, tie: 8, playerPair: 11, bankerPair: 11 }

export const BAC_SPOT_LABELS: Record<BacSpot, string> = {
    player: 'Player',
    banker: 'Banker',
    tie: 'Tie',
    playerPair: 'P Pair',
    bankerPair: 'B Pair'
}

export function emptyBacBets(): BacBets {
    return { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 }
}

export function bacTotal(bets: BacBets): number {
    return BAC_SPOTS.reduce((sum, spot) => sum + bets[spot], 0)
}

const TENS: readonly Rank[] = ['10', 'J', 'Q', 'K']

/** Pip value: tens and faces count zero, an ace one. */
export function bacValue(rank: Rank): number {
    if (rank === 'A') return 1
    return TENS.includes(rank) ? 0 : Number(rank)
}

export function bacHandTotal(cards: readonly Card[]): number {
    return cards.reduce((sum, card) => sum + (card.rank && !card.hidden ? bacValue(card.rank) : 0), 0) % 10
}

/** The pair bets look at the first two cards only: same rank, any suits. */
export function isPair(cards: readonly Card[]): boolean {
    return !!cards[0]?.rank && cards[0].rank === cards[1]?.rank
}

/** A two-card 8 or 9 ends the hand before either side draws. */
export function isNatural(cards: readonly Card[]): boolean {
    return cards.length === 2 && bacHandTotal(cards) >= 8
}

export function playerDraws(total: number): boolean {
    return total <= 5
}

/**
 * The banker's third-card rule. `playerThird` is the value of the player's
 * third card, or null when the player stood (the banker then draws on 0-5).
 */
export function bankerDraws(total: number, playerThird: number | null): boolean {
    if (total >= 7) return false
    if (total <= 2) return true
    if (playerThird === null) return total <= 5
    switch (total) {
        case 3: return playerThird !== 8
        case 4: return playerThird >= 2 && playerThird <= 7
        case 5: return playerThird >= 4 && playerThird <= 7
        default: return playerThird === 6 || playerThird === 7
    }
}

export interface BacRound {
    playerCards: Card[]
    bankerCards: Card[]
    playerTotal: number
    bankerTotal: number
    winner: BacWinner
    playerPair: boolean
    bankerPair: boolean
    natural: boolean
}

/** Deal one complete hand. Cards come off the shoe in table order: P, B, P, B, then thirds. */
export function dealBaccarat(shoe: Shoe): BacRound {
    const playerCards = [shoe.draw()]
    const bankerCards = [shoe.draw()]
    playerCards.push(shoe.draw())
    bankerCards.push(shoe.draw())
    const natural = isNatural(playerCards) || isNatural(bankerCards)
    if (!natural) {
        let playerThird: number | null = null
        if (playerDraws(bacHandTotal(playerCards))) {
            const card = shoe.draw()
            playerCards.push(card)
            playerThird = bacValue(card.rank!)
        }
        if (bankerDraws(bacHandTotal(bankerCards), playerThird)) bankerCards.push(shoe.draw())
    }
    const playerTotal = bacHandTotal(playerCards)
    const bankerTotal = bacHandTotal(bankerCards)
    return {
        playerCards,
        bankerCards,
        playerTotal,
        bankerTotal,
        winner: playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie',
        playerPair: isPair(playerCards),
        bankerPair: isPair(bankerCards),
        natural
    }
}

/** What one spot returns, stake included, rounded down to the coin. Player and Banker push on a tie. */
export function bacSpotReturn(spot: BacSpot, amount: number, round: Pick<BacRound, 'winner' | 'playerPair' | 'bankerPair'>): number {
    if (amount <= 0) return 0
    const win = amount + Math.floor(amount * BAC_PAYS[spot])
    switch (spot) {
        case 'player':
        case 'banker':
            return round.winner === spot ? win : round.winner === 'tie' ? amount : 0
        case 'tie':
            return round.winner === 'tie' ? win : 0
        case 'playerPair':
            return round.playerPair ? win : 0
        case 'bankerPair':
            return round.bankerPair ? win : 0
    }
}

export function resolveBacBets(bets: BacBets, round: Pick<BacRound, 'winner' | 'playerPair' | 'bankerPair'>): { staked: number, payout: number } {
    let payout = 0
    for (const spot of BAC_SPOTS) payout += bacSpotReturn(spot, bets[spot], round)
    return { staked: bacTotal(bets), payout }
}

// ─── roadmaps ────────────────────────────────────────────────────────────────

export interface BacHistoryEntry {
    winner: BacWinner
    playerPair: boolean
    bankerPair: boolean
}

export interface BigRoadColumn {
    result: 'player' | 'banker'
    rows: number
    ties: number
}

/** Big Road: a repeat extends the column, a change starts a new one, a tie marks the current one. */
export function bigRoadColumns(history: readonly BacHistoryEntry[]): BigRoadColumn[] {
    const columns: BigRoadColumn[] = []
    for (const entry of history) {
        if (entry.winner === 'tie') {
            if (columns.length) columns[columns.length - 1]!.ties++
            continue
        }
        const last = columns[columns.length - 1]
        if (last?.result === entry.winner) last.rows++
        else columns.push({ result: entry.winner, rows: 1, ties: 0 })
    }
    return columns
}

// ─── the table's slots in the shared protocol ───────────────────────────────

export interface BacSeat {
    /** Chips on the layout during betting; staked when betting closes. */
    bets: BacBets
    chips: { spot: BacSpot, amount: number }[]
    lastBets: BacBets
    /** What this seat had riding on the hand being dealt. */
    staked: BacBets
}

export interface BacShared {
    round: BacRound | null
    history: BacHistoryEntry[]
    shoe: { decks: number, total: number, dealt: number, untilShuffle: number }
}

export type BacAction =
    | { t: 'bet', spot: BacSpot, amount: number }
    | { t: 'undo' }
    | { t: 'clear' }
    | { t: 'repeat' }
    | { t: 'scale', factor: 0.5 | 2 }

export type BacGameEvent = { type: 'shuffle' }
