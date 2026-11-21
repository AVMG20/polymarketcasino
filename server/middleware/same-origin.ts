import { getRequestHeader, getRequestHost } from 'h3'
import { isForeignRequest } from '#server/utils/same-origin'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Refuse cross-site writes to the API (CSRF); reads stay open. */
export default defineEventHandler((event) => {
    if (SAFE_METHODS.has(event.method) || !event.path.startsWith('/api/')) return
    const foreign = isForeignRequest({
        secFetchSite: getRequestHeader(event, 'sec-fetch-site'),
        origin: getRequestHeader(event, 'origin')
    }, getRequestHost(event, { xForwardedHost: true }))
    if (foreign) throw createError({ statusCode: 403, statusMessage: 'Cross-site request refused' })
})
