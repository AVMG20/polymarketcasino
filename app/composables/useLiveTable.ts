import { toast } from 'vue-sonner'
import { formatCoins } from '#shared/money'
import type { ClientMessage, ServerMessage, TableState } from '#shared/tables/protocol'

export interface TableFeedItem {
    id: number
    kind: 'sit' | 'leave' | 'watch' | 'settled' | 'chat' | 'game'
    name?: string
    text: string
    tone: 'neutral' | 'win' | 'loss'
}

const FEED_LIMIT = 40
const RECONNECT_MS = [1_000, 2_000, 4_000, 8_000]

/**
 * One live table over its socket (/api/tables/<slug>/ws). Everything shown
 * comes from server snapshots; nothing about a round is decided here. Balance
 * pushes go straight to the session (the server only settles once a hand's
 * reveal is over), star changes to the wallet. `onGameEvent` gets a game's own
 * one-shot events for animation and sound.
 */
export function useLiveTable<TSeat, TShared, TAction>(slug: string, onGameEvent?: (payload: unknown) => void) {
    const session = useCasinoSession()
    const wallet = useWallet()

    const state = shallowRef<TableState<TSeat, TShared> | null>(null)
    const me = ref<string | null>(null)
    const connected = ref(false)
    const feed = ref<TableFeedItem[]>([])
    const now = ref(Date.now())
    let skew = 0
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let closed = false
    let seq = 0

    const mySeat = computed(() => state.value?.seats.find(seat => seat?.playerId === me.value) ?? null)
    const phase = computed(() => state.value?.phase ?? 'idle')
    /** Seconds left on the phase clock (server time), or null when untimed. */
    const secondsLeft = computed(() => {
        const ends = state.value?.phaseEndsAt
        return ends ? Math.max(0, Math.ceil((ends - now.value - skew) / 1000)) : null
    })
    /** 1 → 0 over the phase, for a countdown ring. */
    const phaseProgress = computed(() => {
        const s = state.value
        if (!s?.phaseEndsAt || !s.phaseDuration) return null
        return Math.max(0, Math.min(1, (s.phaseEndsAt - now.value - skew) / s.phaseDuration))
    })
    const nextRoundIn = computed(() => {
        const at = state.value?.nextRoundAt
        return at ? Math.max(0, Math.ceil((at - now.value - skew) / 1000)) : null
    })

    function pushFeed(item: Omit<TableFeedItem, 'id'>) {
        feed.value = [...feed.value, { ...item, id: ++seq }].slice(-FEED_LIMIT)
    }

    function handle(message: ServerMessage<TSeat, TShared>) {
        switch (message.t) {
            case 'state':
                skew = message.state.now - Date.now()
                state.value = message.state
                return
            case 'you':
                me.value = message.playerId
                session.setCoins(message.balance)
                return
            case 'balance':
                session.setCoins(message.balance)
                return
            case 'stars':
                wallet.applyStars(message.stars)
                return
            case 'error':
                toast.error(message.message, { id: `table-${slug}` })
                return
            case 'event':
                switch (message.kind) {
                    case 'sit': return pushFeed({ kind: 'sit', name: message.name, text: 'sat down', tone: 'neutral' })
                    case 'leave': return pushFeed({ kind: 'leave', name: message.name, text: 'left the table', tone: 'neutral' })
                    case 'watch': return pushFeed({ kind: 'watch', name: message.name, text: message.joined ? 'is watching' : 'stopped watching', tone: 'neutral' })
                    case 'chat': return pushFeed({ kind: 'chat', name: message.name, text: message.text, tone: 'neutral' })
                    case 'settled':
                        if (message.net) pushFeed({ kind: 'settled', name: message.name, text: `${message.net > 0 ? 'won' : 'lost'} ${formatCoins(Math.abs(message.net))}`, tone: message.net > 0 ? 'win' : 'loss' })
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

    function send(message: ClientMessage<TAction>) {
        if (ws?.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify(message))
    }

    let clock: ReturnType<typeof setInterval> | null = null
    onMounted(() => {
        void connect()
        clock = setInterval(() => (now.value = Date.now()), 200)
    })
    onBeforeUnmount(() => {
        closed = true
        if (retry) clearTimeout(retry)
        if (clock) clearInterval(clock)
        ws?.close()
        ws = null
    })

    return {
        state,
        me,
        connected,
        feed,
        mySeat,
        phase,
        secondsLeft,
        phaseProgress,
        nextRoundIn,
        sit: (seat: number) => send({ t: 'sit', seat }),
        leave: () => send({ t: 'leave' }),
        voteStart: () => send({ t: 'voteStart' }),
        chat: (text: string) => send({ t: 'chat', text }),
        act: (action: TAction) => send({ t: 'action', action })
    }
}
