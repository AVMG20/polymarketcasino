<script setup lang="ts">
import { CircleHelp } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { findGame } from '#shared/games/registry'

/** The page around every game: title, RTP, a rules dialog, and the game itself. `wide` lets a table use a big screen. */
const props = defineProps<{ slug: string, wide?: boolean }>()
const game = computed(() => findGame(props.slug)!)
const rulesOpen = ref(false)
const { postTitle } = useHubBridge()

useHead({ title: () => game.value.name })
onMounted(() => postTitle(game.value.name))
</script>

<template>
  <div class="mx-auto w-full space-y-3 px-3 py-4 sm:px-4" :class="wide ? 'max-w-[100rem]' : 'max-w-6xl'">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <h1 class="truncate font-display text-xl font-extrabold sm:text-2xl">{{ game.name }}</h1>
        <p class="text-xs text-muted-foreground">RTP {{ (game.rtp * 100).toFixed(1) }}% · {{ game.volatility }} volatility</p>
      </div>
      <div class="flex items-center gap-1">
        <slot name="actions" />
        <Button size="icon" variant="ghost" title="Rules" @click="rulesOpen = true">
          <CircleHelp class="size-5" />
        </Button>
      </div>
    </div>

    <slot />

    <Dialog v-model:open="rulesOpen">
      <DialogContent class="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle class="font-display">{{ game.name }}</DialogTitle>
          <DialogDescription>{{ game.tagline }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-3 text-sm">
          <slot name="rules" />
          <p class="text-xs text-muted-foreground">
            Return to player {{ (game.rtp * 100).toFixed(1) }}%. Bets {{ game.minBet.toLocaleString('en-US') }} to {{ game.maxBet.toLocaleString('en-US') }} coins.
            Every outcome is decided on the server; wins are paid in whole coins, rounded down.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
