import { isCoinAmount, normalizeCoins, sameCoins, sumCoins } from '#shared/money'
import type { ScoreEntry, SeatView, ServerMessage, TablePayout, TableState } from '#shared/tables/protocol'
import type { CommittedCoins } from '../ledger'
import { getCoins } from '../ledger'
import { avatarOf } from '../cosmetics'
import { hostHasGame } from '../social'
import { ownStarChange } from '../stars'
import { writeTx } from '../../database'
import { chipBalance, ensureCasino, hasBuiltGame } from '../tycoon'
import { findGame } from '#shared/games/registry'
import { bankroll, type TableOccupancy } from '#shared/tycoon'
import { TableBus } from './bus'
import { refundWagers, settleWagers, stakeWagers } from './escrow'

export interface TableConfig {
    /** The game's slug: also its ledger category and its escrow `game`. */
    slug: string
    seats: number
    minBet: number
    maxBet: number
    /** How long a disconnected player's seat is held while money is on the round. */
    disconnectGrace: number
    /** The same with nothing staked. */
    disconnectGraceIdle: number
}

/** Refuses the current action with a message the client shows as is. */
export class TableError extends Error {}

export function fail(message: string): never {
    throw new TableError(message)
}

export interface TablePlayer<TSeat> {
    playerId: string
    name: string
    image: string | null
    seatIndex: number
    /** The casino they sat down in when visiting (a player id), else null: its hands count toward the visit mission. */
    host: string | null
    connected: boolean
    leaving: boolean
    votedStart: boolean
    lastNet: number | null
    sessionNet: number
    winStreak: number
    roundsPlayed: number
    /**
     * What this player can stake (coins + chips) after their last stake or
     * payout (or at sit-down, or their last action): advisory only, for the
     * games' "can you cover it" checks. The debit is the guard.
     */
    balance: number
    /** Coin and chip balances as last seen (advisory). */
    coins: number
    chips: number
    /** Open escrow rows for this round. Non-empty means real money rides on it. */
    wagerIds: string[]
    /** What those rows add up to. */
    staked: number
    releaseTimer: ReturnType<typeof setTimeout> | null
    game: TSeat
}

interface ScoreRecord {
    name: string
    image: string | null
    net: number
    winStreak: number
    leftAt: number | null
}

const CHAT_MAX_LENGTH = 120
const CHAT_GAP_MS = 800
const SCOREBOARD_ALUMNI = 12

/**
 * The half of a live table that is the same in every game: seats, the phase
 * clock, escrow, settlement, chat, the scoreboard and per-viewer snapshots.
 * Games supply their rules and never touch coins themselves: they stake
 * through `stake()` and hand `settle()` a payout per player. A stake is paid
 * from coins first, then chips; every payout is chips.
 *
 * Everything is synchronous. bun:sqlite commits in-line, so a socket message
 * or a timer runs start to finish without yielding, and no two mutations can
 * interleave. Star reports to the hub run after commit, in the background.
 */
export abstract class LiveTable<TSeat, TShared, TAction> {
    abstract readonly config: TableConfig

    protected abstract createSeat(): TSeat
    /** The table-wide half of the snapshot, as `viewer` (a player id, or null) may see it. */
    protected abstract shared(viewer: string | null): TShared
    /** A game action from a seated player. Throw `fail()` to refuse it. */
    protected abstract onAction(player: TablePlayer<TSeat>, action: TAction): void
    /** The phase clock ran out. */
    protected abstract onPhaseEnd(phase: string): void
    /** The first player sat down at an idle table. */
    protected abstract onTableActive(): void

    /** One seat as `viewer` may see it. Games hide hole cards here. */
    protected seatGame(player: TablePlayer<TSeat>, _viewer: string | null): TSeat {
        return player.game
    }

    readonly bus = new TableBus()
    protected players = new Map<string, TablePlayer<TSeat>>()
    protected phase = 'idle'
    protected phaseEndsAt: number | null = null
    protected phaseDuration: number | null = null
    protected nextRoundAt: number | null = null
    protected roundId = 0
    protected message = 'Waiting for players'

