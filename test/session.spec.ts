import { createApp, createRouter, defineEventHandler, sealSession, toWebHandler, unsealSession, type H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import { requirePlayerId, SESSION_COOKIE, sessionConfig, setSessionPlayer } from '../server/utils/session'
import { isForeignRequest } from '../server/utils/same-origin'
import { seedPlayer } from './setup/players'

// A tiny h3 app over the real session helpers.
const router = createRouter()
    .get('/me', defineEventHandler(async event => ({ playerId: await requirePlayerId(event) })))
    .post('/login', defineEventHandler(async (event) => {
        await setSessionPlayer(event, String(getQuery(event).id))
        return { ok: true }
    }))
const handle = toWebHandler(createApp().use(router))

function getQuery(event: H3Event) {
    return Object.fromEntries(new URL(event.path, 'http://x').searchParams)
}

/** A sealed cookie as if issued `ageMs` ago. */
async function cookieAged(playerId: string, ageMs: number) {
    const fake = { context: { sessions: { [SESSION_COOKIE]: { id: 'old-session', createdAt: Date.now() - ageMs, data: { playerId } } } } }
    return `${SESSION_COOKIE}=${await sealSession(fake as unknown as H3Event, sessionConfig())}`
}

function sessionCookie(response: Response) {
    const header = response.headers.getSetCookie().find(c => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`))
    return header ? decodeURIComponent(header.split(';')[0]!.slice(SESSION_COOKIE.length + 1)) : null
}

describe('casino session', () => {
    it('signs a player in with an HttpOnly, SameSite=Lax cookie (Secure only on https outside production)', async () => {
        const id = seedPlayer()
        const response = await handle(new Request(`http://localhost/login?id=${id}`, { method: 'POST' }))
        const header = response.headers.getSetCookie().join('\n')
        expect(header).toContain('HttpOnly')
        expect(header).toContain('SameSite=Lax')
        expect(header).not.toContain('Secure')
        const secure = await handle(new Request(`http://localhost/login?id=${id}`, { method: 'POST', headers: { 'x-forwarded-proto': 'https' } }))
        expect(secure.headers.getSetCookie().join('\n')).toContain('Secure')
    })

    it('slides: a day-old session is re-issued with a fresh 30 days', async () => {
        const id = seedPlayer()
        const response = await handle(new Request('http://localhost/me', { headers: { cookie: await cookieAged(id, 2 * 86_400_000) } }))
        expect(await response.json()).toEqual({ playerId: id })
        const sealed = sessionCookie(response)
        expect(sealed).toBeTruthy()
        const session = await unsealSession(undefined as unknown as H3Event, sessionConfig(), sealed!)
        expect(Date.now() - session.createdAt!).toBeLessThan(5_000)
        expect(session.data).toEqual({ playerId: id })
    })

    it('leaves a fresh session alone and refuses an expired or foreign one', async () => {
        const id = seedPlayer()
        const fresh = await handle(new Request('http://localhost/me', { headers: { cookie: await cookieAged(id, 60_000) } }))
        expect(fresh.status).toBe(200)
        expect(sessionCookie(fresh)).toBeNull()
        const expired = await handle(new Request('http://localhost/me', { headers: { cookie: await cookieAged(id, 31 * 86_400_000) } }))
        expect(expired.status).toBe(401)
        const unknown = await handle(new Request('http://localhost/me', { headers: { cookie: await cookieAged('nobody', 60_000) } }))
        expect(unknown.status).toBe(401)
        const anonymous = await handle(new Request('http://localhost/me'))
        expect(anonymous.status).toBe(401)
        expect(anonymous.headers.getSetCookie()).toEqual([])
    })
})

describe('same-origin guard', () => {
    it('lets the casino\'s own pages and non-browser clients write, and refuses other sites', () => {
        const host = 'casino.avmg.nl'
        expect(isForeignRequest({ secFetchSite: 'same-origin' }, host)).toBe(false)
        expect(isForeignRequest({ secFetchSite: 'none' }, host)).toBe(false)
        // Another *.avmg.nl app is same-site: Lax cookies flow, so it must still be refused.
        expect(isForeignRequest({ secFetchSite: 'same-site', origin: 'https://evil.avmg.nl' }, host)).toBe(true)
        expect(isForeignRequest({ secFetchSite: 'cross-site' }, host)).toBe(true)
        expect(isForeignRequest({ origin: 'https://casino.avmg.nl' }, host)).toBe(false)
        expect(isForeignRequest({ origin: 'https://evil.example' }, host)).toBe(true)
        expect(isForeignRequest({ origin: 'null' }, host)).toBe(true)
        expect(isForeignRequest({}, host)).toBe(false)
    })
})
