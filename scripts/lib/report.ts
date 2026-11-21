// Shared bookkeeping for the scripts/<game>-rtp.ts simulations. Balance
// checks live here, never in tests: tests cover rules, not tuning numbers.
import { formatCoins } from '../../shared/money'

export interface SimArgs {
    rounds: number
    bet: number
    seed: number
}

/** `bun scripts/<game>-rtp.ts [rounds] [bet] [seed]` */
export function simArgs(defaultRounds: number): SimArgs {
    return {
        rounds: Number(process.argv[2] ?? defaultRounds),
        bet: Number(process.argv[3] ?? 100),
        seed: Number(process.argv[4] ?? 1234)
    }
}

export class Tally {
    staked = 0
    paid = 0
    rounds = 0
    hits = 0
    maxMultiple = 0

    add(stake: number, payout: number) {
        this.rounds++
        this.staked += stake
        this.paid += payout
        if (payout > 0) this.hits++
        this.maxMultiple = Math.max(this.maxMultiple, payout / stake)
    }

    line(label: string) {
        const rtp = this.staked ? (100 * this.paid / this.staked).toFixed(2) : '–'
        return `${label.padEnd(18)} rounds ${formatCoins(this.rounds)}  rtp ${rtp}%  hit ${(100 * this.hits / Math.max(1, this.rounds)).toFixed(1)}%  max ${this.maxMultiple.toFixed(1)}×`
    }
}
