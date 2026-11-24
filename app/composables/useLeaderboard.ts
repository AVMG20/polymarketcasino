/** When the panel last closed: a tap outside it (on the trophy button too) closes it first. */
let closedAt = 0

/** The casino leaderboard panel (opened from the trophy button: the HUD's on My Casino, the top bar's elsewhere). */
export function useLeaderboard() {
    const open = useState('social:leaderboard', () => false)

    function close() {
        if (!open.value) return
        open.value = false
        closedAt = Date.now()
    }

    /** The trophy button: a tap that just closed the panel (outside tap) doesn't reopen it. */
    function toggle() {
        if (open.value) close()
        else if (Date.now() - closedAt > 350) open.value = true
    }

    return { open, close, toggle }
}
