import { toast } from 'vue-sonner'
import type { StarChange } from './useWallet'

export interface RoundResponse<TResult> {
    roundId: string
    game: string
    stake: number
    payout: number
    result: TResult
    balance: number
    stars: StarChange | null
}

/**
 * One game's rounds: POST /api/games/<slug>/play and hold the response until
 * the game has shown it. Call `settle()` once the animation and win reveal are
 * done; it applies the balance (never earlier, or it spoils the win) and
 * celebrates any star. Leaving the page mid-round settles automatically.
 */
export function useGameRound<TResult>(slug: string) {
    const session = useCasinoSession()
    const wallet = useWallet()
    const busy = ref(false)
    let pending: RoundResponse<TResult> | null = null

    async function play(body: { bet?: number, options?: Record<string, unknown> }): Promise<RoundResponse<TResult> | null> {
        if (busy.value) return null
        busy.value = true
        try {
            const response = await $fetch<RoundResponse<TResult>>(`/api/games/${slug}/play`, { method: 'POST', body })
            pending = response
            return response
        } catch (error) {
            busy.value = false
            if (!session.handleUnauthorized(error)) toast.error(apiErrorMessage(error, 'The round did not go through'))
            return null
        }
    }

    function settle() {
        if (pending) {
            session.setCoins(pending.balance)
            wallet.applyStars(pending.stars)
            pending = null
        }
        busy.value = false
    }

    onBeforeUnmount(settle)

    return { busy, play, settle }
}
