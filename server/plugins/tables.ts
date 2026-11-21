import { heldWagerIds, TABLES } from '#server/utils/tables'
import { refundOrphanedWagers } from '#server/utils/tables/escrow'

/**
 * Table state lives in memory, so a restart ends every open hand. On boot,
 * every escrow row still open belongs to a hand that can no longer finish and
 * is refunded. A slower sweep refunds any open row no table holds (a settle
 * that failed twice). On shutdown, open hands are refunded straight away.
 */
const SWEEP_MS = 5 * 60_000
const ORPHAN_AFTER_MS = 30 * 60_000

async function sweep(boot: boolean) {
    try {
        const rows = await refundOrphanedWagers(boot ? {} : { olderThan: new Date(Date.now() - ORPHAN_AFTER_MS), held: heldWagerIds() })
        if (rows) console.log(`[tables] refunded ${rows} open stake(s) ${boot ? 'left by the last run' : 'no table held'}`)
    } catch (error) {
        console.error('[tables] escrow sweep failed', error)
    }
}

export default defineNitroPlugin((nitro) => {
    if (process.env.VITEST) return
    void sweep(true)
    const timer = setInterval(() => void sweep(false), SWEEP_MS)
    timer.unref?.()
    nitro.hooks.hook('close', () => {
        clearInterval(timer)
        for (const table of Object.values(TABLES)) table.run(() => table.abortRound('The table is restarting, bets returned'))
    })
})
