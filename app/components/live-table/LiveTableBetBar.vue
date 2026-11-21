<script setup lang="ts">
/**
 * Repeat, halve, double, undo, clear and the deal-now vote: the same strip,
 * in the same order, under every table.
 */
withDefaults(defineProps<{
    canRepeat?: boolean
    canScale?: boolean
    canUndo?: boolean
    canClear?: boolean
    canDeal?: boolean
    voted?: boolean
    votes?: string
}>(), { canRepeat: false, canScale: false, canUndo: false, canClear: false, canDeal: false, voted: false, votes: '' })

defineEmits<{ repeat: [], scale: [factor: 0.5 | 2], undo: [], clear: [], deal: [] }>()
</script>

<template>
  <div class="lt-betbar">
    <button type="button" class="lb-tile lb-tile-amber" :disabled="!canRepeat" @click="$emit('repeat')">REPEAT</button>
    <button type="button" class="lb-tile op" :disabled="!canScale" title="Halve every bet" @click="$emit('scale', 0.5)">½</button>
    <button type="button" class="lb-tile op" :disabled="!canScale" title="Double every bet" @click="$emit('scale', 2)">2×</button>
    <button type="button" class="lb-tile lb-tile-slate" :disabled="!canUndo" @click="$emit('undo')">UNDO</button>
    <button type="button" class="lb-tile lb-tile-red" :disabled="!canClear" @click="$emit('clear')">CLEAR</button>
    <button type="button" class="lb-tile lb-tile-green deal" :disabled="!canDeal || voted" @click="$emit('deal')">
      {{ voted ? 'READY' : 'DEAL NOW' }}<span v-if="votes" class="ml-1 font-mono text-xs font-semibold opacity-80">{{ votes }}</span>
    </button>
  </div>
</template>
