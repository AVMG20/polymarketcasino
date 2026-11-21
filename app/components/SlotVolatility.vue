<template>
  <!-- Nuxt UI's UTooltip, rebuilt on reka-ui with its look (dark chip, hairline ring, no arrow). -->
  <TooltipRoot>
    <TooltipTrigger as-child>
      <div class="inline-flex cursor-default items-center gap-2">
        <span class="text-[10px] font-black tracking-wide text-muted-foreground uppercase">Volatility</span>
        <span class="inline-flex items-center gap-0.5">
          <ZapIcon
            v-for="i in 5"
            :key="i"
            class="size-3.5"
            :style="{ color: i <= clampedLevel ? COLORS[clampedLevel - 1] : 'var(--muted-foreground)', opacity: i <= clampedLevel ? 1 : 0.3 }"
          />
        </span>
      </div>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side-offset="8"
        class="z-50 flex h-6 items-center rounded-sm bg-popover px-2.5 py-1 text-xs text-popover-foreground shadow-sm ring ring-border select-none"
      >
        {{ `Volatility ${clampedLevel}/5 — ${LABELS[clampedLevel - 1]}` }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>

<script setup lang="ts">
import { ZapIcon } from 'lucide-vue-next'
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'

const props = defineProps<{
    level: number
}>()

// Green -> red, indexed by (level - 1). Rated from real max-win observed
// across 2M simulated spins per slot, not the theoretical payout cap.
const COLORS = ['#4ade80', '#a3e635', '#facc15', '#fb923c', '#ef4444']
const LABELS = ['low', 'medium-low', 'medium', 'high', 'extreme']

const clampedLevel = computed(() => Math.min(5, Math.max(1, Math.round(props.level))))
</script>
