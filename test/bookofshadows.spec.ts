import { describe, expect, it } from 'vitest'
import { seededRng, type Rng } from '../shared/rng'
import {
    BONUS_RETRIGGER_SPINS,
    BONUS_SPINS,
    BONUS_TIERS,
    BOS_BUY_COST,
    BOS_COLS,
    BOS_MAX_WIN,
    BOS_ROWS,
    countBooks,
    evaluateGrid,
    PAYTABLE,
    playBonus,
    playBookOfShadows,
    type Grid,
    type SlotSymbol
} from '../shared/slots/bookofshadows'
import { serverGame } from '../server/utils/games'
import { playRound } from '../server/utils/rounds'
import { coinsOf, seedPlayer } from './setup/players'

/** A grid from rows as seen on screen (top row first); missing rows fill with a non-matching filler. */
function fromRows(...rows: string[][]): Grid {
    const filler: SlotSymbol[] = ['ten', 'jack', 'queen', 'king', 'ace']
    return Array.from({ length: BOS_COLS }, (_, col) => Array.from({ length: BOS_ROWS }, (_, row) => {
        const value = rows[row]?.[col]
        // Alternate fillers per column so blanks never connect.
        return (value ?? filler[(col * 2 + row * 3) % 5]!) as SlotSymbol
    }))
}

/** Rows of distinct symbols that never connect anywhere. */
const BLANK = [
    ['ten', 'queen', 'ten', 'queen', 'ten'],
    ['king', 'ace', 'king', 'ace', 'king'],
    ['jack', 'ten', 'jack', 'ten', 'jack'],
    ['queen', 'king', 'queen', 'king', 'queen'],
    ['ace', 'jack', 'ace', 'jack', 'ace'],
    ['ten', 'queen', 'ten', 'queen', 'ten']
]

function board(overrides: Record<string, SlotSymbol>): Grid {
    const grid = fromRows(...BLANK)
    for (const [key, symbol] of Object.entries(overrides)) {
        const [col, row] = key.split(':').map(Number)
        grid[col!]![row!] = symbol
    }
    return grid
}

describe('book of shadows: connections', () => {
    it('blank boards pay nothing', () => {
        expect(evaluateGrid(fromRows(...BLANK))).toEqual([])
    })

    it('pays a straight run of 3, 4 and 5 reels from the left', () => {
        for (const length of [3, 4, 5]) {
            const cells: Record<string, SlotSymbol> = {}
            for (let col = 0; col < length; col++) cells[`${col}:2`] = 'hood'
            const wins = evaluateGrid(board(cells))
            expect(wins).toHaveLength(1)
            expect(wins[0]).toMatchObject({ symbol: 'hood', length, amount: PAYTABLE.hood[length - 3] })
        }
    })

    it('zigzags one row up or down, but not two', () => {
        const zig = evaluateGrid(board({ '0:0': 'orb', '1:1': 'orb', '2:2': 'orb', '3:1': 'orb' }))
        expect(zig).toMatchObject([{ symbol: 'orb', length: 4 }])
        expect(evaluateGrid(board({ '0:0': 'orb', '1:2': 'orb', '2:2': 'orb' }))).toEqual([])
    })

    it('only pays runs that start on the first reel', () => {
        expect(evaluateGrid(board({ '1:2': 'sword', '2:2': 'sword', '3:2': 'sword', '4:2': 'sword' }))).toEqual([])
    })

    it('lets the book stand in for any symbol', () => {
        const wins = evaluateGrid(board({ '0:3': 'scythe', '1:3': 'book', '2:3': 'scythe' }))
        expect(wins.find(win => win.symbol === 'scythe')).toMatchObject({ length: 3, amount: PAYTABLE.scythe[0] })
        expect(evaluateGrid(board({ '0:3': 'scythe', '1:3': 'ten', '2:3': 'scythe' })).find(win => win.symbol === 'scythe')).toBeUndefined()
    })

    it('pays a run of books once, at the book rate', () => {
        const wins = evaluateGrid(board({ '0:0': 'book', '1:0': 'book', '2:0': 'book' }))
        expect(wins.filter(win => win.symbol === 'book')).toHaveLength(1)
        expect(wins.find(win => win.symbol === 'book')).toMatchObject({ length: 3, amount: PAYTABLE.book[0] })
    })

    it('pays a wild-reel run at the bonus-wild rate in free spins', () => {
        const grid = board({})
        for (const col of [0, 1, 2]) grid[col] = Array<SlotSymbol>(BOS_ROWS).fill('bonuswild')
        const wins = evaluateGrid(grid, ['book', 'bonuswild'])
        const wild = wins.filter(win => win.symbol === 'bonuswild')
        expect(wild).toHaveLength(1)
        expect(wild[0]).toMatchObject({ length: 3, amount: PAYTABLE.bonuswild[0] })
        // The wild reels also carry ordinary symbols to length 4 where reel 4 has them.
        expect(wins.every(win => win.length >= 3)).toBe(true)
    })

    it('counts books', () => {
        expect(countBooks(board({ '0:0': 'book', '4:5': 'book' }))).toBe(2)
    })
})

