// Trash Panda Heist figures shown in the rules, measured with
// `bun scripts/trashpanda-rtp.ts` (100M spins over four seeds, 5M per buy).
// Re-measure and update these whenever the math in shared/slots/trashpanda
// changes.
export const TPH_STATS = {
    rounds: '100 million',
    rtp: 0.963,
    baseRtp: 0.3319,
    diveRtp: 0.1473,
    /** Scatter-triggered plus golden-key free spins. */
    freeSpinsRtp: 0.484,
    buyFreeSpinsRtp: 0.9793,
    buyDiveRtp: 0.9751,
    /** Share of spins that pay anything. */
    hitRate: 0.46,
    diveOdds: 115,
    freeSpinsOdds: 256,
    volatility: 4
} as const
