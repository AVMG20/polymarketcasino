/** When the panel last closed: a tap outside it (on the stats button too) closes it first. */
let closedAt = 0

/** The "Casino stats" panel (hour-by-hour charts), opened from the top bar and the guests popover. */
export function useCasinoStats() {
    const open = useState('tycoon:stats-open', () => false)

    function close() {
        if (!open.value) return
        open.value = false
        closedAt = Date.now()
    }
    function show() {
        open.value = true
    }
    /** A toggle button: a tap that just closed the panel (outside tap) doesn't reopen it. */
    function toggle() {
        if (open.value) close()
        else if (Date.now() - closedAt > 350) open.value = true
    }

    return { open, close, show, toggle }
}
