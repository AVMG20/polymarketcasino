<script setup lang="ts">
import { LIMBO_MAX_TARGET, LIMBO_MIN_TARGET, limboChance, toCents, type LimboResult } from '#shared/games/limbo'
import { findGame } from '#shared/games/registry'
import { formatCoins, formatCoinsExact, payFor } from '#shared/money'
import type { WinShow } from '~/components/game/WinBurst.vue'

const info = findGame('limbo')!
const round = useGameRound<LimboResult>('limbo')

const bet = ref(info.minBet)
const targetText = ref('2,00')
const shown = ref<number | null>(null)
const flying = ref(false)
const last = ref<LimboResult | null>(null)
const win = ref<WinShow | null>(null)
const history = ref<{ id: string, label: string, won: boolean }[]>([])
const sound = useGameSound()

const target = computed(() => {
    const value = toCents(parseDecimal(targetText.value))
    return Number.isFinite(value) ? Math.min(LIMBO_MAX_TARGET, Math.max(LIMBO_MIN_TARGET, value)) : 2
})
const chance = computed(() => limboChance(target.value) * 100)
const payout = computed(() => payFor(bet.value, target.value))
const presets = [
    { value: 1.5, face: '#22c55e', edge: '#15803d' },
    { value: 2, face: '#3b82f6', edge: '#1e40af' },
    { value: 5, face: '#a855f7', edge: '#6b21a8' },
    { value: 10, face: '#f59e0b', edge: '#b45309' },
    { value: 100, face: '#ef4444', edge: '#991b1b' }
]
/** 0..1 up the sky: a log scale so 1.5× and 5,000× both read as a climb. */
const sky = ref(2)
const skyMax = computed(() => (flying.value || last.value ? sky.value : Math.max(2, target.value * 1.25)))
function altitude(value: number) {
    return Math.max(0, Math.min(1, Math.log10(Math.max(1, value)) / Math.log10(skyMax.value)))
}
const rocketY = computed(() => altitude(shown.value ?? 1))
const targetY = computed(() => altitude(target.value))
const landed = computed(() => (last.value ? (last.value.won ? 'won' : 'lost') : null))
/** The rocket is at or past the target (the line turns green). */
const passed = computed(() => (flying.value || landed.value === 'won') && (shown.value ?? 0) >= target.value)
/** Bumped on every launch: replays the smoke at the pad. */
const launchId = ref(0)

// The scenery (fixed, so no randomness): two rows of buildings and some lit windows.
const CLOUD = 'M14 34c-8 0-12-5-10-10s8-6 11-4c1-8 9-12 17-9 3-7 13-9 19-3 5-5 15-4 18 3 7-3 15 1 15 8 6-1 11 3 11 8s-4 7-9 7Z'
const SKYLINE_FAR = [[0, 22, 26], [24, 16, 34], [44, 26, 20], [72, 18, 40], [96, 30, 24], [130, 20, 30], [154, 14, 44], [172, 28, 22], [204, 18, 36], [226, 24, 26], [254, 16, 42], [274, 30, 20], [308, 20, 32], [332, 14, 46], [350, 26, 24], [380, 22, 34]]
    .map(([x, w, h]) => ({ x: x!, w: w!, h: h! }))
const SKYLINE_NEAR = [[-4, 30, 14], [22, 18, 24], [44, 34, 12], [80, 20, 20], [104, 26, 10], [140, 22, 18], [166, 16, 26], [186, 40, 9], [230, 20, 22], [254, 30, 13], [288, 18, 28], [310, 28, 11], [342, 22, 19], [368, 36, 15]]
    .map(([x, w, h]) => ({ x: x!, w: w!, h: h! }))
const WINDOWS = SKYLINE_FAR.flatMap((b, i) => [0, 1, 2]
    .filter(k => (i * 7 + k * 3) % 4 !== 0 && 56 - b.h + 4 + k * 7 < 40)
    .map(k => ({ x: b.x + 3 + ((i + k) % 3) * 5 % Math.max(3, b.w - 6), y: 56 - b.h + 4 + k * 7, o: 0.35 + ((i * 5 + k) % 4) * 0.15 })))
