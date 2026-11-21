import type { H3Event, Session, SessionConfig } from 'h3'
import { getCookie, getRequestProtocol, updateSession, useSession } from 'h3'
import { casinoEnv } from './env'
import { getCoins } from './ledger'

export interface CasinoSessionData {
    playerId?: string
}

export const SESSION_COOKIE = 'pnx_casino'
/** Sessions last 30 days from the last visit (sliding). */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30
/** A session older than this is re-issued on the next request, restarting its 30 days. */
const SESSION_REFRESH_MS = 24 * 3_600_000

/** True when the request reached us over https (directly or via a proxy's x-forwarded-proto). */
export function isHttps(event?: H3Event) {
    return !!event && getRequestProtocol(event, { xForwardedProto: true }) === 'https'
}

export function sessionConfig(event?: H3Event): SessionConfig {
    const env = casinoEnv()
    // The .env.example placeholder is long enough but public: never in production.
    if (env.sessionPassword.length < 32 || (env.production && env.sessionPassword.startsWith('change-me'))) {
        throw createError({ statusCode: 500, statusMessage: 'NUXT_SESSION_PASSWORD must be a secret of at least 32 characters' })
    }
    const none = env.sameSite === 'none'
    return {
        name: SESSION_COOKIE,
        password: env.sessionPassword,
        maxAge: SESSION_MAX_AGE,
        // Only the cookie carries a session; no `x-…-session` header shortcut.
        sessionHeader: false,
        cookie: {
            httpOnly: true,
            path: '/',
            sameSite: env.sameSite,
            // SameSite=None needs Secure, and Partitioned (CHIPS) to survive
            // third-party cookie blocking in a foreign-domain iframe.
            secure: none || env.production || isHttps(event),
            ...(none ? { partitioned: true } : {})
        }
    }
}

export async function getCasinoSession(event: H3Event) {
    return useSession<CasinoSessionData>(event, sessionConfig(event))
}

/**
 * Start a fresh session for `playerId`: a new id and a new createdAt, so the
 * 30 days count from now. (Updating the existing session would keep the
 * createdAt of the cookie the request carried, and with it the old expiry.)
 */
export async function setSessionPlayer(event: H3Event, playerId: string) {
    const fresh: Session<CasinoSessionData> = { id: crypto.randomUUID(), createdAt: Date.now(), data: { playerId } }
    event.context.sessions ??= Object.create(null)
    event.context.sessions![SESSION_COOKIE] = fresh
    await updateSession(event, sessionConfig(event))
}

export async function clearCasinoSession(event: H3Event) {
    const session = await getCasinoSession(event)
    await session.clear()
}

/**
 * The signed-in player's id; 401 without a session or when it points at a
 * player that no longer exists. Every protected endpoint starts here. A day-old
 * session is re-issued, so 30 days count from the last visit.
 */
export async function requirePlayerId(event: H3Event): Promise<string> {
    // No cookie, no session: don't mint an empty one for an anonymous visitor.
    if (!getCookie(event, SESSION_COOKIE)) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const session = await getCasinoSession(event)
    const playerId = session.data.playerId
    if (!playerId || !getCoins(playerId)) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const created = event.context.sessions?.[SESSION_COOKIE]?.createdAt as number | undefined
    if (created && Date.now() - created > SESSION_REFRESH_MS) await setSessionPlayer(event, playerId)
    return playerId
}
