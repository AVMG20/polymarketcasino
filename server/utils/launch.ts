import { lt } from 'drizzle-orm'
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import { db } from '#server/database'
import { launchTokens, players } from '#server/database/schema'
import { casinoEnv } from './env'

export interface LaunchClaims {
    sub: string
    name: string
    image: string | null
    title: string | null
    jti: string
    exp: number
}

let remote: { url: string, keySet: JWTVerifyGetKey } | null = null

/** The hub's public keys, fetched and cached by jose (refetched on an unknown kid). */
function hubKeySet(coreUrl: string): JWTVerifyGetKey {
    const url = `${coreUrl}/.well-known/jwks.json`
    if (remote?.url !== url) {
        remote = { url, keySet: createRemoteJWKSet(new URL(url), { timeoutDuration: 5_000, cooldownDuration: 30_000 }) }
    }
    return remote.keySet
}

export interface VerifyOptions {
    keySet?: JWTVerifyGetKey
    issuer?: string
    audience?: string
}

/**
 * Verify a hub launch token's signature, issuer, audience and expiry. Throws a
 * 401 for anything that is not a valid token for this app. Does not consume the
 * jti; `consumeLaunchToken` does that.
 */
export async function verifyLaunchToken(token: string, options: VerifyOptions = {}): Promise<LaunchClaims> {
    const env = casinoEnv()
    const issuer = options.issuer ?? env.coreUrl
    const audience = options.audience ?? env.appId
    try {
        const { payload } = await jwtVerify(token, options.keySet ?? hubKeySet(env.coreUrl), {
            issuer,
            audience,
            algorithms: ['ES256'],
            // Small clock drift between hub and app must not reject fresh tokens.
            clockTolerance: 30,
            requiredClaims: ['sub', 'jti', 'exp', 'iat']
        })
        if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.jti !== 'string' || !payload.jti) {
            throw new Error('missing sub or jti')
        }
        const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 60) : 'Player'
        return {
            sub: payload.sub,
            name,
            image: typeof payload.image === 'string' && payload.image ? payload.image : null,
            title: typeof payload.title === 'string' && payload.title ? payload.title : null,
            jti: payload.jti,
            exp: payload.exp!
        }
    } catch (error) {
        const reason = error instanceof errors.JWTExpired
            ? 'Launch token expired'
            : error instanceof errors.JWTClaimValidationFailed
                ? `Launch token rejected (${error.claim})`
                : 'Invalid launch token'
        throw createError({ statusCode: 401, statusMessage: reason })
    }
}

/**
 * Accept a jti exactly once. The insert is the guard: a replayed token (or two
 * tabs racing with the same one) gets no row back and is rejected.
 */
export function consumeLaunchToken(jti: string, exp: number) {
    const row = db.insert(launchTokens)
        .values({ jti, expiresAt: new Date(exp * 1000) })
        .onConflictDoNothing()
        .returning({ jti: launchTokens.jti })
        .get()
    if (!row) throw createError({ statusCode: 401, statusMessage: 'Launch token already used' })
    // A used jti only matters until the token would have expired anyway.
    db.delete(launchTokens).where(lt(launchTokens.expiresAt, new Date(Date.now() - 60_000))).run()
}

/** Create the player behind a launch token, or refresh their name, image and title. */
export function upsertPlayer(claims: Pick<LaunchClaims, 'sub' | 'name' | 'image' | 'title'>, origin: 'hub' | 'dev' = 'hub') {
    return db.insert(players)
        .values({ id: claims.sub, name: claims.name, image: claims.image, title: claims.title, origin })
        .onConflictDoUpdate({
            target: players.id,
            set: { name: claims.name, image: claims.image, title: claims.title, updatedAt: new Date() }
        })
        .returning()
        .get()
}
