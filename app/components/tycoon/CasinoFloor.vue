<script setup lang="ts">
import '@fontsource/lilita-one/400.css'
import '@fontsource/fredoka/600.css'
import { GAMES } from '#shared/games/registry'
import type { FloorEngine, FloorView } from '~/utils/floor/engine'
import { holdGlobalPixiResources } from '~/utils/floor/pixi-guard'
import type { FloorApi, FloorScene, FloorTarget } from '~/utils/floor/types'
import { safeDestroy } from '~/utils/slot-pixi'

/**
 * The isometric casino floor (PixiJS). The page hands it a FloorScene and
 * listens for `interact`; everything that moves runs inside the engine's
 * ticker, never through Vue reactivity.
 *
 * The floor survives a lost WebGL context (browsers cap live contexts, and
 * every slot opens its own) and a render that throws: it rebuilds the Pixi
 * app and engine, keeping the camera and avatar where they were, as soon as
 * it is on screen again.
 */
const props = defineProps<{
    scene: FloorScene
    paused?: boolean
}>()

const emit = defineEmits<{
    interact: [target: FloorTarget]
    ready: []
    /** WebGL could not start (or keeps failing): the page shows a fallback. */
    error: [error: unknown]
}>()

type Pixi = typeof import('pixi.js')

const host = ref<HTMLDivElement | null>(null)
let PIXI: Pixi | null = null
let EngineClass: typeof FloorEngine | null = null
let app: import('pixi.js').Application | null = null
let engine: FloorEngine | null = null
let canvas: HTMLCanvasElement | null = null
let observer: ResizeObserver | null = null
let destroyed = false
let booting = false
/** The WebGL context went away or a render threw: rebuild once the floor is visible and unpaused. */
let contextLost = false
let rebuildTimer: ReturnType<typeof setTimeout> | null = null
/** Recent rebuilds, to give up (and show the page's fallback) if the floor keeps breaking. */
let rebuilds: number[] = []
let releasePixi: (() => void) | null = null

function hidden(): boolean {
    return !!props.paused || document.hidden
}

function syncPaused() {
    if (contextLost || isLost() || engine?.broken) {
        contextLost = true
        scheduleRebuild(0)
        return
    }
    engine?.setPaused(hidden())
}

function isLost(): boolean {
    const gl = (app?.renderer as { gl?: WebGLRenderingContext } | undefined)?.gl
    return !!gl && gl.isContextLost()
}

watch(() => props.scene, (scene) => {
    if (scene) engine?.setScene(scene)
})
// The page updates the cage in place between scene rebuilds.
watch(() => [props.scene?.cage?.fill, props.scene?.cage?.stored] as const, ([fill, stored]) => {
    if (fill !== undefined && stored !== undefined) engine?.setCage(fill, stored)
})
watch(() => props.paused, syncPaused)

function onContextLost(e: Event) {
    e.preventDefault()
    console.warn('[floor] WebGL context lost')
    contextLost = true
    engine?.setPaused(true)
    // Give the browser a moment to restore it; rebuild either way.
    scheduleRebuild(800)
}

function onContextRestored() {
    console.info('[floor] WebGL context restored')
    contextLost = true
    scheduleRebuild(0)
}

function scheduleRebuild(delay: number) {
    if (destroyed || rebuildTimer) return
    rebuildTimer = setTimeout(() => {
        rebuildTimer = null
        // Wait until the floor is on screen: a new context now could knock out the open game's.
        if (destroyed || !contextLost || hidden()) return
        void rebuild()
    }, delay)
}

function onRenderError() {
    // The engine logged the error; a fresh renderer is the only reliable way back.
    contextLost = true
    scheduleRebuild(0)
}

async function rebuild() {
    if (booting) return
    const now = Date.now()
    rebuilds = rebuilds.filter(t => now - t < 30_000)
    rebuilds.push(now)
    const resume = engine?.view() ?? null
    teardown()
    contextLost = false
    if (rebuilds.length > 3) {
        const err = new Error('The floor keeps failing to render')
        console.error('[floor]', err)
        emit('error', err)
        return
    }
    await boot(resume)
}

function measure(): { w: number, h: number } | null {
    const el = host.value
    if (!el) return null
    const w = el.clientWidth
    const h = el.clientHeight
    // Hidden (display: none) or collapsed: never size the renderer to nothing.
    if (w < 2 || h < 2) return null
    return { w, h }
}

