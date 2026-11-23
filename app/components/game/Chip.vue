<script lang="ts">
/** Chip denominations a table offers, smallest first, with their colours. */
export const CHIP_LADDER = [10, 50, 100, 500, 1_000, 10_000, 100_000] as const

const CHIP_COLORS: Record<number, { face: string, edge: string, ink: string }> = {
    10: { face: '#eef2f7', edge: '#8a96a8', ink: '#334155' },
    50: { face: '#ef4444', edge: '#9b1c1c', ink: '#fff' },
    100: { face: '#3b82f6', edge: '#1e40af', ink: '#fff' },
    500: { face: '#a855f7', edge: '#6b21a8', ink: '#fff' },
    1_000: { face: '#f59e0b', edge: '#a85d06', ink: '#fff' },
    10_000: { face: '#22c55e', edge: '#15803d', ink: '#fff' },
    100_000: { face: '#2b2333', edge: '#0d0a12', ink: '#ffd84a' }
}

/** The colours of the largest ladder chip at or under `value`. */
export function chipColors(value: number) {
    const step = [...CHIP_LADDER].reverse().find(v => v <= value) ?? CHIP_LADDER[0]
    return CHIP_COLORS[step]!
}

/** The chips that make up `amount`, largest first (greedy on the ladder; at least one). */
export function chipsFor(amount: number, max = 6): number[] {
    const out: number[] = []
    let left = amount
    for (const value of [...CHIP_LADDER].reverse()) {
        while (left >= value && out.length < max) {
            out.push(value)
            left -= value
        }
    }
    return out.length ? out : [CHIP_LADDER[0]]
}
</script>

<script setup lang="ts">
import { formatCoins } from '#shared/money'

/**
 * A casino chip: coloured face by value, striped edge, inset ring and the
 * value on top. Sized by its box (give it a width; it stays round). `label`
 * overrides the printed value (a pile shows its total).
 */
const props = defineProps<{ value: number, label?: string | null }>()
const colors = computed(() => chipColors(props.value))
const text = computed(() => (props.label === null ? '' : props.label ?? formatCoins(props.value, true)))
</script>

<template>
  <span
    class="game-chip relative inline-grid aspect-square shrink-0 place-items-center rounded-full"
    :style="{ '--face': colors.face, '--edge': colors.edge, '--ink': colors.ink, '--len': text.length }"
  >
    <span v-if="text" class="game-chip-label">{{ text }}</span>
  </span>
</template>

<style scoped>
.game-chip {
    container-type: inline-size;
    background:
        radial-gradient(circle, var(--face) 0 47%, transparent 48%),
        radial-gradient(circle, rgb(255 255 255 / 0.55) 0 50%, transparent 51%),
        repeating-conic-gradient(from 11deg, #fff 0 14deg, var(--face) 14deg 45deg);
    box-shadow: 0 2px 0 var(--edge), inset 0 0 0 1.5px var(--edge), inset 0 -2px 3px rgb(0 0 0 / 0.25);
}
.game-chip::after {
    content: '';
    position: absolute;
    inset: 22%;
    border-radius: 50%;
    border: 1.5px dashed rgb(255 255 255 / 0.55);
}
.game-chip-label {
    position: relative;
    z-index: 1;
    font-family: var(--font-game);
    color: var(--ink);
    line-height: 1;
    font-size: clamp(7px, calc(78cqw / max(2.2, var(--len) * 0.62)), 22px);
    text-shadow: 0 1px 0 rgb(0 0 0 / 0.35);
}
</style>
