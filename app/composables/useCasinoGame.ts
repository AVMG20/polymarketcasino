// Shared scaffolding for the originals (Wheel): bet + play-guard + one round
// through the casino's round API + capped history. Ported from the old site,
// where it posted to /api/games/play-game. Balance and history are applied by
// the page, not here, because each page delays them until its animation
// finishes: the page's `setBalance(data.balance)` at that point is the
// round's settle (balance and stars). Leaving mid-round settles on its own
// (useGameRound).

export interface PlayResponse<TResult> {
    gameData: TResult
    balance: number
    /** Staked (coins first, then chips) and paid (chips) this round (the old results carried the payout in gameData). */
    stake: number
    payout: number
}

export function useCasinoGame<TResult, THistory extends Record<string, unknown> = Record<string, unknown>>(
    game: string,
    opts?: { historyLimit?: number }
) {
    const round = useGameRound<TResult>(game)
    /** The playable bankroll: coins first, then chips. Wins pay chips. */
    const bankroll = useBankroll()
    const balance = bankroll.total
    const historyLimit = opts?.historyLimit ?? 8

    // The last bet chosen in this game, else about 1% of the bankroll on a chip value.
    const bet = useGameBet(game, balance)
    const isPlaying = ref(false)
    const isFetching = ref(false)
    const lastBet = ref(0)
    const errorMsg = ref('')
    // ref() would unwrap THistory into UnwrapRefSimple and reject the entries pushed below.
    const history = ref([]) as Ref<THistory[]>

    let unsettled = false

    /** Settles the round that is waiting (both balances and stars). Any other write is stale and ignored. */
    function setBalance(_value?: number) {
        if (!unsettled) return
        unsettled = false
        round.settle()
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
