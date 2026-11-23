<script setup lang="ts">
import { Send } from 'lucide-vue-next'
import type { TableFeedItem } from '~/composables/useLiveTable'

/** The table's chatter: arrivals, results and chat, newest at the bottom. */
const props = defineProps<{ items: TableFeedItem[], canChat: boolean, send: (text: string) => boolean }>()
const text = ref('')
const list = ref<HTMLElement | null>(null)

// The list stops growing at its cap, so follow the newest item instead of the count.
watch(() => props.items[props.items.length - 1]?.id, async () => {
    await nextTick()
    list.value?.scrollTo({ top: list.value.scrollHeight })
})

function submit() {
    const value = text.value.trim()
    if (!value) return
    // Keep the text when the socket dropped it.
    if (props.send(value)) text.value = ''
}
</script>

<template>
  <div class="g-ui flex min-h-0 flex-col gap-2">
    <div ref="list" class="feed g-well h-36 space-y-1 overflow-y-auto rounded-2xl p-2 text-[13px] leading-snug lg:h-56">
      <p v-if="!items.length" class="px-1 py-0.5 text-[var(--g-muted)]">Nothing yet. Say hi.</p>
      <p v-for="item in items" :key="item.id" class="break-words px-1" :class="item.kind === 'chat' ? 'chat' : 'text-[var(--g-muted)]'">
        <span class="font-semibold" :class="item.kind === 'chat' ? 'text-[#ffc93a]' : 'text-[var(--g-ink)]/80'">{{ item.name }}</span>
        <span :class="item.tone === 'win' ? 'g-num text-[#7ee08f]' : ''">{{ item.kind === 'chat' ? ': ' : ' ' }}{{ item.text }}</span><CasinoChipIcon v-if="item.tone === 'win'" class="ml-1 inline size-4 align-[-3px]" />
      </p>
    </div>
    <form class="flex gap-2" @submit.prevent="submit">
      <input
        v-model="text"
        :disabled="!canChat"
        maxlength="120"
        placeholder="Say something"
        aria-label="Chat message"
        class="g-well h-11 min-w-0 flex-1 rounded-xl border-2 border-black/40 px-3 text-sm font-semibold text-[var(--g-ink)] outline-none placeholder:text-[var(--g-muted)]/70 focus-visible:border-[#4aa6ff] disabled:opacity-50"
      >
      <button type="submit" class="g-btn g-blue size-11 shrink-0 rounded-xl" :disabled="!canChat || !text.trim()" title="Send" aria-label="Send">
        <Send class="size-4" :stroke-width="2.75" />
      </button>
    </form>
  </div>
</template>

<style scoped>
/* A thin dark scrollbar: the browser's light default reads as a white stripe on the panel. */
.feed { scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 0.22) transparent; }
</style>
