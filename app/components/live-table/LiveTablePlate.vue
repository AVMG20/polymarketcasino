<script setup lang="ts">
import { WifiOff } from 'lucide-vue-next'
import { formatNumber } from '#shared/money'
import type { SeatView } from '#shared/tables/protocol'

/**
 * A seated player's nameplate on the felt (stage coordinates): avatar, name,
 * session result and streak. When a round settles, what it made floats up off
 * the plate.
 */
const props = defineProps<{ seat: SeatView<unknown>, x: number, y: number, mine: boolean, turn?: boolean, ready?: boolean }>()

const float = ref<{ id: number, net: number } | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
watch(() => props.seat.roundsPlayed, (played, before) => {
    const net = props.seat.lastNet
    if (before === undefined || played === before || !net) return
    float.value = { id: played, net }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (float.value = null), 2_500)
})
onBeforeUnmount(() => timer && clearTimeout(timer))

const net = computed(() => props.seat.sessionNet)
</script>

<template>
  <div class="lt-plate" :class="{ you: mine, turn, away: !seat.connected }" :style="{ left: `${x}px`, top: `${y}px` }">
    <span class="av"><TableAvatar :name="seat.name" :image="seat.image" :size="38" /></span>
    <span class="who">
      <span class="nm">{{ seat.name }}</span>
      <span class="net lt-mono" :class="net > 0 ? 'up' : net < 0 ? 'down' : ''">{{ net === 0 ? '—' : `${net > 0 ? '+' : '−'}${formatNumber(Math.abs(net))}` }}</span>
    </span>
    <WifiOff v-if="!seat.connected" class="size-5 shrink-0 text-white/60" />
    <span v-else-if="ready" class="ready" title="Ready to deal">✓</span>
    <span v-if="seat.winStreak > 1" class="lt-streak" :title="`${seat.winStreak} wins in a row`">W{{ seat.winStreak }}</span>
  </div>
  <div v-if="float" :key="float.id" class="lt-float" :class="float.net > 0 ? 'up' : 'down'" :style="{ left: `${x}px`, top: `${y - 40}px` }">
    {{ float.net > 0 ? '+' : '−' }}{{ formatNumber(Math.abs(float.net)) }}
  </div>
</template>
