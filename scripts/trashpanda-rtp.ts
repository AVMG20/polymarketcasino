// `bun scripts/trashpanda-rtp.ts [rounds] [bet] [seed] [buys]`: paid spin RTP
// (base ways, Dumpster Dive and Night Heist free spins apart), feature rates,
// both buy RTPs and max win, paid in whole coins like the server.
import { seededRng } from '../shared/rng'
import { playTrashPanda, TPH_BUY_DIVE_COST, TPH_BUY_FREE_SPINS_COST, trashPandaStake, type TphFeature } from '../shared/slots/trashpanda'
import { simArgs, Tally } from './lib/report'

const { rounds, bet, seed } = simArgs(5_000_000)
const buyRounds = Number(process.argv[5] ?? 300_000)
const rng = seededRng(seed)

const spins = new Tally()
let base = 0
let dive = 0
let dives = 0
let scatterFs = 0
let scatterFsPay = 0
let keyFs = 0
let keyFsPay = 0
let capped = 0
for (let i = 0; i < rounds; i++) {
    const r = playTrashPanda(rng, bet)
    spins.add(bet, r.payout)
    base += r.basePayout
    if (r.dive) {
        dives++
        dive += r.divePayout
    }
    if (r.freeSpins?.source === 'key') {
        keyFs++
        keyFsPay += r.freeSpinsPayout
    } else if (r.freeSpins) {
        scatterFs++
        scatterFsPay += r.freeSpinsPayout
    }
    if (r.capped) capped++
}

const pct = (x: number) => `${(100 * x / (rounds * bet)).toFixed(2)}%`
const odds = (n: number) => n ? `1 in ${Math.round(rounds / n)}` : 'never'
console.log(`trashpanda at bet ${bet}, seed ${seed}`)
console.log(spins.line('paid spins'))
console.log(`${''.padEnd(18)} base ${pct(base)}  dive ${pct(dive)} (${odds(dives)})  `
    + `free spins ${pct(scatterFsPay)} (${odds(scatterFs)})  key spins ${pct(keyFsPay)} (${odds(keyFs)})  capped ${capped}`)

const buys: [TphFeature, number][] = [['buyFreeSpins', TPH_BUY_FREE_SPINS_COST], ['buyDive', TPH_BUY_DIVE_COST]]
for (const [feature, price] of buys) {
    const tally = new Tally()
    for (let i = 0; i < buyRounds; i++) {
        const r = playTrashPanda(rng, bet, { feature })
        tally.add(trashPandaStake(bet, { feature }), r.payout)
    }
    console.log(tally.line(`${feature} at ${price}×`))
}
