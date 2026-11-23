<script setup lang="ts">
import { CircleHelp, Hammer, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import { isGameUnlocked } from '#shared/tycoon'

/** The page around every game: title, RTP, a rules dialog, and the game itself. `wide` lets a table use a big screen. */
const props = defineProps<{ slug: string, wide?: boolean }>()
const game = computed(() => findGame(props.slug)!)
const rulesOpen = ref(false)
const { postTitle } = useHubBridge()
const tycoon = useTycoon()
// A live table can be watched by anyone; sitting needs the game built.
const { hostFor } = useVisitHost()
const needsBuild = computed(() => !!game.value.live && !hostFor(props.slug) && !!tycoon.state.value && !isGameUnlocked(tycoon.state.value, props.slug))
// Inside the My Casino overlay: compact header with the close button, no page chrome.
const embed = inject(GAME_EMBED, null)
if (embed) {
    embed.headerClaimed.value = true
    onBeforeUnmount(() => (embed.headerClaimed.value = false))
}

useHead({ title: () => game.value.name })
onMounted(() => !embed && postTitle(game.value.name))
</script>

<template>
  <div :class="embed ? 'pb-4' : ''">
  <!-- Inside My Casino: a chunky game bar (back, name, RTP badge, rules), across the whole screen. -->
  <div v-if="embed" class="g-ui sticky top-0 z-20 mb-3 flex select-none items-center gap-2.5 border-b-2 border-[#120c1d] bg-gradient-to-b from-[#3b2c58] to-[#2a1f3f] px-3 py-1.5 shadow-[0_3px_0_#120c1d] sm:px-4">
      <h1 class="g-title min-w-0 flex-1 truncate bg-transparent text-xl">{{ game.name }}</h1>
      <span class="g-num shrink-0 rounded-full bg-[#1b1329] px-2.5 py-1 text-xs text-[#b6a6d3] shadow-[inset_0_2px_0_rgb(0_0_0/0.35)]" :title="`Return to player · ${game.volatility} volatility`">{{ formatFixed(game.rtp * 100, 1) }}%</span>
      <div class="flex items-center gap-1.5">
        <slot name="actions" />
        <button type="button" class="g-btn g-dark size-11 rounded-full" title="Rules" aria-label="Rules" @click="rulesOpen = true">
          <CircleHelp class="size-5" :stroke-width="2.75" />
        </button>
        <button type="button" class="g-btn g-dark size-11 shrink-0 rounded-full" aria-label="Back to the floor" title="Back to the floor" @click="embed.close()">
          <X class="size-5" :stroke-width="3" />
        </button>
      </div>
  </div>
  <div class="mx-auto w-full space-y-3 px-3 sm:px-4" :class="[wide ? 'max-w-[100rem]' : 'max-w-6xl', embed ? '' : 'py-4']">
    <div v-if="!embed" class="flex items-center justify-between gap-2">
      <div class="min-w-0 flex-1">
        <h1 class="truncate font-display text-xl font-extrabold sm:text-2xl">{{ game.name }}</h1>
        <p class="text-xs text-muted-foreground">RTP {{ formatFixed(game.rtp * 100, 1) }}% · {{ game.volatility }} volatility</p>
      </div>
      <div class="flex items-center gap-1">
        <slot name="actions" />
        <Button size="icon" variant="ghost" class="max-sm:size-11" title="Rules" @click="rulesOpen = true">
          <CircleHelp class="size-5" />
        </Button>
      </div>
    </div>

    <!-- On the floor the live table's own watch bar says "Watching" and offers Build, right where the seat would be. -->
    <div v-if="needsBuild && !embed" class="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed bg-card p-3 text-sm">
      <Hammer class="size-5 shrink-0 text-primary" />
      <p class="min-w-0 flex-1 font-semibold">Build {{ game.name }} to take a seat. You can watch the table for free.</p>
      <Button as-child class="h-11"><NuxtLink :to="{ path: '/', query: { build: `game:${slug}` } }">Go to My Casino</NuxtLink></Button>
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
            Return to player {{ formatFixed(game.rtp * 100, 1) }}%. Bets {{ formatCoins(game.minBet) }} to {{ formatCoins(game.maxBet) }} coins.
            Every outcome is decided on the server; wins are paid in whole coins, rounded down.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  </div>
  </div>
</template>
