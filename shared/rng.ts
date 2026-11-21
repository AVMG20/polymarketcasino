/**
 * Randomness for every game. An `Rng` yields uniform floats in [0, 1).
 *
 * - `cryptoRng` (CSPRNG) decides every real outcome on the server.
 * - `seededRng(seed)` replays identically; tests and balance scripts only.
 *   Anyone who knows the seed can predict it, so it never decides a payout.
 *
 * Never use Math.random() for outcomes; it is fine for cosmetic effects.
 */
export interface Rng {
    next(): number
}

const TWO_POW_26 = 67108864
const TWO_POW_53 = 9007199254740992

/** Uniform in [0, 1) with a full 53-bit mantissa from crypto.getRandomValues. */
export const cryptoRng: Rng = {
    next() {
        const buf = new Uint32Array(2)
        crypto.getRandomValues(buf)
        return ((buf[0]! >>> 5) * TWO_POW_26 + (buf[1]! >>> 6)) / TWO_POW_53
    }
}

/** mulberry32: a tiny, fast, seedable generator. The whole state is one u32. */
export function seededRng(seed: number): Rng & { readonly state: number } {
    let s = seed >>> 0
    return {
        get state() {
            return s
        },
        next() {
            s = (s + 0x6D2B79F5) >>> 0
            let t = s
            t = Math.imul(t ^ (t >>> 15), t | 1)
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }
}

/** Uniform integer in [min, max], inclusive. */
export function randomInt(rng: Rng, min: number, max: number): number {
    return min + Math.floor(rng.next() * (max - min + 1))
}

/** Uniform element of a non-empty array. */
export function randomPick<T>(rng: Rng, items: readonly T[]): T {
    return items[Math.floor(rng.next() * items.length)]!
}

/** True with probability `p`. */
export function randomChance(rng: Rng, p: number): boolean {
    return rng.next() < p
}

/** A key drawn in proportion to its weight. Zero weights never come up. */
export function weightedPick<K extends string>(rng: Rng, weights: Readonly<Record<K, number>>): K {
    const entries = Object.entries(weights) as [K, number][]
    let total = 0
    for (const [, weight] of entries) total += weight
    let roll = rng.next() * total
    for (const [key, weight] of entries) {
        roll -= weight
        if (roll < 0) return key
    }
    return entries[entries.length - 1]![0]
}

/** `count` distinct elements, in random order (partial Fisher-Yates). */
export function randomSample<T>(rng: Rng, items: readonly T[], count: number): T[] {
    const pool = items.slice()
    const n = Math.min(count, pool.length)
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rng.next() * (pool.length - i))
        const swap = pool[i]!
        pool[i] = pool[j]!
        pool[j] = swap
    }
    return pool.slice(0, n)
}