    private phaseToken = 0
    private timer: ReturnType<typeof setTimeout> | null = null
    private version = 0
    private scores = new Map<string, ScoreRecord>()
    private lastChat = new Map<string, number>()

    /** Run a mutation and publish the result, even when it throws partway. */
    run<T>(fn: () => T): T {
        try {
            return fn()
        } finally {
            this.publish()
        }
    }

    // ─── the phase clock ─────────────────────────────────────────────────────

    protected setPhase(phase: string, durationMs: number | null) {
        this.phaseToken++
        this.phase = phase
        this.phaseDuration = durationMs
        this.phaseEndsAt = durationMs === null ? null : Date.now() + durationMs
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
    }

    /** Run `fn` after `ms`, unless the phase changed in the meantime. */
    protected schedule(ms: number, fn: () => void) {
        if (this.timer) clearTimeout(this.timer)
        const token = this.phaseToken
        this.timer = setTimeout(() => {
            this.timer = null
            this.run(() => {
                if (token !== this.phaseToken) return
                try {
                    fn()
                } catch (error) {
                    // A broken transition must not wedge the table, and the
                    // round it abandons has real money on it: hand that back.
                    console.error(`[tables] ${this.config.slug}: phase ${this.phase} failed`, error)
                    this.abortRound()
                }
            })
        }, ms)
        this.timer.unref?.()
    }

    protected advance(phase: string, durationMs: number) {
        this.setPhase(phase, durationMs)
        this.schedule(durationMs, () => this.onPhaseEnd(phase))
    }

    /** Cut a running clock short, but never lengthen it. */
    protected shortenPhase(durationMs: number) {
        if (this.phaseEndsAt === null || this.phaseEndsAt - Date.now() <= durationMs) return
        this.advance(this.phase, durationMs)
    }

    // ─── players and seats ───────────────────────────────────────────────────

    protected seated(): TablePlayer<TSeat>[] {
        return [...this.players.values()].sort((a, b) => a.seatIndex - b.seatIndex)
    }

    protected requirePlayer(playerId: string): TablePlayer<TSeat> {
        const player = this.players.get(playerId)
        if (!player) fail('Take a seat first')
        return player
    }

    seatIndexOf(playerId: string): number | null {
        return this.players.get(playerId)?.seatIndex ?? null
    }

    /** `host`: the casino the player is visiting (a player id), whose built tables they may sit at too. */
    sit(playerId: string, name: string, image: string | null, index: unknown, host?: unknown) {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= this.config.seats) fail('Invalid seat')
        const existing = this.players.get(playerId)
        if (existing) {
            if (existing.seatIndex !== index) fail('You are already seated')
            // Tapping your own seat again takes back a pending stand-up.
            existing.leaving = false
            return
        }
        if (this.seated().some(p => p.seatIndex === index)) fail('Seat is taken')
        // Anyone may watch; sitting down needs the game built in My Casino, or in the casino being visited.
        const viaHost = typeof host === 'string' && /^[\w-]{1,128}$/.test(host) && hostHasGame(host, this.config.slug)
        if (!viaHost && !hasBuiltGame(playerId, this.config.slug)) fail(`Build ${findGame(this.config.slug)?.name ?? this.config.slug} in your casino first`)
        // Every payout is chips, which need a casino profile: a visitor who never opened their own gets one now.
        writeTx(tx => ensureCasino(tx, playerId))
        // Advisory: the debit is what really refuses a player who can't pay.
        const coins = getCoins(playerId)?.coins ?? 0
        const chips = chipBalance(playerId)
        if (bankroll(coins, chips) < this.config.minBet) fail(`You need ${this.config.minBet} coins or chips to sit`)

