<template>
  <!-- Nuxt UI's UTooltip, rebuilt on reka-ui with its look (dark chip, hairline ring, no arrow). -->
  <TooltipRoot>
    <TooltipTrigger as-child>
      <div class="flex cursor-default items-center gap-1.5" :class="danger ? 'text-destructive' : undefined">
        <CoinsIcon v-if="showIcon" class="size-4 shrink-0" :class="danger ? 'text-destructive' : 'text-yellow-400'" />
        <span>{{ formatNumber(parsed, compact, minimumFractionDigits) }}</span>
      </div>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side-offset="8"
        class="z-50 flex items-center rounded-sm bg-popover px-2.5 py-1 text-xs text-popover-foreground shadow-sm ring ring-border select-none"
        :class="tooltip ? 'h-auto max-w-64 whitespace-normal' : 'h-6'"
      >
        {{ tooltip || formatNumber(parsed, false, minimumFractionDigits) }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>

<script setup lang="ts">
// The old site's coin amount with an exact-amount tooltip, used by the ported
// originals (Wheel, Magic Hands).
import { CoinsIcon } from 'lucide-vue-next'
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'

const props = withDefaults(defineProps<{
    value: string | number | null | undefined
    compact?: boolean
    showIcon?: boolean
    minimumFractionDigits?: number
    /** Renders the amount in the error colour. */
    danger?: boolean
    /** Replaces the default exact-amount tooltip. */
    tooltip?: string
}>(), { compact: true, showIcon: true, minimumFractionDigits: 0, danger: false, tooltip: '' })

const parsed = computed(() => parseFloat(String(props.value ?? '0')))
</script>
