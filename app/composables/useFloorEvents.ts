import type { BuildKind } from '#shared/tycoon'

/**
 * A tiny bus between the games, the build menu and the floor page. Games
 * announce rounds and construction finishing; the page forwards them to the
 * Pixi floor (celebrate, playing) and opens build cards. Client only.
 */
export interface FloorRoundEvent {
    slug: string
    stake: number
    /** The payout, paid in chips (the same number as chipsEarned). */
    payout: number
    chipsEarned: number
    /** The stake's two parts: coins first, then chips. */
    stakeCoins: number
    stakeChips: number
}

export interface FloorBuiltEvent {
    kind: BuildKind
    id: string
    level: number
}

export interface FloorBuildRequest {
    kind: BuildKind
    id: string
}

const rounds = new Set<(event: FloorRoundEvent) => void>()
const playing = new Set<(slug: string, on: boolean) => void>()
const built = new Set<(event: FloorBuiltEvent) => void>()
const buildRequests = new Set<(request: FloorBuildRequest) => void>()

function listen<T extends (...args: never[]) => void>(set: Set<T>, handler: T) {
    set.add(handler)
    if (getCurrentScope()) onScopeDispose(() => set.delete(handler))
    return () => set.delete(handler)
}

export function useFloorEvents() {
    return {
        emitRound: (event: FloorRoundEvent) => rounds.forEach(handler => handler(event)),
        emitPlaying: (slug: string, on: boolean) => playing.forEach(handler => handler(slug, on)),
        emitBuilt: (event: FloorBuiltEvent) => built.forEach(handler => handler(event)),
        requestBuild: (request: FloorBuildRequest) => buildRequests.forEach(handler => handler(request)),
        onRound: (handler: (event: FloorRoundEvent) => void) => listen(rounds, handler),
        onPlaying: (handler: (slug: string, on: boolean) => void) => listen(playing, handler),
        onBuilt: (handler: (event: FloorBuiltEvent) => void) => listen(built, handler),
        onBuildRequest: (handler: (request: FloorBuildRequest) => void) => listen(buildRequests, handler)
    }
}
