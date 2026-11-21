<script setup lang="ts">
import { findGame } from '#shared/games/registry'
import { GAME_COMPONENTS } from '~/utils/game-components'

const route = useRoute()
const slug = computed(() => String(route.params.slug))
const game = computed(() => findGame(slug.value))
const component = computed(() => GAME_COMPONENTS[slug.value])
</script>

<template>
  <component :is="component" v-if="game && component" :key="slug" />
  <div v-else class="mx-auto max-w-md px-4 py-16 text-center">
    <p class="font-display text-2xl font-bold">No such game</p>
    <NuxtLink to="/" class="text-sm text-primary underline">Back to the lobby</NuxtLink>
  </div>
</template>
