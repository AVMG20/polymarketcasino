import type { ServerMessage } from '#shared/tables/protocol'

/** What a table needs from a socket: crossws peers fit, and so do test fakes. */
export interface TablePeer {
    send(data: string): unknown
}

export interface PeerInfo {
    playerId: string
    name: string
    image: string | null
}

/** The sockets watching one table. A player may have it open in two tabs. */
export class TableBus {
    private peers = new Map<TablePeer, PeerInfo>()

    add(peer: TablePeer, info: PeerInfo) {
        this.peers.set(peer, info)
    }

    remove(peer: TablePeer): PeerInfo | undefined {
        const info = this.peers.get(peer)
        this.peers.delete(peer)
        return info
    }

    info(peer: TablePeer): PeerInfo | undefined {
        return this.peers.get(peer)
    }

    get count() {
        return this.peers.size
    }

    /** Every distinct player watching, for per-viewer snapshots. */
    viewers(): string[] {
        return [...new Set([...this.peers.values()].map(info => info.playerId))]
    }

    isConnected(playerId: string): boolean {
        for (const info of this.peers.values()) if (info.playerId === playerId) return true
        return false
    }

    private write(peer: TablePeer, payload: string) {
        try {
            peer.send(payload)
        } catch {
            this.peers.delete(peer)
        }
    }

    broadcast(message: ServerMessage) {
        const payload = JSON.stringify(message)
        for (const peer of [...this.peers.keys()]) this.write(peer, payload)
    }

    sendTo(peer: TablePeer, message: ServerMessage) {
        this.write(peer, JSON.stringify(message))
    }

    sendToPlayer(playerId: string, message: ServerMessage | string) {
        const payload = typeof message === 'string' ? message : JSON.stringify(message)
        for (const [peer, info] of [...this.peers.entries()]) if (info.playerId === playerId) this.write(peer, payload)
    }
}
