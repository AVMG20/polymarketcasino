import type { H3Event } from 'h3'
import { getRequestHost, getRequestProtocol } from 'h3'

/**
 * Casino settings, read from the environment on every call so tests and a
 * restarted container see the current values. Names follow .env.example.
 */
export function casinoEnv() {
    const coreUrl = (process.env.CORE_URL || 'http://localhost:3100').replace(/\/+$/, '')
    const sameSite = process.env.PNX_COOKIE_SAMESITE === 'none' ? 'none' as const : 'lax' as const
    const production = process.env.NODE_ENV === 'production'
    return {
        coreUrl,
        appId: process.env.PNX_APP_ID || 'casino',
        appKey: process.env.PNX_APP_KEY || '',
        sessionPassword: process.env.NUXT_SESSION_PASSWORD || '',
        sameSite,
        production,
        publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3200').replace(/\/+$/, ''),
        devLoginFlag: !production && process.env.PNX_DEV_LOGIN === 'true',
        // Salts the floor's luck (shared/visitors.ts seedOf): server only, so the good hours can't be
        // worked out from a player id. Falls back to the session secret, then to a fixed dev value.
        luckSalt: process.env.PNX_LUCK_SALT || process.env.NUXT_SESSION_PASSWORD || 'dev-luck'
    }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * The dev login is open only outside production, with PNX_DEV_LOGIN=true, and
 * for a request on plain http or a localhost host. A mis-set env var on a
 * public https deployment still can't enable it.
 */
export function devLoginAllowed(event: H3Event): boolean {
    if (!casinoEnv().devLoginFlag) return false
    const host = getRequestHost(event, { xForwardedHost: true }).replace(/:\d+$/, '')
    return LOCAL_HOSTS.has(host) || getRequestProtocol(event, { xForwardedProto: true }) === 'http'
}
