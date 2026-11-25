import { toast } from 'vue-sonner'
import { STAR_GOALS, starTitle, type StarGoalDef, type StarSummary } from '#shared/stars'

/** A star level change the hub confirmed. */
export interface StarChange {
    level: number
    previous: number
    bounty: number
    /** The casino goals done when it was reported. */
    goals?: string[]
    /** Reported before this response: the hub paid its bounty earlier, so a gem count read since has it. */
    late?: true
}

/** A star rise to celebrate: the level's title and the goals it brought (empty when not known). */
export interface StarCelebration extends StarChange {
    title: string
    earned: StarGoalDef[]
}

export interface WalletState {
    coins: number
    /** My Casino chips: what wins pay. */
    chips: number
    peakCoins: number
    gems: number | null
    hubAccount: boolean
    coinsPerGem: number
    convert: { min: number, max: number }
    stars: StarSummary
    starChange: StarChange | null
}

/**
 * Gems, conversion and the star level. Coins live in
 * useCasinoSession and chips in useTycoon; anything that returns a balance
 * updates them there. The stars count the casino goals reached; the server
 * works them out (the wallet and the owner's casino reads carry them, see
 * `followStars`). A confirmed star rise gets its celebration, and the hub
 * hears about it. The server hands each rise to exactly one response (the
 * seen level, server/utils/stars.ts), so every StarChange that arrives is
 * applied as it comes; one from a read may have a bounty of 0 or no known
 * goal, and the celebration then leaves those out.
 */
export function useWallet() {
    const session = useCasinoSession()
    const bridge = useHubBridge()
    const wallet = useState<WalletState | null>('casino:wallet', () => null)
    const celebrations = useState<StarCelebration[]>('casino:celebrations', () => [])
    const loading = useState('casino:wallet-loading', () => false)
    /** The goals done as of the last star change seen (null until the first summary): a change's new goals are the ones missing here. */
    const knownGoals = useState<string[] | null>('casino:known-goals', () => null)

    /** The star summary (goals and level), from the last wallet or casino read. */
    const stars = computed(() => wallet.value?.stars ?? null)
    const level = computed(() => stars.value?.level ?? 0)

    /** Take a fresh summary from the server (a wallet read, the owner's casino read). */
    function followStars(summary: StarSummary | null | undefined) {
        if (!summary) return
        knownGoals.value ??= summary.goals.filter(goal => goal.done).map(goal => goal.key)
        if (wallet.value) wallet.value.stars = summary
    }

    /** `gemsKnown`: the caller's gem count was read after the bounty was paid (a wallet read). */
    function applyStars(change: StarChange | null | undefined, gemsKnown = false) {
        if (!change) return
        const known = knownGoals.value
        const goals = change.goals ?? []
        const earned = known ? STAR_GOALS.filter(goal => goals.includes(goal.key) && !known.includes(goal.key)) : []
        if (change.goals) knownGoals.value = [...change.goals]
        const summary = wallet.value?.stars
        if (summary) {
            summary.reported = change.level
            // The goals the report counted are done; the next read brings the rest of the progress.
            for (const goal of summary.goals) {
                if (!goals.includes(goal.key) || goal.done) continue
                goal.done = true
                goal.have = goal.need
            }
            summary.level = summary.goals.filter(goal => goal.done).length
        }
        if (change.level > change.previous) celebrations.value.push({ ...change, title: starTitle(change.level) ?? '', earned })
        bridge.postStars(change.level)
        // The hub paid the bounty into the player's gems. Paid earlier (late), the gem count we hold may have it already: read it again.
        if (gemsKnown || change.bounty <= 0 || wallet.value?.gems == null) return
        if (change.late) void refresh()
        else setGems(wallet.value.gems + change.bounty)
    }

    /** Keep the wallet's coin copy in step with the session. */
    function followCoins(coins: number) {
        if (wallet.value) wallet.value.coins = coins
    }

    /** Keep the wallet's chip copy in step with the casino. */
    function followChips(chips: number) {
        if (wallet.value) wallet.value.chips = chips
    }

    function setGems(gems: number | null) {
        if (!wallet.value || gems === null) return
        wallet.value.gems = gems
        bridge.postWallet(gems)
    }

    async function refresh() {
        loading.value = true
        try {
            const state = await $fetch<WalletState>('/api/wallet')
            wallet.value = state
            followStars(state.stars)
            session.setCoins(state.coins)
            applyStars(state.starChange, true)
            if (state.gems !== null) bridge.postWallet(state.gems)
        } catch (error) {
            if (!session.handleUnauthorized(error)) toast.error(apiErrorMessage(error, 'Could not load your wallet'))
        } finally {
            loading.value = false
        }
    }

    /** Throws on failure so the dialog can stay open; the caller shows the error. */
    async function convert(gems: number) {
        const result = await $fetch<{ balance: number, gemsLeft: number, stars: StarChange | null }>('/api/wallet/convert', { method: 'POST', body: { gems } })
        session.setCoins(result.balance)
        setGems(result.gemsLeft)
        applyStars(result.stars)
        return result
    }

    return { wallet, stars, level, loading, celebrations, refresh, convert, applyStars, followCoins, followChips, followStars, setGems }
}
