// Shared scaffolding for the originals (Wheel): bet + play-guard + one round
// through the casino's round API + capped history. Ported from the old site,
// where it posted to /api/games/play-game. Balance and history are applied by
// the page, not here, because each page delays them until its animation
// finishes: the page's `setBalance(data.balance)` at that point is the
// round's settle (balance and stars). Leaving mid-round settles on its own
// (useGameRound).
import { findGame } from '#shared/games/registry'

export interface PlayResponse<TResult> {
    gameData: TResult
    balance: number
    /** Coins staked and paid this round (the old results carried the payout in gameData). */
    stake: number
    payout: number
}

export function useCasinoGame<TResult, THistory extends Record<string, unknown> = Record<string, unknown>>(
    game: string,
    opts?: { historyLimit?: number }
) {
    const session = useCasinoSession()
    const round = useGameRound<TResult>(game)
    const balance = session.coins
    const historyLimit = opts?.historyLimit ?? 8

    // The old site started at 10 with a 1-coin minimum; the casino's bets
    // start at the game's minimum.
    const bet = ref(findGame(game)?.minBet ?? 100)
    const isPlaying = ref(false)
    const isFetching = ref(false)
    const lastBet = ref(0)
    const errorMsg = ref('')
    // ref() would unwrap THistory into UnwrapRefSimple and reject the entries pushed below.
    const history = ref([]) as Ref<THistory[]>

    let unsettled = false

    /** Settles the round that is waiting (balance and stars), or writes the balance. */
    function setBalance(value: number) {
        if (unsettled) {
            unsettled = false
            round.settle()
            return
        }
        session.setCoins(value)
    }

    function pushHistory(entry: THistory) {
        history.value.unshift(entry)
        if (history.value.length > historyLimit) history.value.pop()
    }

    // onStart fires only once the guard has passed, so page-local state (e.g. lastResult)
    // is reset in the same tick as bet/isPlaying, not before a blocked click does nothing.
    async function play(options: Record<string, unknown>, onStart?: () => void): Promise<PlayResponse<TResult> | null> {
        if (isPlaying.value || balance.value < bet.value) return null
        isPlaying.value = true
        isFetching.value = true
        errorMsg.value = ''
        lastBet.value = bet.value
        onStart?.()

        const data = await round.play({ bet: bet.value, options })
        isFetching.value = false
        if (!data) {
            isPlaying.value = false
            errorMsg.value = round.error.value || 'Something went wrong'
            return null
        }
        unsettled = true
        return { gameData: data.result, balance: data.balance, stake: data.stake, payout: data.payout }
    }

    return { bet, isPlaying, isFetching, lastBet, errorMsg, balance, setBalance, history, pushHistory, play }
}
