<script setup lang="ts">
/**
 * The table surface every DOM table shares: felt, rail and gold arcs in a
 * fixed coordinate space (1720 wide) that scales to the width it is given.
 * Games position their furniture in those coordinates directly, so a chip, a
 * card and a label all scale by the same factor as the felt.
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
}>(), { width: 1720, height: 980, felt: true, tone: 'green', title: undefined, titleY: 470 })

const wrap = ref<HTMLElement | null>(null)
const scale = ref(0)

// scale() needs a unitless ratio and calc() cannot divide a length by a
// length, so the fit factor comes from measurement.
let observer: ResizeObserver | null = null
onMounted(() => {
    if (!wrap.value) return
    observer = new ResizeObserver(([entry]) => {
        const width = entry?.contentRect.width ?? 0
        if (width > 0) scale.value = width / props.width
    })
    observer.observe(wrap.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="wrap" class="lt-stage-wrap" :style="{ aspectRatio: `${width} / ${height}` }">
    <div class="lt-stage" :class="`felt-${tone}`" :style="{ width: `${width}px`, height: `${height}px`, '--lt-scale': scale, visibility: scale ? 'visible' : 'hidden' }">
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
