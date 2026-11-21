import { FetchError, ofetch } from 'ofetch'
import { casinoEnv } from './env'

/**
 * Typed client for the hub's app API (docs/platform-contract.md §2). Every call
 * carries the app's Bearer key and gives up after a few seconds, so a slow or
 * missing hub never holds a casino request hostage.
 */

const TIMEOUT_MS = 5_000
/** After the hub fails to answer at all, fail fast for this long instead of waiting out timeouts. */
const DOWN_BACKOFF_MS = 15_000
let downUntil = 0

/** A failed hub call. `statusCode` is null when the hub could not be reached at all. */
export class HubError extends Error {
    /**
     * @param backoff true when the call was not even tried because the hub
     *   failed moments ago (nothing new to log).
     */
    constructor(message: string, readonly statusCode: number | null, readonly backoff = false) {
        super(message)
        this.name = 'HubError'
    }

    /** The hub answered and refused (4xx): retrying the same call will not help. */
    get rejected() {
        return this.statusCode !== null && this.statusCode >= 400 && this.statusCode < 500
    }
}

export interface HubManifestStar {
    key: string
    name: string
    description: string
}

export interface HubManifestGame {
    slug: string
    visibility: 'public' | 'draft'
    name: string
    tagline: string
    description: string
    playPath: string
    icon: string
    cover: string | null
    accent: string
    stars: HubManifestStar[]
}

export interface HubManifest {
    games: HubManifestGame[]
}

export interface HubPlayer {
    id: string
    name: string
    image: string | null
    gems: number
    stars: number
    title: string
}

export interface HubSpendInput {
    playerId: string
    amount: number
    game: string
    reason: string
    idempotencyKey: string
}

export interface HubStarSet {
    /** False when the hub already holds a set with a higher `seq` for this player. */
    applied: boolean
    /** The level the hub now holds for this player and game. */
    stars: number
    /** The best level this player ever reached in this game. */
    best: number
    /** Gems paid for reaching a new best, 0 otherwise. */
    bounty: number
    /** The player's star total across all games. */
    total: number
    title: string
}

async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: Record<string, unknown>): Promise<T> {
    const env = casinoEnv()
    if (Date.now() < downUntil) throw new HubError('Hub unavailable', null, true)
    try {
        return await ofetch<T>(`${env.coreUrl}/api/v1${path}`, {
            method,
            body,
            headers: { Authorization: `Bearer ${env.appKey}` },
            timeout: TIMEOUT_MS,
            retry: 0
        })
    } catch (error) {
        if (error instanceof FetchError) {
            const data = error.data as { statusMessage?: string, message?: string } | undefined
            const status = error.statusCode ?? error.response?.status ?? null
            if (!status || status >= 500) downUntil = Date.now() + DOWN_BACKOFF_MS
            throw new HubError(data?.statusMessage || data?.message || error.message, status || null)
        }
        downUntil = Date.now() + DOWN_BACKOFF_MS
        throw new HubError(error instanceof Error ? error.message : 'Hub request failed', null)
    }
}

export const hub = {
    putManifest: (manifest: HubManifest) =>
        request<{ games: { slug: string, stars: number }[] }>('PUT', '/manifest', manifest as unknown as Record<string, unknown>),

    getPlayer: (playerId: string) =>
        request<HubPlayer>('GET', `/players/${encodeURIComponent(playerId)}`),

    spendGems: (input: HubSpendInput) =>
        request<{ spendId: string, gems: number }>('POST', '/gems/spend', { ...input }),

    refundGems: (spendId: string) =>
        request<{ gems: number }>('POST', '/gems/refund', { spendId }),

    /** Set the player's star level (0-10). Applied only when `seq` beats the last one stored. */
    setStars: (input: { playerId: string, game: string, stars: number, seq: number }) =>
        request<HubStarSet>('PUT', '/stars', input),

    /** Heartbeat: tells the hub this app is alive. */
    ping: () => request<unknown>('GET', '/ping')
}
