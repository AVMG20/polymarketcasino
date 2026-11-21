import type { Rng } from '../rng'

/**
 * Cards and the shoe every live table deals from. A card carries a stable id
 * so the client can diff two snapshots: an id it has not seen is a new card
 * to slide in, and an id that gains rank and suit is a face-down card turning
 * over in place.
 */

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'

export const SUITS: readonly Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

/** A card as it travels: face-down cards have no rank or suit at all. */
export interface Card {
    id: string
    rank?: Rank
    suit?: Suit
    hidden?: boolean
}

/** A card the server knows: both fields set. */
export interface Face {
    rank: Rank
    suit: Suit
}

export function isRed(suit: Suit): boolean {
    return suit === 'hearts' || suit === 'diamonds'
}

/** The face of a dealt card. Server-side cards always have one. */
export function faceOf(card: Card): Face {
    if (!card.rank || !card.suit) throw new Error('card has no face')
    return { rank: card.rank, suit: card.suit }
}

/** Strip a face-down card to its id, so a snapshot can't leak it. */
export function redact(card: Card): Card {
    return card.hidden ? { id: card.id, hidden: true } : card
}

export interface ShoeInfo {
    decks: number
    total: number
    dealt: number
    /** Cards left before the cut card. */
    untilShuffle: number
}

let cardSeq = 0

/**
 * Cards come off the top and are only reshuffled between rounds, once the cut
 * card is reached (`needsShuffle`). A game that wants a fresh deck every hand
 * uses one deck and a penetration of 0. Shuffles are Fisher-Yates on the given
 * Rng: `cryptoRng` at the tables, `seededRng` in scripts and tests.
 */
export class Shoe {
    private cards: Face[] = []
    private dealtCount = 0

    constructor(private readonly rng: Rng, readonly decks = 6, readonly penetration = 0.75) {
        this.shuffle()
    }

    get total() {
        return this.decks * 52
    }

    get remaining() {
        return this.cards.length
    }

    get untilShuffle() {
        return Math.max(0, this.remaining - Math.round(this.total * (1 - this.penetration)))
    }

    get needsShuffle() {
        return this.untilShuffle <= 0
    }

    info(): ShoeInfo {
        return { decks: this.decks, total: this.total, dealt: this.dealtCount, untilShuffle: this.untilShuffle }
    }

    shuffle() {
        this.cards = []
        for (let d = 0; d < this.decks; d++) {
            for (const suit of SUITS) for (const rank of RANKS) this.cards.push({ rank, suit })
        }
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng.next() * (i + 1))
            const swap = this.cards[i]!
            this.cards[i] = this.cards[j]!
            this.cards[j] = swap
        }
        this.dealtCount = 0
    }

    /** One card off the top. A shoe that runs dry mid-round reshuffles rather than stall the table. */
    draw(hidden = false): Card {
        if (!this.cards.length) this.shuffle()
        const face = this.cards.pop()!
        this.dealtCount++
        return { id: `c${++cardSeq}`, rank: face.rank, suit: face.suit, ...(hidden ? { hidden: true } : {}) }
    }
}
