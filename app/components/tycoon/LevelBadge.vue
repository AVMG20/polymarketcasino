<script setup lang="ts">
/** The casino level in a gold coin with a ring of XP to the next level. */
const props = withDefaults(defineProps<{ level: number, progress: number, size?: number, stroke?: number }>(), { size: 50, stroke: 4.5 })
const inner = computed(() => props.size - props.stroke * 2 - 4)
</script>

<template>
  <TycoonRing :progress="progress" :size="size" :stroke="stroke" color="#a879ff">
    <span class="coin grid place-items-center rounded-full" :style="{ width: `${inner}px`, height: `${inner}px` }">
      <span class="flex flex-col items-center leading-none">
        <span class="g-title text-[#5a3200]" :style="{ fontSize: `${Math.max(8, inner * 0.24)}px` }">LV</span>
        <span class="g-num text-white [text-shadow:0_1.5px_0_#7a4a00]" :style="{ fontSize: `${inner * 0.46}px` }">{{ level }}</span>
      </span>
    </span>
  </TycoonRing>
</template>

<style scoped>
.coin {
  background: radial-gradient(circle at 50% 30%, #fff2a8, #ffc93a 55%, #e88a00);
  border: 2px solid #7a4a00;
  box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.5), 0 2px 0 rgb(0 0 0 / 0.35);
}
</style>
