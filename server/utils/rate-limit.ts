/** A per-socket message budget: a burst of `burst` messages, refilled at `rate` per second. */
export interface TokenBucket {
    tokens: number
    refilledAt: number
}

/** Spend one token if there is one (the tables' and the floors' rate limit). */
export function takeToken(bucket: TokenBucket, burst: number, rate: number, now = Date.now()): boolean {
    bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.refilledAt) / 1000) * rate)
    bucket.refilledAt = now
    if (bucket.tokens < 1) return false
    bucket.tokens--
    return true
}
