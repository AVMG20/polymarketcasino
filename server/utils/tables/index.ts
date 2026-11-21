import { baccaratTable } from './baccarat'
import { blackjackTable } from './blackjack'
import { casinoHoldemTable } from './casino-holdem'
import { threeCardPokerTable } from './three-card-poker'
import type { LiveTable } from './table'

/** Every live table, by slug. One of each: the casino runs as a single instance. */
export const TABLES: Record<string, LiveTable<unknown, unknown, unknown>> = {
    'blackjack': blackjackTable as LiveTable<unknown, unknown, unknown>,
    'baccarat': baccaratTable as LiveTable<unknown, unknown, unknown>,
    'three-card-poker': threeCardPokerTable as LiveTable<unknown, unknown, unknown>,
    'casino-holdem': casinoHoldemTable as LiveTable<unknown, unknown, unknown>
}

/** Escrow rows some table still holds (the periodic sweep skips them). */
export function heldWagerIds(): Set<string> {
    return new Set(Object.values(TABLES).flatMap(table => table.heldWagerIds()))
}
