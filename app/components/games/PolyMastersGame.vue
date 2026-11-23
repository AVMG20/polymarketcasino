<script setup lang="ts">
// PolyMasters: a crash game. A biplane takes off from a carrier, flies through
// adders, multipliers, rockets and boosters, and lands on the island (pays the
// Counter Balance) or splashes into the sea. The server decides and settles the
// whole round (shared/games/polymasters.ts); the Pixi scene
// (~/utils/polymasters) only plays the returned flight back. Every model is
// painted with Canvas2D and every sound is synthesised, so it loads no assets.
// Around it: the casino's game frame, control panel and win burst.
import '@fontsource/lilita-one/400.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/800.css'
import '@fontsource/nunito/900.css'
import { PM_MAX_WIN, PM_SAFE_LANDING_COST } from '#shared/games/polymasters'
import { formatCoins, formatCoinsExact, payFor } from '#shared/money'
import { GameScene } from '~/utils/polymasters/scene'
import { sfx } from '~/utils/polymasters/audio'
import type { WinShow } from '~/components/game/WinBurst.vue'
import PmTopBar from '~/components/games/polymasters/PmTopBar.vue'
import PmBoosterBar from '~/components/games/polymasters/PmBoosterBar.vue'
import PmLoadingScreen from '~/components/games/polymasters/PmLoadingScreen.vue'

const game = providePolyMastersGame()
const { state, attachScene, sceneHooks, speedMult, play, dismissResult, setBet, setSpeed, toggleSafe, startAuto, stopAuto, stake, betLocked } = game

const root = ref<HTMLDivElement>()
const host = ref<HTMLDivElement>()
const icons = ref<Record<string, string>>({})
const scene = new GameScene()

const flying = computed(() => state.phase === 'flying')
const locked = computed(() => betLocked())
const bet = computed({ get: () => state.bet, set: (value: number) => setBet(value) })
const maxWin = computed(() => payFor(state.bet, PM_MAX_WIN))

// The win, in the player's face once the plane is down.
const win = ref<WinShow | null>(null)
watch(() => state.phase, (phase) => {
    if (phase === 'flying') win.value = null
    if (phase !== 'result' || !state.result) return
    const r = state.result
    win.value = { id: state.roundId, payout: r.win, multiplier: r.cost > 0 ? Math.floor((r.win / r.cost) * 100) / 100 : 0 }
})
const splashed = computed(() => state.phase === 'result' && !!state.result && state.result.win <= 0)

function fly() {
    if (state.auto.active) {
        stopAuto()
        sfx.click()
        return
    }
    if (state.phase === 'result') dismissResult()
    void play()
}

function auto(rounds: number) {
    sfx.click()
    startAuto(rounds)
}

// --- fullscreen: the whole game (stage and controls) ---------------------------
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
    // Never play behind a dialog (rules, menus portalled to body).
    if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]')) return
    if (target && target !== document.body && !root.value?.contains(target)) return
    e.preventDefault()
    if (state.phase === 'result') dismissResult()
    else void play()
}

// The canvas follows its box, not the window.
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
    fullscreenSupported.value = document.fullscreenEnabled
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onKey)
    if (!(await scene.init(host.value!, sceneHooks, speedMult))) return
    icons.value = scene.icons()
    attachScene(scene)
    scene.setBottomInset(0)
    state.ready = true
    resizeObserver = new ResizeObserver(() => scene.app.resize())
    resizeObserver.observe(host.value!)
})

onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    window.removeEventListener('keydown', onKey)
    resizeObserver?.disconnect()
    game.dispose()
    scene.destroy()
})

const speedLabel = computed(() => PM_SPEEDS.find(s => s.id === state.speed)?.label ?? '')
</script>

