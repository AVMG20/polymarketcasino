import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../server/database'
import { coinTransactions, dailyMissions } from '../server/database/schema'
import { claimMission, ensureMissions, parseMissionBody, recordMissions } from '../server/utils/missions'
import { playRound } from '../server/utils/rounds'
import { collectCage, getTycoonState, startBuild, startCampaign } from '../server/utils/tycoon'
import { writeTx } from '../server/database'
import { amsterdamDay } from '../shared/economy'
import {
    BONUS_MISSION, MISSION_FLOOR_PER_HOUR, MISSIONS, missionReward, pickMissions, roundMissionEvents, WELCOME_AFTER_MS,
    type MissionId
} from '../shared/missions'
import { seededRng } from '../shared/rng'
import { cageCapacity, guestChipsBetween, STARTER_CAGE } from '../shared/tycoon'
import { coinsOf, giveChips, ledgerSum, seedPlayer } from './setup/players'

const MIN = 60_000
const HOUR = 60 * MIN

/** A dev-login player (no hub calls) with a brand-new casino on first use. */
const newPlayer = (coins = 0) => seedPlayer(coins, coins, { casino: 'none', origin: 'dev' })

/** Replace the player's missions of `day` with a known set (fixture). */
function setMissions(playerId: string, day: string, list: [MissionId, number][], reward = 500) {
    db.delete(dailyMissions).where(and(eq(dailyMissions.playerId, playerId), eq(dailyMissions.day, day))).run()
    db.insert(dailyMissions).values([
        ...list.map(([mission, target], slot) => ({ playerId, day, mission, slot, target, reward })),
        { playerId, day, mission: BONUS_MISSION, slot: 3, target: list.length, reward: 1_000 }
    ]).run()
}

function missionRows(playerId: string, day: string) {
    return db.select().from(dailyMissions).where(and(eq(dailyMissions.playerId, playerId), eq(dailyMissions.day, day))).all()
}

function progressOf(playerId: string, day: string, mission: string) {
    return missionRows(playerId, day).find(row => row.mission === mission)?.progress
}

describe('mission rules', () => {
    it('draws one to play, one for the casino and one more, all different and eligible', () => {
        const all = MISSIONS.map(m => m.id)
        for (let seed = 1; seed <= 200; seed++) {
            const picked = pickMissions(seededRng(seed), all)
            expect(picked).toHaveLength(3)
            expect(new Set(picked).size).toBe(3)
            expect(MISSIONS.find(m => m.id === picked[0])!.group).toBe('play')
            expect(MISSIONS.find(m => m.id === picked[1])!.group).toBe('casino')
        }
        const narrow: MissionId[] = ['rounds', 'collects', 'campaign']
        for (let seed = 1; seed <= 50; seed++) expect(pickMissions(seededRng(seed), narrow).sort()).toEqual([...narrow].sort())
    })

    it('counts a round toward rounds, slot wins, 5× wins, live hands and visits', () => {
        expect(roundMissionEvents({ playerId: 'a', game: 'dice', stake: 10, payout: 0 })).toEqual(['rounds'])
        expect(roundMissionEvents({ playerId: 'a', game: 'spinata', stake: 10, payout: 12 })).toEqual(['rounds', 'slot-wins'])
        expect(roundMissionEvents({ playerId: 'a', game: 'spinata', stake: 10, payout: 10 })).toEqual(['rounds'])
        expect(roundMissionEvents({ playerId: 'a', game: 'limbo', stake: 10, payout: 50 })).toEqual(['rounds', 'big-win'])
        expect(roundMissionEvents({ playerId: 'a', game: 'blackjack', stake: 100, payout: 200 })).toEqual(['rounds', 'table-hands'])
        expect(roundMissionEvents({ playerId: 'a', game: 'dice', stake: 10, payout: 0, host: 'b' })).toEqual(['rounds', 'visit'])
        expect(roundMissionEvents({ playerId: 'a', game: 'dice', stake: 10, payout: 0, host: 'a' })).toEqual(['rounds'])
    })

    it('sizes rewards from the full guest income, with a floor for young casinos', () => {
        const young = { games: { plinko: 1, spinata: 1 } }
        expect(missionReward(young, 0.5)).toBe(MISSION_FLOOR_PER_HOUR * 0.5)
        const big = { games: { plinko: 5, spinata: 5, roulette: 5, blackjack: 5, baccarat: 5, aethergates: 5 } }
        expect(missionReward(big, 1)).toBeGreaterThan(MISSION_FLOOR_PER_HOUR)
        expect(missionReward(big, 1) % 10).toBe(0)
    })

    it('reads claim bodies strictly', () => {
        expect(parseMissionBody({ id: 'rounds' })).toBe('rounds')
        expect(parseMissionBody({ id: 'bonus' })).toBe('bonus')
        for (const body of [null, {}, { id: 'nope' }, { id: 3 }, ['rounds']]) expect(() => parseMissionBody(body)).toThrow('id names a mission')
    })
})

