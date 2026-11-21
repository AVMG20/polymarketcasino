import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTVerifyGetKey } from 'jose'
import { consumeLaunchToken, upsertPlayer, verifyLaunchToken } from '../server/utils/launch'
import { coinsOf } from './setup/players'

// A local ES256 key stands in for the hub's signing key.
let privateKey: CryptoKey
let jwk: JWK
let keySet: JWTVerifyGetKey

beforeAll(async () => {
    const pair = await generateKeyPair('ES256')
    privateKey = pair.privateKey
    jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' }
    keySet = createLocalJWKSet({ keys: [jwk] })
})

afterEach(() => {
    vi.unstubAllGlobals()
})

interface TokenOverrides {
    iss?: string
    aud?: string
    sub?: string
    jti?: string
    iat?: number
    exp?: number
}

function sign(overrides: TokenOverrides = {}) {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({ name: 'Alice', image: null, title: 'Regular' })
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setIssuer(overrides.iss ?? 'http://hub.test')
        .setAudience(overrides.aud ?? 'casino')
        .setSubject(overrides.sub ?? 'user-1')
        .setJti(overrides.jti ?? crypto.randomUUID())
        .setIssuedAt(overrides.iat ?? now)
        .setExpirationTime(overrides.exp ?? now + 300)
        .sign(privateKey)
}

describe('verifyLaunchToken', () => {
    it('accepts a valid token and reads its claims', async () => {
        const claims = await verifyLaunchToken(await sign({ sub: 'user-42' }), { keySet })
        expect(claims).toMatchObject({ sub: 'user-42', name: 'Alice', image: null, title: 'Regular' })
        expect(claims.jti).toBeTruthy()
    })

    it('rejects a token for another app', async () => {
        await expect(verifyLaunchToken(await sign({ aud: 'other-app' }), { keySet }))
            .rejects.toMatchObject({ statusCode: 401 })
    })

    it('rejects a token from another issuer', async () => {
        await expect(verifyLaunchToken(await sign({ iss: 'http://evil.test' }), { keySet }))
            .rejects.toMatchObject({ statusCode: 401 })
    })

    it('rejects an expired token', async () => {
        const past = Math.floor(Date.now() / 1000) - 3600
        await expect(verifyLaunchToken(await sign({ iat: past - 300, exp: past }), { keySet }))
            .rejects.toMatchObject({ statusCode: 401, statusMessage: 'Launch token expired' })
    })

    it('rejects a token signed by a different key', async () => {
        const other = await generateKeyPair('ES256')
        const forged = await new SignJWT({ name: 'Mallory' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
            .setIssuer('http://hub.test').setAudience('casino').setSubject('user-1')
            .setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime('5m')
            .sign(other.privateKey)
        await expect(verifyLaunchToken(forged, { keySet })).rejects.toMatchObject({ statusCode: 401 })
    })

    it('fetches the hub JWKS from CORE_URL/.well-known/jwks.json', async () => {
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            expect(String(input instanceof Request ? input.url : input)).toBe('http://hub.test/.well-known/jwks.json')
            return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } })
        })
        vi.stubGlobal('fetch', fetchMock)
        const claims = await verifyLaunchToken(await sign({ sub: 'user-remote' }))
        expect(claims.sub).toBe('user-remote')
        expect(fetchMock).toHaveBeenCalled()
    })
})

describe('consumeLaunchToken', () => {
    it('accepts a jti once and rejects the replay', async () => {
        const token = await sign()
        const claims = await verifyLaunchToken(token, { keySet })
        consumeLaunchToken(claims.jti, claims.exp)
        const replay = await verifyLaunchToken(token, { keySet })
        expect(() => consumeLaunchToken(replay.jti, replay.exp)).toThrowError(expect.objectContaining({ statusCode: 401 }))
    })

    it('creates the player on first launch and refreshes the profile later', () => {
        const id = `launch-${crypto.randomUUID()}`
        upsertPlayer({ sub: id, name: 'Bob', image: null, title: 'Newcomer' })
        const again = upsertPlayer({ sub: id, name: 'Bobby', image: 'https://img.test/b.png', title: 'Regular' })
        expect(again).toMatchObject({ id, name: 'Bobby', image: 'https://img.test/b.png', title: 'Regular', coins: 0 })
        expect(coinsOf(id).coins).toBe(0)
    })
})
