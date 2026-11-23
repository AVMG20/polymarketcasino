<script setup lang="ts">
import { Flame, WifiOff } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import type { SeatView } from '#shared/tables/protocol'

/**
 * A seated player's spot on the felt (stage coordinates): a big avatar on a
 * leather nameplate with their name, session result and streak. When a round
 * settles, what it made rises off the plate: a win big, in white on gold with
 * the chip (every win pays chips), a loss or a push small and quiet.
 */
const props = defineProps<{ seat: SeatView<unknown>, x: number, y: number, mine: boolean, turn?: boolean, ready?: boolean }>()

const float = ref<{ id: number, net: number } | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
watch(() => props.seat.roundsPlayed, (played, before) => {
    const net = props.seat.lastNet
    if (before === undefined || played === before || net === null) return
    float.value = { id: played, net }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (float.value = null), 2_800)
})
onBeforeUnmount(() => timer && clearTimeout(timer))

const net = computed(() => props.seat.sessionNet)
</script>

<template>
  <div class="lt-plate" :class="{ you: mine, turn, away: !seat.connected }" :style="{ left: `${x}px`, top: `${y}px` }">
    <span class="av"><TableAvatar :name="seat.name" :image="seat.image" :size="82" /></span>
    <span v-if="ready" class="ready" title="Ready to deal">✓</span>
    <span class="who">
      <span class="nm">{{ seat.name }}</span>
      <span class="net" :class="net > 0 ? 'up' : net < 0 ? 'down' : ''">{{ net === 0 ? '±0' : `${net > 0 ? '+' : '−'}${formatCoins(Math.abs(net))}` }}</span>
    </span>
    <WifiOff v-if="!seat.connected" class="size-6 shrink-0 text-white/60" />
    <span v-if="seat.winStreak > 1" class="lt-streak inline-flex items-center gap-0.5" :title="`${seat.winStreak} wins in a row`"><Flame class="size-4" :stroke-width="3" />{{ seat.winStreak }}</span>
  </div>
  <div
    v-if="float"
    :key="float.id"
    class="lt-float"
    :class="float.net > 0 ? 'up' : float.net < 0 ? 'down' : 'push'"
    :style="{ left: `${x}px`, top: `${y - 58}px` }"
    :title="float.net > 0 ? 'Paid in chips' : undefined"
  >
    <template v-if="float.net > 0">+{{ formatCoins(float.net) }}<CasinoChipIcon /></template>
    <template v-else-if="float.net < 0">−{{ formatCoins(-float.net) }}</template>
    <template v-else>PUSH</template>
  </div>
</template>
