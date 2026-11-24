<script setup lang="ts">
import { Sofa, X } from 'lucide-vue-next'

/**
 * Once, after the Decor upgrade was removed: its chips came back. A small card
 * above the action bar (not a toast) that points to the specials instead.
 */
const tycoon = useTycoon()
const arrange = useArrange()
const amount = computed(() => tycoon.decorRefund.value)
/** Waits for the welcome-back card, so they don't stack. */
const show = computed(() => !!amount.value && !tycoon.welcome.value && !arrange.active.value)

function close() {
    tycoon.decorRefund.value = null
}
function openShop() {
    close()
    arrange.start()
    arrange.shopOpen.value = true
}
</script>

<template>
  <Transition name="note">
    <div v-if="show && amount" class="g-ui pointer-events-none absolute inset-x-2 bottom-32 z-30 flex justify-center" role="status">
      <div class="g-panel pointer-events-auto relative w-full max-w-[24rem] rounded-[22px] p-3 pr-12">
        <button type="button" class="g-btn g-dark absolute top-2 right-2 size-11 rounded-full" aria-label="Close" @click="close"><X class="size-5" :stroke-width="3" /></button>
        <p class="text-[13.5px] leading-snug font-semibold">
          The Decor upgrade is gone: your <TycoonCost :amount="amount" /> chips are back. Decorate with specials to bring richer guests.
        </p>
        <button type="button" class="g-btn mt-2.5 h-11 rounded-xl px-4 text-base" style="--face: #ff7ab0; --edge: #9c2f62" @click="openShop">
          <Sofa class="size-5" :stroke-width="2.75" /> Open the Decor shop
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.note-enter-active { transition: transform 0.3s cubic-bezier(0.3, 1.4, 0.5, 1), opacity 0.2s ease; }
.note-leave-active { transition: opacity 0.15s ease; }
.note-enter-from { opacity: 0; transform: translateY(16px) scale(0.96); }
.note-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .note-enter-active { transition: opacity 0.15s ease; }
  .note-enter-from { transform: none; }
}
</style>
