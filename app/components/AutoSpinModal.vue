<script setup lang="ts">
// Named for what actually turned out to be the shared modal: none of the six
// slots have a buy-bonus confirmation dialog (buy bonus fires the spin
// directly on click, in every game that has it). The modal every slot does
// share is this auto-spin count picker. See the migration report for detail.
//
// Nuxt UI's UModal and soft neutral UButtons, rebuilt on the shadcn-vue
// dialog with the same layout: a titled header over a divider, then the body.
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

defineProps<{
    options: number[]
}>()

const emit = defineEmits<{ pick: [count: number] }>()

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex flex-col gap-0 divide-y divide-border rounded-lg border-0 p-0 ring ring-border sm:max-w-lg">
      <div class="flex min-h-16 items-center gap-1.5 p-4 pr-12 sm:px-6">
        <DialogTitle class="font-semibold text-foreground">
          Auto Spin
        </DialogTitle>
        <DialogDescription class="sr-only">
          Pick how many spins to play
        </DialogDescription>
      </div>
      <div class="p-4 sm:p-6">
        <div class="space-y-4">
          <slot name="description" />
          <div class="grid grid-cols-5 gap-2">
            <button
              v-for="count in options"
              :key="count"
              type="button"
              class="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-sm font-bold text-foreground transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              @click="emit('pick', count)"
            >
              {{ count }}
            </button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
