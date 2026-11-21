/**
 * The chip ladder every live table uses, and the table limits. Chips start at
 * 100 coins, so every fractional pay (baccarat's banker 0.95, blackjack's 3:2,
 * a half-bet surrender or insurance) lands on a whole coin.
 */
export interface Chip {
    value: number
    /** Face colour, rim colour and text colour. */
    face: string
    rim: string
    text: string
}

export const CHIPS: readonly Chip[] = [
    { value: 100, face: '#f1f5f9', rim: '#64748b', text: '#0f172a' },
    { value: 500, face: '#dc2626', rim: '#fee2e2', text: '#ffffff' },
    { value: 1_000, face: '#16a34a', rim: '#dcfce7', text: '#ffffff' },
    { value: 5_000, face: '#1e293b', rim: '#e2e8f0', text: '#ffffff' },
    { value: 25_000, face: '#7c3aed', rim: '#ede9fe', text: '#ffffff' },
    { value: 100_000, face: '#ca8a04', rim: '#fef9c3', text: '#1c1917' },
    { value: 250_000, face: '#db2777', rim: '#fce7f3', text: '#ffffff' },
    { value: 1_000_000, face: '#0d9488', rim: '#ccfbf1', text: '#ffffff' }
]

export const CHIP_VALUES: ReadonlySet<number> = new Set(CHIPS.map(chip => chip.value))

/** The smallest bet on any spot. */
export const TABLE_MIN_BET = CHIPS[0]!.value
/** The largest bet on any one spot (an ante, a main bet, a side bet). */
export const TABLE_MAX_BET = 1_000_000

export function isChip(value: unknown): value is number {
    return typeof value === 'number' && CHIP_VALUES.has(value)
}

/** Break an amount into chips, largest first, for drawing a stack. */
export function chipStack(amount: number, max = 8): Chip[] {
    const stack: Chip[] = []
    let left = amount
    for (let i = CHIPS.length - 1; i >= 0 && stack.length < max; i--) {
        const chip = CHIPS[i]!
        while (left >= chip.value && stack.length < max) {
            stack.push(chip)
            left -= chip.value
        }
    }
    // A scaled bet can leave less than the smallest chip: show it as one.
    if (!stack.length && amount > 0) stack.push(CHIPS[0]!)
    return stack
}

/** A bet scaled by ½ or 2, rounded down to the coin. */
export function scaleAmount(amount: number, factor: 0.5 | 2): number {
    return Math.floor(amount * factor)
}
