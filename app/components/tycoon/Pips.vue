<script setup lang="ts">
/** Level pips (●●○○○). A pip that just filled pops; `next` makes the next one blink. */
const props = withDefaults(defineProps<{ level: number, max: number, size?: 'sm' | 'md', next?: boolean }>(), { size: 'sm', next: false })

const popAt = ref(0)
let timer: ReturnType<typeof setTimeout> | null = null
watch(() => props.level, (to, from) => {
    if (to <= from) return
    popAt.value = to
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (popAt.value = 0), 600)
})
onBeforeUnmount(() => timer && clearTimeout(timer))
</script>

<template>
  <span class="inline-flex items-center gap-[3px]" :aria-label="`Level ${level} of ${max}`" :title="`Level ${level} / ${max}`">
    <span
      v-for="i in max"
      :key="i"
      class="rounded-full border-[1.5px] border-black/55"
      :class="[
        size === 'md' ? 'size-3' : 'size-2',
        i <= level ? 'bg-[#ffc93a] shadow-[inset_0_-1.5px_0_rgb(0_0_0/0.25),0_0_6px_rgb(255_201_58/0.6)]' : next && i === level + 1 ? 'pip-next' : 'bg-black/45',
        i === popAt ? 'g-pop' : ''
      ]"
    />
  </span>
</template>

<style scoped>
.pip-next { animation: pip-next 1.2s ease-in-out infinite; }
@keyframes pip-next {
  0%, 100% { background: rgb(0 0 0 / 0.45); box-shadow: none; }
  50% { background: rgb(255 201 58 / 0.55); box-shadow: 0 0 8px rgb(255 201 58 / 0.7); }
}
@media (prefers-reduced-motion: reduce) {
  .pip-next { animation: none; background: rgb(255 201 58 / 0.4); }
}
</style>
