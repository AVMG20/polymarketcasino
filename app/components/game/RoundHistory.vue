<script setup lang="ts">
/** A row of recent results, newest first. `compact`: smaller and quieter, for under a stage. */
defineProps<{ items: { id: string, label: string, won: boolean }[], compact?: boolean }>()
</script>

<template>
  <div class="flex gap-1.5 overflow-x-auto [scrollbar-width:none]" :class="compact ? 'min-h-5 opacity-70' : 'min-h-7 pb-1'">
    <TransitionGroup
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 -translate-x-2"
    >
      <span
        v-for="item in items"
        :key="item.id"
        class="shrink-0 rounded-full font-mono font-semibold tabular-nums"
        :class="[compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs', item.won ? 'bg-success/20 text-success' : compact ? 'bg-black/25 text-white/70' : 'bg-muted text-muted-foreground']"
      >
        {{ item.label }}
      </span>
    </TransitionGroup>
  </div>
</template>
