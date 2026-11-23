<script setup lang="ts">
import { Volume2, VolumeX } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

/** Sound on/off for a game's header (the casino's one mute switch). */
const sound = useGameSound()
const embed = inject(GAME_EMBED, null)
</script>

<template>
  <button
    v-if="embed"
    type="button"
    class="g-btn g-dark size-11 shrink-0 rounded-full"
    :title="sound.muted.value ? 'Sound off' : 'Sound on'"
    :aria-label="sound.muted.value ? 'Turn sound on' : 'Turn sound off'"
    :aria-pressed="!sound.muted.value"
    @click="sound.toggle()"
  >
    <VolumeX v-if="sound.muted.value" class="size-5 opacity-70" :stroke-width="2.75" />
    <Volume2 v-else class="size-5" :stroke-width="2.75" />
  </button>
  <Button
    v-else
    size="icon"
    variant="ghost"
    class="max-sm:size-11"
    :title="sound.muted.value ? 'Sound off' : 'Sound on'"
    :aria-label="sound.muted.value ? 'Turn sound on' : 'Turn sound off'"
    :aria-pressed="!sound.muted.value"
    @click="sound.toggle()"
  >
    <VolumeX v-if="sound.muted.value" class="size-5 opacity-70" />
    <Volume2 v-else class="size-5" />
  </Button>
</template>
