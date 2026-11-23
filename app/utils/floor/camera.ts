import type { Container } from 'pixi.js'

/**
 * The floor camera: a world point at the centre of the view and a zoom.
 * Drag pans with inertia, the wheel and pinch zoom around the pointer, and
 * the view stays over the owned part of the building.
 */
export class Camera {
    x = 0
    y = 0
    zoom = 1
    minZoom = 0.45
    maxZoom = 1.9
    viewW = 1
    viewH = 1
    bounds = { minX: -500, minY: -300, maxX: 500, maxY: 300 }
    private vx = 0
    private vy = 0
    private tween: { fromX: number, fromY: number, toX: number, toY: number, fromZ: number, toZ: number, t: number, dur: number } | null = null
    /** Last time the user moved the camera themselves (performance.now()). */
    lastManual = -Infinity
    /**
     * Extra room past the edges (world units) while a panel covers part of the view, so
     * a zone framed beside it can sit in the visible part instead of being clamped under it.
     */
    slack = { x: 0, y: 0 }

    constructor(private readonly reducedMotion: boolean) {}

    apply(world: Container) {
        world.scale.set(this.zoom)
        world.position.set(Math.round(this.viewW / 2 - this.x * this.zoom), Math.round(this.viewH / 2 - this.y * this.zoom))
    }

    screenToWorld(sx: number, sy: number): { x: number, y: number } {
        return { x: (sx - this.viewW / 2) / this.zoom + this.x, y: (sy - this.viewH / 2) / this.zoom + this.y }
    }

    worldToScreen(wx: number, wy: number): { x: number, y: number } {
        return { x: (wx - this.x) * this.zoom + this.viewW / 2, y: (wy - this.y) * this.zoom + this.viewH / 2 }
    }

    resize(w: number, h: number) {
        this.viewW = Math.max(1, w)
        this.viewH = Math.max(1, h)
        this.clamp()
    }

    setBounds(b: { minX: number, minY: number, maxX: number, maxY: number }) {
        this.bounds = b
        // Never zoom out past the whole owned area (with some air around it).
        const fit = Math.min(this.viewW / (b.maxX - b.minX), this.viewH / (b.maxY - b.minY))
        this.minZoom = Math.max(0.3, Math.min(0.75, fit * 0.9))
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom))
        this.clamp()
    }

    /** A comfortable zoom to show a world-space box. */
    fitZoom(w: number, h: number): number {
        return Math.max(this.minZoom, Math.min(1.35, Math.min(this.viewW / w, this.viewH / h)))
    }

    clamp() {
        const b = this.bounds
        const halfW = this.viewW / 2 / this.zoom
        const halfH = this.viewH / 2 / this.zoom
        // Let the view reach a bit past the edges, but never lose the floor.
        // A tall phone view is far taller than the floor's front edge allows: give it more
        // slack, or the backroom (at the front) gets pushed to the bottom of the screen.
        const padX = Math.min(halfW * 0.6, 160) + this.slack.x
        const padY = Math.min(halfH * 0.6, Math.max(140, halfH - 200)) + this.slack.y
        const minX = b.minX + halfW - padX
        const maxX = b.maxX - halfW + padX
        const minY = b.minY + halfH - padY
        const maxY = b.maxY - halfH + padY
        this.x = minX > maxX ? (b.minX + b.maxX) / 2 : Math.max(minX, Math.min(maxX, this.x))
        this.y = minY > maxY ? (b.minY + b.maxY) / 2 : Math.max(minY, Math.min(maxY, this.y))
    }

    panBy(dsx: number, dsy: number) {
        this.tween = null
        this.x -= dsx / this.zoom
        this.y -= dsy / this.zoom
        this.lastManual = performance.now()
        this.clamp()
    }

    zoomAt(sx: number, sy: number, factor: number) {
        this.tween = null
        const before = this.screenToWorld(sx, sy)
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor))
        this.x = before.x - (sx - this.viewW / 2) / this.zoom
        this.y = before.y - (sy - this.viewH / 2) / this.zoom
        this.lastManual = performance.now()
        this.clamp()
    }

    fling(vx: number, vy: number) {
        if (this.reducedMotion) return
        this.vx = vx
        this.vy = vy
    }

    stopFling() {
        this.vx = 0
        this.vy = 0
    }

    /** Glide to a world point (and optionally a zoom). */
    glideTo(x: number, y: number, zoom = this.zoom, dur = 0.7) {
        this.stopFling()
        const z = Math.max(this.minZoom, Math.min(this.maxZoom, zoom))
        if (this.reducedMotion) dur = 0.01
        this.tween = { fromX: this.x, fromY: this.y, toX: x, toY: y, fromZ: this.zoom, toZ: z, t: 0, dur }
    }

    /** Snap without animation. */
    jumpTo(x: number, y: number, zoom = this.zoom) {
        this.tween = null
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom))
        this.x = x
        this.y = y
        this.clamp()
    }

    /** Soft follow of a world point (the avatar), unless the user just moved the view. */
    follow(x: number, y: number, dt: number) {
        if (this.tween || performance.now() - this.lastManual < 2500) return
        // Only nudge when the point drifts out of the middle of the view.
        const sx = (x - this.x) * this.zoom
        const sy = (y - this.y) * this.zoom
        const dzX = this.viewW * 0.18
        const dzY = this.viewH * 0.16
        const k = 1 - Math.exp(-dt * 3)
        if (Math.abs(sx) > dzX) this.x += ((Math.abs(sx) - dzX) * Math.sign(sx) / this.zoom) * k
        if (Math.abs(sy) > dzY) this.y += ((Math.abs(sy) - dzY) * Math.sign(sy) / this.zoom) * k
        this.clamp()
    }

    update(dt: number): boolean {
        let moved = false
        if (this.tween) {
            const tw = this.tween
            tw.t = Math.min(tw.dur, tw.t + dt)
            const k = tw.t / tw.dur
            const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
            this.x = tw.fromX + (tw.toX - tw.fromX) * e
            this.y = tw.fromY + (tw.toY - tw.fromY) * e
            this.zoom = tw.fromZ + (tw.toZ - tw.fromZ) * e
            if (tw.t >= tw.dur) this.tween = null
            this.clamp()
            moved = true
        }
        if (this.vx || this.vy) {
            this.x -= (this.vx * dt) / this.zoom
            this.y -= (this.vy * dt) / this.zoom
            const decay = Math.exp(-dt * 5)
            this.vx *= decay
            this.vy *= decay
            if (Math.hypot(this.vx, this.vy) < 8) this.stopFling()
            this.clamp()
            moved = true
        }
        return moved
    }
}

