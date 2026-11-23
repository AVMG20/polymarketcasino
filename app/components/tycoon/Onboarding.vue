<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { nextCost } from '#shared/tycoon'

/**
 * First-visit pointer: one short bubble at a time, pointing at the thing to
 * tap: the cage (collect coins), then the loop in one line at Games (coins
 * are for betting, wins pay chips, chips build), then Build for Limbo
 * once there are chips. Remembered in localStorage per player, so a new
 * account on the same device gets the tips too.
 */
const props = defineProps<{ paused?: boolean }>()
const emit = defineEmits<{ cage: [], games: [], limbo: [] }>()
const tycoon = useTycoon()
const { player } = useCasinoSession()
const playerId = computed(() => player.value?.id ?? null)
const key = (id: string) => `casino:onboarding:${id}`

/** Nothing shows until the player's own progress is read. */
const dismissed = ref(true)
const collected = ref(false)
/** The "bet coins, win chips" tip was tapped (or the player has won chips). */
const looped = ref(false)

function load(id: string | null) {
    dismissed.value = true
    if (!id) return
    try {
        const saved = JSON.parse(localStorage.getItem(key(id)) ?? 'null') as { dismissed?: boolean, collected?: boolean, looped?: boolean } | null
        dismissed.value = !!saved?.dismissed
        collected.value = !!saved?.collected
        looped.value = !!saved?.looped
    } catch {
        dismissed.value = false
        collected.value = false
        looped.value = false
    }
}
onMounted(() => load(playerId.value))
watch(playerId, load)

function save() {
    if (!playerId.value) return
    try {
        localStorage.setItem(key(playerId.value), JSON.stringify({ dismissed: dismissed.value, collected: collected.value, looped: looped.value }))
    } catch {
        // Private mode: the tip simply shows again next visit.
    }
}

function dismiss() {
    dismissed.value = true
    save()
}

/** The page calls this after a collect. */
function markCollected() {
    if (collected.value) return
    collected.value = true
    save()
}
defineExpose({ markCollected })

const limboDone = computed(() => {
    const s = tycoon.state.value
    return !s || (s.games.limbo ?? 0) >= 1 || s.constructions.some(c => c.kind === 'game' && c.id === 'limbo')
})
/** What Limbo costs to build (its first level), so the Build tip waits until it is affordable. */
const limboPrice = computed(() => {
    const s = tycoon.state.value
    return s ? (nextCost(s, 'game', 'limbo')?.chips ?? 0) : 0
})
// Winning chips is the lesson: once there are chips, the loop tip is done.
watch(() => tycoon.chips.value, (chips) => {
    if (chips > 0 && collected.value && !looped.value) {
        looped.value = true
        save()
    }
})
const step = computed<'cage' | 'loop' | 'limbo' | null>(() => {
    if (dismissed.value || !tycoon.state.value) return null
    if (!collected.value) return 'cage'
    if (tycoon.chips.value <= 0) return looped.value ? null : 'loop'
    // Point at Build only once the chips are there: "Build Limbo!" with nothing to pay is a dead end.
    if (limboDone.value || tycoon.chips.value < limboPrice.value) return null
    return 'limbo'
})
const TEXT = { cage: 'Collect your coins!', loop: 'Bet coins, win chips. Chips build your casino!', limbo: 'Build Limbo!' }
// The loop tip points at Games (its tap opens them): under the chip pill it covered the cage and missions buttons.
const ANCHOR = { cage: 'cage', loop: 'games', limbo: 'build' }
const text = computed(() => (step.value ? TEXT[step.value] : ''))

// Where the bubble points: the HUD element marked data-tip="<anchor>".
const root = ref<HTMLElement | null>(null)
const pos = ref<{ x: number, y: number, below: boolean } | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

function place() {
    const host = root.value?.parentElement
    const anchor = step.value ? host?.querySelector<HTMLElement>(`[data-tip="${ANCHOR[step.value]}"]`) : null
    if (!host || !anchor) {
        pos.value = null
        return
    }
    const box = host.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    const below = rect.top - box.top < box.height / 2
    pos.value = {
        x: rect.left - box.left + rect.width / 2,
        y: below ? rect.bottom - box.top + 12 : rect.top - box.top - 12,
        below
    }
}

watch(step, () => nextTick(place))
onMounted(() => {
    place()
    timer = setInterval(place, 600)
    window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
    window.removeEventListener('resize', place)
})

// Keep the bubble on screen; the arrow still points at the anchor.
const BUBBLE = 240
const left = computed(() => {
    const width = root.value?.parentElement?.clientWidth ?? 360
    return Math.max(8, Math.min(width - BUBBLE - 8, (pos.value?.x ?? 0) - BUBBLE / 2))
})

function go() {
    if (step.value === 'cage') return emit('cage')
    if (step.value === 'loop') {
        looped.value = true
        save()
        return emit('games')
    }
    emit('limbo')
}
</script>

<template>
  <div ref="root" class="contents">
    <Transition name="tip">
      <div
        v-if="step && pos && !paused"
        class="g-ui pointer-events-none absolute z-20"
        :style="{ left: `${left}px`, top: pos.below ? `${pos.y}px` : undefined, bottom: pos.below ? undefined : `calc(100% - ${pos.y}px)`, width: `${BUBBLE}px` }"
      >
        <div class="tip-float relative" :class="pos.below ? 'tip-down' : 'tip-up'">
          <span class="arrow absolute size-4 rotate-45" :class="pos.below ? '-top-2' : '-bottom-2'" :style="{ left: `${pos.x - left - 8}px` }" />
          <div class="bubble pointer-events-auto relative flex items-center rounded-2xl">
            <button type="button" class="g-title min-h-11 flex-1 py-2 pl-3.5 text-left text-lg leading-tight text-[#3b2200]" @click="go">{{ text }}</button>
            <button type="button" class="grid size-11 shrink-0 place-items-center text-[#7a4a00]" aria-label="Hide tips" @click="dismiss"><X class="size-4" :stroke-width="3.5" /></button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.bubble, .arrow {
  background: #ffd65c;
  border: 2.5px solid #7a4a00;
}
.bubble { box-shadow: 0 4px 0 #7a4a00, 0 10px 22px rgb(0 0 0 / 0.4); }
.bubble .g-title { text-shadow: 0 1px 0 rgb(255 255 255 / 0.5); }
.tip-down .arrow { border-right: none; border-bottom: none; }
.tip-up .arrow { border-left: none; border-top: none; }
.tip-down { animation: nudge-down 1.2s ease-in-out infinite; }
.tip-up { animation: nudge-up 1.2s ease-in-out infinite; }
@keyframes nudge-down { 50% { transform: translateY(5px); } }
@keyframes nudge-up { 50% { transform: translateY(-5px); } }
.tip-enter-active, .tip-leave-active { transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.3, 1.5, 0.5, 1); }
.tip-enter-from, .tip-leave-to { opacity: 0; transform: scale(0.8); }
@media (prefers-reduced-motion: reduce) {
  .tip-down, .tip-up { animation: none; }
}
</style>
