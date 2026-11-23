<script setup lang="ts">
import { Zap } from 'lucide-vue-next'

/**
 * Finish a construction now for gems, at the live price (`skipGems` of the
 * time left, so it drops as the timer runs). Always shown on a running
 * construction: greyed with the reason when gems can't pay for it.
 */
const props = defineProps<{ leftMs: number, target: string }>()
const tycoon = useTycoon()
const price = computed(() => tycoon.skipPrice(props.leftMs))
const reason = computed(() => {
    if (!tycoon.state.value?.gemsEnabled) return 'Gems need a Polynux account'
    if ((tycoon.gems.value ?? 0) < price.value) return 'Not enough gems'
    return null
})

function skip() {
    if (reason.value || tycoon.busy.value) return
    void tycoon.buyGem('skip', props.target)
}
</script>

<template>
  <button
    type="button"
    class="g-btn gap-1!"
    :class="reason ? 'g-off' : 'g-gem'"
    :aria-disabled="!!reason"
    :disabled="tycoon.busy.value"
    :title="reason ?? `Finish now for ${price} gems`"
    :aria-label="reason ? `Finish now: ${reason}` : `Finish now for ${price} gems`"
    @click="skip"
  >
    <Zap class="size-[1.05em] shrink-0" :stroke-width="3" />
    <TycoonCost :amount="price" currency="gems" />
  </button>
</template>
