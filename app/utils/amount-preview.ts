import { formatCoinsExact, parseAmount } from '#shared/money'

/**
 * Full-number readout for what was typed into an amount input: `10m` →
 * `10.000.000`, `2,5` → `2,5`, `2.137` → `2.137`. Every decimal the amount
 * keeps is shown (up to four), so the player sees exactly what they bet.
 * Empty when the text doesn't parse or already reads the same, so `500`
 * doesn't echo `500` next to itself.
 */
export function amountPreview(text: string | undefined, integer = false): string {
    const parsed = parseAmount(text ?? '')
    if (parsed === null) return ''
    const formatted = formatCoinsExact(integer ? Math.floor(parsed) : parsed)
    return formatted === text?.trim() ? '' : formatted
}
