<script setup lang="ts">
/** A row of recent results, newest first. */
defineProps<{ items: { id: string, label: string, won: boolean }[] }>()
</script>

<template>
  <div class="flex min-h-7 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
    <TransitionGroup
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 -translate-x-2"
    >
      <span
        v-for="item in items"
        :key="item.id"
        class="shrink-0 rounded-full px-2.5 py-1 font-mono text-xs font-semibold tabular-nums"
        :class="item.won ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'"
      >
        {{ item.label }}
      </span>
    </TransitionGroup>
  </div>
</template>
