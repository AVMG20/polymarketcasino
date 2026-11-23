<script setup lang="ts">
import type { BuildKind } from '#shared/tycoon'

/** The big picture of a build item: a game's illustration, or a zone's or upgrade's picture. */
const props = defineProps<{ kind: BuildKind, id: string, dim?: boolean }>()
const art = computed(() => buildArt(props.kind, props.id))
</script>

<template>
  <div class="relative size-full overflow-hidden" :class="dim ? 'grayscale brightness-[0.55]' : ''">
    <TycoonGameArt v-if="kind === 'game'" :slug="id" />
    <TycoonIllo v-else-if="art.illo" :name="art.illo" :color="art.color" />
    <div v-else class="size-full" :style="{ background: art.color }" />
  </div>
</template>