export interface InputHandlers {
    /** A tap or click; `touch` for fingers and pens (a little slop around small targets). */
    tap: (sx: number, sy: number, touch: boolean) => void
    /** The mouse rests over (sx, sy): highlight what a click would hit; true when that is a target. */
    hover: (sx: number, sy: number) => boolean
    /** The mouse left, or a drag started: drop the highlight. */
    hoverEnd: () => void
}

/**
 * Pointer input on the canvas: a tap is a press that barely moved and was
 * short; anything else pans. Two fingers pinch-zoom. A mouse wheel zooms; a
 * trackpad pans with two fingers and zooms with a pinch (ctrl+wheel).
 */
export class FloorInput {
    private pointers = new Map<number, { x: number, y: number }>()
    private start: { x: number, y: number, t: number } | null = null
    private dragging = false
    private pinch: { dist: number, mx: number, my: number } | null = null
    private samples: { x: number, y: number, t: number }[] = []
    /** Until when wheel events count as a trackpad (performance.now()). */
    private trackpadUntil = 0
    private readonly listeners: [string, EventListener, AddEventListenerOptions?][] = []

    constructor(private readonly el: HTMLElement, private readonly camera: Camera, private readonly handlers: InputHandlers) {
        el.style.touchAction = 'none'
        this.on('pointerdown', e => this.down(e as PointerEvent))
        this.on('pointermove', e => this.move(e as PointerEvent))
        this.on('pointerup', e => this.up(e as PointerEvent))
        this.on('pointercancel', e => this.cancel(e as PointerEvent))
        this.on('pointerleave', e => this.leave(e as PointerEvent))
        this.on('wheel', e => this.wheel(e as WheelEvent), { passive: false })
        this.on('contextmenu', e => e.preventDefault())
    }

    private on(type: string, fn: EventListener, opts?: AddEventListenerOptions) {
        this.el.addEventListener(type, fn, opts)
        this.listeners.push([type, fn, opts])
    }

    private local(e: PointerEvent | WheelEvent): { x: number, y: number } {
        const r = this.el.getBoundingClientRect()
        return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    private down(e: PointerEvent) {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        const p = this.local(e)
        try {
            this.el.setPointerCapture(e.pointerId)
        } catch { /* not capturable */ }
        this.pointers.set(e.pointerId, p)
        this.camera.stopFling()
        if (this.pointers.size === 1) {
            this.start = { ...p, t: performance.now() }
            this.dragging = false
            this.samples = [{ ...p, t: performance.now() }]
        } else if (this.pointers.size === 2) {
            const [a, b] = [...this.pointers.values()]
            this.pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 }
            this.start = null
            this.dragging = true
            this.handlers.hoverEnd()
        }
    }