/** One hero under the sky: the target before a launch, the climbing number in flight, the result after a loss (a win shows itself). */
const readout = computed(() => (flying.value || last.value ? `${formatFixed(shown.value ?? 1, 2)}×` : `${formatFixed(target.value, 2)}×`))

let frame = 0
function animate(to: number): Promise<void> {
    return new Promise((resolve) => {
        const start = performance.now()
        const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.min(900, 300 + Math.log10(to) * 200)
        if (duration) sound.launch(duration / 1000)
        const step = (now: number) => {
            const t = duration ? Math.min(1, (now - start) / duration) : 1
            // Climb on a log scale so 1.5× and 5,000× both read as a rise.
            shown.value = Math.floor(10 ** (Math.log10(to) * (1 - (1 - t) ** 2)) * 100) / 100
            if (t < 1) frame = requestAnimationFrame(step)
            else resolve()
        }
        frame = requestAnimationFrame(step)
    })
}
onBeforeUnmount(() => cancelAnimationFrame(frame))

async function play() {
    if (round.busy.value) return
    win.value = null
    last.value = null
    targetText.value = formatFixed(target.value, 2, false)
    const response = await round.play({ bet: bet.value, options: { target: target.value } })
    if (!response) return
    sky.value = Math.max(2, target.value * 1.25, response.result.result * 1.1)
    launchId.value++
    flying.value = true
    shown.value = 1
    await animate(response.result.result)
    shown.value = response.result.result
    flying.value = false
    last.value = response.result
    if (response.result.won) sound.win(response.result.target)
    else sound.lose()
    win.value = { id: response.roundId, payout: response.payout, multiplier: response.result.won ? response.result.target : 0 }
    history.value = [{ id: response.roundId, label: `${formatFixed(response.result.result, 2)}×`, won: response.result.won }, ...history.value].slice(0, 20)
    round.settle()
}

