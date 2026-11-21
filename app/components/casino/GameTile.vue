<script setup lang="ts">
import type { GameInfo } from '#shared/games/registry'

defineProps<{ game: GameInfo }>()
</script>

<template>
  <NuxtLink
    :to="`/games/${game.slug}`"
    class="group block overflow-hidden rounded-2xl border bg-card transition-transform duration-200 ease-[cubic-bezier(.34,1.56,.64,1)] hover:scale-[1.03] motion-reduce:hover:scale-100"
  >
    <div class="aspect-[4/3] overflow-hidden bg-muted">
      <img :src="game.cover" :alt="game.name" loading="lazy" class="size-full object-cover">
    </div>
    <div class="space-y-1 p-3">
      <h3 class="font-display leading-tight font-bold">{{ game.name }}</h3>
      <p class="line-clamp-2 text-xs text-muted-foreground">{{ game.tagline }}</p>
      <p class="font-mono text-xs text-muted-foreground">RTP {{ (game.rtp * 100).toFixed(1) }}%</p>
    </div>
  </NuxtLink>
</template>
