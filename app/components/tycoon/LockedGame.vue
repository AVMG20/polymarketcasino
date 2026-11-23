<script setup lang="ts">
import { HardHat, Lock, X } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'

/** A game the player has not built (yet): its cover under a lock, and the way to build it. */
const props = defineProps<{ slug: string, overlay?: boolean }>()
defineEmits<{ build: [] }>()
const embed = inject(GAME_EMBED, null)
const game = computed(() => findGame(props.slug))
const tycoon = useTycoon()
const v = computed(() => tycoon.view('game', props.slug))
</script>

<template>
  <div class="g-ui px-4 py-8">
    <div class="g-panel relative mx-auto flex max-w-sm flex-col items-center gap-3 rounded-[28px] p-5 text-center">
      <button v-if="overlay && embed" type="button" class="g-btn g-dark absolute top-2 right-2 size-11 rounded-full" aria-label="Close" @click="embed.close()"><X class="size-5" :stroke-width="3" /></button>
      <div class="relative size-36 overflow-hidden rounded-[24px] border-[3px] border-black/50 shadow-[0_5px_0_rgb(0_0_0/0.4)]">
        <div class="size-full grayscale brightness-75"><TycoonGameArt :slug="slug" /></div>
        <div v-if="v.running" class="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 to-transparent p-2">
          <TycoonBuildBar :progress="1 - v.running.leftMs / v.running.total" :left-ms="v.running.leftMs" />
        </div>
        <div v-else class="absolute inset-0 grid place-items-center">
          <span class="grid size-16 place-items-center rounded-full border-[3px] border-black/50 bg-[#1b1329]/90"><Lock class="size-8 text-[#ffc93a]" :stroke-width="3" /></span>
        </div>
      </div>
      <h1 class="g-title text-3xl leading-tight">{{ game?.name ?? 'Unknown game' }}</h1>
      <TycoonSkipButton v-if="v.running" class="h-12 rounded-xl px-4 text-lg" :left-ms="v.running.leftMs" :target="`game:${slug}`" />
      <p v-else-if="v.lockZone" class="flex items-center gap-1.5 font-semibold text-[#ffc93a]"><Lock class="size-4" :stroke-width="3" /> {{ v.lockZone }}</p>
      <button v-if="overlay" type="button" class="g-btn g-green h-14 w-full rounded-2xl text-xl uppercase" @click="$emit('build')">
        <HardHat class="size-6" :stroke-width="2.75" /> Build
        <span v-if="v.cost && !v.running" class="ml-2 rounded-xl bg-black/25 px-2.5 py-1 text-lg normal-case"><TycoonCost :amount="v.cost.chips" /></span>
      </button>
      <NuxtLink v-else :to="{ path: '/', query: { build: `game:${slug}` } }" class="g-btn g-green h-14 w-full rounded-2xl text-xl uppercase">
        <HardHat class="size-6" :stroke-width="2.75" /> Build
        <span v-if="v.cost && !v.running" class="ml-2 rounded-xl bg-black/25 px-2.5 py-1 text-lg normal-case"><TycoonCost :amount="v.cost.chips" /></span>
      </NuxtLink>
    </div>
  </div>
</template>
