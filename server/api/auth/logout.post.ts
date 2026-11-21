import { clearCasinoSession } from '#server/utils/session'

export default defineEventHandler(async (event) => {
    await clearCasinoSession(event)
    return { ok: true }
})
