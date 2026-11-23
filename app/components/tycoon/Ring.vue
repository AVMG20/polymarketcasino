<script setup lang="ts">
/** A circular progress ring with something in the middle (an icon, a cover). */
const props = withDefaults(defineProps<{ progress: number, size?: number, stroke?: number, color?: string }>(), { size: 56, stroke: 5, color: '#ffc93a' })
const radius = computed(() => (props.size - props.stroke) / 2)
const length = computed(() => 2 * Math.PI * radius.value)
const offset = computed(() => length.value * (1 - Math.max(0, Math.min(1, props.progress))))
</script>

<template>
  <span class="relative inline-grid shrink-0 place-items-center" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" class="absolute inset-0 -rotate-90" aria-hidden="true">
      <circle :cx="size / 2" :cy="size / 2" :r="radius" fill="none" stroke="rgb(0 0 0 / 0.55)" :stroke-width="stroke" />
      <circle :cx="size / 2" :cy="size / 2" :r="radius" fill="none" :stroke="color" :stroke-width="stroke" stroke-linecap="round" :stroke-dasharray="length" :stroke-dashoffset="offset" class="transition-[stroke-dashoffset] duration-300 ease-linear" />
    </svg>
    <slot />
  </span>
</template>
