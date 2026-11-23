<script setup lang="ts">
/** A felt-topped table surface with a wooden rail: the stage the originals play on. */
const props = withDefaults(defineProps<{ tone?: 'green' | 'blue' | 'plum' | 'night' }>(), { tone: 'green' })
const felts = {
    green: 'radial-gradient(ellipse at 50% 0%, #23a06a 0%, #116b43 48%, #0a3f29 100%)',
    blue: 'radial-gradient(ellipse at 50% 0%, #2f6fc0 0%, #1a467f 48%, #0b2141 100%)',
    plum: 'radial-gradient(ellipse at 50% 0%, #7b45b5 0%, #4f2580 48%, #1f0d36 100%)',
    night: 'radial-gradient(ellipse at 50% 100%, #3b2a6b 0%, #1a1440 55%, #0a0820 100%)'
}
const style = computed(() => ({ background: felts[props.tone] }))
</script>

<template>
  <section class="relative overflow-hidden rounded-[1.5rem] border-[5px] border-[#3b2416] text-white shadow-[inset_0_0_50px_rgba(0,0,0,.45),0_6px_0_0_#24150c]" :style="style">
    <div class="pointer-events-none absolute inset-0 opacity-[.07]" style="background-image: radial-gradient(#fff 1px, transparent 1px); background-size: 14px 14px" />
    <div class="relative h-full">
      <slot />
    </div>
  </section>
</template>
