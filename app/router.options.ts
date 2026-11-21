import type { RouterConfig } from '@nuxt/schema'

export default {
    // A hub launch arrives as `#pnx=<token>`: never treat it as a scroll anchor
    // (the session plugin strips it from the URL).
    scrollBehavior(to, _from, saved) {
        if (saved) return saved
        if (to.hash && !to.hash.startsWith('#pnx=')) return { el: to.hash }
        return { top: 0 }
    }
} satisfies RouterConfig
