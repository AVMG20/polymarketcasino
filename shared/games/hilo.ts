import type { Rng } from '../rng'
import { floorMultiplier, type StepGame, type StepState } from './steps'

/**
 * Card Climb (hi-lo): a card is face up; guess whether the next one is
 * higher or lower. Every right guess multiplies the round, a wrong one ends
 * it with nothing. Cash out any time after the first right guess, or skip a
 * card you don't like (HILO_SKIPS times a round).
 *
 * Ranks run A (1, low) to K (13, high); suits are only looks. Every card is
 * drawn from a full, freshly shuffled deck (13 equally likely ranks), so the
 * odds never depend on what came before. The guesses on a card of rank r:
 *   - 2..Q: "higher or same" wins on 14 - r ranks, "lower or same" on r;
 *   - A: "higher" wins on 12 ranks, "same" on 1;
 *   - K: "lower" wins on 12 ranks, "same" on 1.
 * A right guess on w winning ranks multiplies by the fair 13 / w, and the
 * round's multiplier starts at the house share HILO_RTP: so the house edge
 * is taken once per round however long it runs, and cashing out at any
 * point returns HILO_RTP. The round cashes out on its own at the cap.
 */
export const HILO_RTP = 0.975
export const HILO_SKIPS = 3
export const HILO_MAX_MULTIPLIER = 1_000_000
export const HILO_RANKS = 13

export type HiloGuess = 'higher' | 'lower' | 'same'

export interface HiloCard {
    /** 1 = A … 13 = K. */
    rank: number
    /** 0 ♠, 1 ♥, 2 ♦, 3 ♣ (looks only). */
    suit: number
}

export interface HiloStep {
    /** The card the move was made on. */
    card: HiloCard
    /** The guess, or null for a skip. */
    guess: HiloGuess | null
    /** The card that came next. */
    next: HiloCard
    won: boolean
}

export interface HiloState extends StepState {
    card: HiloCard
    steps: HiloStep[]
    /** Winning ranks of every right guess (the multiplier is HILO_RTP × Π 13 / w). */
    wins: number[]
    skips: number
}

export interface HiloView {
    card: HiloCard
    steps: HiloStep[]
    status: HiloState['status']
    multiplier: number
    skipsLeft: number
    /** The guesses on the current card and what each multiplies the round by. */
    options: HiloOption[]
}

export interface HiloOption {
    guess: HiloGuess
    /** Winning ranks out of 13. */
    wins: number
    /** The chance it is right. */
    chance: number
    /** What a right guess multiplies the round by (13 / wins). */
    factor: number
}

/** The guesses a card allows and how many of the 13 ranks win each. */
export function hiloOptions(rank: number): HiloOption[] {
    const pairs: [HiloGuess, number][] = rank <= 1
        ? [['higher', 12], ['same', 1]]
        : rank >= HILO_RANKS
            ? [['lower', 12], ['same', 1]]
            : [['higher', HILO_RANKS + 1 - rank], ['lower', rank]]
    return pairs.map(([guess, wins]) => ({ guess, wins, chance: wins / HILO_RANKS, factor: HILO_RANKS / wins }))
}

/** Whether `guess` on `rank` is right when `next` comes. */
export function hiloWins(rank: number, guess: HiloGuess, next: number): boolean {
    if (guess === 'same') return next === rank
    if (guess === 'higher') return rank <= 1 ? next > rank : next >= rank
    return rank >= HILO_RANKS ? next < rank : next <= rank
}

/** The round's multiplier after right guesses on these winning-rank counts. */
export function hiloMultiplier(wins: readonly number[]): number {
    if (!wins.length) return 1
    let fair = 1
    for (const w of wins) fair *= HILO_RANKS / w
    return Math.min(HILO_MAX_MULTIPLIER, floorMultiplier(HILO_RTP * fair))
}

export function drawCard(rng: Rng): HiloCard {
    const n = Math.floor(rng.next() * 52)
    return { rank: (n % HILO_RANKS) + 1, suit: Math.floor(n / HILO_RANKS) }
}

export const hilo: StepGame<HiloState, HiloView> = {
    slug: 'hilo',
    start(rng) {
        return { status: 'open', card: drawCard(rng), steps: [], wins: [], skips: 0 }
    },
    act(state, action, rng) {
        if (state.status !== 'open') throw new RangeError('The round is over')
        if (action.type === 'skip') {
            if (state.skips >= HILO_SKIPS) throw new RangeError('No skips left')
            const next = drawCard(rng)
            return { ...state, card: next, skips: state.skips + 1, steps: [...state.steps, { card: state.card, guess: null, next, won: false }] }
        }
        if (action.type !== 'guess') throw new RangeError('Guess or skip')
        const option = hiloOptions(state.card.rank).find(o => o.guess === action.guess)
        if (!option) throw new RangeError(`Pick ${hiloOptions(state.card.rank).map(o => o.guess).join(' or ')}`)
        const next = drawCard(rng)
        const won = hiloWins(state.card.rank, option.guess, next.rank)
        const steps = [...state.steps, { card: state.card, guess: option.guess, next, won }]
        if (!won) return { ...state, card: next, steps, status: 'lost' }
        const wins = [...state.wins, option.wins]
        return { ...state, card: next, steps, wins, status: hiloMultiplier(wins) >= HILO_MAX_MULTIPLIER ? 'cashed' : 'open' }
    },
    canCashOut: state => state.status === 'open' && state.wins.length > 0,
    cashOut(state) {
        if (!hilo.canCashOut(state)) throw new RangeError('Make a right guess first')
        return { ...state, status: 'cashed' }
    },
    multiplier: state => (state.status === 'lost' ? 0 : hiloMultiplier(state.wins)),
    view(state) {
        return {
            card: state.card,
            steps: state.steps,
            status: state.status,
            multiplier: hilo.multiplier(state),
            skipsLeft: HILO_SKIPS - state.skips,
            options: hiloOptions(state.card.rank)
        }
    },
    summary: state => ({ guesses: state.wins.length, skips: state.skips, status: state.status, multiplier: hilo.multiplier(state) })
}
