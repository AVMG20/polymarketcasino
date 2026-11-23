/** The casino being visited, while the visit page is open. */
export interface VisitHost {
    id: string
    name: string
    /** Its built games and their level. */
    games: Record<string, number>
}

/**
 * Visiting another casino: its built games can be played (and its live
 * tables sat at) with your own coins and chips. The visit page sets the host
 * and clears it when it closes; rounds and seats pass `host` while it is set,
 * and the server checks the host really has the game.
 */
export function useVisitHost() {
    const host = useState<VisitHost | null>('social:host', () => null)

    /** The host's id when it has `slug` built (so a round may pass it), else undefined. */
    function hostFor(slug: string): string | undefined {
        const h = host.value
        return h && (h.games[slug] ?? 0) >= 1 ? h.id : undefined
    }

    return { host, hostFor }
}
