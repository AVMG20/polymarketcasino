<script setup lang="ts">
import { Eraser, Play, RotateCcw, Undo2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

/** Undo, clear, repeat, halve, double and "deal now", under every betting layout. */
defineProps<{ canUndo: boolean, canRepeat: boolean, canScale: boolean, canDeal: boolean, voted: boolean, votes?: string }>()
defineEmits<{ undo: [], clear: [], repeat: [], scale: [factor: 0.5 | 2], deal: [] }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="icon-lg" class="size-11" title="Undo" :disabled="!canUndo" @click="$emit('undo')"><Undo2 class="size-5" /></Button>
    <Button variant="outline" size="icon-lg" class="size-11" title="Clear" :disabled="!canUndo" @click="$emit('clear')"><Eraser class="size-5" /></Button>
    <Button variant="outline" size="icon-lg" class="size-11" title="Repeat last bet" :disabled="!canRepeat" @click="$emit('repeat')"><RotateCcw class="size-5" /></Button>
    <Button variant="outline" class="h-11 w-11 font-semibold" title="Halve" :disabled="!canScale" @click="$emit('scale', 0.5)">½</Button>
    <Button variant="outline" class="h-11 w-11 font-semibold" title="Double" :disabled="!canScale" @click="$emit('scale', 2)">2×</Button>
    <Button
      class="ml-auto h-11 min-w-32 font-display shadow-[0_3px_0_0_color-mix(in_oklch,var(--primary)_60%,black)] active:translate-y-[2px] active:shadow-none"
      :disabled="!canDeal || voted"
      @click="$emit('deal')"
    >
      <Play class="size-4" /> {{ voted ? 'Ready' : 'Deal now' }}<span v-if="votes" class="font-mono text-xs opacity-80">{{ votes }}</span>
    </Button>
  </div>
</template>
