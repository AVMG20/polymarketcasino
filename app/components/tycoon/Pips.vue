<script setup lang="ts">
/**
 * Level pips (●●○○○). A pip that just filled pops; `next` makes the next one
 * blink; `marks` rings the levels that do something special (a top machine
 * level drawing richer guests). Past COMPACT_FROM levels the dots get
 * crowded: "Lv 3/12" and a bar instead.
 */
const props = withDefaults(defineProps<{ level: number, max: number, size?: 'sm' | 'md', next?: boolean, marks?: readonly number[] }>(), { size: 'sm', next: false, marks: () => [] })
const COMPACT_FROM = 7
const compact = computed(() => props.max >= COMPACT_FROM)

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
  <span v-if="compact" class="inline-flex items-center gap-1.5" :aria-label="`Level ${level} of ${max}`" :title="`Level ${level} / ${max}`">
    <span class="g-num leading-none" :class="size === 'md' ? 'text-sm' : 'text-[10px]'">Lv {{ level }}/{{ max }}</span>
    <span class="block overflow-hidden rounded-full border-[1.5px] border-black/55 bg-black/45" :class="size === 'md' ? 'h-2.5 w-16' : 'h-2 w-10'">
      <span class="block h-full rounded-full bg-[#ffc93a] shadow-[0_0_6px_rgb(255_201_58/0.6)] transition-[width] duration-500" :class="popAt ? 'g-pop' : ''" :style="{ width: `${Math.min(100, (level / max) * 100)}%` }" />
    </span>
  </span>
  <span v-else class="inline-flex items-center gap-[3px]" :aria-label="`Level ${level} of ${max}`" :title="marks.length ? `Level ${level} / ${max} · ringed levels draw richer guests` : `Level ${level} / ${max}`">
    <span
      v-for="i in max"
      :key="i"
      class="rounded-full border-[1.5px]"
      :class="[
        size === 'md' ? 'size-3' : 'size-2',
        marks.includes(i) ? 'border-[#c084fc] ring-1 ring-[#c084fc]/60' : 'border-black/55',
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
