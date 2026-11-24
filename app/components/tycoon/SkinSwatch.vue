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

const f = (n: number) => n.toFixed(2)
/** A point on the swatch's floor: u toward the right corner, v toward the left one (0..1). */
const fp = (u: number, v: number): [number, number] => [32 + 30 * u - 30 * v, 25 + 15 * u + 15 * v]
const fl = (u: number, v: number) => fp(u, v).map(f).join(' ')
/** A point on a back wall: t along it (0 at the outer end of the left wall, 2 at the right end), z up (1 = the trim line). */
const wp = (t: number, z: number): [number, number] => (t <= 1 ? [2 + 30 * t, 40 - 15 * t - 19 * z] : [32 + 30 * (t - 1), 25 + 15 * (t - 1) - 19 * z])
const wl = (t: number, z: number) => wp(t, z).map(f).join(' ')
/** A four-point glint, s from the middle to a tip. */
const glint = (x: number, y: number, s: number) => `M${f(x)} ${f(y - s)}Q${f(x)} ${f(y)} ${f(x + s)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y + s)}Q${f(x)} ${f(y)} ${f(x - s)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y - s)}Z`

/**
 * The premium finishes (palette Finish) as the floor and walls paint them:
 * the stone's veins, the inlay grid, glints or stars, and the walls' pattern.
 * Fixed positions, so a swatch looks the same every time.
 */
