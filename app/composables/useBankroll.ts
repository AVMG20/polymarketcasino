import { sumCoins } from '#shared/money'
import { bankroll, splitStake } from '#shared/tycoon'

/**
 * What the player can stake: coins and chips together. Every stake is paid
 * from coins first, then chips for whatever coins don't cover (the server
 * splits it the same way), and every win pays chips. There is no currency
 * choice.
 */
export function useBankroll() {
    const session = useCasinoSession()
    const tycoon = useTycoon()
    const total = computed(() => bankroll(session.coins.value, tycoon.chips.value))

    /**
     * The optimistic debit of a stake, coins first, then chips. Returns a
     * function that puts both balances back (a round that failed), or null
     * when the bankroll can't cover it.
     */
    function take(stake: number): (() => void) | null {
        const before = { coins: session.coins.value, chips: tycoon.chips.value }
        const split = splitStake(stake, before.coins, before.chips)
        if (!split) return null
        session.setCoins(sumCoins([before.coins, -split.coins]))
        tycoon.setChips(sumCoins([before.chips, -split.chips]))
        return () => {
            session.setCoins(before.coins)
            tycoon.setChips(before.chips)
        }
    }

    return { total, take }
}
