import { PRESENCE_CLOSE, type PresenceClientMessage, type PresenceMember, type PresenceServerMessage } from '#shared/floor-presence'
import type { TableOccupancy } from '#shared/tycoon'
import type { FloorMove, FloorRemote } from '~/utils/floor/types'

/** Reconnect delays (ms), the last one repeating. */
const RECONNECT_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]
/** A full room: try again after this. */
const FULL_RETRY_MS = 60_000
/** A tab hidden this long leaves the floor; it comes back when shown. */
const HIDDEN_LEAVE_MS = 60_000

/** A visitor's settled bet put `amount` coins in your cage's visitors pot (now `pot`). */
export interface FloorRakeback {
    amount: number
    pot: number
    from: string
    game: string
    /** Server ms the bet committed (a push from before your last collect is stale). */
    at: number
}

interface Tracked {
    member: PresenceMember
    seq: number
}

/**
 * Live presence on the casino floor shown (`casinoId`: your own, or the one
 * you visit): opens /api/floor/<id>/ws, tells the room where your avatar
 * walks (`move`, from CasinoFloor's `move` event) and keeps `remotes`, the
 * other players there, for CasinoFloor to draw. Reconnects with backoff;
 * leaves while the tab has been hidden a minute. Your look is read by the
 * server; a wardrobe change only says "look again". On your own floor the
 * server also tells you when a visitor's bet put rakeback in your cage
 * (`onRakeback`; display only).
 */
export function useFloorPresence(casinoId: MaybeRefOrGetter<string | null | undefined>, options: { onRakeback?: (news: FloorRakeback) => void, onTables?: (tables: TableOccupancy[]) => void } = {}) {
    const session = useCasinoSession()
    const tycoon = useTycoon()

    const remotes = shallowRef<FloorRemote[]>([])
    const connected = ref(false)
    /** The casino's owner is on the floor (visit mode). */
    const ownerOnline = computed(() => remotes.value.some(r => r.owner))

    const members = new Map<string, Tracked>()
    let ws: WebSocket | null = null
    let socketFor: string | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let stopped = false
    let away = false
    let lastMove: FloorMove | null = null
    /** One counter for every move, so a figure never mistakes a new move for one it has shown. */
    let moves = 0

    function publish() {
        const list: FloorRemote[] = []
        for (const { member, seq } of members.values()) {
            if (member.x === null || member.y === null) continue
            list.push({ id: member.id, name: member.name, avatar: member.avatar, owner: member.owner, tile: { x: member.x, y: member.y }, walk: member.walk, seq })
        }
        remotes.value = list
    }

    function handle(message: PresenceServerMessage) {
        switch (message.t) {
            case 'snapshot':
                members.clear()
                // People already here stand where they are.
                for (const member of message.members) members.set(member.id, { member: { ...member, walk: false }, seq: ++moves })
                if (Array.isArray(message.tables)) options.onTables?.(message.tables)
                break
            case 'join':
                members.set(message.member.id, { member: message.member, seq: ++moves })
                break
            case 'move': {
                const tracked = members.get(message.id)
                if (!tracked) return
                tracked.member = { ...tracked.member, x: message.x, y: message.y, walk: message.walk }
                tracked.seq = ++moves
                break
            }
            case 'look': {
                const tracked = members.get(message.id)
                if (!tracked) return
                tracked.member = { ...tracked.member, avatar: message.avatar }
                break
            }
            case 'leave':
                if (!members.delete(message.id)) return
                break
            case 'tables':
                if (Array.isArray(message.tables)) options.onTables?.(message.tables)
                return
            case 'rakeback':
                if (typeof message.amount === 'number' && typeof message.pot === 'number') options.onRakeback?.({ amount: message.amount, pot: message.pot, from: String(message.from ?? ''), game: String(message.game ?? ''), at: typeof message.at === 'number' ? message.at : 0 })
                return
            default:
                return
        }
        publish()
    }

    function send(message: PresenceClientMessage) {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
    }

    function clearRetry() {
        if (retry) clearTimeout(retry)
        retry = null
    }

    function disconnect() {
        clearRetry()
        const socket = ws
        ws = null
        socketFor = null
        connected.value = false
        socket?.close(1000)
        if (members.size) {
            members.clear()
            publish()
        }
    }

    function connect() {
        const id = toValue(casinoId)
        if (stopped || away || !id || ws) return
        clearRetry()
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const socket = new WebSocket(`${proto}://${location.host}/api/floor/${encodeURIComponent(id)}/ws`)
        ws = socket
        socketFor = id
        socket.onopen = () => {
            connected.value = true
            attempts = 0
            // Back in the room: stand where the avatar is (no walk-in from afar).
            if (lastMove) send({ t: 'move', x: lastMove.x, y: lastMove.y, walk: false })
        }
        socket.onmessage = (event) => {
            if (ws !== socket) return
            try {
                handle(JSON.parse(String(event.data)))
            } catch {
                // A malformed frame isn't worth dropping the floor for.
            }
        }
        socket.onclose = (event) => {
            if (ws !== socket) return
            ws = null
            socketFor = null
            const wasOpen = connected.value
            connected.value = false
            if (members.size) {
                members.clear()
                publish()
            }
            if (stopped || away) return
            // A refused upgrade looks like any other close: check the session first.
            if (!wasOpen && attempts >= 1) {
                void $fetch('/api/me').catch(error => session.handleUnauthorized(error))
            }
            const delay = event.code === PRESENCE_CLOSE.full ? FULL_RETRY_MS : RECONNECT_MS[Math.min(attempts++, RECONNECT_MS.length - 1)]!
            retry = setTimeout(connect, delay)
        }
    }

    /** CasinoFloor's `move`: where your avatar is headed or stands. */
    function move(next: FloorMove) {
        lastMove = next
        send({ t: 'move', x: next.x, y: next.y, walk: next.walk })
    }

    function onVisibility() {
        if (document.hidden) {
            if (!hiddenTimer) {
                hiddenTimer = setTimeout(() => {
                    hiddenTimer = null
                    away = true
                    disconnect()
                }, HIDDEN_LEAVE_MS)
            }
            return
        }
        if (hiddenTimer) clearTimeout(hiddenTimer)
        hiddenTimer = null
        if (away) {
            away = false
            attempts = 0
            connect()
        }
    }

    // Another casino (or none): leave this room for that one.
    watch(() => toValue(casinoId), (id, previous) => {
        if (socketFor === id && ws) return
        disconnect()
        attempts = 0
        // The avatar of another floor stands somewhere else (that floor tells us anew).
        if (previous) lastMove = null
        connect()
    })

    // A wardrobe change: the server reads the new look and tells the room.
    const lookKey = computed(() => JSON.stringify(tycoon.state.value?.cosmetics?.avatar ?? null))
    watch(lookKey, () => send({ t: 'look' }))

    onMounted(() => {
        document.addEventListener('visibilitychange', onVisibility)
        connect()
    })
    onBeforeUnmount(() => {
        stopped = true
        document.removeEventListener('visibilitychange', onVisibility)
        if (hiddenTimer) clearTimeout(hiddenTimer)
        disconnect()
    })

    return { remotes, connected, ownerOnline, move }
}
