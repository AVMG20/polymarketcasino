<script setup lang="ts">
// Poly Masters: a crash game. A biplane takes off from a carrier, flies through
// adders, multipliers, rockets and boosters, and lands on the island (pays the
// counter) or splashes into the sea. The server decides and settles the whole
// round (shared/games/polymasters.ts); the Pixi scene (~/utils/polymasters)
// only plays the returned flight back. Every model is painted with Canvas2D and
// every sound is synthesised, so it loads no assets.
import '@fontsource/lilita-one/400.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/800.css'
import '@fontsource/nunito/900.css'
import { Volume2, VolumeX } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { PM_MAX_WIN, PM_SAFE_LANDING_COST } from '#shared/games/polymasters'
import { GameScene } from '~/utils/polymasters/scene'
import PmTopBar from '~/components/games/polymasters/PmTopBar.vue'
import PmBoosterBar from '~/components/games/polymasters/PmBoosterBar.vue'
import PmControlBar from '~/components/games/polymasters/PmControlBar.vue'
import PmResultOverlay from '~/components/games/polymasters/PmResultOverlay.vue'
import PmLoadingScreen from '~/components/games/polymasters/PmLoadingScreen.vue'

const sound = useSlotSound(undefined)
const game = providePolyMastersGame()
const { state, attachScene, sceneHooks, speedMult, play, dismissResult } = game

const root = ref<HTMLDivElement>()
const host = ref<HTMLDivElement>()
const controls = ref<{ bar?: HTMLElement }>()
const icons = ref<Record<string, string>>({})
const scene = new GameScene()

// --- fullscreen ---------------------------------------------------------------
const fullscreenSupported = ref(false)
const isFullscreen = ref(false)

function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void root.value?.requestFullscreen().catch(() => {})
}

function onFullscreenChange() {
    isFullscreen.value = document.fullscreenElement === root.value
}

// --- keyboard -----------------------------------------------------------------
function onKey(e: KeyboardEvent) {
    if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
    // A focused button already plays/stops on Space by itself.
    if (target?.tagName === 'BUTTON' && root.value?.contains(target)) return
    e.preventDefault()
    if (state.phase === 'result') dismissResult()
    else void play()
}

// The canvas follows its box, not the window: a sidebar toggle resizes the stage too.
let resizeObserver: ResizeObserver | null = null
let deckObserver: ResizeObserver | null = null

onMounted(async () => {
    fullscreenSupported.value = document.fullscreenEnabled
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onKey)
    if (!(await scene.init(host.value!, sceneHooks, speedMult))) return
    icons.value = scene.icons()
    attachScene(scene)
    state.ready = true
    resizeObserver = new ResizeObserver(() => scene.app.resize())
    resizeObserver.observe(host.value!)
    // keep the game world clear of the control deck (measured without its fade-in padding)
    const bar = controls.value?.bar
    if (bar) {
        const measure = () => scene.setBottomInset(bar.offsetHeight - parseFloat(getComputedStyle(bar).paddingTop))
        deckObserver = new ResizeObserver(measure)
        deckObserver.observe(bar)
        measure()
    }
})

onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    window.removeEventListener('keydown', onKey)
    resizeObserver?.disconnect()
    deckObserver?.disconnect()
    game.dispose()
    scene.destroy()
})
</script>

