import { casinoEnv } from '#server/utils/env'

/** Pages may only be framed by the hub (and ourselves). */
export default defineEventHandler((event) => {
    if (event.path.startsWith('/api/')) return
    setResponseHeader(event, 'Content-Security-Policy', `frame-ancestors 'self' ${casinoEnv().coreUrl}`)
})
