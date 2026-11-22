import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { parseAmount } from '#shared/money'

/**
 * Two-way text buffer for a numeric coins/gems ref, so any input can accept
 * shorthand like `10k`, `2.5m` or `1b`. Bind the returned ref with `v-model`
 * on a plain text input (not `type="number"`, which rejects the suffix).
 *
 * Typing updates `amount` as soon as the text parses; blank or unparseable
 * text reads as 0. Setting `amount` from code (½, 2×, All…) rewrites the text,
 * but a value the text already means is left alone, so `100m` stays `100m`.
 * `parseAmount` reads coins with up to four decimals, Dutch first (`2.137` is
 * 2137, `2,5` is 2.5); `integer` rounds down to whole coins (or gems). Values
 * written back use the decimal comma, so they read back the same.
 */
export function useAmountInput(amount: Ref<number>, options: { integer?: boolean, shorthand?: boolean } = {}) {
    // With `shorthand`, values set from code are written back as `2.5b`
    // rather than `2500000000`, so small bet fields never overflow.
    const show = (value: number) => (options.shorthand ? amountShorthand(value) : plainAmount(value))
    const read = (value: string) => {
        const parsed = parseAmount(value) ?? 0
        return options.integer ? Math.floor(parsed) : parsed
    }

    const text = ref(amount.value ? show(amount.value) : '')

    watch(text, (value) => {
        const parsed = read(value)
        if (parsed !== amount.value) amount.value = parsed
    })

    watch(amount, (value) => {
        if (read(text.value) !== value) text.value = value ? show(value) : ''
    })

    return text
}

/** Digits with a decimal comma and no grouping (`2137,5`), which `parseAmount` reads back exactly. */
export function plainAmount(value: number) {
    return String(value).replace('.', ',')
}

/**
 * The shortest `k`/`m`/`b`/`t` spelling that parses back to exactly `value`
 * (`2500000000` → `2,5b`, `12000` → `12k`). Values that would need more than
 * two decimals keep their plain digits, so rewriting never changes the amount.
 */
export function amountShorthand(value: number) {
    const units: [string, number][] = [['t', 1e12], ['b', 1e9], ['m', 1e6], ['k', 1e3]]
    for (const [suffix, size] of units) {
        if (value < size) continue
        const scaled = value / size
        const rounded = Math.round(scaled * 100) / 100
        if (Math.abs(rounded * size - value) < 1e-6) return `${plainAmount(rounded)}${suffix}`
    }
    return plainAmount(value)
}
