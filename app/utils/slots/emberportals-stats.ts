// Ember Portals figures shown in the rules, measured with
// `bun scripts/emberportals-rtp.ts` (paid spins, ante and buy).
// Re-measure and update these whenever the math in
// shared/slots/emberportals changes.
export const EP_STATS = {
    rounds: '52 million',
    rtp: 0.96,
    baseRtp: 0.283,
    freeSpinsRtp: 0.677,
    anteRtp: 0.959,
    buyRtp: 0.969,
    /** Share of spins with at least one winning cluster. */
    hitRate: 0.27,
    freeSpinsOdds: 159,
    anteFreeSpinsOdds: 120,
    volatility: 5
} as const
