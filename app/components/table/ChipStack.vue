<script setup lang="ts">
import { chipStack } from '#shared/tables/chips'
import { formatCoins } from '#shared/money'

/** A bet drawn as a small stack of chips with its amount. */
const props = withDefaults(defineProps<{ amount: number, size?: 'sm' | 'md', label?: boolean }>(), { size: 'md', label: true })
const chips = computed(() => chipStack(props.amount, 5))
const px = computed(() => (props.size === 'sm' ? 22 : 30))
</script>

<template>
  <div v-if="amount > 0" class="pop-in relative flex flex-col items-center">
    <div class="relative" :style="{ width: `${px}px`, height: `${px + (chips.length - 1) * 4}px` }">
      <span
        v-for="(chip, i) in chips"
        :key="i"
        class="absolute left-0 rounded-full border-[3px] border-dashed shadow-[0_2px_0_rgba(0,0,0,.35)]"
        :style="{ width: `${px}px`, height: `${px}px`, bottom: `${i * 4}px`, background: chip.face, borderColor: chip.rim }"
      />
    </div>
    <span v-if="label" class="mt-0.5 rounded-full bg-black/55 px-1.5 font-mono text-[10px] leading-4 font-semibold text-white tabular-nums">{{ formatCoins(amount) }}</span>
  </div>
</template>

<style scoped>
.pop-in {
    animation: pop-in 220ms cubic-bezier(.3, 1.6, .5, 1) both;
}

@keyframes pop-in {
    from {
        transform: translateY(14px) scale(.6);
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .pop-in {
        animation: none;
    }
}
</style>
