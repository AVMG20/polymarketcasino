<script setup lang="ts">
import { Flame, WifiOff } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import type { SeatView } from '#shared/tables/protocol'

/**
 * One seat on the felt: an open chair to sit in, or the player's plate (avatar,
 * name, session result, streak) under whatever the game puts in the slot.
 */
const props = defineProps<{ seat: SeatView<unknown> | null, index: number, mine: boolean, active?: boolean, canSit: boolean }>()
defineEmits<{ sit: [index: number] }>()

const flash = ref<number | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
watch(() => [props.seat?.lastNet, props.seat?.roundsPlayed], ([net], old) => {
    if (net === null || net === undefined || !old || old[1] === props.seat?.roundsPlayed) return
    flash.value = net as number
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (flash.value = null), 3_000)
})
onBeforeUnmount(() => timer && clearTimeout(timer))
</script>

<template>
  <div
    class="relative flex min-w-0 flex-col items-center justify-end gap-1.5 rounded-2xl p-1.5 transition-colors"
    :class="[active ? 'bg-white/15 ring-2 ring-star' : mine ? 'bg-white/8 ring-1 ring-white/30' : '']"
  >
    <template v-if="seat">
      <div class="flex min-h-[4.5rem] w-full flex-col items-center justify-end gap-1">
        <slot />
      </div>
      <Transition enter-active-class="transition duration-300" enter-from-class="opacity-0 scale-75" leave-active-class="transition duration-300" leave-to-class="opacity-0">
        <span
          v-if="flash !== null && flash !== 0"
          class="absolute top-1 z-10 rounded-full px-2 py-0.5 font-mono text-xs font-bold shadow-lg"
          :class="flash > 0 ? 'bg-success text-black' : 'bg-black/70 text-white/80'"
        >{{ flash > 0 ? '+' : '−' }}{{ formatCoins(Math.abs(flash)) }}</span>
      </Transition>
      <div class="flex w-full min-w-0 items-center gap-1.5 rounded-full bg-black/35 py-1 pr-2 pl-1" :class="seat.connected ? '' : 'opacity-60'">
        <TableAvatar :name="seat.name" :image="seat.image" :size="24" />
        <div class="min-w-0 flex-1 leading-tight">
          <p class="truncate text-[11px] font-semibold" :class="mine ? 'text-star' : 'text-white'">{{ seat.name }}</p>
          <p class="font-mono text-[10px] tabular-nums" :class="seat.sessionNet > 0 ? 'text-success' : seat.sessionNet < 0 ? 'text-white/55' : 'text-white/55'">
            {{ seat.sessionNet > 0 ? '+' : seat.sessionNet < 0 ? '−' : '' }}{{ formatCoins(Math.abs(seat.sessionNet)) }}
          </p>
        </div>
        <WifiOff v-if="!seat.connected" class="size-3 shrink-0 text-white/70" />
        <span v-else-if="seat.winStreak > 1" class="flex shrink-0 items-center text-[10px] font-bold text-star"><Flame class="size-3" />{{ seat.winStreak }}</span>
      </div>
    </template>
    <button
      v-else
      type="button"
      class="grid min-h-28 w-full place-items-center rounded-2xl border-2 border-dashed border-white/25 text-xs font-semibold tracking-wide text-white/60 uppercase transition-colors enabled:hover:border-star enabled:hover:text-star disabled:opacity-40"
      :disabled="!canSit"
      @click="$emit('sit', index)"
    >
      Sit
    </button>
  </div>
</template>
