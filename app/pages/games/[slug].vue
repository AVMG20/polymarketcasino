<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { findGame } from '#shared/games/registry'
import { isGameUnlocked } from '#shared/tycoon'
import { GAME_COMPONENTS } from '~/utils/game-components'

const route = useRoute()
const tycoon = useTycoon()
const slug = computed(() => String(route.params.slug))
const game = computed(() => findGame(slug.value))
const component = computed(() => GAME_COMPONENTS[slug.value])
const loaded = computed(() => tycoon.ready.value)
// Live tables can be watched by anyone; every other game needs to be built.
const playable = computed(() => !!tycoon.state.value && (!!game.value?.live || isGameUnlocked(tycoon.state.value, slug.value)))

function retry() {
    tycoon.loadFailed.value = false
    void tycoon.refresh()
}

onMounted(() => {
    void tycoon.refresh()
})
</script>

<template>
  <template v-if="game && component">
    <div v-if="!loaded && tycoon.loadFailed.value" class="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <p class="font-display text-xl font-bold">Could not load your casino</p>
      <Button class="h-11" @click="retry">Try again</Button>
    </div>
    <div v-else-if="!loaded" class="grid min-h-[40dvh] place-items-center"><div class="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
    <component :is="component" v-else-if="playable" :key="slug" />
    <TycoonLockedGame v-else :slug="slug" />
  </template>
  <div v-else class="mx-auto max-w-md px-4 py-16 text-center">
    <p class="font-display text-2xl font-bold">No such game</p>
    <NuxtLink to="/" class="text-sm text-primary underline">Back to My Casino</NuxtLink>
  </div>
</template>
