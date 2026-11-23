import { findGame } from '#shared/games/registry'
import { findTycoonGame, findUpgrade, findZone, type BuildKind } from '#shared/tycoon'

/** 90 000 -> "1m 30s", 7 200 000 -> "2h". Instant builds read "instant". */
export function formatDuration(ms: number): string {
    if (ms <= 0) return 'instant'
    const total = Math.ceil(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
    if (m > 0) return s > 0 && m < 10 ? `${m}m ${s}s` : `${m}m`
    return `${s}s`
}

/** A live countdown: always shows the seconds ("1:05", "1:02:09"). */
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** What a construction or build item is called. */
export function buildName(kind: BuildKind, id: string): string {
    if (kind === 'zone') return findZone(id)?.name ?? id
    if (kind === 'upgrade') return findUpgrade(id)?.name ?? id
    return findGame(id)?.name ?? id
}

export function isTycoonGame(slug: string): boolean {
    return !!findTycoonGame(slug)
}
