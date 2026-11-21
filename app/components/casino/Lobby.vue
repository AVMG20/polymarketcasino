<script setup lang="ts">
import { GAME_KINDS, GAMES } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import { Progress } from '@/components/ui/progress'

const { coins, player } = useCasinoSession()
const { wallet } = useWallet()

const groups = computed(() => GAME_KINDS
    .map(group => ({ ...group, games: GAMES.filter(game => game.kind === group.kind) }))
    .filter(group => group.games.length))

const stars = computed(() => wallet.value?.stars ?? null)
const progress = computed(() => {
    const next = stars.value?.next
    if (!next) return 100
    const floor = stars.value?.current?.threshold ?? 0
    return Math.max(0, Math.min(100, Math.floor(((coins.value - floor) / (next.threshold - floor)) * 100)))
})

useHead({ title: 'Lobby' })
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-8 px-4 py-6">
    <section class="grid gap-5 rounded-2xl border bg-card p-5 md:grid-cols-[1fr_auto] md:items-center">
      <div class="min-w-0 space-y-2">
        <p class="text-sm text-muted-foreground">Balance</p>
        <p class="font-display text-3xl font-extrabold break-all tabular-nums sm:text-4xl">
          {{ formatCoins(coins, false) }} <span class="text-base text-muted-foreground sm:text-lg">coins</span>
        </p>
        <p v-if="player" class="text-xs text-muted-foreground">Best ever {{ formatCoins(player.peakCoins) }}</p>
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <CasinoAllowanceButton />
          <CasinoConvertDialog v-if="wallet?.hubAccount" />
        </div>
      </div>
      <div v-if="stars" class="space-y-2 md:w-80">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold">{{ stars.level }} / {{ stars.max }} stars</span>
          <span v-if="stars.current" class="text-xs text-muted-foreground">{{ stars.current.name }}</span>
        </div>
        <CasinoStarTrack :level="stars.level" />
        <template v-if="stars.next">
          <Progress :model-value="progress" class="h-2" />
          <p class="text-xs text-muted-foreground">
            Hold {{ formatCoins(stars.next.threshold) }} for <span class="font-semibold text-foreground">{{ stars.next.name }}</span>
          </p>
        </template>
        <p v-else class="text-xs font-semibold text-star">All ten stars</p>
        <p v-if="stars.current" class="text-xs text-muted-foreground">
          Below {{ formatCoins(stars.current.threshold) }} you drop to {{ stars.level - 1 }} {{ stars.level - 1 === 1 ? 'star' : 'stars' }}
        </p>
      </div>
    </section>

    <section v-for="group in groups" :key="group.kind" class="space-y-3">
      <h2 class="font-display text-xl font-bold">{{ group.label }}</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        <CasinoGameTile v-for="game in group.games" :key="game.slug" :game="game" />
      </div>
    </section>
  </div>
</template>
