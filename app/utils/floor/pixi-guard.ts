type Pixi = typeof import('pixi.js')

/**
 * Pixi keeps some pools process-wide (batches, pooled render textures, text
 * canvases). `app.destroy(true)` on any Application calls
 * `GlobalResourceRegistry.release()`, which destroys everything in those
 * pools, including stale pool slots that still point at batches another live
 * renderer is drawing with. Closing a Pixi slot while the floor is mounted
 * then breaks the floor's next render ("reading 'ids' of null") and the floor
 * stays black. While a floor is alive, a global release is skipped: the pools
 * are reused anyway, and the floor frees its own resources on unmount.
 */
let holders = 0
let original: (() => void) | null = null

export function holdGlobalPixiResources(PIXI: Pixi): () => void {
    const registry = PIXI.GlobalResourceRegistry
    if (!registry) return () => {}
    if (holders++ === 0) {
        original = registry.release
        registry.release = () => {}
    }
    let released = false
    return () => {
        if (released) return
        released = true
        if (--holders === 0 && original) {
            registry.release = original
            original = null
        }
    }
}
