// Shared pixi.js Application bootstrap for the bespoke slots (Aethergates,
// Ember Portals, Xeno Slot). Reel building, textures and symbol rendering
// stay in each game; every game creates its Application with the same options
// and guards the same way against unmounting mid-init.
import type { Application } from 'pixi.js'

interface SlotPixiSize {
    width: number
    height: number
}

// `isDestroyed` is checked right after the await because pixi's async init
// can resolve after the component has already unmounted; the caller owns the
// flag since it flips in the same onBeforeUnmount that tears down the rest.
export async function initSlotPixiApp(ApplicationCtor: typeof Application, size: SlotPixiSize, isDestroyed: () => boolean): Promise<Application | null> {
    const app = new ApplicationCtor()
    await app.init({
        width: size.width,
        height: size.height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        // Never below native resolution on dpr 1, capped at 2 on Retina.
        resolution: Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)
    })

    if (isDestroyed()) {
        app.destroy({ removeView: true })
        return null
    }

    return app
}

// pixi objects can already be torn down by HMR or a prior teardown pass.
export function safeDestroy(fn: () => void) {
    try {
        fn()
    } catch { /* already destroyed */ }
}
