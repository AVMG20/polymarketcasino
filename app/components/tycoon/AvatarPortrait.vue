<script setup lang="ts">
import type { AvatarLook } from '#shared/cosmetics'
import { FIGURE_FOOT, FIGURE_H, FIGURE_W, avatarLook, drawFigure, type Frame, type Pose } from '~/utils/floor/art/characters'

/**
 * A player's chibi figure with their avatar cosmetics, drawn with the
 * floor's own art (no Pixi): `bust` for a portrait in a list or a seat,
 * `full` for the whole figure. `animate` turns it around and struts now and
 * then (the wardrobe preview); reduced motion keeps it still.
 *
 * Usable anywhere a player is shown (leaderboard, visits, live table seats):
 * `<TycoonAvatarPortrait :name="name" :avatar="avatar" :size="40" />`.
 */
const props = withDefaults(defineProps<{
    name: string
    avatar?: AvatarLook | null
    /** Box size in CSS px (height for `full`; width follows). */
    size?: number
    /** `bust` the head (and hat), `upper` head and torso (outfits, chains), `full` the whole figure. */
    crop?: 'bust' | 'upper' | 'full'
    animate?: boolean
}>(), { avatar: null, size: 40, crop: 'bust', animate: false })

const canvas = ref<HTMLCanvasElement | null>(null)
const look = computed(() => avatarLook(props.name || 'player', props.avatar))

/**
 * Where the top of a bust starts (figure px): the head sits at y 24-46 and
 * the hair tops out near 21; each hat reaches higher. A bust is cropped from
 * there to the shoulders (y 52), so a bare head fills a round frame and a
 * tall hat zooms out just as far as it needs.
 */
const BUST_TOP: Record<string, number> = { none: 19.5, cap: 19, hardhat: 18, beanie: 15, crown: 13, cowboy: 13, tophat: 8, party: 8 }
const BUST_BOTTOM = 52

// The part of the figure canvas each crop shows (figure px).
const view = computed(() => {
    if (props.crop === 'bust') {
        const { hat, style } = look.value
        // A bun or spikes stick up past a bare head (or a cap).
        const hair = (hat === 'none' || hat === 'cap') && (style === 'bun' || style === 'spiky') ? 15.5 : 99
        const top = Math.min(hair, BUST_TOP[hat] ?? 8)
        const side = BUST_BOTTOM - top
        return { x: 20.5 - side / 2, y: top, w: side, h: side }
    }
    return props.crop === 'upper'
        ? { x: -4, y: 17, w: 48, h: 48 }
        : { x: 0, y: 0, w: FIGURE_W, h: FIGURE_H }
})
const box = computed(() => ({ w: Math.round(props.size * view.value.w / view.value.h), h: props.size }))

let raf = 0
let started = 0
let reduced = false

function draw(pose: Pose = 'front', frame: Frame = 0, flip = false, bob = 0) {
    const el = canvas.value
    if (!el) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const w = Math.round(box.value.w * dpr)
    const h = Math.round(box.value.h * dpr)
    if (el.width !== w) el.width = w
    if (el.height !== h) el.height = h
    const ctx = el.getContext('2d')
    if (!ctx) return
    const v = view.value
    const k = w / v.w
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.setTransform(flip ? -k : k, 0, 0, k, flip ? w + v.x * k : -v.x * k, (-v.y - bob) * k)
    drawFigure(ctx, FIGURE_FOOT.x, FIGURE_FOOT.y, look.value, pose, frame, 1)
}

/** The preview's little routine: face right, strut, face left, show the back. */
function loop(t: number) {
    const s = ((t - started) / 1000) % 5.2
    if (s < 1.3) draw('front', 0, false, Math.abs(Math.sin(s * 2.4)) * 0.8)
    else if (s < 2.6) draw('front', Math.floor(s * 6) % 2 ? 1 : 2, false, Math.abs(Math.sin(s * Math.PI * 3)) * 1.6)
    else if (s < 3.9) draw('front', 0, true, Math.abs(Math.sin(s * 2.4)) * 0.8)
    else draw('back', 0, s > 4.55)
    raf = requestAnimationFrame(loop)
}

function restart() {
    cancelAnimationFrame(raf)
    raf = 0
    if (props.animate && !reduced) {
        started = performance.now()
        raf = requestAnimationFrame(loop)
    } else {
        draw()
    }
}

watch([look, () => props.size, () => props.crop, () => props.animate], () => restart())

onMounted(() => {
    reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    restart()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <canvas ref="canvas" class="block shrink-0" :style="{ width: `${box.w}px`, height: `${box.h}px` }" :aria-label="`${name}'s avatar`" role="img" />
</template>