<template>
  <GameFrame slug="polymasters">
    <template #actions>
      <Button size="icon" variant="ghost" :title="sound.muted.value ? 'Sound on' : 'Sound off'" @click="sound.toggle()">
        <VolumeX v-if="sound.muted.value" class="size-5" />
        <Volume2 v-else class="size-5" />
      </Button>
    </template>
    <div ref="root" class="pm" :class="{ 'is-fullscreen': isFullscreen }">
      <div ref="host" class="stage" />
      <div class="hud">
        <PmTopBar :fullscreen="isFullscreen" :fullscreen-supported="fullscreenSupported" @toggle-fullscreen="toggleFullscreen" />
        <PmBoosterBar :icons="icons" />
        <PmResultOverlay />
        <PmControlBar ref="controls" />
      </div>
      <Transition name="pm-toast">
        <div v-if="state.toast" class="toast panel" role="alert">{{ state.toast }}</div>
      </Transition>
      <Transition name="pm-fade" :duration="600">
        <PmLoadingScreen v-if="!state.ready" />
      </Transition>
    </div>

    <template #rules>
      <p>The plane takes off with your bet on its counter. Adders (+1, +2, +5, +10) add bets, multipliers (×2 to ×5) multiply the counter, and both lift the plane.</p>
      <p>A rocket halves the counter and drops the plane. A hit at the lowest altitude sinks it, unless a Life Buoy bounces it back. Nitro and the Laser Gun stop rockets; a Magnet keeps them away and pulls the plane to the island.</p>
      <p>Land on the island and the counter pays. The higher the plane flies at the end, the easier the landing. The flight ends at {{ PM_MAX_WIN.toLocaleString('en-US') }}× bet.</p>
      <p>Safe Landing costs {{ PM_SAFE_LANDING_COST }}× bet per round and always lands.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.pm {
  position: relative;
  container: pm / size;
  /* windowed: 16:9, sized so the whole game fits under the page chrome */
  width: min(100%, calc((100svh - 8rem) * 16 / 9));
  aspect-ratio: 16 / 9;
  min-height: 480px;
  margin-inline: auto;
  /* clip, not hidden: a focused control must never scroll the stage sideways */
  overflow: clip;
  isolation: isolate;
  border-radius: calc(var(--radius) * 1.25);
  border: 1px solid var(--border);
  background: #071a36;
}
@media (max-width: 720px) {
  .pm {
    width: 100%;
    aspect-ratio: auto;
    height: calc(100svh - 7rem);
    min-height: 560px;
  }
}
.pm.is-fullscreen {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  min-height: 0;
  border: 0;
  border-radius: 0;
}
.stage {
  position: absolute;
  inset: 0;
}
.stage :deep(canvas) {
  display: block;
}
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.hud > :deep(*) {
  pointer-events: auto;
}
.toast {
  position: absolute;
  left: 50%;
  bottom: 150px;
  transform: translateX(-50%);
  padding: 12px 22px;
  border-radius: 14px;
  font-weight: 800;
  z-index: 30;
  max-width: calc(100% - 32px);
  text-align: center;
}
.pm-toast-enter-active,
.pm-toast-leave-active {
  transition: all 0.25s;
}
.pm-toast-enter-from,
.pm-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}
.pm-fade-leave-active {
  transition: opacity 0.6s;
  pointer-events: none;
}
.pm-fade-leave-to {
  opacity: 0;
}
</style>

<style>
/* Game theme, scoped to the game box so it never leaks into the rest of the app. */
.pm {
  --gold-1: #fff6c2;
  --gold-2: #ffd54a;
  --gold-3: #f2a51c;
  --gold-4: #9a5a06;
  --red-1: #ff6b5e;
  --red-2: #e0242c;
  --red-3: #8a0e14;
  --navy-1: #1b4f8f;
  --navy-2: #0e2f5c;
  --navy-3: #071a36;
  --glass: rgba(8, 26, 54, 0.72);
  --glass-edge: rgba(255, 255, 255, 0.14);
  --green: #6dff8a;
  --cyan: #7fe8ff;
  --display: 'Lilita One', 'Arial Black', sans-serif;
  --ui: 'Nunito', system-ui, sans-serif;
  color: #fff;
  font-family: var(--ui);
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}
.pm *,
.pm *::before,
.pm *::after {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}
.pm button {
  font-family: inherit;
  color: inherit;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0;
}
.pm button:disabled {
  cursor: not-allowed;
}
.pm .display {
  font-family: var(--display);
  letter-spacing: 0.02em;
}
.pm .gold-text {
  background: linear-gradient(180deg, #fffbe0 0%, #ffe066 38%, #f5a623 62%, #fff0a8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 3px 0 #6a3a00) drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45));
}
.pm .panel {
  background: linear-gradient(180deg, rgba(20, 52, 96, 0.86), rgba(6, 20, 44, 0.9));
  border: 1px solid var(--glass-edge);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -2px 0 rgba(0, 0, 0, 0.35),
    0 10px 30px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.pm .label {
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(190, 220, 255, 0.75);
}
.pm .round-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(180deg, #2c6bb8, #123a70);
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.25),
    inset 0 -3px 0 rgba(0, 0, 0, 0.3),
    0 4px 10px rgba(0, 0, 0, 0.35);
  transition:
    transform 0.12s,
    filter 0.12s;
}
.pm .round-btn:hover:not(:disabled) {
  filter: brightness(1.15);
}
.pm .round-btn:active:not(:disabled) {
  transform: scale(0.92);
}
.pm .round-btn:disabled {
  opacity: 0.4;
}
.pm .round-btn svg {
  width: 20px;
  height: 20px;
}
@keyframes pm-shine {
  0% {
    transform: translateX(-120%) skewX(-20deg);
  }
  60%,
  100% {
    transform: translateX(220%) skewX(-20deg);
  }
}
</style>
