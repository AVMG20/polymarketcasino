<script setup lang="ts">
import type { SymbolSkin } from '~/utils/slot-themes'

/** One cell's picture: image, icon or card rank, on its tile colour. */
defineProps<{ skin: SymbolSkin | undefined }>()
</script>

<template>
  <div
    class="@container grid size-full place-items-center overflow-hidden rounded-[18%] select-none"
    :style="{ background: skin?.bg ?? 'transparent', color: skin?.fg }"
    :title="skin?.label"
  >
    <img v-if="skin?.image" :src="skin.image" :alt="skin.label" class="size-[92%] object-contain" draggable="false">
    <component :is="skin.icon" v-else-if="skin?.icon" class="size-[62%]" :stroke-width="2.2" />
    <span v-else-if="skin?.text" class="font-display text-[48cqw] leading-none font-extrabold">{{ skin.text }}</span>
  </div>
</template>
