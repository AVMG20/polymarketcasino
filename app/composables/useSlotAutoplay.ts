/**
 * Autoplay for the bespoke slots, with the shell's rules (SlotGame.vue): a
 * fixed run of spins that stops when a feature triggers, when the next spin
 * can't be afforded, or when the player presses stop. The game starts it,
 * reports each finished round and asks whether to spin again. Returned as a
 * reactive object, so `autoplay.left` reads the same in script and template.
 */
export const SLOT_AUTO_SPINS = 10

export function useSlotAutoplay() {
    /** Spins left, counting the one in progress. 0 when autoplay is off. */
    const left = ref(0)
    const active = computed(() => left.value > 0)

    function start(count = SLOT_AUTO_SPINS) {
        left.value = Math.max(0, Math.floor(count))
    }

    function stop() {
        left.value = 0
    }

    /**
     * Count a finished round. Returns true when the next autoplay spin should
     * start: never after a feature, never when the balance can't cover it.
     */
    function finish(round: { bonus?: boolean }, balance: number, nextCost: number): boolean {
        if (left.value <= 0) return false
        left.value--
        if (round.bonus) stop()
        if (balance < nextCost) stop()
        return left.value > 0
    }

    onBeforeUnmount(stop)

    return reactive({ left, active, start, stop, finish })
}
