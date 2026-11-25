import { toast } from 'vue-sonner'
import type { StarChange } from './useWallet'

export interface RoundResponse<TResult> {
    roundId: string
    game: string
    stake: number
    payout: number
    result: TResult
    /** The coin balance after the round. */
    balance: number
    stars: StarChange | null
    /** The chip balance after the round (every payout is chips). */
    chips: number
    /** The payout, paid in chips (0 on a loss). */
    chipsEarned: number
    /** The rakeback on the stake, in chips (0 when it went to the casino being visited); `chips` includes it. */
    rakeback?: number
    /** The stake's two parts: coins first, then chips for the rest. */
    stakeCoins: number
    stakeChips: number
}

/**
 * One game's rounds: POST /api/games/<slug>/play and hold the response until
 * the game has shown it. Call `settle()` once the animation and win reveal are
 * done; it applies both balances (never earlier, or it spoils the win:
 * coins after the stake, chips after the payout) and celebrates any star.
 * Leaving the page mid-round settles automatically.
 */
export function useGameRound<TResult>(slug: string) {
    const session = useCasinoSession()
    const wallet = useWallet()
    const tycoon = useTycoon()
    const floorEvents = useFloorEvents()
    const { hostFor } = useVisitHost()
    const busy = ref(false)
    /** Why the last play() failed, or ''. */
    const error = ref('')
    let pending: RoundResponse<TResult> | null = null
    let unmounted = false

    async function play(body: { bet?: number, options?: Record<string, unknown> }): Promise<RoundResponse<TResult> | null> {
        if (busy.value) return null
        busy.value = true
        error.value = ''
        floorEvents.emitPlaying(slug, true)
        try {
            const response = await $fetch<RoundResponse<TResult>>(`/api/games/${slug}/play`, { method: 'POST', body: { ...body, host: hostFor(slug) } })
            pending = response
            // The game closed while the request was out: apply it now, nobody will reveal it.
            if (unmounted) settle()
            return response
        } catch (failure) {
            busy.value = false
            floorEvents.emitPlaying(slug, false)
            // A game that is not built answers 403: re-read the casino so the lock shows.
            if (apiStatus(failure) === 403) void tycoon.refresh()
            error.value = apiErrorMessage(failure, 'The round did not go through')
            if (!session.handleUnauthorized(failure)) toast.error(error.value)
            return null
        }
    }

    function settle() {
        if (pending) {
            session.setCoins(pending.balance)
            tycoon.setChips(pending.chips)
            wallet.applyStars(pending.stars)
            floorEvents.emitRound({
                slug,
                stake: pending.stake,
                payout: pending.payout,
                chipsEarned: pending.chipsEarned,
                stakeCoins: pending.stakeCoins,
                stakeChips: pending.stakeChips
            })
            floorEvents.emitPlaying(slug, false)
            pending = null
        }
        busy.value = false
    }

    onBeforeUnmount(() => {
        unmounted = true
        settle()
    })

    return { busy, error, play, settle }
}