describe('daily missions', () => {
    it('draws three missions and a bonus on the first read, and keeps them for the day', () => {
        const id = newPlayer()
        const first = getTycoonState(id).missions!
        expect(first.day).toBe(amsterdamDay())
        expect(first.missions).toHaveLength(3)
        expect(first.missions.every(m => m.progress === 0 && !m.claimed && m.reward >= MISSION_FLOOR_PER_HOUR * 0.5)).toBe(true)
        expect(first.bonus).toMatchObject({ id: 'bonus', target: 3, progress: 0 })
        expect(first.endsAt).toBeGreaterThan(Date.now())
        expect(getTycoonState(id).missions).toEqual(first)
        // A burst of first reads draws once.
        const other = newPlayer()
        writeTx(tx => [1, 2, 3].map(() => ensureMissions(tx, other)))
        expect(missionRows(other, amsterdamDay())).toHaveLength(4)
    })

    it('counts rounds, collects, builds and campaigns from the real events', async () => {
        const id = newPlayer(10_000)
        const day = amsterdamDay()
        getTycoonState(id)
        setMissions(id, day, [['rounds', 20], ['collects', 2], ['build', 1]])
        for (let i = 0; i < 3; i++) await playRound(id, 'plinko', { bet: 10, options: { rows: 8, risk: 'low', balls: 1 } })
        expect(progressOf(id, day, 'rounds')).toBe(3)

        await collectCage(id)
        expect(progressOf(id, day, 'collects')).toBe(1)
        // An empty cage collects nothing and counts for nothing.
        await collectCage(id)
        expect(progressOf(id, day, 'collects')).toBe(1)

        giveChips(id, 10_000)
        await startBuild(id, { kind: 'game', id: 'limbo' })
        expect(progressOf(id, day, 'build')).toBe(1)

        setMissions(id, day, [['campaign', 1], ['rounds', 20], ['big-win', 1]])
        await startCampaign(id, 'flyers')
        expect(progressOf(id, day, 'campaign')).toBe(1)
    })

    it('caps progress at the target and refuses a claim before it is done', async () => {
        const id = newPlayer()
        const day = amsterdamDay()
        getTycoonState(id)
        setMissions(id, day, [['rounds', 2], ['collects', 2], ['campaign', 1]])
        await expect(claimMission(id, 'rounds')).rejects.toThrow('Not done yet')
        writeTx(tx => [1, 2, 3, 4].forEach(() => recordMissions(tx, id, ['rounds'])))
        expect(progressOf(id, day, 'rounds')).toBe(2)
        await expect(claimMission(id, 'visit')).rejects.toThrow("That is not one of today's missions")
    })

    it('pays a claim in coins once, however many claims race, and the bonus after all three', async () => {
        const id = newPlayer(0)
        const day = amsterdamDay()
        getTycoonState(id)
        setMissions(id, day, [['rounds', 1], ['collects', 1], ['campaign', 1]], 500)
        writeTx(tx => recordMissions(tx, id, ['rounds', 'collects', 'campaign']))

        const burst = await Promise.allSettled(Array.from({ length: 12 }, () => claimMission(id, 'rounds')))
        const paid = burst.filter(r => r.status === 'fulfilled')
        expect(paid).toHaveLength(1)
        expect((paid[0] as PromiseFulfilledResult<{ reward?: number, coins: number | null }>).value).toMatchObject({ reward: 500, coins: 500 })
        expect(coinsOf(id).coins).toBe(500)
        const rows = db.select().from(coinTransactions).where(and(eq(coinTransactions.playerId, id), eq(coinTransactions.category, 'mission'))).all()
        expect(rows).toHaveLength(1)
        await expect(claimMission(id, 'rounds')).rejects.toThrow('Claimed already')

        await expect(claimMission(id, 'bonus')).rejects.toThrow('Not done yet')
        await Promise.all([claimMission(id, 'collects'), claimMission(id, 'campaign')])
        const bonus = await Promise.allSettled(Array.from({ length: 6 }, () => claimMission(id, 'bonus')))
        expect(bonus.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        expect(coinsOf(id).coins).toBe(500 * 3 + 1_000)
        expect(ledgerSum(id)).toBe(coinsOf(id).coins)
        const state = getTycoonState(id).missions!
        expect(state.missions.every(m => m.claimed)).toBe(true)
        expect(state.bonus).toMatchObject({ claimed: true, progress: 3 })
        // A claimed mission stops counting.
        writeTx(tx => recordMissions(tx, id, ['rounds']))
        expect(progressOf(id, day, 'rounds')).toBe(1)
    })

    it('rolls over at midnight in Amsterdam (winter and summer time)', async () => {
        for (const [before, after, day, next] of [
            ['2026-11-23T22:59:00Z', '2026-11-23T23:01:00Z', '2026-11-23', '2026-11-24'],
            ['2026-07-01T21:59:00Z', '2026-07-01T22:01:00Z', '2026-07-01', '2026-07-02']
        ] as const) {
            const id = newPlayer()
            const t0 = Date.parse(before)
            const t1 = Date.parse(after)
            writeTx(tx => ensureMissions(tx, id, t0))
            setMissions(id, day, [['rounds', 1], ['collects', 2], ['campaign', 1]])
            writeTx(tx => recordMissions(tx, id, ['rounds'], t0))
            expect(progressOf(id, day, 'rounds')).toBe(1)

            // Past midnight: a new day with new missions, and yesterday's can't be claimed.
            writeTx(tx => recordMissions(tx, id, ['rounds'], t1))
            expect(missionRows(id, next)).toHaveLength(4)
            expect(progressOf(id, day, 'rounds')).toBe(1)
            await expect(claimMission(id, 'rounds', t1)).rejects.toThrow()
            expect(coinsOf(id).coins).toBe(0)
            expect(getTycoonState(id, t1).missions!.day).toBe(next)
        }
    })
})

describe('while you were away', () => {
    it('says nothing on a quick return, and only when the page asks', () => {
        const id = newPlayer()
        const t0 = Date.now()
        expect(getTycoonState(id, t0, { welcome: true }).welcome).toBeNull()
        expect(getTycoonState(id, t0 + WELCOME_AFTER_MS - 1_000, { welcome: true }).welcome).toBeNull()
        // Any read is a visit: a later read without the flag still moves "last seen".
        expect(getTycoonState(id, t0 + 2 * WELCOME_AFTER_MS).welcome).toBeNull()
        expect(getTycoonState(id, t0 + 2 * WELCOME_AFTER_MS + 60_000, { welcome: true }).welcome).toBeNull()
    })

    it('reports the coins the cage earned, constructions that finished and the campaign that ended', async () => {
        const id = newPlayer()
        const t0 = Date.now()
        await collectCage(id, t0)
        giveChips(id, 50_000)
        await startBuild(id, { kind: 'game', id: 'plinko' }, t0)
        await startCampaign(id, 'flyers', t0)
        const away = getTycoonState(id, t0 + 3 * HOUR, { welcome: true }).welcome!
        expect(away.awayMs).toBe(3 * HOUR)
        expect(away.finished).toEqual([{ kind: 'game', id: 'plinko', level: 2 }])
        expect(away.campaignEnded).toBe('flyers')
        expect(away.earned).toBeGreaterThan(0)
        expect(away.lost).toBe(0)
        expect(away.full).toBe(false)
        expect(away.seats).toBeGreaterThan(0)
        // Shown once: the next read is a fresh visit.
        expect(getTycoonState(id, t0 + 3 * HOUR + 1_000, { welcome: true }).welcome).toBeNull()
    })

    it('keeps the coins collected right after a read out of the "lost" count', async () => {
        const id = newPlayer()
        const t0 = Date.now()
        // A read, then a collect half a minute later (inside the snapshot's one-minute window).
        expect(getTycoonState(id, t0).cage.stored).toBe(STARTER_CAGE)
        expect((await collectCage(id, t0 + 30_000)).collected).toBe(STARTER_CAGE)
        const t1 = t0 + 30_000 + 3 * HOUR
        const away = getTycoonState(id, t1, { welcome: true }).welcome!
        const income = guestChipsBetween(getTycoonState(id, t1), t0 + 30_000, t1)
        expect(income).toBeLessThan(cageCapacity(0))
        expect(away.full).toBe(false)
        expect(away.lost).toBe(0)
        expect(away.earned).toBe(Math.floor(income))
    })

    it('says how much a full cage turned away', async () => {
        const id = newPlayer()
        const t0 = Date.now()
        // A new casino's cage starts full: it has been losing income from the first second.
        const stored = getTycoonState(id, t0).cage.stored
        expect(stored).toBe(STARTER_CAGE)
        const t1 = t0 + 24 * HOUR
        const away = getTycoonState(id, t1, { welcome: true }).welcome!
        expect(away.full).toBe(true)
        expect(away.earned).toBe(0)
        const state = getTycoonState(id, t1)
        expect(away.lost).toBe(Math.round(guestChipsBetween(state, t0, t1)))
        expect(away.capacity).toBe(cageCapacity(0))

        // Half empty, then a day away: earned what fit, lost the rest.
        await collectCage(id, t1)
        const t2 = t1 + 30 * HOUR
        const back = getTycoonState(id, t2, { welcome: true }).welcome!
        const income = guestChipsBetween(getTycoonState(id, t2), t1, t2)
        expect(back.full).toBe(true)
        expect(back.earned + back.lost).toBeGreaterThanOrEqual(Math.floor(income) - 1)
        expect(back.earned + back.lost).toBeLessThanOrEqual(Math.ceil(income) + 1)
    })
})
