import { toast } from 'vue-sonner'
import { findGame } from '#shared/games/registry'
import { formatCoins, sumCoins } from '#shared/money'
import { bankroll, isGameUnlocked } from '#shared/tycoon'
import type { ClientMessage, ServerMessage, TableState } from '#shared/tables/protocol'
import type { WinShow } from '~/components/game/WinBurst.vue'

export interface TableFeedItem {
    id: number
    kind: 'sit' | 'leave' | 'watch' | 'settled' | 'chat' | 'game'
    name?: string
    text: string
    tone: 'neutral' | 'win' | 'loss'
}

export interface TableClock {
    endsAt: number | null
    duration: number | null
    nextAt: number | null
    skew: number
}

/** Whole seconds until a server-time deadline, ticking locally (null when there is none). */
export function useCountdown(at: () => number | null, skew: () => number) {
    const now = ref(Date.now())
    let timer: ReturnType<typeof setInterval> | null = null
    onMounted(() => {
        timer = setInterval(() => (now.value = Date.now()), 200)
    })
    onBeforeUnmount(() => {
        if (timer) clearInterval(timer)
    })
    /** Milliseconds left, or null when untimed. */
    const msLeft = computed(() => {
        const target = at()
        return target ? Math.max(0, target - now.value - skew()) : null
    })
    const seconds = computed(() => (msLeft.value === null ? null : Math.ceil(msLeft.value / 1000)))
    return { msLeft, seconds }
}

/**
 * Blocks a second decision (hit, split, call...) until the next snapshot changes
 * `key`, or a short timeout passes, so a double tap sends one action. `run` takes
 * the send and only locks when it went out.
 */
export function useActionLock(key: () => unknown, timeoutMs = 1_500) {
    const locked = ref(false)
    let timer: ReturnType<typeof setTimeout> | null = null
    function release() {
        locked.value = false
        if (timer) clearTimeout(timer)
        timer = null
    }
    watch(key, release)
    onBeforeUnmount(release)
    function run(send: () => boolean | void): boolean {
        if (locked.value) return false
        const sent = send() !== false
        if (sent) {
            locked.value = true
            timer = setTimeout(release, timeoutMs)
        }
        return sent
    }
    return { locked, run }
}

const FEED_LIMIT = 40
const RECONNECT_MS = [1_000, 2_000, 4_000, 8_000]

/**
 * One live table over its socket (/api/tables/<slug>/ws). Everything shown
 * comes from server snapshots; nothing about a round is decided here. Balance
 * pushes go straight to the session (coins) and the casino (chips): the
 * server only settles once a hand's reveal is over, and every payout is
 * chips. Star changes go to the wallet. `onGameEvent` gets a game's own
 * one-shot events for animation and sound. `stakedOf` reads what a seat had
 * riding on the round, so the player's own win can be put in their face
 * (`win`, for GameWinBurst) when it settles.
 */
