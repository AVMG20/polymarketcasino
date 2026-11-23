<script lang="ts">
// Open drawers, oldest first: Escape closes only the top-most.
const openStack: symbol[] = []
</script>

<script setup lang="ts">
import type { Component } from 'vue'
import { X } from 'lucide-vue-next'

/**
 * The game UI's panel over the floor: a bottom drawer on phones (the floor
 * stays visible above it), a side panel on the right from `md` up. It sits
 * inside the floor page (absolute), so it never covers the top bar. No dimming:
 * `dismissable` closes it on a tap anywhere outside.
 */
const props = withDefaults(defineProps<{
    open: boolean
    title?: string
    icon?: Component | null
    color?: string
    /** Max height on phones. */
    height?: string
    /** Phones: a compact card that floats above the bottom instead of a full-width drawer. */
    card?: boolean
    dismissable?: boolean
}>(), { title: '', icon: null, color: '#3fd25a', height: '64dvh', card: false, dismissable: false })
const emit = defineEmits<{ close: [] }>()

const id = Symbol('drawer')
const panel = ref<HTMLElement | null>(null)
/** Drawers open on the page: the HUD folds away on phones while one covers the floor. */
const openDrawers = useState<number>('tycoon:open-drawers', () => 0)

function leave() {
    const index = openStack.indexOf(id)
    if (index >= 0) {
        openStack.splice(index, 1)
        openDrawers.value = Math.max(0, openDrawers.value - 1)
    }
}

function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && props.open && openStack[openStack.length - 1] === id) emit('close')
}

function onPointerDown(event: PointerEvent) {
    if (!props.dismissable || !props.open || !panel.value) return
    if (event.target instanceof Node && panel.value.contains(event.target)) return
    emit('close')
}

watch(() => props.open, async (open) => {
    if (open) {
        if (!openStack.includes(id)) {
            openStack.push(id)
            openDrawers.value++
        }
        await nextTick()
        panel.value?.focus({ preventScroll: true })
    } else {
        leave()
    }
}, { immediate: true })

onMounted(() => {
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
})
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('pointerdown', onPointerDown, true)
    leave()
})
</script>

<template>
  <Transition name="drawer">
    <section
      v-if="open"
      ref="panel"
      class="g-ui g-panel drawer absolute z-40 flex flex-col overflow-hidden outline-none"
      :class="card
        ? 'card inset-x-2 bottom-2 mx-auto max-w-[26rem] rounded-[26px] md:right-4 md:bottom-4 md:left-auto md:w-[24rem]'
        : 'inset-x-0 bottom-0 rounded-t-[28px] border-b-0 md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:w-[min(34rem,max(25rem,42vw))] md:rounded-[28px] md:border-b-2'"
      :style="{ '--drawer-h': height }"
      role="dialog"
      tabindex="-1"
      :aria-label="title || undefined"
    >
      <div v-if="!card" class="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-white/20 md:hidden" />
      <header v-if="title" class="flex shrink-0 items-center gap-2.5 px-3 pt-2 pb-2 md:pt-3">
        <span v-if="icon" class="grid size-10 shrink-0 place-items-center rounded-2xl border-2 border-black/40 shadow-[0_3px_0_rgb(0_0_0/0.4),inset_0_2px_0_rgb(255_255_255/0.35)]" :style="{ background: color }">
          <component :is="icon" class="size-5 text-white drop-shadow-[0_1.5px_0_rgb(0_0_0/0.35)]" :stroke-width="2.75" />
        </span>
        <h2 class="g-title min-w-0 flex-1 truncate text-2xl uppercase">{{ title }}</h2>
        <slot name="extra" />
        <button type="button" class="g-btn g-dark size-11 shrink-0 rounded-full" aria-label="Close" @click="emit('close')">
          <X class="size-5" :stroke-width="3" />
        </button>
      </header>
      <button v-else type="button" class="g-btn g-dark absolute top-2 right-2 z-10 size-11 rounded-full" aria-label="Close" @click="emit('close')">
        <X class="size-5" :stroke-width="3" />
      </button>
      <div class="drawer-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <slot />
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.drawer { max-height: var(--drawer-h); }
/* A thin dark scrollbar: the browser's light default reads as a white stripe on the panel. */
.drawer-scroll { scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 0.22) transparent; }
@media (min-width: 768px) {
  .drawer:not(.card) { max-height: none; }
  .drawer.card { max-height: calc(100% - 2rem); }
}
.drawer-enter-active { transition: transform 0.32s cubic-bezier(0.3, 1.3, 0.5, 1), opacity 0.2s ease; }
.drawer-leave-active { transition: transform 0.2s ease-in, opacity 0.2s ease-in; }
.drawer-enter-from, .drawer-leave-to { transform: translateY(105%); opacity: 0.4; }
@media (min-width: 768px) {
  .drawer-enter-from, .drawer-leave-to { transform: translateX(110%); }
}
@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active, .drawer-leave-active { transition: opacity 0.15s ease; }
  .drawer-enter-from, .drawer-leave-to { transform: none; opacity: 0; }
}
</style>
