import { casinoEnv } from '#server/utils/env'
import { hub } from '#server/utils/hub'
import { casinoManifest } from '#server/utils/manifest'
import { syncAllStars } from '#server/utils/stars'
import { retryStalePurchases } from '#server/utils/tycoon-gems'
import { retryStaleConversions } from '#server/utils/wallet'

/**
 * Keeps the hub in the loop without ever blocking the casino on it:
 * - on boot, push the manifest (retried every minute until accepted);
 * - every ten minutes, a heartbeat ping, plus a sweep that settles abandoned
 *   conversions and My Casino gem purchases and reports star levels that are
 *   still due.
 * The hub may be down at any point; the casino keeps working on coins.
 */
const MANIFEST_RETRY_MS = 60_000
const HEARTBEAT_MS = 10 * 60_000

async function pushManifest(): Promise<boolean> {
    try {
        const result = await hub.putManifest(casinoManifest())
        console.log(`[hub] manifest accepted: ${result.games.map(game => `${game.slug} (${game.stars} stars)`).join(', ')}`)
        return true
    } catch (error) {
        console.warn(`[hub] manifest push failed, retrying: ${(error as Error).message}`)
        return false
    }
}

async function sweep() {
    try {
        await retryStaleConversions()
        await retryStalePurchases()
        await syncAllStars()
    } catch (error) {
        console.warn('[hub] sweep failed', error)
    }
}

async function heartbeat() {
    try {
        await hub.ping()
    } catch (error) {
        console.warn(`[hub] ping failed: ${(error as Error).message}`)
    }
    await sweep()
}

export default defineNitroPlugin(() => {
    if (process.env.VITEST) return
    if (!casinoEnv().appKey) console.warn('[hub] PNX_APP_KEY is not set: the hub will refuse every call (manifest, convert, stars)')

    const boot = async () => {
        if (!(await pushManifest())) {
            const retry = setInterval(async () => {
                if (!(await pushManifest())) return
                clearInterval(retry)
                await sweep()
            }, MANIFEST_RETRY_MS)
            retry.unref?.()
            return
        }
        await sweep()
    }
    void boot()

    const timer = setInterval(() => void heartbeat(), HEARTBEAT_MS)
    timer.unref?.()
})
