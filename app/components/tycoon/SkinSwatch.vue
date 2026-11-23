<script setup lang="ts">
import type { SkinId } from '#shared/cosmetics'
import type { ZoneId } from '#shared/tycoon'
import { motifPath } from '~/utils/floor/art/floor'
import { skinStyle, type Motif } from '~/utils/floor/art/palette'

/**
 * A zone skin as a little room corner: its walls, trim, floor and signature
 * motif, drawn with the floor's own motif path so the emblem matches the one
 * the room paints.
 */
const props = defineProps<{ zone: ZoneId, skin: SkinId }>()
const style = computed(() => skinStyle(props.zone, props.skin))
const motif = computed(() => (style.value.motif === 'none' ? '' : svgMotif(style.value.motif)))
const uid = useId()

/** The floor's canvas motif recorded as an SVG path, centred on 0,0 with radius 10. */
function svgMotif(kind: Motif): string {
    const parts: string[] = []
    let open = false
    const f = (n: number) => n.toFixed(2)
    const point = (x: number, y: number) => {
        parts.push(`${open ? 'L' : 'M'}${f(x)} ${f(y)}`)
        open = true
    }
    const arcTo = (cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw: boolean) => {
        const at = (a: number) => [
            cx + rx * Math.cos(a) * Math.cos(rot) - ry * Math.sin(a) * Math.sin(rot),
            cy + rx * Math.cos(a) * Math.sin(rot) + ry * Math.sin(a) * Math.cos(rot)
        ] as const
        let sweep = ccw ? a0 - a1 : a1 - a0
        const full = sweep >= Math.PI * 2 - 1e-6
        sweep = full ? Math.PI * 2 : ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
        const [sx, sy] = at(a0)
        point(sx, sy)
        const deg = (rot * 180) / Math.PI
        // A full turn goes as two halves (one SVG arc can't close on itself).
        const steps = full ? [a0 + (ccw ? -Math.PI : Math.PI), a0 + (ccw ? -2 * Math.PI : 2 * Math.PI)] : [ccw ? a0 - sweep : a0 + sweep]
        for (const end of steps) {
            const [ex, ey] = at(end)
            parts.push(`A${f(rx)} ${f(ry)} ${f(deg)} ${!full && sweep > Math.PI ? 1 : 0} ${ccw ? 0 : 1} ${f(ex)} ${f(ey)}`)
        }
    }
    const recorder = {
        beginPath: () => { open = false },
        moveTo: (x: number, y: number) => {
            parts.push(`M${f(x)} ${f(y)}`)
            open = true
        },
        lineTo: (x: number, y: number) => point(x, y),
        closePath: () => {
            parts.push('Z')
            open = false
        },
        quadraticCurveTo: (qx: number, qy: number, x: number, y: number) => parts.push(`Q${f(qx)} ${f(qy)} ${f(x)} ${f(y)}`),
        arc: (cx: number, cy: number, r: number, a0: number, a1: number, ccw = false) => arcTo(cx, cy, r, r, 0, a0, a1, ccw),
        ellipse: (cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false) => arcTo(cx, cy, rx, ry, rot, a0, a1, ccw)
    }
    motifPath(recorder as unknown as CanvasRenderingContext2D, kind, 0, 0, 10)
    return parts.join('')
}
</script>

<template>
  <svg viewBox="0 0 64 58" class="block size-full" aria-hidden="true">
    <defs>
      <linearGradient :id="`${uid}-l`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :stop-color="style.wall" />
        <stop offset="1" :stop-color="`color-mix(in oklab, ${style.wall} 75%, black)`" />
      </linearGradient>
      <linearGradient :id="`${uid}-f`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.16" />
        <stop offset="1" stop-color="#000" stop-opacity="0.2" />
      </linearGradient>
    </defs>
    <!-- Back walls with their trim and a wainscot -->
    <polygon points="2,40 32,25 32,3 2,18" :fill="`url(#${uid}-l)`" stroke="#1b1329" stroke-width="1.4" stroke-linejoin="round" />
    <polygon points="32,25 62,40 62,18 32,3" :fill="style.wall" stroke="#1b1329" stroke-width="1.4" stroke-linejoin="round" style="filter: brightness(1.12)" />
    <polygon points="2,40 32,25 32,17 2,32" fill="black" opacity="0.14" />
    <polygon points="32,25 62,40 62,32 32,17" fill="black" opacity="0.08" />
    <polyline points="2,21 32,6 62,21" fill="none" :stroke="style.trim" stroke-width="2.4" />
    <polyline points="2,32 32,17 62,32" fill="none" :stroke="style.trim" stroke-width="1.2" opacity="0.8" />
    <path d="M32 3.6 V25" stroke="#fff" stroke-opacity="0.18" stroke-width="1" />
    <!-- Floor: the main colour, a checker of the second one, the pattern's diamond -->
    <polygon points="32,25 62,40 32,55 2,40" :fill="style.floor" stroke="#1b1329" stroke-width="1.4" stroke-linejoin="round" />
    <polygon points="32,25 47,32.5 32,40 17,32.5" :fill="style.floorAlt" />
    <polygon points="32,40 47,47.5 32,55 17,47.5" :fill="style.floorAlt" />
    <polygon points="32,25 62,40 32,55 2,40" :fill="`url(#${uid}-f)`" />
    <polygon points="32,30 52,40 32,50 12,40" fill="none" :stroke="style.pattern" stroke-width="1.2" opacity="0.85" />
    <!-- The skin's emblem: the floor's motif on a medallion, stood up so it reads at a glance -->
    <template v-if="motif">
      <ellipse cx="32" cy="41" rx="17" ry="8.5" :fill="`color-mix(in oklab, ${style.floor} 65%, black)`" fill-opacity="0.75" :stroke="style.pattern" stroke-width="1.2" />
      <path :d="motif" transform="translate(32 37) scale(1.05)" :fill="style.pattern" stroke="#1b1329" stroke-width="1.6" stroke-linejoin="round" paint-order="stroke" />
    </template>
  </svg>
</template>
