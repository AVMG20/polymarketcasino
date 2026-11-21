import { devLoginAllowed } from '#server/utils/env'
import { upsertPlayer } from '#server/utils/launch'
import { setSessionPlayer } from '#server/utils/session'

/**
 * Dev only: sign in as a local player without the hub. The id is derived from
 * the name, so `?name=Alice` is the same Alice every time. Browsers get
 * redirected to `return` (or /), everything else gets JSON.
 */
export default defineEventHandler(async (event) => {
    if (!devLoginAllowed(event)) throw createError({ statusCode: 404, statusMessage: 'Not found' })

    const query = getQuery(event)
    const name = String(query.name ?? 'Dev').trim().slice(0, 40) || 'Dev'
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dev'
    const player = upsertPlayer({ sub: `dev-${slug}`, name, image: null, title: 'Newcomer' }, 'dev')
    await setSessionPlayer(event, player.id)

    if (getRequestHeader(event, 'accept')?.includes('text/html')) {
        // A local path only: `//host` and `/\host` would leave the site.
        const target = typeof query.return === 'string' && /^\/(?![/\\])/.test(query.return) ? query.return : '/'
        return sendRedirect(event, target, 302)
    }
    return { player: { id: player.id, name: player.name, coins: player.coins } }
})
