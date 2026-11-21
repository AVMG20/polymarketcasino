<script setup lang="ts">
/** A place to put chips: label, what it pays, and the chips already on it. */
defineProps<{ label: string, pays?: string, amount: number, disabled?: boolean, highlight?: 'win' | 'lose' | null, tone?: string }>()
defineEmits<{ place: [] }>()
</script>

<template>
  <button
    type="button"
    class="relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 px-2 py-1.5 text-center transition-all enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 disabled:cursor-default"
    :class="[
      highlight === 'win' ? 'border-star bg-star/15 shadow-[0_0_24px_-4px_var(--star)]' : highlight === 'lose' ? 'border-border opacity-60' : 'border-dashed border-border',
      tone ?? ''
    ]"
    :disabled="disabled"
    @click="$emit('place')"
  >
    <span class="text-xs leading-tight font-bold tracking-wide uppercase">{{ label }}</span>
    <span v-if="pays" class="text-[10px] text-muted-foreground">{{ pays }}</span>
    <TableChipStack v-if="amount > 0" :amount="amount" size="sm" class="mt-0.5" />
  </button>
</template>
