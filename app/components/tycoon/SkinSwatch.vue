<script setup lang="ts">
import { Crown, Moon, Sparkles, Star, Sunrise, TreePalm } from 'lucide-vue-next'
import type { SkinId } from '#shared/cosmetics'
import type { ZoneId } from '#shared/tycoon'
import { skinStyle, type Motif } from '~/utils/floor/art/palette'

/** A zone skin as a little room corner: its walls, trim, floor and signature motif. */
const props = defineProps<{ zone: ZoneId, skin: SkinId }>()
const style = computed(() => skinStyle(props.zone, props.skin))
const ICONS: Record<Motif, typeof Crown> = { none: Sparkles, fan: Sunrise, palm: TreePalm, horseshoe: Star, crown: Crown, moon: Moon }
const icon = computed(() => ICONS[style.value.motif])
const uid = useId()
</script>

<template>
  <div class="relative size-full">
    <svg viewBox="0 0 64 58" class="size-full" aria-hidden="true">
      <defs>
        <linearGradient :id="`${uid}-l`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :stop-color="style.wall" />
          <stop offset="1" :stop-color="`color-mix(in oklab, ${style.wall} 75%, black)`" />
        </linearGradient>
      </defs>
      <!-- Back walls with their trim -->
      <polygon points="2,40 32,25 32,3 2,18" :fill="`url(#${uid}-l)`" stroke="#1b1329" stroke-width="1.4" stroke-linejoin="round" />
      <polygon points="32,25 62,40 62,18 32,3" :fill="style.wall" stroke="#1b1329" stroke-width="1.4" stroke-linejoin="round" style="filter: brightness(1.12)" />
      <polyline points="2,21 32,6 62,21" fill="none" :stroke="style.trim" stroke-width="2.4" />
      <polyline points="2,34 32,19 62,34" fill="none" :stroke="style.trim" stroke-width="1.2" opacity="0.7" />
      <!-- Floor: the main colour, a checker of the second one, the pattern's diamond -->
      <polygon points="32,25 62,40 32,55 2,40" :fill="style.floor" stroke="#1b1329" stroke-width="1.4" stroke-linejoin="round" />
      <polygon points="32,25 47,32.5 32,40 17,32.5" :fill="style.floorAlt" />
      <polygon points="32,40 47,47.5 32,55 17,47.5" :fill="style.floorAlt" />
      <polygon points="32,30 52,40 32,50 12,40" fill="none" :stroke="style.pattern" stroke-width="1.2" opacity="0.85" />
    </svg>
    <component :is="icon" class="absolute top-[58%] left-1/2 size-[30%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_1.5px_0_rgb(0_0_0/0.5)]" :style="{ color: style.pattern }" :stroke-width="2.75" />
  </div>
</template>
