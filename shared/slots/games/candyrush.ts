import type { SlotConfig } from '../types'

/**
 * Candy Rush: a 7×7 grid that pays clusters of five or more touching candies.
 * Winning candies pop and new ones fall in; every further pop in a row raises
 * the multiplier by one. Four lollipops start free spins, where the
 * multiplier never resets between spins.
 */

const sizes = (p5: number, p6: number, p7: number, p8: number, p10: number, p12: number, p15: number) =>
    ({ 5: p5, 6: p6, 7: p7, 8: p8, 10: p10, 12: p12, 15: p15 })

export const candyrush: SlotConfig = {
    id: 'candyrush',
    cols: 7,
    rows: 7,
    symbols: {
        grape: { kind: 'pay', pays: sizes(0.04, 0.06, 0.08, 0.12, 0.2, 0.4, 1) },
        berry: { kind: 'pay', pays: sizes(0.05, 0.07, 0.1, 0.15, 0.25, 0.5, 1.2) },
        lemon: { kind: 'pay', pays: sizes(0.06, 0.08, 0.12, 0.18, 0.3, 0.6, 1.5) },
        apple: { kind: 'pay', pays: sizes(0.08, 0.1, 0.15, 0.25, 0.4, 0.8, 2) },
        orange: { kind: 'pay', pays: sizes(0.1, 0.15, 0.2, 0.3, 0.5, 1, 3) },
        cherry: { kind: 'pay', pays: sizes(0.15, 0.2, 0.3, 0.5, 1, 2, 5) },
        scatter: { kind: 'scatter' }
    },
    weights: {
        grape: 1, berry: 0.95, lemon: 0.9, apple: 0.8, orange: 0.65, cherry: 0.5, scatter: 0.07
    },
    pay: { type: 'cluster', minSize: 5 },
    payScale: 8.23,
    scatter: { symbol: 'scatter', pays: { 4: 3, 5: 10, 6: 50 } },
    tumble: { multiplierStep: 1 },
    freeSpins: {
        awards: { 4: 10, 5: 12, 6: 15 },
        retrigger: { count: 4, spins: 5 },
        multiplierCap: 50
    },
    buyCost: 49,
    maxWin: 5000
}
