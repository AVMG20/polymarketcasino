import type { SlotConfig } from '../types'

/**
 * Spiñata: 5×3 reels, 20 paylines, left to right. The piñata wild substitutes
 * and pays on its own. Three or more scatters anywhere pay and start the
 * Festival of Spins, where every wild that lands raises a multiplier that
 * holds for the rest of the feature.
 */

export const SPINATA_LINES: readonly (readonly number[])[] = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 2],
    [2, 1, 1, 1, 0], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
    [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 0, 2, 0]
]

// Pays are written per line bet (bet / 20) and converted to × total bet.
const perLine = (pays: Record<number, number>) =>
    Object.fromEntries(Object.entries(pays).map(([count, pay]) => [count, pay / SPINATA_LINES.length]))

export const spinata: SlotConfig = {
    id: 'spinata',
    cols: 5,
    rows: 3,
    symbols: {
        ten: { kind: 'pay', pays: perLine({ 3: 5, 4: 15, 5: 50 }) },
        jack: { kind: 'pay', pays: perLine({ 3: 5, 4: 15, 5: 50 }) },
        queen: { kind: 'pay', pays: perLine({ 3: 6, 4: 20, 5: 70 }) },
        king: { kind: 'pay', pays: perLine({ 3: 8, 4: 25, 5: 90 }) },
        ace: { kind: 'pay', pays: perLine({ 3: 10, 4: 30, 5: 120 }) },
        maracas: { kind: 'pay', pays: perLine({ 3: 15, 4: 50, 5: 200 }) },
        cactus: { kind: 'pay', pays: perLine({ 3: 20, 4: 75, 5: 300 }) },
        sombrero: { kind: 'pay', pays: perLine({ 3: 30, 4: 120, 5: 500 }) },
        flower: { kind: 'pay', pays: perLine({ 3: 50, 4: 200, 5: 1000 }) },
        wild: { kind: 'wild', pays: perLine({ 3: 100, 4: 500, 5: 2500 }) },
        scatter: { kind: 'scatter' }
    },
    weights: {
        ten: 33, jack: 30, queen: 26, king: 22, ace: 18,
        maracas: 13, cactus: 9, sombrero: 6, flower: 4,
        wild: 3, scatter: 4.3
    },
    pay: { type: 'lines', lines: SPINATA_LINES },
    payScale: 2.62,
    scatter: { symbol: 'scatter', pays: { 3: 2, 4: 10, 5: 50 }, onePerReel: true },
    freeSpins: {
        awards: { 3: 10, 4: 12, 5: 15 },
        retrigger: { count: 3, spins: 5 },
        weights: {
            ten: 33, jack: 30, queen: 26, king: 22, ace: 18,
            maracas: 13, cactus: 9, sombrero: 6, flower: 4,
            wild: 5, scatter: 3
        },
        wildMultiplierStep: 1,
        multiplierCap: 20
    },
    buyCost: 48,
    maxWin: 5000
}
