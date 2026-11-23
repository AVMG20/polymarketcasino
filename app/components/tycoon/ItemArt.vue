<script setup lang="ts">
import type { BuildKind } from '#shared/tycoon'

/** The big picture of a build item: a game's illustration, or an icon on a glossy colour tile. */
const props = defineProps<{ kind: BuildKind, id: string, dim?: boolean }>()
const art = computed(() => buildArt(props.kind, props.id))
</script>

<template>
  <div class="relative size-full overflow-hidden" :class="dim ? 'grayscale brightness-[0.55]' : ''">
    <TycoonGameArt v-if="kind === 'game'" :slug="id" />
    <div
      v-else
      class="grid size-full place-items-center"
      :style="{ background: `radial-gradient(circle at 30% 22%, color-mix(in oklab, ${art.color} 55%, white), ${art.color} 48%, color-mix(in oklab, ${art.color} 60%, black))` }"
    >
      <div class="absolute inset-0 opacity-20 [background:repeating-linear-gradient(135deg,rgb(255_255_255/0.5)_0_6px,transparent_6px_18px)]" />
      <component :is="art.icon" v-if="art.icon" class="relative size-[52%] text-white drop-shadow-[0_3px_0_rgb(0_0_0/0.3)]" :stroke-width="2.25" />
    </div>
  </div>
</template>
