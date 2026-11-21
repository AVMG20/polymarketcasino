import type { Card, ShoeInfo } from './cards'
import type { BjHand, BjSideBet, BjSideResult, BjSpot } from './blackjack'

/** The blackjack table's slots in the shared protocol. */

export interface BjSeat {
    /** Chips on the layout during betting; staked when betting closes. */
    pendingBet: number
    pendingSide: Record<BjSideBet, number>
    /** Placement order, so undo takes back one chip. */
    chips: { spot: BjSpot, amount: number }[]
    lastBet: number
    lastSide: Record<BjSideBet, number>
    hands: BjHand[]
    sideResults: BjSideResult[] | null
    insurance: number
    insuranceDecided: boolean
}

export interface BjShared {
    dealer: { cards: Card[], score: number, soft: boolean, blackjack: boolean, busted: boolean }
    activeSeat: number | null
    activeHand: number | null
    shoe: ShoeInfo
}

export type BjTableAction =
    | { t: 'bet', spot: BjSpot, amount: number }
    | { t: 'undo' }
    | { t: 'clear' }
    | { t: 'repeat' }
    | { t: 'scale', factor: 0.5 | 2 }
    | { t: 'insurance', take: boolean }
    | { t: 'play', action: 'hit' | 'stand' | 'double' | 'split' | 'surrender' }

export type BjGameEvent =
    | { type: 'shuffle' }
    | { type: 'action', seat: number, name: string, action: string }
    | { type: 'side', seat: number, name: string, label: string, payout: number }
