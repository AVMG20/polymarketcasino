// Shared scaffolding for the slot games: bet + spin-guard + one round through
// the casino's round API (useGameRound → POST /api/games/<slug>/play). Ported
// from the old site, where it posted to /api/games/play-game; the guard cost
// isn't always `bet` (buy-bonus spins cost a multiple of it), so callers pass
// it in. Slots debit optimistically before the request and settle with the
// response after the reveal animation: the caller's `setBalance(data.balance)`
// at that point is the round's settle (balances and stars). Never refetch the
// session per spin. Unmounting mid-spin settles the round here (or in
// useGameRound) instead.
//
// `balance` is the playable bankroll, coins plus chips: a bet is paid from
// coins first, then chips, and every win pays chips.
import { sumCoins } from '#shared/money'

interface SpinResponse<TResult> {
    gameData: TResult
    /** The coin balance after the round. Pass it back to setBalance() to settle. */
    balance: number
    /** Coins staked and paid this round, in whole coins (the old results carried these in gameData). */
    stake: number
    payout: number
}

// All six slots cap their spin history at 10 rows; no caller needs this
// configurable, so it isn't.
const HISTORY_LIMIT = 10

export function useSlotGame<TResult, THistory extends Record<string, unknown> = Record<string, unknown>>(game: string) {
    const round = useGameRound<TResult>(game)
    const bankroll = useBankroll()

    // The last bet chosen in this slot, else about 1% of the bankroll on a chip value.
    const bet = useGameBet(game, bankroll.total)
    const isSpinning = ref(false)
    const errorMsg = ref('')
    // ref() would unwrap THistory into UnwrapRefSimple and reject the entries pushed below.
    const history = ref([]) as Ref<THistory[]>

    /** The playable bankroll: a bet is paid from coins first, then chips. Wins pay chips. */
    const balance = bankroll.total

    // idle: no round; debited: the optimistic debit may be written; unsettled:
    // a round came back and its reveal hasn't settled yet.
    let phase: 'idle' | 'debited' | 'unsettled' = 'idle'
    let disposed = false
    // Puts both balances back after the optimistic debit of a spin that failed.
    let restore: (() => void) | null = null

    /**
     * Write the balance. While a round is waiting this settles it (the
     * server's balances plus any star change); during a spin's start it is the
     * optimistic debit. Any other write is stale (a second settle, or the
     * refund of a failed spin, which spin() already restored) and is ignored.
     */
    function setBalance(value: number) {
        if (phase === 'unsettled') {
            phase = 'idle'
            round.settle()
            return
        }
        // The optimistic debit down to `value`, coins first, then chips.
        if (phase === 'debited' && !restore) restore = bankroll.take(sumCoins([balance.value, -value]))
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
        if (isSpinning.value) return null
        // A round the caller never settled (an animation that threw early) settles now.
        if (phase === 'unsettled') setBalance(0)
        if (balance.value < cost) return null
        isSpinning.value = true
        errorMsg.value = ''
        phase = 'debited'
        onStart?.()

        const data = await round.play({ bet: bet.value, options })
        if (!data) {
            // Put the optimistic debit back; the caller's own refund write is then a no-op.
            restore?.()
            restore = null
            phase = 'idle'
            isSpinning.value = false
            errorMsg.value = round.error.value || 'Something went wrong'
            return null
        }
        restore = null
        if (disposed) {
            phase = 'idle'
            round.settle()
        } else {
            phase = 'unsettled'
        }
        return { gameData: data.result, balance: data.balance, stake: data.stake, payout: data.payout }
    }

    return { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin }
}
