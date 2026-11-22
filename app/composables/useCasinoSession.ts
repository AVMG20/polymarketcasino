import { normalizeCoins } from '#shared/money'
import { toast } from 'vue-sonner'

export interface CasinoPlayer {
    id: string
    name: string
    image: string | null
    title: string | null
    coins: number
    peakCoins: number
}

export interface CasinoConfig {
    coreUrl: string
    appId: string
    devLogin: boolean
}

type Status = 'loading' | 'ready' | 'signed-out'

/**
 * Who is playing and how many coins they hold. Booted once by the session
 * plugin: a `#pnx=<token>` launch from the hub is exchanged for a session;
 * without a session the player is sent to the hub's /connect (or, with the dev
 * login enabled, shown the sign-in screen).
 */
export function useCasinoSession() {
    const status = useState<Status>('casino:status', () => 'loading')
    const config = useState<CasinoConfig | null>('casino:config', () => null)
    const player = useState<CasinoPlayer | null>('casino:player', () => null)

    const coins = computed(() => player.value?.coins ?? 0)

    /**
     * Apply a balance the server returned. Games call this after their win
     * reveal (and with `before - cost` for an optimistic debit, so the value
     * is snapped back onto four decimals: 10.3 - 0.1 is not 10.200000000000001).
     */
    function setCoins(next: number) {
        if (!player.value) return
        const value = normalizeCoins(next)
        player.value.coins = value
        if (value > player.value.peakCoins) player.value.peakCoins = value
        useWallet().followCoins(value)
    }

    /**
     * The session ran out mid-play. Inside the hub, ask it for a fresh launch;
     * standalone, go through /connect. Returns true when it was a 401.
     */
    function handleUnauthorized(error: unknown): boolean {
        if (apiStatus(error) !== 401) return false
        player.value = null
        status.value = 'signed-out'
        if (useHubBridge().relaunch()) return true
        if (!config.value?.devLogin) window.location.href = connectUrl()
        return true
    }

    function connectUrl() {
        const c = config.value
        if (!c) return '/'
        return `${c.coreUrl}/connect?app=${encodeURIComponent(c.appId)}&return=${encodeURIComponent(window.location.href)}`
    }

    async function loadPlayer(): Promise<boolean> {
        try {
            const { player: me } = await $fetch<{ player: CasinoPlayer }>('/api/me')
            player.value = me
            status.value = 'ready'
            return true
        } catch (error) {
            if (apiStatus(error) !== 401) toast.error(apiErrorMessage(error, 'Could not load your account'))
            player.value = null
            return false
        }
    }

    /** Read the launch token from the URL hash (and strip it), or null. */
    function takeLaunchToken(): string | null {
        const match = /(?:^#|&)pnx=([^&]+)/.exec(window.location.hash)
        if (!match) return null
        const rest = window.location.hash.slice(1).split('&').filter(part => !part.startsWith('pnx=')).join('&')
        history.replaceState(history.state, '', window.location.pathname + window.location.search + (rest ? `#${rest}` : ''))
        return decodeURIComponent(match[1]!)
    }

    async function boot() {
        const token = takeLaunchToken()
        config.value = await $fetch<CasinoConfig>('/api/config')
        if (token) {
            try {
                await $fetch('/api/auth/launch', { method: 'POST', body: { token } })
            } catch (error) {
                toast.error(apiErrorMessage(error, 'Could not sign you in'))
            }
        }
        if (await loadPlayer()) return
        status.value = 'signed-out'
        // Inside the hub, ask it for a fresh launch token (the hub allows one
        // relaunch per 30 s, so a bad token can't loop). Standalone, go through
        // /connect, unless a launch just failed (that would loop) or the dev
        // login screen is on offer.
        if (useHubBridge().relaunch()) return
        if (!token && !config.value.devLogin) window.location.href = connectUrl()
    }

    async function devLogin(name: string) {
        await $fetch('/api/dev/login', { query: { name } })
        await loadPlayer()
    }

    async function signOut() {
        await $fetch('/api/auth/logout', { method: 'POST' })
        player.value = null
        status.value = 'signed-out'
    }

    return { status, config, player, coins, setCoins, handleUnauthorized, boot, connectUrl, devLogin, signOut, refresh: loadPlayer }
}
