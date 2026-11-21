<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'

/**
 * The corner panel a table hangs its reference material off (paytables, the
 * baccarat roads, the shoe). Dimmed and collapsed to its header until asked
 * for, so it never competes with the hands.
 */
const props = withDefaults(defineProps<{ title: string, offset?: number, open?: boolean, side?: 'left' | 'right' }>(), { offset: 0, open: false, side: 'left' })
const expanded = ref(props.open)
</script>

<template>
  <div class="lt-corner" :class="{ 'open': expanded, 'lt-corner-r': side === 'right' }" :style="{ top: `${62 + offset}px` }">
    <div class="lt-corner-head" @click="expanded = !expanded">
      <ChevronDown v-if="expanded" />
      <ChevronRight v-else />
      <span>{{ title }}</span>
    </div>
    <div v-if="expanded" class="lt-corner-body">
      <slot />
    </div>
  </div>
</template>
