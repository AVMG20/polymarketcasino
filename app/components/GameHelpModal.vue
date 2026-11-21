<script setup lang="ts">
// The old site's "How X works" modal for the originals. Nuxt UI's UModal
// (title, close button, divider, body) rebuilt on the shadcn-vue dialog.
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

defineProps<{
    title: string
    ui?: { content?: string }
}>()

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex flex-col gap-0 divide-y divide-border rounded-lg border-0 p-0 ring ring-border sm:max-w-lg" :class="ui?.content">
      <div class="flex min-h-16 items-center gap-1.5 p-4 pr-12 sm:px-6">
        <DialogTitle class="font-semibold text-foreground">
          {{ title }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ title }}
        </DialogDescription>
      </div>
      <div class="p-4 sm:p-6">
        <ul class="list-inside list-disc space-y-2 text-sm text-muted-foreground">
          <slot />
        </ul>
      </div>
    </DialogContent>
  </Dialog>
</template>
