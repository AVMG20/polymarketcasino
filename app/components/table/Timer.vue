<script setup lang="ts">
/** The phase clock as a ring that drains, with the seconds inside. */
const props = defineProps<{ seconds: number | null, progress: number | null }>()
const R = 16
const circumference = 2 * Math.PI * R
const urgent = computed(() => props.seconds !== null && props.seconds <= 5)
</script>

<template>
  <div v-if="seconds !== null" class="relative grid size-10 shrink-0 place-items-center">
    <svg viewBox="0 0 40 40" class="absolute inset-0 -rotate-90">
      <circle cx="20" cy="20" :r="R" fill="none" stroke="currentColor" stroke-width="4" class="text-white/15" />
      <circle
        cx="20" cy="20" :r="R" fill="none" stroke-width="4" stroke-linecap="round"
        :stroke="urgent ? 'var(--destructive)' : 'var(--star)'"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="circumference * (1 - (progress ?? 0))"
        class="transition-[stroke-dashoffset] duration-200 ease-linear"
      />
    </svg>
    <span class="font-mono text-sm font-bold tabular-nums" :class="urgent ? 'text-destructive' : 'text-white'">{{ seconds }}</span>
  </div>
</template>
