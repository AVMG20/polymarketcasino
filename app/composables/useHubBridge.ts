/**
 * Talking to the hub when the casino runs inside its iframe
 * (docs/platform-contract.md, postMessage). Outside an iframe every call is a
 * no-op.
 */
export function useHubBridge() {
    const { config } = useCasinoSession()
    const embedded = useState('casino:embedded', () => import.meta.client && window.self !== window.top)

    function post(type: 'wallet' | 'star' | 'title' | 'relaunch', payload: Record<string, unknown> = {}): boolean {
        if (!embedded.value || !config.value) return false
        window.parent.postMessage({ source: 'pnx', type, ...payload }, config.value.coreUrl)
        return true
    }

    /** Listen for the hub's `hello` (it carries the gem count); unknown types are ignored. */
    function onHello(handler: (gems: number) => void) {
        if (!import.meta.client) return
        window.addEventListener('message', (event) => {
            if (!config.value || event.origin !== config.value.coreUrl) return
            const data = event.data as { source?: string, type?: string, gems?: unknown }
            if (data?.source === 'pnx' && data.type === 'hello' && typeof data.gems === 'number') handler(data.gems)
        })
    }

    return {
        embedded,
        postWallet: (gems: number) => post('wallet', { gems }),
        /** The casino's star level (0-10) changed. */
        postStars: (stars: number) => post('star', { game: 'casino', stars }),
        postTitle: (title: string) => post('title', { title }),
        /** Ask the hub for a fresh launch (session expired). False when not embedded. */
        relaunch: () => post('relaunch'),
        onHello
    }
}
