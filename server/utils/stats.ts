import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../database'
import { coinTransactions, gameRounds } from '../database/schema'
import { addDays, amsterdamDay, amsterdamDayStart } from '../../shared/economy'
import { findGame } from '../../shared/games/registry'
import { fromUnits } from '../../shared/money'
import {
    FLOW_CATEGORIES,
    isStatsRange,
    RANGE_DAYS,
    type GameStats,
    type PlayerStats,
    type RoundTotals,
    type StatsRange
} from '../../shared/stats'

/**
 * A player's results over a range of Amsterdam days, for the stats page.
 *
 * Game results come from `game_rounds`: one row per settled round (instant
 * games and live tables alike) with its total stake and payout. The ledger
 * can't give them on its own: a live-table stake is debited when betting
 * closes and may come back as a refund (`refund: true`) with no round at all,
 * and an open hand's stake has no payout yet. Refunded and open stakes
 * therefore never count as wagered. The ledger gives the balance at each
 * day's end and the non-game flows (allowance, gem conversions), which stay
 * out of wagered, paid out and return.
 *
 * Every aggregate runs in SQL as index seeks, so the cost follows the rows in
 * range, never the whole ledger: rounds are summed per game and Amsterdam day
 * as one range each of a covering index (no sort, no row reads), the balances
 * are one seek per day, the flows one per category. Sums are read as database
 * units and converted at the end, so totals are exact.
 */

const SLUG = /^[a-z0-9-]{1,40}$/

export interface StatsQuery {
    range: StatsRange
    game: string | null
}

/** The query string, typed. Throws 400 for a range or game that can't be one. */
export function parseStatsQuery(query: Record<string, unknown>): StatsQuery {
    const range = query.range ?? '30d'
    if (!isStatsRange(range)) throw createError({ statusCode: 400, statusMessage: 'Unknown range' })
    const game = query.game ?? null
    if (game !== null && (typeof game !== 'string' || !SLUG.test(game))) throw createError({ statusCode: 400, statusMessage: 'Unknown game' })
    return { range, game }
}

/** Round totals in database units. */
interface Units {
    rounds: number
    stake: number
    payout: number
    best: number
}

const emptyUnits = (): Units => ({ rounds: 0, stake: 0, payout: 0, best: 0 })

function addUnits(into: Units, row: Units) {
    into.rounds += row.rounds
    into.stake += row.stake
    into.payout += row.payout
    into.best = Math.max(into.best, row.best)
}

function totals(units: Units): RoundTotals {
    return {
        rounds: units.rounds,
        wagered: fromUnits(units.stake),
        paidOut: fromUnits(units.payout),
        net: fromUnits(units.payout - units.stake),
        returnRate: units.stake > 0 ? units.payout / units.stake : null,
        biggestWin: fromUnits(Math.max(0, units.best))
    }
}

