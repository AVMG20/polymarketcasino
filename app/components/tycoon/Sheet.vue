<script lang="ts">
// Open sheets, oldest first: Escape closes only the top-most.
const openStack: symbol[] = []
</script>

<script setup lang="ts">
import { X } from 'lucide-vue-next'

/**
 * A bottom sheet (a centred card from `md` up). `modal` dims the floor and
 * closes on a tap outside; without it the floor above stays visible and
 * clickable (the quick games). Escape closes.
 */
const props = withDefaults(defineProps<{
    open: boolean
    title?: string
    modal?: boolean
    maxHeight?: string
    z?: number
    /** `wide`: a big panel anchored to the bottom on every screen (the quick games). */
    size?: 'default' | 'wide'
}>(), { modal: true, title: '', maxHeight: '86dvh', z: 50, size: 'default' })
/** `closed`: the leave animation is done. */
const emit = defineEmits<{ close: [], closed: [] }>()

const id = Symbol('sheet')
const panel = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null

function leave() {
    const index = openStack.indexOf(id)
    if (index >= 0) openStack.splice(index, 1)
}

function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && props.open && openStack[openStack.length - 1] === id) emit('close')
}

watch(() => props.open, async (open) => {
    if (open) {
        openStack.push(id)
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        await nextTick()
        panel.value?.focus({ preventScroll: true })
    } else {
        leave()
        returnFocus?.focus({ preventScroll: true })
        returnFocus = null
    }
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    leave()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet" @after-leave="emit('closed')">
      <div v-if="open" class="pointer-events-none fixed inset-0 flex items-end justify-center md:items-center md:p-4" :style="{ zIndex: z }">
        <div v-if="modal" class="sheet-backdrop pointer-events-auto absolute inset-0 bg-black/55" @click="emit('close')" />
        <!-- A wide sheet is a centred game window on desktop: the floor dims a little around it. -->
        <div v-else-if="size === 'wide'" class="sheet-backdrop pointer-events-auto absolute inset-0 hidden bg-black/35 md:block" @click="emit('close')" />
        <section
          class="sheet-panel pointer-events-auto relative flex outline-none w-full flex-col overflow-hidden rounded-t-3xl border border-b-0 bg-background shadow-2xl md:rounded-3xl md:border-b"
          :class="size === 'wide' ? 'md:max-w-[min(64rem,92vw)]' : 'md:max-w-2xl'"
          :style="{ maxHeight }"
          ref="panel"
          role="dialog"
          :aria-modal="modal || undefined"
          tabindex="-1"
          :aria-label="title || undefined"
        >
          <header v-if="title || $slots.header" class="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
            <div class="mx-auto absolute top-1.5 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/25 md:hidden" />
            <h2 class="min-w-0 flex-1 truncate pt-1.5 font-display text-lg font-extrabold">
              <slot name="header">{{ title }}</slot>
            </h2>
            <button type="button" class="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close" @click="emit('close')">
              <X class="size-5" />
            </button>
          </header>
          <div v-else class="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/25 md:hidden" />
          <div class="dark-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <slot />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* A thin dark scrollbar: the browser's light default reads as a white stripe on the dark UI. */
.dark-scroll { scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 0.22) transparent; }
.sheet-enter-active, .sheet-leave-active { transition: opacity 0.2s ease; }
.sheet-enter-active .sheet-panel, .sheet-leave-active .sheet-panel { transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet-panel, .sheet-leave-to .sheet-panel { transform: translateY(100%); }
@media (min-width: 768px) {
  .sheet-enter-from .sheet-panel, .sheet-leave-to .sheet-panel { transform: scale(0.94) translateY(16px); }
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active .sheet-panel, .sheet-leave-active .sheet-panel { transition: none; }
}
</style>
