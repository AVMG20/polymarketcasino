import { ABANDONED_MS, settleAbandonedRounds } from '#server/utils/steps'

/**
 * Multi-step rounds (Gem Dig, Card Climb) live in the database, so they
 * survive a restart and the player can pick one up later. A round nobody
 * touched for a day is settled here: cashed out at its current multiplier
 * when it has progress, refunded when it has none (server/utils/steps.ts).
 */
const SWEEP_MS = 10 * 60_000

async function sweep() {
    try {
        const closed = await settleAbandonedRounds(new Date(Date.now() - ABANDONED_MS))
        if (closed) console.log(`[steps] settled ${closed} abandoned round(s)`)
    } catch (error) {
        console.error('[steps] abandoned-round sweep failed', error)
    }
}

export default defineNitroPlugin((nitro) => {
    if (process.env.VITEST) return
    void sweep()
    const timer = setInterval(() => void sweep(), SWEEP_MS)
    timer.unref?.()
    nitro.hooks.hook('close', () => clearInterval(timer))
})
