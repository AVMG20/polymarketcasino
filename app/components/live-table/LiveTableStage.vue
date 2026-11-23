<script setup lang="ts">
/**
 * The table surface every table shares: felt, rail and gold arcs in a fixed
 * coordinate space (1720 wide) that scales to the width it is given. Games
 * position their furniture in those coordinates directly, so a chip, a card
 * and a label all scale by the same factor as the felt.
 *
 * On a phone the whole table would render at a fifth of its size, so once you
 * sit (`focus` is your seat's x) the stage becomes a camera: it frames the
 * middle two thirds of the felt between the dealer and your seat, half again
 * as big, and glides there when you change seats.
 */
const props = withDefaults(defineProps<{
    width?: number
    height?: number
    felt?: boolean
    /** The felt's colour. */
    tone?: 'green' | 'red' | 'blue' | 'teal'
    /** The game's name, printed into the felt at `titleY`. */
    title?: string
    titleY?: number
    /** Your seat's x on a narrow screen: the camera frames it with the dealer. */
    focus?: number | null
    /** How much of the felt's width and height the camera frames, and from how far down. */
    camera?: { span: number, tall: number, top: number }
}>(), { width: 1720, height: 980, felt: true, tone: 'green', title: undefined, titleY: 470, focus: null, camera: () => ({ span: 0.675, tall: 0.88, top: 0.07 }) })

const wrap = ref<HTMLElement | null>(null)
const wrapWidth = ref(0)

/** Below this width (CSS px) the full table is too small to read. */
const CAMERA_BELOW = 640

const view = computed(() => {
    const camera = props.focus !== null && wrapWidth.value > 0 && wrapWidth.value < CAMERA_BELOW
    if (!camera) return { camera, w: props.width, h: props.height, x: 0, y: 0 }
    const w = Math.round(props.width * props.camera.span)
    const h = Math.round(props.height * props.camera.tall)
    // Halfway between your seat and the dealer, kept inside the rail.
    const centre = (props.focus! + props.width / 2) / 2
    const x = Math.round(Math.min(props.width - w, Math.max(0, centre - w / 2)))
    return { camera, w, h, x, y: Math.round(props.height * props.camera.top) }
})
const scale = computed(() => (wrapWidth.value > 0 ? wrapWidth.value / view.value.w : 0))

// scale() needs a unitless ratio and calc() cannot divide a length by a
// length, so the fit factor comes from measurement.
let observer: ResizeObserver | null = null
onMounted(() => {
    if (!wrap.value) return
    observer = new ResizeObserver(([entry]) => {
        const width = entry?.contentRect.width ?? 0
        if (width > 0) wrapWidth.value = width
    })
    observer.observe(wrap.value)
})
onBeforeUnmount(() => observer?.disconnect())

const stageStyle = computed(() => ({
    width: `${props.width}px`,
    height: `${props.height}px`,
    transform: `translate(${-view.value.x * scale.value}px, ${-view.value.y * scale.value}px) scale(${scale.value})`,
    visibility: scale.value ? 'visible' as const : 'hidden' as const
}))
</script>

<template>
  <div ref="wrap" class="lt-stage-wrap" :class="{ 'lt-camera': view.camera }" :style="{ aspectRatio: `${view.w} / ${view.h}` }">
    <div class="lt-stage" :class="`felt-${tone}`" :style="stageStyle">
      <template v-if="felt">
        <div class="lt-felt">
          <div class="lt-felt-inner" />
        </div>
        <div class="lt-arc" />
        <div class="lt-arc inner" />
        <div v-if="title" class="lt-print" :style="{ top: `${titleY}px` }">{{ title }}</div>
      </template>
      <slot :scale="scale" />
    </div>
  </div>
</template>
