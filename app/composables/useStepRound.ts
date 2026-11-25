import { toast } from 'vue-sonner'
import type { StepStatus } from '#shared/games/steps'
import type { StarChange } from './useWallet'

/** A multi-step round as the server shows it (server/utils/steps.ts). */
export interface StepRound<V> {
    id: string
    game: string
    bet: number
    stakeChips: number
    /** Moves made; sent back with the next move. */
    step: number
    status: StepStatus
    multiplier: number
    /** What cashing out pays now; what it paid once over. */
    payout: number
    canCashOut: boolean
    view: V
}

interface StepResponse<V> {
    round: StepRound<V>
    balance: number
    chips: number
    stars: StarChange | null
    chipsEarned: number
    /** The coins the round's rakeback put in the player's own cage (0 when it went to the casino being visited). */
    rakeback?: number
    /** The player's rakeback pot in the cage after, when the settle raised it; else null. */
    rakebackPot?: number | null
}

/**
 * One multi-step game's rounds (Gem Dig, Card Climb): start (the stake is
 * taken at once, so the coin balance drops then), move one step at a time
 * and cash out. A round that ends (bust or cash-out) is held until the game
 * has shown it: call `settle()` after the reveal; it applies the chips and
 * celebrates any star (leaving settles too). `resume()` picks an open round
 * back up, so a closed tab never loses one.
 */
export function useStepRound<V>(slug: string) {
    const session = useCasinoSession()
    const wallet = useWallet()
    const tycoon = useTycoon()
    const floorEvents = useFloorEvents()
    const { hostFor } = useVisitHost()
    const round = shallowRef<StepRound<V> | null>(null)
    const busy = ref(false)
    let ended: StepResponse<V> | null = null
    /** The pots' epoch when the ending request was sent (a collect since makes its pot stale). */
    let endedEpoch = 0
    let unmounted = false

    function fail(failure: unknown, fallback: string) {
        if (apiStatus(failure) === 403) void tycoon.refresh()
        const message = apiErrorMessage(failure, fallback)
        if (!session.handleUnauthorized(failure)) toast.error(message)
        // Out of step with the server (a second tab): read the round again.
        if (apiStatus(failure) === 409) void resume()
    }

    async function send(path: string, body: Record<string, unknown>, fallback: string): Promise<StepResponse<V> | null> {
        if (busy.value) return null
        busy.value = true
        const epoch = tycoon.potsEpoch()
        try {
            // Visiting: a game built in the host's casino may be started there.
            const host = path === 'start' ? hostFor(slug) : undefined
            const response = await $fetch<StepResponse<V>>(`/api/games/${slug}/${path}`, { method: 'POST', body: host ? { ...body, host } : body })
            round.value = response.round
            if (response.round.status !== 'open') {
                ended = response
                endedEpoch = epoch
                if (unmounted) settle()
            } else {
                busy.value = false
            }
            return response
        } catch (failure) {
            busy.value = false
            fail(failure, fallback)
            return null
        }
    }

    async function start(bet: number, options: Record<string, unknown> = {}) {
        const response = await send('start', { bet, options }, 'The round did not start')
        if (response) {
            // The stake is gone the moment the round starts.
            session.setCoins(response.balance)
            tycoon.setChips(response.chips)
            floorEvents.emitPlaying(slug, true)
        }
        return response
    }

    function act(action: Record<string, unknown>) {
        if (!round.value) return Promise.resolve(null)
        return send('act', { step: round.value.step, action }, 'That move did not go through')
    }

    function cashOut() {
        if (!round.value) return Promise.resolve(null)
        return send('cashout', { step: round.value.step }, 'The cash-out did not go through')
    }

    /** Picks up the player's open round, if there is one. */
    async function resume() {
        try {
            const { round: open } = await $fetch<{ round: StepRound<V> | null }>(`/api/games/${slug}/round`)
            if (!ended) round.value = open
            if (open) floorEvents.emitPlaying(slug, true)
            return open
        } catch (failure) {
            session.handleUnauthorized(failure)
            return null
        }
    }

    /** Applies an ended round (after the reveal) and frees the controls. */
    function settle() {
        if (ended) {
            const { round: done } = ended
            session.setCoins(ended.balance)
            tycoon.setChips(ended.chips)
            tycoon.setPot('rakeback', ended.rakebackPot, { epoch: endedEpoch })
            wallet.applyStars(ended.stars)
            floorEvents.emitRound({
                slug,
                stake: done.bet,
                payout: done.status === 'cashed' ? done.payout : 0,
                chipsEarned: ended.chipsEarned,
                stakeCoins: Math.max(0, done.bet - done.stakeChips),
                stakeChips: done.stakeChips
            })
            floorEvents.emitPlaying(slug, false)
            ended = null
        }
        busy.value = false
    }

    onBeforeUnmount(() => {
        unmounted = true
        settle()
        // An open round waits on the server; the floor stops showing it played.
        floorEvents.emitPlaying(slug, false)
    })

    return { round, busy, start, act, cashOut, resume, settle }
}
