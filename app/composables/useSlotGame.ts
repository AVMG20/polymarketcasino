// Shared scaffolding for the slot games: bet + spin-guard + one round through
// the casino's round API (useGameRound → POST /api/games/<slug>/play). Ported
// from the old site, where it posted to /api/games/play-game; the guard cost
// isn't always `bet` (buy-bonus spins cost a multiple of it), so callers pass
// it in. Slots debit optimistically before the request and settle with the
// response's balance after the reveal animation: the caller's
// `setBalance(data.balance)` at that point is the round's settle (balance and
// stars). Never refetch the session per spin. Unmounting mid-spin settles the
// round here (or in useGameRound) instead.
import { findGame } from '#shared/games/registry'

interface SpinResponse<TResult> {
    gameData: TResult
    balance: number
    /** What the round paid, in whole coins (games whose result is in × bet read it here). */
    payout: number
}

// All six slots cap their spin history at 10 rows; no caller needs this
// configurable, so it isn't.
const HISTORY_LIMIT = 10

export function useSlotGame<TResult, THistory extends Record<string, unknown> = Record<string, unknown>>(game: string) {
    const session = useCasinoSession()
    const round = useGameRound<TResult>(game)
    const balance = session.coins

    // The old site started at 10 with a 1-coin minimum; the casino's bets
    // start at the game's minimum.
    const bet = ref(findGame(game)?.minBet ?? 100)
    const isSpinning = ref(false)
    const errorMsg = ref('')
    // ref() would unwrap THistory into UnwrapRefSimple and reject the entries pushed below.
    const history = ref([]) as Ref<THistory[]>

    // A round came back but its reveal hasn't settled yet.
    let unsettled = false
    let disposed = false

    /**
     * Write the balance. While a round is waiting this settles it (the
     * server's balance plus any star change); otherwise it is a local write,
     * like the optimistic debit before a spin or the refund of a failed one.
     */
    function setBalance(value: number) {
        if (unsettled) {
            unsettled = false
            round.settle()
            return
        }
        session.setCoins(value)
    }

    // useGameRound settles a round still waiting when the game unmounts; this
    // covers a response that only arrives afterwards.
    onScopeDispose(() => {
        disposed = true
    })

    function pushHistory(entry: THistory) {
        history.value.unshift(entry)
        if (history.value.length > HISTORY_LIMIT) history.value.pop()
    }

    // onStart fires only once the guard has passed, so the caller can take its
    // optimistic balance debit and reset per-round visual state in the same
    // tick as isSpinning flipping true, not before a blocked click does nothing.
    async function spin(cost: number, options: Record<string, unknown> | undefined, onStart?: () => void): Promise<SpinResponse<TResult> | null> {
        if (isSpinning.value || balance.value < cost) return null
        isSpinning.value = true
        errorMsg.value = ''
        onStart?.()

        const data = await round.play({ bet: bet.value, options })
        if (!data) {
            isSpinning.value = false
            errorMsg.value = round.error.value || 'Something went wrong'
            return null
        }
        if (disposed) round.settle()
        else unsettled = true
        return { gameData: data.result, balance: data.balance, payout: data.payout }
    }

    return { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin }
}