function onKey(event: KeyboardEvent) {
    if (event.code === 'Space' && event.target === document.body) {
        event.preventDefault()
        void play()
    }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <GameFrame slug="limbo">
    <template #actions>
      <GameSoundToggle />
    </template>
    <div class="@container">
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <!-- The win centres on the sky (lifted by the ground band), not on the readout. -->
        <GameWinBurst :show="win" class="rounded-[1.5rem]" style="--wb-lift: 6.75rem">
          <GameFelt tone="night" class="h-full">
            <div class="flex h-full min-h-[21rem] flex-col sm:min-h-[26rem]">
              <!-- The sky, edge to edge in the rail: stars in three depths, clouds, a moon and the city with the launch pad. -->
              <div
                class="limbo-sky relative min-h-[15rem] flex-1 overflow-hidden"
                :class="flying ? 'limbo-flying' : ''"
                :style="{ '--alt': rocketY }"
              >
                <div class="limbo-stars limbo-stars-far absolute inset-0" />
                <div class="limbo-stars limbo-stars-mid absolute inset-0" />
                <div class="limbo-stars limbo-stars-near absolute inset-0" />
                <div class="limbo-moon absolute top-[18%] left-[10%] size-10 rounded-full sm:size-12" />
                <svg viewBox="0 0 120 40" class="limbo-cloud absolute bottom-[38%] left-[4%] w-28 sm:w-36" aria-hidden="true"><path :d="CLOUD" /></svg>
                <svg viewBox="0 0 120 40" class="limbo-cloud limbo-cloud-2 absolute right-[3%] bottom-[60%] w-24 sm:w-32" aria-hidden="true"><path :d="CLOUD" /></svg>

                <!-- The city: a far row and a near row of buildings, a few windows lit. -->
                <svg viewBox="0 0 400 56" preserveAspectRatio="xMidYMax slice" class="absolute inset-x-0 bottom-0 h-14 w-full sm:h-16" aria-hidden="true">
                  <rect v-for="(b, i) in SKYLINE_FAR" :key="`f${i}`" :x="b.x" :y="56 - b.h" :width="b.w" :height="b.h" fill="#2b2160" />
                  <rect v-for="(b, i) in SKYLINE_NEAR" :key="`n${i}`" :x="b.x" :y="56 - b.h" :width="b.w" :height="b.h" fill="#150f31" />
                  <rect v-for="(w, i) in WINDOWS" :key="`w${i}`" :x="w.x" :y="w.y" width="2.2" height="2.6" rx=".4" fill="#ffd76a" :opacity="w.o" />
                </svg>

                <!-- Last results, newest first. -->
                <div class="limbo-history absolute inset-x-0 top-0 z-10 px-3 pt-3">
                  <GameRoundHistory :items="history" compact />
                </div>

                <!-- The climb: the pad at the bottom, the top kept clear for the rocket's height. -->
                <div class="absolute inset-x-0 top-[4.5rem] bottom-3 sm:top-[5.5rem]">
                  <!-- The target: a glowing line with its label, green once the rocket passes it. -->
                  <div
                    class="limbo-target absolute inset-x-0 z-[1] transition-opacity duration-300"
                    :class="[passed ? 'passed' : landed === 'lost' ? 'missed' : '', landed === 'won' ? 'opacity-0' : '']"
                    :style="{ bottom: `${targetY * 100}%` }"
                  >
                    <span class="limbo-target-label g-num absolute right-2 bottom-1.5 rounded-full px-2.5 py-0.5 text-sm sm:text-base">{{ formatFixed(target, 2) }}×</span>
                  </div>
                  <!-- The exhaust trail from the pad up to the rocket. -->
                  <div
                    class="limbo-trail absolute bottom-0 left-1/2 w-3 -translate-x-1/2 rounded-full"
                    :class="flying || landed ? 'opacity-100' : 'opacity-0'"
                    :style="{ height: `${rocketY * 100}%` }"
                  />
                  <span v-if="launchId" :key="launchId" class="limbo-smoke absolute bottom-0 left-1/2" aria-hidden="true"><i /><i /><i /><i /></span>
                  <!-- A full-height layer moved by a share of its own height: the rocket climbs with transforms only. -->
                  <div class="pointer-events-none absolute inset-0 z-[2]" :style="{ transform: `translateY(-${rocketY * 100}%)` }">
                    <svg
                      viewBox="0 0 40 72"
                      class="absolute -bottom-3.5 left-1/2 h-16 w-9 -translate-x-1/2 overflow-visible sm:-bottom-[1.1rem] sm:h-20 sm:w-11"
                      :class="[flying ? 'limbo-shake' : '', landed === 'lost' ? 'limbo-down' : '']"
                      aria-hidden="true"
                    >
                      <g v-if="flying" class="limbo-flame">
                        <path d="M13 56h14l-7 16Z" fill="#fb923c" />
                        <path d="M16 56h8l-4 10Z" fill="#fde047" />
                      </g>
                      <path d="M11 30 2 48l10-4ZM29 30l9 18-10-4Z" fill="#e11d48" />
                      <path d="M11 30 2 48l3-1Z M29 30l9 18-3-1Z" fill="#9f1239" />
                      <path d="M20 2c8.5 8 11.5 22 9.5 42h-19C8.5 24 11.5 10 20 2Z" fill="#f8fafc" />
                      <path d="M20 2c8.5 8 11.5 22 9.5 42H20Z" fill="#cbd5e1" />
                      <path d="M20 2c4 3.8 6.8 8.6 8.2 14H11.8C13.2 10.6 16 5.8 20 2Z" fill="#e11d48" />
                      <circle cx="20" cy="26" r="5.2" fill="#38bdf8" stroke="#0c4a6e" stroke-width="2" />
                      <circle cx="18.4" cy="24.4" r="1.6" fill="#e0f2fe" />
                      <path d="M12.5 44h15l-2.5 6h-10Z" fill="#475569" />
                      <path d="M15 50h10l-1 6h-8Z" fill="#334155" />
                    </svg>
                  </div>
                </div>

                <!-- The launch pad: a deck on two legs and a gantry. -->
                <svg viewBox="0 0 96 30" class="absolute bottom-0 left-1/2 z-[1] h-[1.9rem] w-24 -translate-x-1/2" aria-hidden="true">
                  <path d="M20 4h4v26h-4ZM20 8l10 6M20 16l10 6M24 6l-4 6M24 14l-4 6" stroke="#64748b" stroke-width="1.6" fill="none" />
                  <rect x="18" y="2" width="8" height="2.5" rx="1" fill="#94a3b8" />
                  <path d="M30 21h36l-4 4H34Z" fill="#475569" />
                  <rect x="28" y="18" width="40" height="3.5" rx="1.5" fill="#94a3b8" />
                  <path d="M34 25h4v5h-4ZM58 25h4v5h-4Z" fill="#334155" />
                  <circle cx="30" cy="19.5" r="1.2" fill="#ef4444" class="limbo-beacon" />
                  <circle cx="66" cy="19.5" r="1.2" fill="#ef4444" class="limbo-beacon" />
                </svg>
              </div>

              <!-- The ground: one hero, the target before a launch, the climbing number, or where the rocket got to. -->
              <div class="limbo-ground relative px-3 pt-1.5 pb-2.5 text-center" aria-live="polite">
                <div>
                  <p class="g-title text-xs tracking-wide uppercase sm:text-sm" :class="landed === 'lost' ? 'text-[#ffc2cc]' : landed === 'won' ? 'text-[#7ee08f]' : 'text-white/60'">
                    {{ landed === 'lost' ? `×0 · needed ${formatFixed(last?.target ?? target, 2)}×` : landed === 'won' ? 'Reached' : flying ? 'Climbing' : 'Reach' }}
                  </p>
                  <p
                    :key="last ? history[0]?.id : 'live'"
                    class="limbo-readout leading-[.95] whitespace-nowrap tabular-nums"
                    :class="landed === 'lost' ? 'limbo-lost' : passed ? 'text-[#7ee08f]' : 'text-white'"
                    :style="{ '--chars': readout.length }"
                  >
                    {{ readout }}
                  </p>
                </div>
              </div>
            </div>
          </GameFelt>
        </GameWinBurst>

        <div class="g-ui g-panel flex min-w-0 flex-col gap-3 rounded-[1.5rem] p-3 sm:p-4">
          <GameBetInput v-model="bet" :min="info.minBet" :max="info.maxBet" :disabled="round.busy.value" />

          <label class="g-well flex h-14 items-center gap-2 rounded-2xl px-3 focus-within:ring-2 focus-within:ring-[var(--g-gold)]/60">
            <span class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Target</span>
            <input
              v-model="targetText"
              inputmode="decimal"
              aria-label="Target multiplier"
              class="g-num min-w-0 flex-1 bg-transparent text-right text-3xl text-[var(--g-gold)] outline-none disabled:opacity-60"
              :disabled="round.busy.value"
              @blur="targetText = formatFixed(target, 2, false)"
              @keydown.enter.prevent="targetText = formatFixed(target, 2, false)"
            >
            <span class="g-num text-2xl text-[var(--g-gold)]">×</span>
          </label>

          <div class="flex items-center justify-between gap-1">
            <button
              v-for="p in presets" :key="p.value"
              type="button"
              class="limbo-chip grid size-12 shrink-0 place-items-center rounded-full font-[family-name:var(--font-game)] text-sm text-white transition disabled:opacity-40"
              :class="target === p.value ? 'limbo-chip-on' : ''"
              :style="{ '--face': p.face, '--edge': p.edge }"
              :disabled="round.busy.value"
              :aria-pressed="target === p.value"
              :aria-label="`Target ${p.value}×`"
              @click="targetText = formatFixed(p.value, 2, false)"
            >
              {{ formatFixed(p.value, p.value % 1 ? 1 : 0) }}×
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Chance</p>
              <p class="g-num truncate text-2xl">{{ formatFixed(chance, chance < 1 ? 4 : 2) }}%</p>
            </div>
            <div class="g-well min-w-0 rounded-2xl px-1 py-2">
              <p class="text-[11px] font-semibold tracking-wide text-[var(--g-muted)] uppercase">Win</p>
              <p class="g-num flex items-center justify-center gap-1 truncate text-2xl text-[var(--g-green)]" :title="`${formatCoinsExact(payout)} chips`">
                <CasinoChipIcon class="size-4" />{{ formatCoins(payout) }}
              </p>
            </div>
          </div>

          <!-- Sticks to the bottom of the sheet, so Launch never scrolls out of reach on a phone. -->
          <div class="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto rounded-b-[1.4rem] bg-[var(--g-panel)] px-3 pt-1 pb-3 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            <button type="button" class="g-btn g-orange h-16 w-full rounded-2xl text-3xl uppercase" :disabled="round.busy.value" @click="play">
              {{ flying ? 'Flying…' : 'Launch' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #rules>
      <p>Name a target multiplier, then launch. The game draws a result; when it reaches your target you win bet × target.</p>
      <p>The chance of reaching target t is 98% ÷ t, so every target returns 98%. Space launches.</p>
    </template>
  </GameFrame>
</template>

<style scoped>
.limbo-readout {
    font-family: var(--font-game);
    letter-spacing: 0.01em;
    /* Big, but one line: long multipliers get smaller. */
    font-size: clamp(2.5rem, calc(92cqw / (var(--chars) * 0.58)), 4.75rem);
    text-shadow: 0 5px 0 rgb(0 0 0 / 0.4);
}
.limbo-lost { color: #ffc2cc; animation: limbo-thud 0.35s ease-out; }

/* ─── the sky ───────────────────────────────────────────────────────────────── */
.limbo-sky {
    background:
        radial-gradient(ellipse 70% 38% at 50% 100%, rgb(255 138 92 / 0.38), transparent 70%),
        linear-gradient(180deg, #070618 0%, #120d3a 40%, #2a1b5e 72%, #5b2f73 100%);
}
.limbo-stars { pointer-events: none; }
.limbo-stars-far {
    opacity: 0.45;
    background-image: radial-gradient(circle, #fff 0.6px, transparent 1.1px), radial-gradient(circle, #c7d2fe 0.6px, transparent 1.1px);
    background-size: 37px 41px, 53px 47px;
    background-position: 0 0, 18px 22px;
}
.limbo-stars-mid {
    opacity: 0.65;
    background-image: radial-gradient(circle, #fff 1px, transparent 1.6px);
    background-size: 97px 89px;
    background-position: 30px 12px;
    animation: limbo-twinkle 3.2s ease-in-out infinite alternate;
}
.limbo-stars-near {
    opacity: 0.9;
    background-image: radial-gradient(circle, #fff 1.4px, rgb(255 255 255 / 0.25) 2.4px, transparent 3.4px);
    background-size: 163px 151px;
    background-position: 70px 40px;
}
/* In flight the stars stream past, the near ones fastest. */
.limbo-flying .limbo-stars-far { animation: limbo-far 1.4s linear infinite; }
.limbo-flying .limbo-stars-mid { animation: limbo-mid 0.8s linear infinite; }
.limbo-flying .limbo-stars-near { animation: limbo-near 0.45s linear infinite; }
.limbo-moon {
    background: radial-gradient(circle at 38% 36%, #fffbe8 0%, #f5e7b8 55%, #d9c38a 100%);
    box-shadow: 0 0 24px 6px rgb(255 240 190 / 0.25), inset -6px -4px 0 rgb(0 0 0 / 0.12);
    transform: translateY(calc(var(--alt, 0) * 40%));
    transition: transform 0.2s linear;
}
.limbo-cloud { fill: rgb(214 200 255 / 0.13); transform: translateY(calc(var(--alt, 0) * 320%)); transition: transform 0.2s linear; pointer-events: none; }
.limbo-cloud-2 { fill: rgb(214 200 255 / 0.09); transform: translateY(calc(var(--alt, 0) * 220%)); }
.limbo-history { mask-image: linear-gradient(90deg, #000 85%, transparent); }

/* ─── the target, the trail, the pad ────────────────────────────────────────── */
.limbo-target { height: 0; border-top: 3px dashed #ffc93a; filter: drop-shadow(0 0 6px rgb(255 201 58 / 0.85)); }
.limbo-target-label { background: #ffc93a; color: #4a2a00; box-shadow: 0 2px 0 rgb(0 0 0 / 0.35); }
.limbo-target.passed { border-color: #3fd25a; filter: drop-shadow(0 0 8px rgb(63 210 90 / 0.9)); }
.limbo-target.passed .limbo-target-label { background: #3fd25a; color: #06310f; }
.limbo-target.missed { border-color: #ff5470; filter: drop-shadow(0 0 6px rgb(255 84 112 / 0.7)); }
.limbo-target.missed .limbo-target-label { background: #ff5470; color: #fff; }
.limbo-trail {
    background: linear-gradient(0deg, transparent 0%, rgb(255 180 110 / 0.18) 30%, rgb(255 214 140 / 0.7) 100%);
    filter: blur(3px);
    transition: opacity 0.8s ease;
}
.limbo-smoke { width: 0; height: 0; pointer-events: none; }
.limbo-smoke i {
    position: absolute;
    left: -14px;
    bottom: -10px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgb(226 222 240 / 0.55);
    animation: limbo-smoke 0.9s ease-out both;
}
.limbo-smoke i:nth-child(1) { --sx: -46px; }
.limbo-smoke i:nth-child(2) { --sx: 46px; animation-delay: 0.04s; }
.limbo-smoke i:nth-child(3) { --sx: -24px; animation-delay: 0.1s; }
.limbo-smoke i:nth-child(4) { --sx: 26px; animation-delay: 0.14s; }
.limbo-beacon { animation: limbo-beacon 1.4s ease-in-out infinite; }
.limbo-down { transform: rotate(14deg) translateY(4px); filter: grayscale(0.7) brightness(0.8); transition: transform 0.35s ease, filter 0.35s ease; }

/* ─── the ground and the readout ────────────────────────────────────────────── */
.limbo-ground { background: linear-gradient(180deg, #150f31, #0d0a22); border-top: 2px solid #2b2160; }
.limbo-shake { animation: limbo-shake 0.1s linear infinite; }
.limbo-flame { transform-origin: 20px 56px; animation: limbo-flame 0.12s ease-in-out infinite alternate; }
.limbo-chip {
    background: radial-gradient(circle, var(--face) 0 52%, transparent 53%), repeating-conic-gradient(#fff 0 15deg, var(--face) 15deg 45deg);
    border: 2px solid var(--edge);
    box-shadow: 0 3px 0 var(--edge), inset 0 0 0 3px var(--face);
    text-shadow: 0 1.5px 0 rgb(0 0 0 / 0.45);
}
.limbo-chip:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 var(--edge), inset 0 0 0 3px var(--face); }
.limbo-chip-on { transform: translateY(-3px) scale(1.08); box-shadow: 0 5px 0 var(--edge), 0 0 0 3px #fff, 0 0 16px rgb(255 255 255 / 0.5); }
@keyframes limbo-thud { 0% { transform: translateX(0); } 25% { transform: translateX(-6px); } 50% { transform: translateX(5px); } 75% { transform: translateX(-2px); } 100% { transform: translateX(0); } }
@keyframes limbo-far { to { background-position: 0 41px, 18px 69px; } }
@keyframes limbo-mid { to { background-position: 30px 101px; } }
@keyframes limbo-near { to { background-position: 70px 191px; } }
@keyframes limbo-twinkle { to { opacity: 0.4; } }
@keyframes limbo-beacon { 50% { opacity: 0.25; } }
@keyframes limbo-smoke {
    0% { transform: translate(0, 0) scale(0.4); opacity: 0; }
    20% { opacity: 1; }
    100% { transform: translate(var(--sx), -8px) scale(1.6); opacity: 0; }
}
@keyframes limbo-shake { 0%, 100% { transform: translateX(-1px); } 50% { transform: translateX(1px); } }
@keyframes limbo-flame { to { transform: scaleY(1.35); } }
@media (prefers-reduced-motion: reduce) {
    .limbo-lost, .limbo-flying .limbo-stars, .limbo-stars-mid, .limbo-shake, .limbo-flame, .limbo-beacon, .limbo-smoke i { animation: none; }
    .limbo-smoke { display: none; }
    .limbo-chip, .limbo-chip-on { transition: none; }
}
</style>