function onResize() {
    if (!app || !engine) return
    const size = measure()
    if (!size) return
    if (app.renderer.width === size.w && app.renderer.height === size.h) return
    app.renderer.resize(size.w, size.h)
    engine.resize(size.w, size.h)
    // Resizing clears the canvas; with the ticker stopped nothing would draw it again.
    engine.redraw()
}

async function boot(resume: FloorView | null) {
    if (destroyed || !host.value || !PIXI || !EngineClass) return
    booting = true
    const el = host.value
    const size = measure() ?? { w: Math.max(1, el.clientWidth || 360), h: Math.max(1, el.clientHeight || 640) }
    const instance = new PIXI.Application()
    try {
        await instance.init({
            width: size.w,
            height: size.h,
            backgroundAlpha: 0,
            antialias: false,
            autoDensity: true,
            // Never below native resolution on dpr 1, capped at 2 on Retina.
            resolution: Math.min(Math.max(window.devicePixelRatio || 1, 1), 2),
            preference: 'webgl'
        })
    } catch (err) {
        booting = false
        console.error('[floor] could not start the renderer', err)
        safeDestroy(() => instance.destroy({ removeView: true }))
        if (!destroyed) emit('error', err)
        return
    }
    if (destroyed) {
        booting = false
        safeDestroy(() => instance.destroy({ removeView: true }))
        return
    }
    app = instance
    canvas = app.canvas
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.style.outline = 'none'
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    el.appendChild(canvas)

    try {
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
        engine = new EngineClass({
            PIXI,
            app,
            input: canvas,
            reducedMotion,
            names: Object.fromEntries(GAMES.map(g => [g.slug, g.name])),
            onInteract: target => emit('interact', target),
            onRenderError,
            resume
        })
        engine.setScene(props.scene)
        // Dev only: poke the engine from the console (picking, context loss).
        if (import.meta.dev) (window as unknown as { __floor?: FloorEngine }).__floor = engine
    } catch (err) {
        booting = false
        console.error('[floor] could not build the floor', err)
        teardown()
        if (!destroyed) emit('error', err)
        return
    }
    booting = false
    syncPaused()
    engine.redraw()
    emit('ready')
}

function teardown() {
    if (rebuildTimer) {
        clearTimeout(rebuildTimer)
        rebuildTimer = null
    }
    const e = engine
    engine = null
    if (e) safeDestroy(() => e.destroy())
    if (canvas) {
        canvas.removeEventListener('webglcontextlost', onContextLost)
        canvas.removeEventListener('webglcontextrestored', onContextRestored)
        canvas.remove()
        canvas = null
    }
    const instance = app
    app = null
    // Not destroy(true): that also releases Pixi's global pools, which other live renderers use.
    if (instance) safeDestroy(() => instance.destroy({ removeView: true }, { children: true, texture: true }))
}

onMounted(async () => {
    try {
        const [pixi, mod] = await Promise.all([import('pixi.js'), import('~/utils/floor/engine')])
        PIXI = pixi
        EngineClass = mod.FloorEngine
        if (!destroyed) releasePixi = holdGlobalPixiResources(pixi)
    } catch (err) {
        console.error('[floor] could not load the renderer', err)
        if (!destroyed) emit('error', err)
        return
    }
    // Baked signs use the display fonts: wait for them so the first bake has them.
    await Promise.all([
        document.fonts.load('16px "Lilita One"'),
        document.fonts.load('600 12px "Fredoka"')
    ]).catch(() => {})
    if (destroyed || !host.value) return
    await boot(null)
    if (destroyed || !host.value) return
    observer = new ResizeObserver(onResize)
    observer.observe(host.value)
    document.addEventListener('visibilitychange', syncPaused)
})

onBeforeUnmount(() => {
    destroyed = true
    observer?.disconnect()
    observer = null
    document.removeEventListener('visibilitychange', syncPaused)
    teardown()
    releasePixi?.()
    releasePixi = null
})

const api: FloorApi = {
    walkTo: target => engine?.walkTo(target),
    teleportTo: (target, poof) => engine?.teleportTo(target, poof),
    focus: (target, options) => engine?.focus(target, options),
    celebrate: (slug, info) => engine?.celebrate(slug, info),
    playing: (slug, on) => engine?.playing(slug, on),
    collected: (amount, options) => {
        // The target comes in viewport pixels; the engine draws in the host's.
        const box = host.value?.getBoundingClientRect()
        const to = options?.to && box ? { x: options.to.x - box.left, y: options.to.y - box.top } : undefined
        engine?.collected(amount, { currency: options?.currency, to })
    }
}

defineExpose(api)
</script>

<template>
  <div ref="host" class="relative size-full touch-none select-none overflow-hidden" />
</template>
