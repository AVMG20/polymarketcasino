<script setup lang="ts">
/** A decorative stack of chips that grows with the amount (a chip per order of magnitude). */
const props = withDefaults(defineProps<{ amount: number, min?: number, tone?: 'red' | 'gold' | 'blue' }>(), { min: 10, tone: 'red' })
const count = computed(() => Math.max(1, Math.min(9, 1 + Math.round(Math.log10(Math.max(1, props.amount / props.min) + 1) * 3))))
const colors = { red: ['#e11d48', '#9f1239'], gold: ['#f5c542', '#b8860b'], blue: ['#3b82f6', '#1d4ed8'] }
const fill = computed(() => colors[props.tone])
</script>

<template>
  <div class="relative inline-block h-14 w-12" aria-hidden="true">
    <span
      v-for="n in count"
      :key="n"
      class="chip absolute left-0 h-3.5 w-12 rounded-[50%] border-2 border-white/80 shadow-[0_2px_0_rgba(0,0,0,.35)]"
      :style="{ bottom: `${(n - 1) * 4}px`, background: `repeating-conic-gradient(${fill[1]} 0 18deg, ${fill[0]} 18deg 36deg)`, animationDelay: `${n * 25}ms` }"
    />
  </div>
</template>

<style scoped>
.chip { animation: stack-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
@keyframes stack-in { from { transform: translateY(-14px) scale(0.8); opacity: 0; } }
</style>