export function useLiveTable<TSeat, TShared, TAction>(slug: string, onGameEvent?: (payload: unknown) => void, stakedOf?: (seat: TSeat) => number) {
    const session = useCasinoSession()
    const wallet = useWallet()
    const tycoon = useTycoon()
    const floorEvents = useFloorEvents()
    const embed = inject(GAME_EMBED, null)

    const state = shallowRef<TableState<TSeat, TShared> | null>(null)
    const me = ref<string | null>(null)
    const connected = ref(false)
    const feed = ref<TableFeedItem[]>([])
    const skew = ref(0)
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let closed = false
    let seq = 0

    /** Anyone can watch; taking a seat needs the game built on the player's floor, or in the casino being visited. */
    const { hostFor } = useVisitHost()
    const canSit = computed(() => !!hostFor(slug) || (!!tycoon.state.value && isGameUnlocked(tycoon.state.value, slug)))

    const mySeat = computed(() => state.value?.seats.find(seat => seat?.playerId === me.value) ?? null)
    const phase = computed(() => state.value?.phase ?? 'idle')
    /**
     * The phase and next-round deadlines (server time) with the clock skew. Only the
     * ring and count components tick against them, so the game itself doesn't re-render.
     */
    const clock = computed<TableClock>(() => ({
        endsAt: state.value?.phaseEndsAt ?? null,
        duration: state.value?.phaseDuration ?? null,
        nextAt: state.value?.nextRoundAt ?? null,
        skew: skew.value
    }))

    /**
     * The player's own win on the round that just settled, for the win
     * burst. It clears once the show is over, or when betting opens again.
     */
    const win = ref<WinShow | null>(null)
    let winTimer: ReturnType<typeof setTimeout> | null = null
    watch(() => mySeat.value?.roundsPlayed, (played, before) => {
        const seat = mySeat.value
        if (!seat || played === undefined || before === undefined || played === before) return
        const net = seat.lastNet ?? 0
        const staked = stakedOf?.(seat.game) ?? 0
        if (net <= 0 || staked <= 0) return
        const payout = sumCoins([staked, net])
        win.value = { id: `${state.value?.roundId ?? 0}-${played}`, payout, multiplier: payout / staked }
        // The felt is shared: once the show is over it clears, the plate keeps the result.
        if (winTimer) clearTimeout(winTimer)
        winTimer = setTimeout(() => (win.value = null), 3_600)
    })
    watch(() => [phase.value, !!mySeat.value] as const, ([current, seated]) => {
        if (current === 'betting' || !seated) win.value = null
    })

    function pushFeed(item: Omit<TableFeedItem, 'id'>) {
        feed.value = [...feed.value, { ...item, id: ++seq }].slice(-FEED_LIMIT)
    }

    function handle(message: ServerMessage<TSeat, TShared>) {
        switch (message.t) {
            case 'state':
                skew.value = message.state.now - Date.now()
                state.value = message.state
                return
            case 'you':
                me.value = message.playerId
                session.setCoins(message.balance)
                if (typeof message.chips === 'number') tycoon.setChips(message.chips)
                return
            case 'balance':
                session.setCoins(message.balance)
                if (typeof message.chips === 'number') tycoon.setChips(message.chips)
                return
            case 'stars':
                wallet.applyStars(message.stars)
                return
            case 'error':
                toast.error(message.message, { id: `table-${slug}` })
                // A refused sit usually means the casino state is stale (not built yet): re-read it.
                if (!canSit.value || /build/i.test(message.message)) void tycoon.refresh()
                return
            case 'event':
                switch (message.kind) {
                    case 'sit': return pushFeed({ kind: 'sit', name: message.name, text: 'sat down', tone: 'neutral' })
                    case 'leave': return pushFeed({ kind: 'leave', name: message.name, text: 'left the table', tone: 'neutral' })
                    case 'watch': return pushFeed({ kind: 'watch', name: message.name, text: message.joined ? 'is watching' : 'stopped watching', tone: 'neutral' })
                    case 'chat': return pushFeed({ kind: 'chat', name: message.name, text: message.text, tone: 'neutral' })
                    case 'settled':
                        if (message.net) pushFeed({ kind: 'settled', name: message.name, text: message.net > 0 ? `won ${formatCoins(message.net)} chips` : `lost ${formatCoins(-message.net)}`, tone: message.net > 0 ? 'win' : 'loss' })
                        return
                    case 'game':
                        return onGameEvent?.(message.payload)
                }
        }
    }

    async function connect() {
        if (closed || ws) return
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const socket = new WebSocket(`${proto}://${location.host}/api/tables/${slug}/ws`)
        ws = socket
        socket.onopen = () => {
            connected.value = true
            attempts = 0
        }
        socket.onmessage = (event) => {
            try {
                handle(JSON.parse(String(event.data)))
            } catch {
                // A malformed frame isn't worth dropping the table for.
            }
        }
        socket.onclose = () => {
            if (ws === socket) ws = null
            const wasOpen = connected.value
            connected.value = false
            if (closed) return
            // A refused upgrade looks like any other close: check the session first.
            if (!wasOpen && attempts >= 1) {
                void $fetch('/api/me').catch((error) => {
                    session.handleUnauthorized(error)
                })
            }
            retry = setTimeout(() => void connect(), RECONNECT_MS[Math.min(attempts++, RECONNECT_MS.length - 1)])
        }
    }

    /** Watching only: open the build flow for this table (the floor's, or My Casino's page). */
    function build() {
        if (embed) floorEvents.requestBuild({ kind: 'game', id: slug })
        else void navigateTo({ path: '/', query: { build: `game:${slug}` } })
    }

    function sit(seat: number) {
        if (!canSit.value) {
            toast.error(`Build ${findGame(slug)?.name ?? 'this table'} to take a seat`, { id: `table-${slug}` })
            return
        }
        // A seat needs the table minimum in coins and chips together (the server checks too).
        const minimum = state.value?.minBet ?? 100
        if (bankroll(session.coins.value, tycoon.chips.value) < minimum) {
            toast.error(`You need ${formatCoins(minimum)} coins or chips to sit`, { id: `table-${slug}` })
            return
        }
        const host = hostFor(slug)
        send(host ? { t: 'sit', seat, host } : { t: 'sit', seat })
    }

    /** Returns whether the message went out (false while disconnected). */
    function send(message: ClientMessage<TAction>): boolean {
        if (ws?.readyState !== WebSocket.OPEN) {
            toast.error('Reconnecting…', { id: `table-${slug}-offline` })
            return false
        }
        ws.send(JSON.stringify(message))
        return true
    }

    onMounted(() => void connect())
    onBeforeUnmount(() => {
        closed = true
        if (retry) clearTimeout(retry)
        if (winTimer) clearTimeout(winTimer)
        ws?.close()
        ws = null
    })

    /** What the player has riding on the round now (0 while watching or between hands). */
    const inPlay = computed(() => (mySeat.value && stakedOf ? stakedOf(mySeat.value.game) : 0))

    return {
        state,
        me,
        connected,
        feed,
        mySeat,
        inPlay,
        phase,
        clock,
        canSit,
        win,
        build,
        sit,
        leave: () => send({ t: 'leave' }),
        voteStart: () => send({ t: 'voteStart' }),
        chat: (text: string): boolean => send({ t: 'chat', text }),
        act: (action: TAction) => send({ t: 'action', action })
    }
}
