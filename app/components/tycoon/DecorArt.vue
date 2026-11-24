<script setup lang="ts">
import { isSpecial, type DecorType } from '#shared/decor'
import { decorIcon } from '~/utils/floor/art/decor'
import { DECOR_ICONS } from '~/utils/decor-art'

/**
 * A decoration's picture for the shop, the storage tray and the level list:
 * the floor's own drawing on a soft backdrop in its colour (an icon until
 * the drawing is ready). Specials get a gold rim.
 */
const props = defineProps<{ type: DecorType, dim?: boolean }>()
const art = computed(() => DECOR_ICONS[props.type])
const special = computed(() => isSpecial(props.type))
const src = ref<string | null>(null)

watch(() => props.type, async (type) => {
    src.value = null
    try {
        const url = await decorIcon(type, 128)
        if (type === props.type) src.value = url
    } catch {
        // No 2D canvas: the icon stays.
    }
}, { immediate: true })
</script>

<template>
  <span
    class="relative grid size-full place-items-center overflow-hidden"
    :class="dim ? 'grayscale brightness-[0.55]' : ''"
    :style="{ background: `radial-gradient(circle at 50% 40%, color-mix(in oklab, ${art.color} 45%, #3b2c58), color-mix(in oklab, ${art.color} 25%, #1b1329) 75%)` }"
  >
    <img v-if="src" :src="src" alt="" class="size-[88%] object-contain drop-shadow-[0_3px_0_rgb(0_0_0/0.3)]" draggable="false">
    <component :is="art.icon" v-else class="size-[50%] text-white/80" :stroke-width="2.25" />
    <span v-if="special" class="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_2px_rgb(255_214_92/0.9),inset_0_0_14px_rgb(255_214_92/0.5)]" />
  </span>
</template>