    private move(e: PointerEvent) {
        const p = this.local(e)
        const prev = this.pointers.get(e.pointerId)
        if (!prev) {
            if (e.pointerType === 'mouse') this.el.style.cursor = this.handlers.hover(p.x, p.y) ? 'pointer' : 'default'
            return
        }
        this.pointers.set(e.pointerId, p)
        if (this.pointers.size >= 2 && this.pinch) {
            const [a, b] = [...this.pointers.values()]
            const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
            const mx = (a!.x + b!.x) / 2
            const my = (a!.y + b!.y) / 2
            if (this.pinch.dist > 0) this.camera.zoomAt(mx, my, dist / this.pinch.dist)
            this.camera.panBy(mx - this.pinch.mx, my - this.pinch.my)
            this.pinch = { dist, mx, my }
            return
        }
        if (!this.start) return
        const slop = e.pointerType === 'mouse' ? 5 : 10
        if (!this.dragging && Math.hypot(p.x - this.start.x, p.y - this.start.y) > slop) {
            this.dragging = true
            this.el.style.cursor = 'grabbing'
            this.handlers.hoverEnd()
        }
        if (this.dragging) {
            this.camera.panBy(p.x - prev.x, p.y - prev.y)
            const now = performance.now()
            this.samples.push({ ...p, t: now })
            while (this.samples.length > 2 && now - this.samples[0]!.t > 100) this.samples.shift()
        }
    }

    private up(e: PointerEvent) {
        const p = this.local(e)
        const had = this.pointers.delete(e.pointerId)
        if (!had) return
        if (this.pointers.size > 0) {
            this.regroup()
            return
        }
        if (!this.dragging && this.start && performance.now() - this.start.t < 600) {
            this.handlers.tap(p.x, p.y, e.pointerType !== 'mouse')
        } else if (this.dragging && this.samples.length >= 2) {
            const a = this.samples[0]!
            const b = this.samples[this.samples.length - 1]!
            const dt = (b.t - a.t) / 1000
            if (dt > 0.008 && performance.now() - b.t < 80) this.camera.fling((b.x - a.x) / dt, (b.y - a.y) / dt)
        }
        this.start = null
        this.pinch = null
        this.dragging = false
        this.samples = []
        if (e.pointerType === 'mouse') this.el.style.cursor = this.handlers.hover(p.x, p.y) ? 'pointer' : 'default'
    }

    /**
     * Fingers left after one lifted or was cancelled: one keeps panning from
     * where it is (no tap), two start a fresh pinch.
     */
    private regroup() {
        const rest = [...this.pointers.values()]
        this.samples = []
        this.dragging = true
        if (rest.length === 1) {
            this.start = { ...rest[0]!, t: 0 }
            this.pinch = null
        } else if (rest.length >= 2) {
            const [a, b] = rest
            this.start = null
            this.pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 }
        }
    }

    private cancel(e: PointerEvent) {
        if (!this.pointers.delete(e.pointerId)) return
        if (this.pointers.size) {
            this.regroup()
            return
        }
        this.start = null
        this.pinch = null
        this.dragging = false
        this.samples = []
    }

    private leave(e: PointerEvent) {
        if (e.pointerType === 'mouse' && !this.pointers.size) {
            this.el.style.cursor = ''
            this.handlers.hoverEnd()
        }
    }

    /**
     * Mouse wheels zoom in notches; trackpads send a stream of small (often
     * fractional, often two-axis) deltas: two-finger scroll pans, a pinch
     * arrives as ctrl+wheel and zooms.
     */
    private wheel(e: WheelEvent) {
        e.preventDefault()
        const p = this.local(e)
        const now = performance.now()
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.camera.viewH : 1
        const dx = e.deltaX * scale
        const dy = e.deltaY * scale
        if (e.ctrlKey) {
            // Pinch (or ctrl + mouse wheel): smooth zoom around the pointer.
            this.camera.zoomAt(p.x, p.y, Math.exp(-Math.max(-25, Math.min(25, dy)) * 0.01))
            return
        }
        const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
        const notch = e.deltaMode !== 0
            || (dx === 0 && Math.abs(dy) >= 50 && (legacy === undefined || legacy === 0 || Math.abs(legacy) % 120 === 0))
        const pad = !notch && (dx !== 0 || !Number.isInteger(dy) || Math.abs(dy) < 50)
        if (pad) this.trackpadUntil = now + 400
        if (pad || (!notch && now < this.trackpadUntil)) {
            this.camera.panBy(-dx, -dy)
            return
        }
        this.camera.zoomAt(p.x, p.y, Math.exp(-Math.max(-240, Math.min(240, dy)) * 0.0015))
    }

    /** Update the mouse cursor (the highlight can change under a resting mouse). */
    setCursor(cursor: string) {
        if (this.pointers.size) return
        if (this.el.style.cursor !== cursor) this.el.style.cursor = cursor
    }

    destroy() {
        for (const [type, fn, opts] of this.listeners) this.el.removeEventListener(type, fn, opts)
        this.listeners.length = 0
    }
}
