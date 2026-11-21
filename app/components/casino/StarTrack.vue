<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCoins } from '#shared/money'
import { CASINO_STARS } from '#shared/stars'

/**
 * Ten rounded squares, the first `level` filled amber. Stars follow the
 * current balance, so the tooltip says what it takes to hold each one.
 */
const props = withDefaults(defineProps<{ level: number, size?: 'sm' | 'md' }>(), { size: 'md' })
const stars = computed(() => CASINO_STARS.map((star, i) => ({ ...star, on: i < props.level })))
</script>

<template>
  <div class="flex items-center gap-1" :aria-label="`${level} of 10 stars`">
    <Tooltip v-for="star in stars" :key="star.key">
      <TooltipTrigger as-child>
        <span
          class="grid place-items-center rounded-md border transition-colors duration-300"
          :class="[
            size === 'sm' ? 'size-3.5' : 'size-6',
            star.on ? 'border-star bg-star text-star-foreground' : 'border-border bg-muted text-muted-foreground'
          ]"
        >
          <svg v-if="size === 'md'" viewBox="0 0 24 24" class="size-3.5" aria-hidden="true">
            <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" :fill="star.on ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p class="font-semibold">{{ star.name }}</p>
        <p class="text-xs opacity-80">Hold {{ formatCoins(star.threshold) }} coins</p>
      </TooltipContent>
    </Tooltip>
  </div>
</template>
