<script setup lang="ts">
import { Send } from 'lucide-vue-next'
import type { TableFeedItem } from '~/composables/useLiveTable'

/** The table's chatter: arrivals, results and chat, newest at the bottom. */
const props = defineProps<{ items: TableFeedItem[], canChat: boolean }>()
const emit = defineEmits<{ chat: [text: string] }>()
const text = ref('')
const list = ref<HTMLElement | null>(null)

watch(() => props.items.length, async () => {
    await nextTick()
    list.value?.scrollTo({ top: list.value.scrollHeight })
})

function send() {
    const value = text.value.trim()
    if (!value) return
    emit('chat', value)
    text.value = ''
}
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2">
    <div ref="list" class="h-48 space-y-1 overflow-y-auto pr-1 text-xs lg:h-64">
      <p v-if="!items.length" class="text-muted-foreground">Nothing yet. Say hi.</p>
      <p v-for="item in items" :key="item.id" class="break-words" :class="item.kind === 'chat' ? '' : 'text-muted-foreground'">
        <span class="font-semibold" :class="item.kind === 'chat' ? 'text-foreground' : ''">{{ item.name }}</span>
        <span :class="item.tone === 'win' ? 'font-semibold text-success' : ''">{{ item.kind === 'chat' ? ': ' : ' ' }}{{ item.text }}</span>
      </p>
    </div>
    <form class="flex gap-1.5" @submit.prevent="send">
      <input
        v-model="text"
        :disabled="!canChat"
        maxlength="120"
        placeholder="Say something"
        class="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      >
      <button type="submit" class="grid size-11 shrink-0 place-items-center rounded-xl border hover:bg-muted disabled:opacity-50" :disabled="!canChat || !text.trim()" title="Send">
        <Send class="size-4" />
      </button>
    </form>
  </div>
</template>
