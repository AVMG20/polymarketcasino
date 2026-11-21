<script setup lang="ts">
import { chip, chipsFor } from '~/utils/live-table/art'

/**
 * Chips crossing the felt, in stage coordinates: the house paying a winner,
 * a lost bet swept back to the house. Each chip arcs over on its own beat.
 * Presentation only; call `fly()` through a template ref.
 */
interface Flight { id: number, value: number, x: number, y: number, dx: number, dy: number, delay: number, size: number }
interface Point { x: number, y: number }

const flights = ref<Flight[]>([])
let seq = 0
const DURATION = 720

function fly(from: Point, to: Point, amount: number, options: { delay?: number, size?: number, max?: number } = {}) {
    if (amount <= 0 || (typeof document !== 'undefined' && document.hidden)) return
    const size = options.size ?? 56
    chipsFor(amount, options.max ?? 6).forEach((c, i) => {
        flights.value.push({
            id: ++seq,
            value: c.value,
            x: from.x - size / 2,
            y: from.y - size / 2 - i * 8,
            dx: to.x - from.x + (i % 2 ? 4 : -4),
            dy: to.y - from.y,
            delay: (options.delay ?? 0) + i * 90,
            size
        })
    })
}

function launch(el: Element | null, flight: Flight) {
    if (!(el instanceof HTMLElement) || el.dataset.flown) return
    el.dataset.flown = '1'
    const frames: Keyframe[] = []
    for (let step = 0; step <= 10; step++) {
        const t = step / 10
        const lift = Math.sin(t * Math.PI) * 74
        frames.push({ transform: `translate(${flight.dx * t}px, ${flight.dy * t - lift}px) rotate(${t * 80}deg)`, opacity: t === 1 ? 0.9 : 1 })
    }
    const animation = el.animate(frames, { duration: DURATION, delay: flight.delay, easing: 'ease-in-out', fill: 'both' })
    animation.onfinish = () => {
        flights.value = flights.value.filter(f => f.id !== flight.id)
    }
}

defineExpose({ fly })
</script>

<template>
  <span
    v-for="f in flights"
    :key="f.id"
    :ref="el => launch(el as Element | null, f)"
    class="lt-flight"
    :style="{ left: `${f.x}px`, top: `${f.y}px`, width: `${f.size}px`, height: `${f.size}px` }"
    v-html="chip(f.value)"
  />
</template>