        const record = this.scores.get(playerId)
        this.players.set(playerId, {
            playerId,
            name,
            image,
            seatIndex: index,
            host: viaHost && host !== playerId ? host as string : null,
            connected: this.bus.isConnected(playerId),
            leaving: false,
            votedStart: false,
            lastNet: null,
            sessionNet: 0,
            winStreak: record?.winStreak ?? 0,
            roundsPlayed: 0,
            balance: bankroll(coins, chips),
            coins,
            chips,
            wagerIds: [],
            staked: 0,
            releaseTimer: null,
            game: this.createSeat()
        })
        this.scores.set(playerId, { name, image, net: record?.net ?? 0, winStreak: record?.winStreak ?? 0, leftAt: null })
        this.bus.broadcast({ t: 'event', kind: 'sit', name, seat: index })
        if (this.phase === 'idle') this.onTableActive()
    }

    leave(playerId: string) {
        const player = this.players.get(playerId)
        if (!player) return
        // Money on the round: the seat frees once it settles.
        if (player.wagerIds.length) {
            player.leaving = true
            return
        }
        this.release(player)
    }

    protected release(player: TablePlayer<TSeat>) {
        if (player.releaseTimer) clearTimeout(player.releaseTimer)
        this.players.delete(player.playerId)
        const record = this.scores.get(player.playerId)
        if (record) record.leftAt = Date.now()
        this.pruneScores()
        this.bus.broadcast({ t: 'event', kind: 'leave', name: player.name, seat: player.seatIndex })
        if (!this.players.size) this.onEmpty()
    }

    /** The last player left: the table session (and its scoreboard) ends. */
    protected onEmpty() {
        this.scores.clear()
        this.nextRoundAt = null
        this.setPhase('idle', null)
        this.message = 'Waiting for players'
    }

    /** Release the seats of players who asked to leave and have no money on the table. */
    protected releaseLeavers() {
        for (const player of this.seated()) if (player.leaving && !player.wagerIds.length) this.release(player)
    }

    setConnected(playerId: string, connected: boolean) {
        const player = this.players.get(playerId)
        if (!player) return
        player.connected = connected
        if (player.releaseTimer) clearTimeout(player.releaseTimer)
        player.releaseTimer = null
        if (connected) return
        // A player who drops mid-hand keeps the seat until the round settles
        // (timers act for them); only then, or once idle, does it free.
        const grace = player.wagerIds.length ? this.config.disconnectGrace : this.config.disconnectGraceIdle
        player.releaseTimer = setTimeout(() => {
            this.run(() => {
                const current = this.players.get(playerId)
                if (current && !current.connected) this.leave(playerId)
            })
        }, grace)
        player.releaseTimer.unref?.()
    }

    // ─── money ───────────────────────────────────────────────────────────────

    /** The refusal for a stake the player's coins and chips can't cover. */
    protected notEnough(_player: TablePlayer<TSeat>): string {
        return 'Not enough coins or chips'
    }

    /**
     * Escrow stakes for `player`, all or nothing, each paid from coins first,
     * then chips. Throws `fail('Not enough coins or chips')` when they can't
     * cover the lot; the debits are the guard.
     */
    protected stake(player: TablePlayer<TSeat>, stakes: { amount: number, kind: string }[]) {
        for (const { amount } of stakes) {
            if (!isCoinAmount(amount) || amount <= 0) fail('Invalid bet')
        }
        let committed
        try {
            committed = stakeWagers(player.playerId, this.config.slug, this.roundId, stakes)
        } catch (error) {
            if ((error as { statusCode?: number }).statusCode === 400) fail(this.notEnough(player))
            throw error
        }
        player.wagerIds.push(...committed.value.wagerIds)
        player.staked = sumCoins([player.staked, ...stakes.map(s => s.amount)])
        this.pushBalance(player, committed.value, committed)
    }

    /**
     * Close the round for every player in `payouts`. Each settles in its own
     * transaction; a player whose settlement fails is refunded instead, and if
     * that fails too their rows are left for the sweep.
     */
    protected settle(payouts: TablePayout[]) {
        for (const result of payouts) {
            const player = this.players.get(result.playerId)
            if (!player?.wagerIds.length) continue
            const wagerIds = player.wagerIds
            const staked = player.staked
            if (!sameCoins(staked, result.staked)) console.error(`[tables] ${this.config.slug}: ${player.playerId} staked ${staked}, game says ${result.staked}`)
            try {
                const committed = settleWagers({
                    playerId: player.playerId,
                    game: this.config.slug,
                    wagerIds,
                    staked: normalizeCoins(result.staked),
                    payout: normalizeCoins(result.payout),
                    summary: { round: this.roundId, ...result.summary },
                    multiple: result.multiple,
                    host: player.host
                })
                player.wagerIds = []
                player.staked = 0
                const outcome = committed.value
                if (outcome.kind === 'closed') continue
                if (outcome.kind === 'refunded') {
                    this.bus.sendToPlayer(player.playerId, { t: 'error', message: 'This round was cancelled; your bets came back' })
                    this.pushBalance(player, outcome, committed)
                    continue
                }
                this.pushBalance(player, outcome, committed)
                const net = normalizeCoins(result.payout - result.staked)
                this.recordResult(player, net)
            } catch (error) {
                console.error(`[tables] ${this.config.slug}: settling ${player.playerId} failed`, error)
                this.refund(player)
            }
        }
        this.releaseLeavers()
    }

    private recordResult(player: TablePlayer<TSeat>, net: number) {
        player.lastNet = net
        player.sessionNet = normalizeCoins(player.sessionNet + net)
        player.roundsPlayed++
        if (net > 0) player.winStreak++
        else if (net < 0) player.winStreak = 0
        const record = this.scores.get(player.playerId)
        if (record) {
            record.net = normalizeCoins(record.net + net)
            record.winStreak = player.winStreak
        }
        this.bus.broadcast({ t: 'event', kind: 'settled', seat: player.seatIndex, name: player.name, net })
    }

    /** Hand back everything `player` has open on this round. */
    protected refund(player: TablePlayer<TSeat>) {
        const wagerIds = player.wagerIds
        player.wagerIds = []
        player.staked = 0
        if (!wagerIds.length) return
        try {
            const committed = refundWagers(player.playerId, this.config.slug, wagerIds)
            const { balance, chips } = committed.value
            if (balance !== null && chips !== null) this.pushBalance(player, { balance, chips }, committed)
        } catch (error) {
            // The rows stay open and no table holds them: the sweep refunds them.
            console.error(`[tables] ${this.config.slug}: refund for ${player.playerId} failed`, error)
        }
    }

    /** Tear down a round that can't finish: every stake comes back. */
    abortRound(message = 'Round cancelled, bets returned') {
        for (const player of this.seated()) {
            this.refund(player)
            player.game = this.createSeat()
        }
        this.message = message
        this.nextRoundAt = null
        this.setPhase('idle', null)
        this.releaseLeavers()
        if (this.players.size) this.onTableActive()
    }

    /** Who sits here and how many watch, for the casino floor (GET /api/tables). */
    occupancy(): TableOccupancy {
        return {
            slug: this.config.slug,
            seated: this.seated().map(p => ({ name: p.name, image: p.image, avatar: avatarOf(p.playerId) })),
            seats: this.config.seats,
            watching: this.bus.count
        }
    }

    /** Escrow rows this table holds, so the periodic sweep leaves them alone. */
    heldWagerIds(): string[] {
        return this.seated().flatMap(player => player.wagerIds)
    }

    /** Tell the player's sockets both balances (`balance` = coins, `chips`), then any star change. */
    private pushBalance(player: TablePlayer<TSeat>, balances: { balance: number, chips: number }, committed: CommittedCoins<unknown>) {
        player.coins = balances.balance
        player.chips = balances.chips
        player.balance = bankroll(player.coins, player.chips)
        this.bus.sendToPlayer(player.playerId, { t: 'balance', balance: balances.balance, chips: balances.chips })
        const playerId = player.playerId
        void committed.stars.then((changes) => {
            // Handed over (and claimed as seen) only while the player has a socket here; else their next read celebrates it.
            if (!this.bus.isConnected(playerId)) return
            const change = ownStarChange(playerId, changes)
            if (change) this.bus.sendToPlayer(playerId, { t: 'stars', stars: { level: change.level, previous: change.previous, bounty: change.bounty, goals: change.goals, ...(change.late ? { late: true as const } : {}) } })
        })
    }

    // ─── votes, chat, actions ────────────────────────────────────────────────

    voteStart(playerId: string) {
        const player = this.requirePlayer(playerId)
        player.votedStart = true
        this.onVoteStart()
    }

    /** Default: nothing. Games that let a table skip its betting clock override this. */
    protected onVoteStart() {}

    protected clearVotes() {
        for (const player of this.seated()) player.votedStart = false
    }

    chat(playerId: string, name: string, text: unknown) {
        if (typeof text !== 'string') return
        const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH)
        if (!clean) return
        const now = Date.now()
        if (now - (this.lastChat.get(playerId) ?? 0) < CHAT_GAP_MS) fail('Slow down')
        this.lastChat.set(playerId, now)
        this.bus.broadcast({ t: 'event', kind: 'chat', name, seat: this.seatIndexOf(playerId) ?? -1, text: clean })
    }

    action(playerId: string, action: unknown) {
        if (!action || typeof action !== 'object' || Array.isArray(action)) fail('Unknown action')
        const player = this.requirePlayer(playerId)
        // Fresh balances for the game's advisory checks (solo rounds may have moved them).
        player.coins = getCoins(playerId)?.coins ?? 0
        player.chips = chipBalance(playerId)
        player.balance = bankroll(player.coins, player.chips)
        this.onAction(player, action as TAction)
    }

    protected event(payload: unknown) {
        this.bus.broadcast({ t: 'event', kind: 'game', payload })
    }

    protected tell(playerId: string, message: string) {
        this.bus.sendToPlayer(playerId, { t: 'error', message })
    }

    // ─── snapshots ───────────────────────────────────────────────────────────

    private pruneScores() {
        const gone = [...this.scores.entries()]
            .filter(([playerId, record]) => record.leftAt !== null && !this.players.has(playerId))
            .sort((a, b) => (b[1].leftAt ?? 0) - (a[1].leftAt ?? 0))
        for (const [playerId] of gone.slice(SCOREBOARD_ALUMNI)) this.scores.delete(playerId)
    }

    private scoreboard(): ScoreEntry[] {
        return [...this.scores.entries()]
            .map(([playerId, r]) => ({ playerId, name: r.name, image: r.image, net: r.net, winStreak: r.winStreak, seated: this.players.has(playerId) }))
            .sort((a, b) => b.net - a.net)
    }

    snapshot(viewer: string | null): TableState<TSeat, TShared> {
        const seats: (SeatView<TSeat> | null)[] = Array.from({ length: this.config.seats }, () => null)
        for (const p of this.seated()) {
            seats[p.seatIndex] = {
                index: p.seatIndex,
                playerId: p.playerId,
                name: p.name,
                image: p.image,
                connected: p.connected,
                leaving: p.leaving,
                votedStart: p.votedStart,
                lastNet: p.lastNet,
                sessionNet: p.sessionNet,
                winStreak: p.winStreak,
                roundsPlayed: p.roundsPlayed,
                game: this.seatGame(p, viewer)
            }
        }
        return {
            slug: this.config.slug,
            version: this.version,
            roundId: this.roundId,
            phase: this.phase,
            phaseEndsAt: this.phaseEndsAt,
            phaseDuration: this.phaseDuration,
            nextRoundAt: this.nextRoundAt,
            now: Date.now(),
            seats,
            message: this.message,
            scoreboard: this.scoreboard(),
            watching: this.bus.count,
            minBet: this.config.minBet,
            maxBet: this.config.maxBet,
            game: this.shared(viewer)
        }
    }

    /** Send every watcher the table as they may see it. */
    publish() {
        this.version++
        for (const viewer of this.bus.viewers()) {
            this.bus.sendToPlayer(viewer, JSON.stringify({ t: 'state', state: this.snapshot(viewer) } satisfies ServerMessage))
        }
    }
}
