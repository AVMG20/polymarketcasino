<script setup lang="ts">
import { formatCoins } from '#shared/money'
import type { HistoryHour } from '#shared/visitors'

/**
 * Income per hour as a strip of small bars (the welcome card's away
 * stretch): what came into the cage, with what a full cage turned away
 * stacked on top in orange. The busiest hour (most guest spend) is gold.
 * Hover or tap a bar for its hour; the line under the strip says the
 * busiest hour otherwise.
 */
const props = defineProps<{ hours: HistoryHour[], days?: boolean }>()

const max = computed(() => Math.max(1, ...props.hours.map(h => h.income + h.lost)))
/** The busiest hour: the most guest spend (a full cage may have lost some of it). */
const best = computed(() => {
    let at = -1
    let top = 0
    props.hours.forEach((h, i) => {
        if (h.income + h.lost > top) {
            top = h.income + h.lost
            at = i
        }
    })
    return at
})
const active = ref<number | null>(null)
const shown = computed(() => {
    const i = active.value ?? best.value
    const h = i >= 0 ? props.hours[i] : null
    return h ? { i, h, best: i === best.value } : null
})
const when = (ms: number) => (props.days ? formatDayClock(ms) : formatClock(ms))

function pick(event: PointerEvent) {
    const el = event.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    if (!props.hours.length || rect.width <= 0) return
    active.value = Math.min(props.hours.length - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * props.hours.length)))
}
</script>

<template>
  <div>
    <div
      class="flex h-12 touch-pan-y items-end select-none"
      :class="hours.length > 40 ? 'gap-px' : 'gap-[3px]'"
      role="img"
      :aria-label="`Income per hour over ${hours.length} hours`"
      @pointermove="pick"
      @pointerdown="pick"
      @pointerleave="active = null"
    >
      <span
        v-for="(h, i) in hours"
        :key="h.at"
        class="flex min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-t-[3px]"
        :style="{ height: `${Math.max(6, ((h.income + h.lost) / max) * 100)}%`, opacity: active === null || active === i ? 1 : 0.55 }"
        :title="`${when(h.at)} · +${formatCoins(h.income)} coins${h.lost > 0 ? ` · ${formatCoins(h.lost)} lost (cage full)` : ''}`"
      >
        <span v-if="h.lost > 0" class="block bg-[#ff9a2e]" :style="{ height: `${(h.lost / (h.income + h.lost)) * 100}%` }" />
        <span class="block flex-1" :class="i === best ? 'bg-[#ffc93a]' : 'bg-[#7ee08f]'" />
      </span>
    </div>
    <p v-if="shown" class="mt-1 flex items-center gap-1.5 text-[12px] leading-4 font-semibold text-[var(--g-muted)]">
      <span>{{ shown.best ? 'Busiest hour' : 'Hour' }} {{ when(shown.h.at) }}</span>
      <span v-if="shown.h.income > 0 || !shown.h.lost" class="g-num ml-auto text-[#7ee08f]">+{{ formatCoins(shown.h.income) }}</span>
      <span v-if="shown.h.lost > 0" class="g-num text-[#ffb35c]" :class="shown.h.income > 0 ? '' : 'ml-auto'">{{ formatCoins(shown.h.lost) }} lost</span>
    </p>
  </div>
</template>
