import type { Rng } from '../rng'

/**
 * Multi-step games (Gem Dig, Card Climb): a round is started with a stake,
 * advanced one move at a time and ends in a bust (pays nothing), a cash-out
 * or an automatic cash-out (the board is cleared or the cap is reached).
 *
 * The rules are pure state machines over a JSON state. The server keeps the
 * state (secrets included: mine positions) in step_rounds and only ever sends
 * `view(state)`, which hides what the player must not see until the round is
 * over. Every move is one guarded transaction (server/utils/steps.ts).
 */
export type StepStatus =
    /** Still running: the player moves or cashes out. */
    | 'open'
    /** Busted: pays nothing. */
    | 'lost'
    /** Cashed out (by the player, or automatically): pays bet × multiplier. */
    | 'cashed'

export interface StepState {
    status: StepStatus
}

export interface StepGame<S extends StepState, V> {
    slug: string
    /** Parse the start options and set the round up. Throws RangeError for bad options. */
    start(rng: Rng, options: Record<string, unknown>): S
    /** One move. Throws RangeError for a move that isn't allowed. Returns the next state. */
    act(state: S, action: Record<string, unknown>, rng: Rng): S
    /** Whether the player may cash out now (a round with no progress may not: it would be a free refund). */
    canCashOut(state: S): boolean
    /** The state after the player cashes out. */
    cashOut(state: S): S
    /** What cashing out pays now, as a multiple of the bet (0 once lost). */
    multiplier(state: S): number
    /** What the client may see. Secrets only once the round is over. */
    view(state: S): V
    /** Kept with the round in game_rounds. */
    summary(state: S): Record<string, unknown>
}

/** Rounded down to 0.0001 (a cumulative multiplier), with an epsilon for binary floats. */
export function floorMultiplier(value: number): number {
    return Math.floor(value * 10_000 + 1e-6) / 10_000
}