describe('book of shadows: free spins', () => {
    it('plays at least the base spins, adds the retrigger once, and stops books after it', () => {
        const rng = seededRng(7)
        let sawRetrigger = false
        for (let i = 0; i < 400; i++) {
            const bonus = playBonus(rng)
            expect(bonus.spins).toHaveLength(bonus.totalSpins)
            expect(bonus.totalSpins).toBe(BONUS_SPINS + (bonus.retriggered ? BONUS_RETRIGGER_SPINS : 0))
            const at = bonus.spins.findIndex(spin => spin.retriggered)
            expect(bonus.spins.filter(spin => spin.retriggered).length).toBe(bonus.retriggered ? 1 : 0)
            if (at >= 0) {
                sawRetrigger = true
                for (const spin of bonus.spins.slice(at + 1)) expect(spin.booksLanded).toBe(0)
            }
        }
        expect(sawRetrigger).toBe(true)
    })

    it('keeps wild reels locked once they land', () => {
        const rng = seededRng(3)
        for (let i = 0; i < 200; i++) {
            const bonus = playBonus(rng)
            const locked = new Set<number>()
            for (const spin of bonus.spins) {
                for (const col of locked) expect(spin.landedGrid[col]!.every(s => s === 'bonuswild')).toBe(true)
                for (const col of spin.newlyLocked) {
                    expect(locked.has(col)).toBe(false)
                    expect(spin.landedGrid[col]!.filter(s => s === 'bonuswild')).toHaveLength(1)
                    expect(spin.expandedGrid[col]!.every(s => s === 'bonuswild')).toBe(true)
                    locked.add(col)
                }
            }
            expect(bonus.lockedColumns).toEqual([...locked].sort((a, b) => a - b))
        }
    })

    it('multiplies only the wild-reel wins by the drawn symbol', () => {
        const rng = seededRng(11)
        for (let i = 0; i < 200; i++) {
            const bonus = playBonus(rng)
            expect(BONUS_TIERS).toContainEqual(bonus.tier)
            const ordinary = bonus.spins.reduce((sum, spin) => sum + spin.ordinaryWin, 0)
            const wild = bonus.spins.reduce((sum, spin) => sum + spin.wildWin, 0)
            expect(bonus.ordinaryWin).toBeCloseTo(ordinary, 9)
            expect(bonus.wildWin).toBeCloseTo(wild * bonus.tier.multiplier, 9)
            expect(bonus.totalWin).toBeCloseTo(ordinary + wild * bonus.tier.multiplier, 9)
        }
    })
})

describe('book of shadows: rounds', () => {
    it('starts the free spins on 3+ books, and on every buy', () => {
        const rng = seededRng(21)
        for (let i = 0; i < 3_000; i++) {
            const outcome = playBookOfShadows(rng)
            expect(outcome.feature).toBe(countBooks(outcome.grid) >= 3)
            expect(outcome.bonus !== null).toBe(outcome.feature)
        }
        for (let i = 0; i < 50; i++) {
            const bought = playBookOfShadows(rng, { buy: true })
            expect(bought.feature).toBe(true)
            expect(countBooks(bought.grid)).toBeGreaterThanOrEqual(3)
        }
    })

    it('adds the base grid and the feature, capped at the max win', () => {
        const rng = seededRng(5)
        for (let i = 0; i < 200; i++) {
            const outcome = playBookOfShadows(rng, { buy: true })
            const raw = outcome.wins.reduce((sum, win) => sum + win.amount, 0) + outcome.bonus!.totalWin
            expect(outcome.win).toBeCloseTo(Math.min(raw, BOS_MAX_WIN), 9)
            expect(outcome.capped).toBe(raw >= BOS_MAX_WIN)
        }
        // A rigged rng that always lands a wild reel and the top symbol hits the cap.
        const always: Rng = { next: () => 0 }
        const capped = playBookOfShadows(always, { buy: true })
        expect(capped.win).toBeLessThanOrEqual(BOS_MAX_WIN)
    })
})

describe('book of shadows: server', () => {
    const game = serverGame('bookofshadows')!

    it('stakes the bet, or the bet times the buy cost', () => {
        const rng = seededRng(1)
        expect(game.play({ bet: 100, options: {}, rng }).stake).toBe(100)
        const buy = game.play({ bet: 250, options: { buy: true }, rng })
        expect(buy.stake).toBe(250 * BOS_BUY_COST)
        expect(Number.isSafeInteger(BOS_BUY_COST)).toBe(true)
        expect((buy.result as { feature: boolean }).feature).toBe(true)
    })

    it('pays whole coins, rounded down', () => {
        const rng = seededRng(2)
        for (let i = 0; i < 500; i++) {
            const out = game.play({ bet: 137, options: {}, rng })
            const win = (out.result as { win: number }).win
            expect(out.payout).toBe(Math.floor(137 * win + 1e-9))
        }
    })

    it('refuses a buy flag that is not a boolean', () => {
        expect(() => game.play({ bet: 100, options: { buy: 'yes' }, rng: seededRng(1) })).toThrow(RangeError)
    })

    it('settles a buy through playRound and refuses one the player cannot cover', async () => {
        const id = seedPlayer(100 * BOS_BUY_COST)
        const round = await playRound(id, 'bookofshadows', { bet: 100, options: { buy: true } })
        expect(round.stake).toBe(100 * BOS_BUY_COST)
        expect(round.balance).toBe(round.payout)
        const poor = seedPlayer(100 * BOS_BUY_COST - 1)
        await expect(playRound(poor, 'bookofshadows', { bet: 100, options: { buy: true } })).rejects.toMatchObject({ statusCode: 400 })
        expect(coinsOf(poor).coins).toBe(100 * BOS_BUY_COST - 1)
        await expect(playRound(id, 'bookofshadows', { bet: 99 })).rejects.toMatchObject({ statusCode: 400 })
    })
})