const extra = computed(() => {
    const st = style.value
    if (!st.finish) return null
    const grid = (n: number) => {
        const lines: string[] = []
        for (let k = 1; k < n; k++) lines.push(`M${fl(k / n, 0)}L${fl(k / n, 1)}`, `M${fl(0, k / n)}L${fl(1, k / n)}`)
        return lines.join('')
    }
    const veins = `M${fl(0, 0.3)}Q${fl(0.3, 0.2)} ${fl(0.45, 0.55)}T${fl(1, 0.75)}M${fl(0.15, 1)}Q${fl(0.4, 0.75)} ${fl(0.7, 0.9)}M${fl(0.55, 0)}Q${fl(0.65, 0.3)} ${fl(0.95, 0.35)}`
    const glints = ([[0.2, 0.15, 2.4], [0.82, 0.3, 2], [0.7, 0.85, 2.6], [0.12, 0.7, 1.8]] as const).map(([u, v, s]) => glint(...fp(u, v), s)).join('')
    const studs = [0.25, 0.5, 0.75].flatMap(u => [0.25, 0.5, 0.75].map(v => fp(u, v)))
    const stars = ([[0.1, 0.2], [0.3, 0.05], [0.4, 0.3], [0.6, 0.12], [0.9, 0.2], [0.85, 0.55], [0.72, 0.95], [0.2, 0.9], [0.05, 0.5], [0.95, 0.85], [0.5, 0.95], [0.35, 0.7]] as const).map(([u, v]) => fp(u, v))
    const wallStars = ([[0.15, 0.3], [0.4, 0.7], [0.7, 0.25], [0.9, 0.6], [1.2, 0.45], [1.45, 0.75], [1.65, 0.2], [1.85, 0.55]] as const).map(([t, z]) => wp(t, z))
    // Harlequin diagonals on the walls.
    const harlequin: string[] = []
    for (let k = -1; k <= 4; k++) {
        harlequin.push(`M${wl(k * 0.5, 0)}L${wl(k * 0.5 + 0.5, 1)}`, `M${wl(k * 0.5 + 0.5, 0)}L${wl(k * 0.5, 1)}`)
    }
    const icicles = [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5, 1.7, 1.9].map((t, i) => `M${wl(t - 0.06, 1)}L${wl(t + 0.06, 1)}L${wl(t, i % 2 ? 0.86 : 0.78)}Z`).join('')
    const bulbs = [0.2, 0.5, 0.8, 1.2, 1.5, 1.8].map(t => wp(t, 0.9))
    const panels = [0.5, 1.5].map(t => `M${wl(t - 0.32, 0.12)}L${wl(t + 0.32, 0.12)}L${wl(t + 0.32, 0.82)}L${wl(t - 0.32, 0.82)}Z`).join('')
    return { finish: st.finish, grid4: grid(4), grid2: grid(2), veins, glints, studs, stars, wallStars, harlequin: harlequin.join(''), icicles, bulbs, panels }
})

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
      <linearGradient :id="`${uid}-ice`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.55" />
        <stop offset="0.6" stop-color="#fff" stop-opacity="0" />
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
    <!-- Premium finishes: the floor's stone or stars, and the walls' pattern -->
    <template v-if="extra">
      <clipPath :id="`${uid}-fc`"><polygon points="32,25 62,40 32,55 2,40" /></clipPath>
      <clipPath :id="`${uid}-wc`"><polygon points="2,40 32,25 32,3 2,18" /><polygon points="32,25 62,40 62,18 32,3" /></clipPath>
      <g :clip-path="`url(#${uid}-fc)`">
        <template v-if="extra.finish === 'ice'">
          <polygon points="32,25 62,40 32,55 2,40" :fill="`url(#${uid}-ice)`" />
          <path :d="extra.veins" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="0.7" />
          <path :d="extra.grid2" stroke="#fff" stroke-opacity="0.9" stroke-width="0.6" />
          <path :d="extra.glints" fill="#fff" />
        </template>
        <template v-else-if="extra.finish === 'gold'">
          <path :d="extra.veins" fill="none" :stroke="style.vein" stroke-opacity="0.55" stroke-width="0.6" />
          <path :d="extra.grid4" :stroke="style.pattern" stroke-opacity="0.85" stroke-width="0.6" />
          <path :d="extra.glints" fill="#fff6d5" />
        </template>
        <template v-else-if="extra.finish === 'jade'">
          <path :d="extra.veins" fill="none" :stroke="style.vein" stroke-opacity="0.5" stroke-width="0.6" />
          <path :d="extra.grid4" stroke="#0d3a26" stroke-opacity="0.5" stroke-width="0.5" />
          <rect v-for="([x, y], i) in extra.studs" :key="i" :x="x - 1" :y="y - 1" width="2" height="2" :fill="style.pattern" />
        </template>
        <template v-else>
          <ellipse cx="20" cy="36" rx="14" ry="7" fill="#b04ad8" fill-opacity="0.35" />
          <ellipse cx="46" cy="46" rx="13" ry="6" fill="#3f8fe0" fill-opacity="0.32" />
          <circle v-for="([x, y], i) in extra.stars" :key="i" :cx="x" :cy="y" :r="i % 3 ? 0.45 : 0.7" fill="#fff" :fill-opacity="i % 2 ? 0.7 : 0.95" />
          <path :d="extra.glints" fill="#e7efff" />
        </template>
      </g>
      <g :clip-path="`url(#${uid}-wc)`">
        <template v-if="extra.finish === 'ice'">
          <polygon points="2,40 32,25 32,3 2,18" fill="#fff" fill-opacity="0.12" />
          <path :d="extra.icicles" :fill="style.trim" />
        </template>
        <template v-else-if="extra.finish === 'gold'">
          <path :d="extra.harlequin" :stroke="style.pattern" stroke-opacity="0.5" stroke-width="0.6" />
          <circle v-for="([x, y], i) in extra.bulbs" :key="i" :cx="x" :cy="y" r="1.1" fill="#fff3c4" />
        </template>
        <path v-else-if="extra.finish === 'jade'" :d="extra.panels" fill="none" :stroke="style.pattern" stroke-opacity="0.7" stroke-width="0.7" />
        <template v-else>
          <circle v-for="([x, y], i) in extra.wallStars" :key="i" :cx="x" :cy="y" :r="i % 3 ? 0.45 : 0.7" fill="#fff" fill-opacity="0.85" />
        </template>
      </g>
    </template>
    <!-- The skin's emblem: the floor's motif on a medallion, stood up so it reads at a glance -->
    <template v-if="motif">
      <ellipse v-if="extra" cx="32" cy="41" rx="20" ry="10" fill="none" :stroke="style.pattern" stroke-width="0.7" stroke-dasharray="1 1.6" />
      <ellipse cx="32" cy="41" rx="17" ry="8.5" :fill="style.medal ?? `color-mix(in oklab, ${style.floor} 65%, black)`" :fill-opacity="extra ? 0.95 : 0.75" :stroke="style.pattern" :stroke-width="extra ? 1.6 : 1.2" />
      <path :d="motif" transform="translate(32 37) scale(1.05)" :fill="style.emblem ?? style.pattern" stroke="#1b1329" stroke-width="1.6" stroke-linejoin="round" paint-order="stroke" />
    </template>
  </svg>
</template>
