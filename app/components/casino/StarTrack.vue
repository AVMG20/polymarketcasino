<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCoins } from '#shared/money'
import { CASINO_STARS } from '#shared/stars'

/**
 * Ten rounded squares, the first `level` filled amber. Stars follow the chip
 * balance, so the tooltip says how many chips it takes to hold each one.
 * A star gained pops in, a star lost blinks out (not on the first render).
 */
const props = withDefaults(defineProps<{ level: number, size?: 'sm' | 'md' }>(), { size: 'md' })
const stars = computed(() => CASINO_STARS.map((star, i) => ({ ...star, on: i < props.level })))

/** The stars between the old and the new level, while they animate. */
const changed = ref<{ from: number, to: number, up: boolean } | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
watch(() => props.level, async (to, from) => {
    if (timer) clearTimeout(timer)
    changed.value = null
    await nextTick()
    changed.value = { from: Math.min(from, to), to: Math.max(from, to), up: to > from }
    timer = setTimeout(() => (changed.value = null), 1000)
})
onBeforeUnmount(() => timer && clearTimeout(timer))
const animation = (i: number) => {
    const c = changed.value
    return c && i >= c.from && i < c.to ? (c.up ? 'star-in' : 'star-out') : ''
}
</script>

<template>
  <div class="flex items-center gap-1" :aria-label="`${level} of 10 stars`">
    <Tooltip v-for="(star, i) in stars" :key="star.key">
      <TooltipTrigger as-child>
        <span
          class="grid place-items-center rounded-md border transition-colors duration-300"
          :class="[
            size === 'sm' ? 'size-3.5' : 'size-6',
            star.on ? 'border-star bg-star text-star-foreground' : 'border-border bg-muted text-muted-foreground',
            animation(i)
          ]"
        >
          <svg v-if="size === 'md'" viewBox="0 0 24 24" class="size-3.5" aria-hidden="true">
            <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" :fill="star.on ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p class="font-semibold">{{ star.name }}</p>
        <p class="text-xs opacity-80">Hold {{ formatCoins(star.threshold) }} chips</p>
      </TooltipContent>
    </Tooltip>
  </div>
</template>

<style scoped>
/* Gained: pops in with a flash. Lost: blinks twice in amber, then fades to empty. */
.star-in { animation: star-in 0.7s cubic-bezier(0.3, 1.5, 0.5, 1); }
.star-out { animation: star-out 0.9s ease-out; }
@keyframes star-in {
  0% { transform: scale(0.3); opacity: 0; }
  45% { transform: scale(1.5); opacity: 1; box-shadow: 0 0 0 3px color-mix(in oklab, var(--star) 55%, transparent), 0 0 14px 4px var(--star); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
}
@keyframes star-out {
  0%, 40% { background-color: var(--star); border-color: var(--star); opacity: 1; }
  20%, 60% { background-color: var(--star); border-color: var(--star); opacity: 0.2; }
  80% { transform: scale(0.7); opacity: 0.6; }
  100% { transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .star-in, .star-out { animation: none; }
}
</style>
