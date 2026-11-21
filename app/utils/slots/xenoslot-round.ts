// A Xeno Slot round in the shape the old site's server returned it, which the
// game component reads: amounts in coins at the round's bet, coin values on
// the Hold & Win board still in × bet. The casino's result
// (shared/slots/xenoslot) keeps everything in × bet and pays whole coins.
import {
    xenoSlotPayout,
    type Cell,
    type XenoSlotResult as XsResult,
    type XsCoin,
    type XsLineWin,
    type XsSymbol,
    type XsWave
} from '#shared/slots/xenoslot'

export type { Cell }
export type SlotSymbol = XsSymbol

export interface LineWin extends XsLineWin {
    /** Coins this line pays at the round's bet. */
    amount: number
}

export interface BonusWave extends XsWave {
    /** Landed at least one coin, core or UFO. */
    hit: boolean
}

export interface BonusResult {
    seed: XsCoin[]
    waves: BonusWave[]
    /** Coins the feature paid. */
    bonusPayout: number
}

export interface XenoSlotResult {
    bet: number
    /** Coins staked: the bet, or the buy price. */
    cost: number
    grid: SlotSymbol[][]
    lines: LineWin[]
    basePayout: number
    bonusTriggered: boolean
    bonusCells: Cell[]
    bonus: BonusResult | null
    /** Coins the round paid (capped), as the server settled it. */
    payout: number
}

const coins = (multiple: number, bet: number) => Math.floor(bet * multiple + 1e-9)

export function xenoRound(result: XsResult, bet: number, cost: number): XenoSlotResult {
    const payout = xenoSlotPayout(result, bet)
    // Whole coins as paid: the lines' part rounded down, the bonus the rest.
    const basePayout = Math.min(payout, coins(result.baseWin, bet))
    return {
        bet,
        cost,
        grid: result.grid,
        lines: result.lines.map(l => ({ ...l, amount: coins(l.win, bet) })),
        basePayout,
        bonusTriggered: result.bonus !== null,
        bonusCells: result.bonusCells,
        bonus: result.bonus
            ? {
                    seed: result.bonus.seed,
                    waves: result.bonus.waves.map(w => ({ ...w, hit: w.coins.length + w.glovers.length + w.collectors.length > 0 })),
                    bonusPayout: payout - basePayout
                }
            : null,
        payout
    }
}
