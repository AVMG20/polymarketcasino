import type { SlotConfig } from '../types'

/**
 * Trash Panda Heist: 5×4 reels, 1,024 ways. The panda wild lands on reels
 * 2-5 only. Three or more dumpsters start the heist: free spins where every
 * panda that lands sticks for the rest of the feature.
 */

const base = {
    ten: 30, jack: 28, queen: 26, king: 22, ace: 20,
    can: 12, fish: 9, pizza: 7, donut: 5,
    scatter: 3
}

export const trashpanda: SlotConfig = {
    id: 'trashpanda',
    cols: 5,
    rows: 4,
    symbols: {
        ten: { kind: 'pay', pays: { 3: 0.02, 4: 0.05, 5: 0.1 } },
        jack: { kind: 'pay', pays: { 3: 0.02, 4: 0.05, 5: 0.1 } },
        queen: { kind: 'pay', pays: { 3: 0.025, 4: 0.06, 5: 0.12 } },
        king: { kind: 'pay', pays: { 3: 0.03, 4: 0.08, 5: 0.15 } },
        ace: { kind: 'pay', pays: { 3: 0.03, 4: 0.08, 5: 0.15 } },
        can: { kind: 'pay', pays: { 3: 0.05, 4: 0.15, 5: 0.3 } },
        fish: { kind: 'pay', pays: { 3: 0.08, 4: 0.2, 5: 0.5 } },
        pizza: { kind: 'pay', pays: { 3: 0.1, 4: 0.3, 5: 0.8 } },
        donut: { kind: 'pay', pays: { 3: 0.15, 4: 0.5, 5: 1.5 } },
        wild: { kind: 'wild' },
        scatter: { kind: 'scatter' }
    },
    weights: [
        base,
        { ...base, wild: 4 },
        { ...base, wild: 4 },
        { ...base, wild: 4 },
        { ...base, wild: 4 }
    ],
    pay: { type: 'ways' },
    payScale: 4.85,
    scatter: { symbol: 'scatter', pays: { 3: 1, 4: 5, 5: 20 }, onePerReel: true },
    freeSpins: {
        awards: { 3: 8, 4: 12, 5: 16 },
        retrigger: { count: 3, spins: 4 },
        weights: [base, ...Array.from({ length: 4 }, () => ({ ...base, scatter: 2, wild: 6 }))],
        stickyWilds: true
    },
    buyCost: 56,
    maxWin: 5000
}
