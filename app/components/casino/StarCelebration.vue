<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { CASINO_STARS } from '#shared/stars'

/** One moment per star rise: a card that drops in and waits for a tap. Drops are silent. */
const { celebrations } = useWallet()
const current = computed(() => celebrations.value[0] ?? null)
const star = computed(() => (current.value ? CASINO_STARS[current.value.level - 1] : null))

function dismiss() {
    celebrations.value.shift()
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] motion-reduce:transition-none"
    enter-from-class="opacity-0 scale-75"
    leave-active-class="transition duration-150"
    leave-to-class="opacity-0"
  >
    <div v-if="current && star" :key="`${current.previous}-${current.level}`" class="fixed inset-0 z-50 grid place-items-center bg-background/60 p-4 backdrop-blur-sm" @click="dismiss">
      <div class="w-full max-w-xs space-y-3 rounded-2xl border-2 border-star bg-card p-6 text-center" @click.stop>
        <svg viewBox="0 0 24 24" class="mx-auto size-16 text-star" aria-hidden="true">
          <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor" />
        </svg>
        <p class="text-xs font-semibold text-muted-foreground uppercase">{{ current.level }} of 10 stars</p>
        <p class="font-display text-2xl font-extrabold">{{ star.name }}</p>
        <CasinoStarTrack :level="current.level" size="sm" class="justify-center" />
        <p v-if="current.bounty" class="inline-flex items-center gap-1 font-mono text-sm font-semibold text-gem">
          +{{ current.bounty }} <CasinoGemIcon class="size-4" />
        </p>
        <Button class="w-full font-display" @click="dismiss">Nice</Button>
      </div>
    </div>
  </Transition>
</template>
