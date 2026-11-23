<script setup lang="ts">
/**
 * A construction's progress: a chunky bar with moving hazard stripes and the
 * time left printed inside it. The one way the game UI shows "being built".
 */
const props = withDefaults(defineProps<{ progress: number, leftMs: number, size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })
const width = computed(() => `${Math.max(0.06, Math.min(1, props.progress)) * 100}%`)
</script>

<template>
  <span
    class="bar relative block overflow-hidden rounded-full"
    :class="size === 'sm' ? 'h-5 text-[11px]' : size === 'lg' ? 'h-10 text-xl' : 'h-7 text-sm'"
    role="progressbar"
    :aria-valuenow="Math.round(progress * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="`${formatCountdown(leftMs)} left`"
  >
    <span class="fill absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-linear" :style="{ width }" />
    <span class="g-num absolute inset-0 grid place-items-center leading-none">{{ formatCountdown(leftMs) }}</span>
  </span>
</template>

<style scoped>
.bar {
  background: #120c1d;
  border: 2px solid rgb(0 0 0 / 0.55);
  box-shadow: inset 0 2px 0 rgb(0 0 0 / 0.45), 0 1px 0 rgb(255 255 255 / 0.08);
}
.fill {
  background:
    repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.22) 0 6px, transparent 6px 12px),
    linear-gradient(180deg, #ffe08a 0%, #ffc93a 45%, #ff9a2e 100%);
  background-size: 17px 17px, 100% 100%;
  box-shadow: inset 0 -2px 0 rgb(0 0 0 / 0.2), inset 0 2px 0 rgb(255 255 255 / 0.45);
  animation: stripes 0.9s linear infinite;
}
@keyframes stripes {
  to { background-position: 17px 0, 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .fill { animation: none; }
}
</style>