export function playerStats(playerId: string, query: StatsQuery, now: Date = new Date()): PlayerStats {
    const to = amsterdamDay(now)
    const played = playedGames(playerId)
    const first = query.range === 'all' ? firstDay(playerId, played) : addDays(to, -(RANGE_DAYS[query.range] - 1))
    const from = first && first < to ? first : to

    const days: string[] = []
    for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
    // starts[i] is when days[i] begins; the last entry is the end of `to`.
    const starts = [...days, addDays(to, 1)].map(day => amsterdamDayStart(day).getTime())
    const startAt = new Date(starts[0]!)
    const endAt = new Date(starts.at(-1)!)

    // ─── Rounds, per game and day ───────────────────────────────────────

    const spans = days.map((_, i) => [starts[i]!, starts[i + 1]!])
    const rows = played.length
        ? db.all<{ game: string, i: number, totals: string }>(sql`
            select g.value as game, b.key as i, (
                select json_array(count(*), sum(stake), sum(payout), max(payout - stake))
                from ${gameRounds}
                where player_id = ${playerId} and game = g.value
                    and created_at >= json_extract(b.value, '$[0]') and created_at < json_extract(b.value, '$[1]')
            ) as totals
            from json_each(${JSON.stringify(played)}) g, json_each(${JSON.stringify(spans)}) b
        `)
        : []

    const perGame = new Map<string, Units>()
    const perDay = days.map(emptyUnits)
    const selected = emptyUnits()
    let biggest: { units: number, game: string, day: string } | null = null
    for (const row of rows) {
        const [rounds, stake, payout, best] = JSON.parse(row.totals) as [number, number | null, number | null, number | null]
        if (!rounds) continue
        const units: Units = { rounds, stake: stake ?? 0, payout: payout ?? 0, best: best ?? 0 }
        const day = Number(row.i)

        const game = perGame.get(row.game) ?? emptyUnits()
        addUnits(game, units)
        perGame.set(row.game, game)

        if (query.game !== null && row.game !== query.game) continue
        addUnits(selected, units)
        addUnits(perDay[day]!, units)
        if (units.best > 0 && (!biggest || units.best > biggest.units)) biggest = { units: units.best, game: row.game, day: days[day]! }
    }

    const games: GameStats[] = [...perGame]
        .map(([game, units]) => ({ game, name: findGame(game)?.name ?? game, ...totals(units) }))
        .sort((a, b) => b.wagered - a.wagered || a.name.localeCompare(b.name))

    // ─── Balance at each day's end ──────────────────────────────────────

    // The last ledger row before each boundary, one index seek each: the
    // balance going into the range, then at the end of every day.
    const balanceRows = db.all<{ i: number, balance: number | null }>(sql`
        select b.key as i, (
            select ${coinTransactions.balanceAfter} from ${coinTransactions}
            where ${coinTransactions.playerId} = ${playerId} and ${coinTransactions.createdAt} < b.value
            order by ${coinTransactions.createdAt} desc, ${coinTransactions.id} desc
            limit 1
        ) as balance
        from json_each(${JSON.stringify(starts)}) b
        order by b.key
    `)
    const balances: number[] = []
    let last = 0
    for (const row of balanceRows) {
        if (row.balance !== null) last = Number(row.balance)
        balances.push(last)
    }

    // ─── Allowance and conversions ──────────────────────────────────────

    const flowRows = db.select({
        category: coinTransactions.category,
        count: sql<number>`count(*)`,
        amount: sql<number>`sum(case when ${coinTransactions.type} = 'credit' then ${coinTransactions.amount} else -${coinTransactions.amount} end)`
    })
        .from(coinTransactions)
        .where(and(
            eq(coinTransactions.playerId, playerId),
            inArray(coinTransactions.category, [...FLOW_CATEGORIES]),
            gte(coinTransactions.createdAt, startAt),
            lt(coinTransactions.createdAt, endAt)
        ))
        .groupBy(coinTransactions.category)
        .all()
    const flows = FLOW_CATEGORIES.map((category) => {
        const row = flowRows.find(r => r.category === category)
        return { category, count: Number(row?.count ?? 0), amount: fromUnits(Number(row?.amount ?? 0)) }
    })

    return {
        range: query.range,
        game: query.game,
        from,
        to,
        summary: {
            ...totals(selected),
            biggestWinGame: biggest?.game ?? null,
            biggestWinDay: biggest?.day ?? null
        },
        games,
        days: days.map((day, i) => ({
            day,
            ...pick(totals(perDay[i]!)),
            balance: fromUnits(balances[i + 1] ?? last)
        })),
        flows,
        balance: { start: fromUnits(balances[0] ?? 0), end: fromUnits(balances.at(-1) ?? 0) }
    }
}

function pick({ rounds, wagered, paidOut, net }: RoundTotals) {
    return { rounds, wagered, paidOut, net }
}

/** Every game the player has a round of, by skipping through the index one game at a time. */
function playedGames(playerId: string): string[] {
    return db.all<{ game: string }>(sql`
        with recursive g(game) as (
            select min(game) from ${gameRounds} where player_id = ${playerId}
            union all
            select (select min(game) from ${gameRounds} where player_id = ${playerId} and game > g.game) from g where g.game is not null
        )
        select game from g where game is not null
    `).map(row => row.game)
}

/** The Amsterdam day of the player's first ledger row or round, or null if they have none. */
function firstDay(playerId: string, played: string[]): string | null {
    // db.all, not db.get: a raw get returns the row as an array.
    const [row] = db.all<{ ledger: number | null, rounds: number | null }>(sql`
        select
            (select min(created_at) from ${coinTransactions} where player_id = ${playerId}) as ledger,
            (select min((select min(created_at) from ${gameRounds} where player_id = ${playerId} and game = g.value)) from json_each(${JSON.stringify(played)}) g) as rounds
    `)
    const times = [row?.ledger, row?.rounds].filter((at): at is number => at !== null && at !== undefined).map(Number)
    return times.length ? amsterdamDay(new Date(Math.min(...times))) : null
}
