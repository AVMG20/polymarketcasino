<script setup lang="ts">
import { Store, X } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import { isGameUnlocked } from '#shared/tycoon'
import { GAME_COMPONENTS } from '~/utils/game-components'
import { GAME_EMBED, QUICK_GAMES } from '~/utils/game-embed'

/**
 * A game opened from the floor. Dice, Limbo and Wheel are a bottom sheet with
 * the floor still running above; everything else takes the whole screen with a
 * zoom-in from the machine (the floor is paused behind it). Live tables can be
 * watched without being built; sitting needs the game.
 */
const props = defineProps<{ slug: string | null }>()
const emit = defineEmits<{ close: [], build: [slug: string] }>()

const tycoon = useTycoon()
const headerClaimed = ref(false)
provide(GAME_EMBED, { close: () => emit('close'), headerClaimed })

/**
 * The game on screen. It outlives `slug` while the sheet or zoom plays its
 * leave animation (else the panel would empty out as it goes), and is
 * cleared when that is done, which unmounts the game (settling a round
 * still waiting).
 */
const shown = ref<string | null>(props.slug)
watch(() => props.slug, (slug) => {
    if (slug) shown.value = slug
})
function closed() {
    if (!props.slug) shown.value = null
}

const game = computed(() => (shown.value ? findGame(shown.value) : undefined))
const component = computed(() => (shown.value ? GAME_COMPONENTS[shown.value] : undefined))
const quick = computed(() => !!shown.value && QUICK_GAMES.includes(shown.value))
// Visiting: the host's built games play too (with your own coins and chips).
const { host, hostFor } = useVisitHost()
const atHost = computed(() => !!shown.value && !!hostFor(shown.value))
const unlocked = computed(() => atHost.value || (!!shown.value && !!tycoon.state.value && isGameUnlocked(tycoon.state.value, shown.value)))
// Until the casino is read, don't flash a lock over the game (the server still checks on play).
const playable = computed(() => !tycoon.state.value || unlocked.value || !!game.value?.live)

const open = computed(() => !!props.slug && !!game.value)

// Escape leaves a full-screen game (quick games close through their sheet).
// A dialog the game opened on top (rules, paytable) gets the Escape first.
function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented || !props.slug || quick.value) return
    if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"], .sd-scrim')) return
    event.preventDefault()
    emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
const fullOpen = computed(() => open.value && !quick.value)
const quickOpen = computed(() => open.value && quick.value)
</script>

<template>
  <!-- Quick games: a bottom sheet, floor visible and live above it. -->
  <TycoonSheet :open="quickOpen" :modal="false" size="wide" max-height="min(85dvh, calc(100dvh - 7rem))" :z="45" @close="emit('close')" @closed="closed">
    <template v-if="shown && quick">
      <p v-if="atHost" class="g-ui flex justify-center px-3 pt-1 pb-1.5">
        <span class="host-badge"><Store class="size-3.5" :stroke-width="3" />Playing at {{ host?.name }}'s casino</span>
      </p>
      <component :is="component" v-if="playable && component" :key="shown" />
      <TycoonLockedGame v-else :slug="shown" overlay @build="emit('build', shown!)" />
    </template>
  </TycoonSheet>

  <!-- Everything else: full screen. -->
  <Teleport to="body">
    <Transition name="zoom" @after-leave="closed">
      <div v-if="fullOpen && shown" class="dark-scroll fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-background" role="dialog" :aria-label="game?.name">
        <div v-if="!headerClaimed" class="g-ui sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b-2 border-[#120c1d] bg-gradient-to-b from-[#3b2c58] to-[#2a1f3f] px-2 shadow-[0_3px_0_#120c1d]">
          <span class="g-title min-w-0 flex-1 truncate text-xl">{{ game?.name }}</span>
          <button type="button" class="g-btn g-dark size-11 shrink-0 rounded-full" aria-label="Back to the floor" @click="emit('close')"><X class="size-5" :stroke-width="3" /></button>
        </div>
        <div :class="headerClaimed ? 'min-h-full' : 'min-h-[calc(100%-3.5rem)]'">
          <component :is="component" v-if="playable && component" :key="shown" />
          <TycoonLockedGame v-else :slug="shown" overlay @build="emit('build', shown!)" />
        </div>
        <!-- Visiting: whose casino this game stands in (your own coins and chips pay). -->
        <p v-if="atHost" class="g-ui pointer-events-none fixed inset-x-0 top-[3.75rem] z-40 flex justify-center px-3">
          <span class="host-badge"><Store class="size-3.5" :stroke-width="3" />Playing at {{ host?.name }}'s casino</span>
        </p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* A thin dark scrollbar: the browser's light default reads as a white stripe on the dark UI. */
.dark-scroll { scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 0.22) transparent; }
.host-badge {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 0.35rem;
  overflow: hidden;
  border: 2px solid #120c1d;
  border-radius: 999px;
  background: #2a1f3f;
  padding: 0.15rem 0.65rem;
  font-size: 12px;
  font-weight: 600;
  line-height: 1rem;
  color: #ffc93a;
  white-space: nowrap;
  text-overflow: ellipsis;
  box-shadow: 0 3px 0 #120c1d;
}
.zoom-enter-active { transition: opacity 0.28s ease, transform 0.38s cubic-bezier(0.22, 1, 0.36, 1); }
.zoom-leave-active { transition: opacity 0.18s ease, transform 0.2s ease; }
.zoom-enter-from { opacity: 0; transform: scale(0.55); }
.zoom-leave-to { opacity: 0; transform: scale(1.06); }
@media (prefers-reduced-motion: reduce) {
  .zoom-enter-active, .zoom-leave-active { transition: opacity 0.15s ease; }
  .zoom-enter-from, .zoom-leave-to { transform: none; }
}
</style>