<template>
  <GameFrame slug="polymasters" wide>
    <div ref="root" class="pm-root @container" :class="{ 'pm-full': isFullscreen }">
      <div class="flex flex-col gap-3 @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_20rem] @3xl:grid-rows-[auto_1fr] @3xl:items-start">
        <GameWinBurst :show="win" class="rounded-[1.5rem] @3xl:row-span-2">
          <div class="pm">
            <div ref="host" class="stage" />
            <div class="hud">
              <PmTopBar :fullscreen="isFullscreen" :fullscreen-supported="fullscreenSupported" @toggle-fullscreen="toggleFullscreen" />
              <PmBoosterBar :icons="icons" />
              <Transition name="pm-splash">
                <p v-if="splashed" class="pm-zero g-title">
                  <span class="text-xl leading-none">×0</span> Splash!
                </p>
              </Transition>
            </div>
            <Transition name="pm-toast">
              <div v-if="state.toast" class="toast panel" role="alert">{{ state.toast }}</div>
            </Transition>
            <Transition name="pm-fade" :duration="600">
              <PmLoadingScreen v-if="!state.ready" />
            </Transition>
          </div>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <GameBetInput v-model="bet" :min="PM_MIN_BET" :max="PM_MAX_BET" :disabled="locked" />

          <div role="radiogroup" aria-label="Flight" class="grid grid-cols-2 gap-2">
            <button
              type="button" role="radio" :aria-checked="!state.safe" :disabled="locked"
              class="g-btn h-14 flex-col gap-0 rounded-2xl text-lg leading-tight"
              :class="state.safe ? 'g-dark opacity-70' : 'g-blue'"
              @click="state.safe && toggleSafe()"
            >
              Normal
              <span class="font-[family-name:var(--font-round)] text-[11px] font-semibold opacity-85">up to ×{{ formatCoins(PM_MAX_WIN) }}</span>
            </button>
            <button
              type="button" role="radio" :aria-checked="state.safe"
              :disabled="locked"
              class="g-btn h-14 flex-col gap-0 rounded-2xl text-lg leading-tight"
              :class="state.safe ? 'g-gold' : 'g-dark opacity-70'"
              :title="`Costs ${PM_SAFE_LANDING_COST}× the bet and always lands`"
              @click="!state.safe && toggleSafe()"
            >
              <span class="inline-flex items-center gap-1">
                <svg viewBox="0 0 24 24" class="size-4" aria-hidden="true"><path d="M3 20h18M4.5 15.5l6-1.4 3.6-6.6 2 .4-1.6 5.5 4.6-1.1c.9-.2 1.7.4 1.5 1.2-.1.5-.5.8-1 .9L5.3 17.4z" fill="currentColor" /></svg>
                Safe
              </span>
              <span class="font-[family-name:var(--font-round)] text-[11px] font-semibold opacity-85">×{{ PM_SAFE_LANDING_COST }} · always lands</span>
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Stake</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl" :title="formatCoinsExact(stake())">
                <GameStakeIcons :amount="stake()" class="text-base" />{{ formatCoins(stake()) }}
              </p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Max win</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl text-[var(--g-green)]" :title="`${formatCoinsExact(maxWin)} chips`">
                <CasinoChipIcon class="size-4" />{{ formatCoins(maxWin) }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-12 shrink-0 text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Speed</span>
            <div role="radiogroup" aria-label="Speed" class="grid flex-1 grid-cols-4 gap-1.5">
              <button
                v-for="s in PM_SPEEDS" :key="s.id"
                type="button" role="radio" :aria-checked="state.speed === s.id" :title="s.label" :aria-label="s.label"
                class="g-btn h-11 rounded-xl"
                :class="state.speed === s.id ? 'g-purple' : 'g-dark opacity-70'"
                @click="setSpeed(s.id)"
              >
                <svg viewBox="0 0 24 24" class="h-4" :style="{ width: `${10 + s.id * 4}px` }" aria-hidden="true">
                  <path v-for="k in s.id" :key="k" :d="`M${2 + (k - 1) * 5} 5l7 7-7 7`" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="w-12 shrink-0 text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Auto</span>
            <div class="grid flex-1 grid-cols-4 gap-1.5">
              <button
                v-for="n in PM_AUTO_OPTIONS" :key="n"
                type="button"
                class="g-btn g-dark h-11 rounded-xl text-base"
                :disabled="flying || state.auto.active"
                :title="`Fly ${n} rounds`"
                @click="auto(n)"
              >{{ n }}</button>
            </div>
          </div>
          <p class="sr-only" aria-live="polite">{{ speedLabel }}</p>
        </div>

        <!-- Fly sticks to the bottom of the screen on a phone. -->
        <div class="g-ui g-panel sticky bottom-2 z-20 rounded-[1.5rem] p-2 sm:p-3 @3xl:static @3xl:col-start-2">
          <button
            type="button"
            class="g-btn h-14 w-full rounded-2xl text-2xl uppercase"
            :class="state.auto.active ? 'g-red' : state.safe ? 'g-gold' : 'g-green'"
            :disabled="!state.ready || (flying && !state.auto.active)"
            @click="fly"
          >
            <template v-if="state.auto.active">Stop <span class="text-base normal-case opacity-85">{{ state.auto.left + 1 }} left</span></template>
            <template v-else-if="flying">Flying…</template>
            <template v-else>
              <svg viewBox="0 0 24 24" class="size-6" aria-hidden="true"><path d="M2.5 13.5l7-1.6 4.2-7.7 2.3.5-1.9 6.4 5.4-1.2c1-.2 2 .5 1.8 1.4-.1.6-.6 1-1.2 1.1L3.4 15.6z" fill="currentColor" /></svg>
              Fly
            </template>
          </button>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Set a bet and press <strong>Fly</strong>. The plane takes off from the carrier and flies a route over the ocean. Its <strong>counter</strong> starts at your bet and changes with everything it flies through. Land on the island and the counter is paid; splash into the sea and the round is lost.</p>
      <div v-if="icons.add1" class="flex flex-wrap items-center gap-2">
        <img v-for="v in [1, 2, 5, 10]" :key="`a${v}`" :src="icons[`add${v}`]" alt="" class="size-9">
        <img v-for="v in [2, 3, 4, 5]" :key="`m${v}`" :src="icons[`mul${v}`]" alt="" class="size-9">
      </div>
      <p><strong>Adders</strong> add 1, 2, 5 or 10 bets; <strong>multipliers</strong> multiply the counter by 2 to 5. Both lift the plane: the higher it flies at the end, the better its chance to reach the island.</p>
      <p><img v-if="icons.rocket" :src="icons.rocket" alt="" class="mr-1 inline size-8 align-middle"> A <strong>rocket</strong> halves the counter and knocks the plane down; hit while skimming the waves, it goes into the sea.</p>
      <p>
        <img v-for="b in ['nitro', 'laser', 'magnet', 'buoy']" :key="b" :src="icons[b]" alt="" class="mr-1 inline size-8 align-middle">
        Boosters: <strong>Nitro</strong> bounces rockets off, the <strong>Laser</strong> shoots them down, the <strong>Magnet</strong> pulls in multipliers and pulls the plane to the island, the <strong>Life Buoy</strong> saves one splash.
      </p>
      <p><strong>Safe Landing</strong> costs {{ PM_SAFE_LANDING_COST }}× the bet, never splashes and always lands. The max win is ×{{ formatCoins(PM_MAX_WIN) }}; the round ends at once when the counter reaches it. Speed only changes how fast a flight plays out. Space flies.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.pm {
  position: relative;
  container: pm / size;
  width: 100%;
  /* Phones: a tall stage (the scene stands the world upright). cqw is the win burst's width. */
  height: clamp(22rem, 125cqw, 66svh);
  /* clip, not hidden: a focused control must never scroll the stage sideways */
  overflow: clip;
  isolation: isolate;
  border-radius: 1.5rem;
  border: 5px solid #3b2416;
  box-shadow: inset 0 0 40px rgb(0 0 0 / 0.35), 0 6px 0 0 #24150c;
  background: #071a36;
}
@container (min-width: 48rem) {
  .pm { height: clamp(26rem, 64cqw, calc(100svh - 9rem)); }
}
.pm-full {
  overflow: auto;
  padding: 12px;
  background: #0d0a16;
}
.pm-full .pm { height: calc(100dvh - 10.5rem); }
@container (min-width: 48rem) {
  .pm-full .pm { height: calc(100dvh - 24px); }
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
.pm-zero {
  position: absolute;
  left: 50%;
  bottom: 18px;
  translate: -50% 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 14px;
  border-radius: 999px;
  background: #ff5470;
  color: #fff;
  font-size: 1rem;
  box-shadow: 0 3px 0 #b3213d;
  pointer-events: none !important;
}
.pm-splash-enter-active { transition: transform 0.3s cubic-bezier(0.3, 0.7, 0.4, 1.5), opacity 0.2s; }
.pm-splash-leave-active { transition: opacity 0.2s; }
.pm-splash-enter-from { transform: scale(1.3); opacity: 0; }
.pm-splash-leave-to { opacity: 0; }
.toast {
  position: absolute;
  left: 50%;
  bottom: 60px;
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
@media (prefers-reduced-motion: reduce) {
  .pm-splash-enter-active { transition: none; }
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
</style>
