import { toast } from 'vue-sonner'
import { starSummary, type StarSummary } from '#shared/stars'

/** A star level change the hub confirmed. */
export interface StarChange {
    level: number
    previous: number
    bounty: number
}

export interface WalletState {
    coins: number
    peakCoins: number
    gems: number | null
    hubAccount: boolean
    coinsPerGem: number
    convert: { min: number, max: number }
    allowance: { amount: number, available: boolean, nextAt: string }
    stars: StarSummary
    starChange: StarChange | null
}

/**
 * Gems, conversion, the daily allowance and the star level. Coins live in
 * useCasinoSession; anything that returns a balance updates them there.
 * A confirmed star rise gets its celebration, a drop just updates the track,
 * and the hub hears about both.
 */
export function useWallet() {
    const session = useCasinoSession()
    const bridge = useHubBridge()
    const wallet = useState<WalletState | null>('casino:wallet', () => null)
    const celebrations = useState<StarChange[]>('casino:celebrations', () => [])
    const loading = useState('casino:wallet-loading', () => false)

    /** Star level that follows the shown balance (the hub's copy may lag a moment). */
    const level = computed(() => wallet.value?.stars.level ?? 0)

    /** `gemsKnown`: the caller's gem count was read after the bounty was paid (a wallet read). */
    function applyStars(change: StarChange | null | undefined, gemsKnown = false) {
        if (!change) return
        if (wallet.value) wallet.value.stars.reported = change.level
        if (change.level > change.previous) celebrations.value.push(change)
        bridge.postStars(change.level)
        // The hub paid the bounty into the player's gems.
        if (!gemsKnown && change.bounty > 0 && wallet.value?.gems != null) setGems(wallet.value.gems + change.bounty)
    }

    /** Recompute the local star summary for a new balance (thresholds are shared). */
    function followCoins(coins: number) {
        if (!wallet.value) return
        wallet.value.coins = coins
        wallet.value.stars = starSummary(coins, wallet.value.stars.reported)
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

    async function claimAllowance() {
        try {
            const result = await $fetch<{ balance: number, nextAt: string, stars: StarChange | null }>('/api/wallet/allowance', { method: 'POST' })
            session.setCoins(result.balance)
            if (wallet.value) wallet.value.allowance = { ...wallet.value.allowance, available: false, nextAt: result.nextAt }
            applyStars(result.stars)
            return true
        } catch (error) {
            if (!session.handleUnauthorized(error)) toast.error(apiErrorMessage(error, 'Could not claim the allowance'))
            return false
        }
    }

    return { wallet, level, loading, celebrations, refresh, convert, claimAllowance, applyStars, followCoins, setGems }
}
