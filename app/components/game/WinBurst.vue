<script lang="ts">
export interface WinShow {
    /** A new id restarts the show (the round id). */
    id: string | number
    /** The payout, always chips (economy v2: every win pays chips). */
    payout: number
    multiplier: number
}
</script>

<script setup lang="ts">
import { formatCoins, formatCoinsExact } from '#shared/money'

/**
 * Wraps a game's stage and puts the round's result in the player's face: a
 * huge white "+19" with a warm gold glow and the blue chip next to it (every
 * win pays chips; white so a win always reads as a win), a burst of chips and
 * the multiplier as a badge. Bigger multipliers get a bigger show (BIG WIN
 * ≥ 5×, HUGE WIN ≥ 20×: more chips, rays, a shake). A loss is only a short
 * red flash: the game marks its own result ×0, where the player is looking.
 *
 * Set `--wb-lift` on it to centre the result higher (above a track).
 *
 * It never blocks play: the layer ignores the pointer. After the show a win
 * settles (the burst fades, the amount and multiplier shrink and stay) until
 * `show` is set to null (the next round starting), which clears it at once.
 */
const props = defineProps<{ show: WinShow | null }>()

type Tier = 'loss' | 'small' | 'win' | 'big' | 'huge'
const TIERS: Record<Tier, { hold: number, count: number, coins: number, shake: string }> = {
    loss: { hold: 500, count: 0, coins: 0, shake: '' },
    small: { hold: 1100, count: 300, coins: 0, shake: '' },
    win: { hold: 1350, count: 450, coins: 16, shake: '' },
    big: { hold: 1900, count: 800, coins: 28, shake: 'wb-shake' },
    huge: { hold: 2400, count: 1100, coins: 44, shake: 'wb-shake-hard' }
}

const active = ref<WinShow | null>(null)
const shown = ref(0)
const reduced = ref(false)
const tier = computed<Tier>(() => {
    const win = active.value
    if (!win || win.payout <= 0) return 'loss'
    if (win.multiplier < 1) return 'small'
    if (win.multiplier >= 20) return 'huge'
    if (win.multiplier >= 5) return 'big'
    return 'win'
})
const label = computed(() => `+${formatCoins(shown.value)}`)
// Fits the final amount on one line: long amounts get a smaller size.
const chars = computed(() => `+${formatCoins(active.value?.payout ?? 0)}`.length + 2)
const multipleFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 })
const coins = ref<{ id: number, style: Record<string, string> }[]>([])

const leaving = ref(false)
/** The show is over: a win stays on the stage, smaller, until the next round. */
const settled = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let frame = 0

function stop() {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    leaving.value = false
    settled.value = false
}

/** A win stays; a loss fades out. */
function settle() {
    if (tier.value === 'loss') return hide()
    settled.value = true
    coins.value = []
}

/** Fades out, then clears. */
function hide() {
    leaving.value = true
    timer = setTimeout(() => {
        leaving.value = false
        active.value = null
    }, 220)
}

function countUp(to: number, duration: number) {
    if (!duration || reduced.value) {
        shown.value = to
        return
    }
    const start = performance.now()
    const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        // Ease out, rounded down to whole coins on the way (never shows more than the payout).
        const value = to * (1 - (1 - t) ** 3)
        shown.value = t < 1 ? (to >= 10 ? Math.floor(value) : Math.floor(value * 100) / 100) : to
        if (t < 1) frame = requestAnimationFrame(step)
    }
    shown.value = 0
    frame = requestAnimationFrame(step)
}

/** A ring of chips flung outwards with a little gravity (cosmetic, so Math.random). */
function burst(count: number) {
    coins.value = Array.from({ length: reduced.value ? 0 : count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5
        const reach = 90 + Math.random() * (count > 30 ? 190 : 130)
        const size = 12 + Math.random() * 12
        return {
            id: i,
            style: {
                '--dx': `${Math.cos(angle) * reach}px`,
                '--dy': `${Math.sin(angle) * reach * 0.75 - 30}px`,
                '--spin': `${(Math.random() - 0.5) * 720}deg`,
                'width': `${size}px`,
                'height': `${size}px`,
                'animationDelay': `${Math.random() * 120}ms`,
                'animationDuration': `${700 + Math.random() * 500}ms`
            }
        }
    })
}

watch(() => props.show, (next) => {
    stop()
    active.value = next
    if (!next) return
    reduced.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const config = TIERS[tier.value]
    countUp(next.payout, config.count)
    burst(config.coins)
    timer = setTimeout(settle, config.hold + (reduced.value ? 0 : config.count * 0.5))
}, { immediate: true })

onBeforeUnmount(stop)
</script>

<template>
  <div class="relative isolate [container-type:inline-size]" :class="active && !reduced ? TIERS[tier].shake : ''" :data-tier="active ? tier : null">
    <!-- `showing`: a win is on screen, so the stage can step back. -->
    <slot :showing="!!active && !leaving && !settled && tier !== 'loss'" />

    <div
      v-if="active" :key="active.id"
      class="pointer-events-none absolute inset-0 z-30 grid place-items-center overflow-hidden rounded-[inherit] pb-[var(--wb-lift,0px)] transition-opacity duration-200"
      :class="leaving ? 'opacity-0' : ''"
      aria-live="polite"
    >
      <!-- Loss: a short red flash; the game shows its own ×0 where the result is. -->
      <div v-if="tier === 'loss'" class="wb-flash absolute inset-0 rounded-[inherit]" />

      <template v-else>
        <!-- The burst: fades once the win settles. -->
        <div class="absolute inset-0 transition-opacity duration-300" :class="settled ? 'opacity-0' : ''">
          <div class="wb-dim absolute inset-0" />
          <div v-if="tier === 'big' || tier === 'huge'" class="wb-rays absolute top-1/2 left-1/2 aspect-square w-[160cqw] max-w-[60rem]" />
          <div class="wb-glow absolute top-1/2 left-1/2 aspect-square w-[min(90cqw,28rem)]" :class="tier === 'small' ? 'opacity-40' : ''" />
          <span v-for="coin in coins" :key="coin.id" class="wb-coin absolute top-1/2 left-1/2" :style="coin.style" />
        </div>

        <div class="wb-result relative flex max-w-full flex-col items-center px-3 text-center" :class="settled ? 'wb-settled' : ''">
          <span
            v-if="(tier === 'big' || tier === 'huge') && !settled"
            class="wb-banner g-title mb-1 rounded-full px-4 py-0.5 text-xl tracking-wider text-[#4a2a00] uppercase sm:text-2xl"
            :class="tier === 'huge' ? 'wb-banner-huge' : ''"
          >{{ tier === 'huge' ? 'Huge win' : 'Big win' }}</span>
          <span
            class="wb-amount block leading-none whitespace-nowrap"
            :class="[tier === 'small' ? 'wb-amount-plain' : 'wb-amount-win', reduced ? '' : 'wb-pop']"
            :style="{ '--chars': chars, '--max': tier === 'huge' ? '9.5rem' : tier === 'big' ? '8.5rem' : '7.5rem' }"
            :title="`${formatCoinsExact(active.payout)} chips`"
          >{{ label }}<CasinoChipIcon class="wb-chip" /></span>
          <div class="wb-meta mt-2 flex flex-wrap items-center justify-center gap-1.5">
            <span class="g-num rounded-full bg-black/60 px-3 py-0.5 text-lg text-[#ffd84a] ring-2 ring-[#ffd84a]/50 sm:text-xl">×{{ multipleFormat.format(active.multiplier) }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wb-result { transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1); }
.wb-settled { transform: scale(0.62); }
.wb-amount {
    font-family: var(--font-game);
    letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums;
    /* Big, but one line: shrinks for long amounts. */
    font-size: clamp(2.6rem, calc(94cqw / (var(--chars) * 0.56)), var(--max));
}
.wb-amount { display: inline-flex; align-items: center; }
/* White on a warm gold glow with a dark outline: reads on the purple UI and the green felt. */
.wb-amount-win {
    color: #fff;
    -webkit-text-stroke: 0.035em #5a3200;
    paint-order: stroke fill;
    filter: drop-shadow(0 4px 0 #6b3d00) drop-shadow(0 0 18px rgb(255 196 40 / 0.85));
}
/* The chip after the amount: every win pays chips. */
.wb-chip { width: 0.55em; height: 0.55em; margin-left: 0.14em; filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.45)); }
.wb-amount-plain { color: #fff; text-shadow: 0 4px 0 rgb(0 0 0 / 0.45); }
.wb-pop { animation: wb-pop 0.55s cubic-bezier(0.3, 0.7, 0.4, 1.5) both; }
.wb-meta { animation: wb-rise 0.35s 0.12s ease-out both; }
.wb-banner {
    background: linear-gradient(180deg, #fff3b0, #ffc93a 55%, #e79a00);
    box-shadow: 0 3px 0 #9a5a00, 0 0 24px rgb(255 201 58 / 0.6);
    animation: wb-banner 0.5s cubic-bezier(0.3, 0.7, 0.4, 1.6) both;
}
.wb-banner-huge { background: linear-gradient(180deg, #ffe0f0, #ff7ac1 50%, #c2187a); color: #fff; text-shadow: 0 2px 0 rgb(0 0 0 / 0.35); box-shadow: 0 3px 0 #7a0e4c, 0 0 30px rgb(255 90 180 / 0.7); }

.wb-dim { background: radial-gradient(ellipse at center, rgb(0 0 0 / 0.55) 0%, rgb(0 0 0 / 0.25) 55%, transparent 80%); animation: wb-in 0.15s ease-out both; }
.wb-glow {
    translate: -50% -50%;
    border-radius: 50%;
    background: radial-gradient(circle, rgb(255 214 70 / 0.75) 0%, rgb(255 170 0 / 0.25) 40%, transparent 68%);
    animation: wb-glow 1.2s ease-out both;
}
.wb-rays {
    translate: -50% -50%;
    border-radius: 50%;
    background: repeating-conic-gradient(rgb(255 220 110 / 0.28) 0deg 9deg, transparent 9deg 22.5deg);
    mask-image: radial-gradient(circle, #000 12%, transparent 62%);
    animation: wb-rays 2.6s linear both;
}
.wb-coin {
    margin: -8px 0 0 -8px;
    border-radius: 50%;
    /* A blue casino chip: white edge stripes around a darker inlay. */
    background:
        radial-gradient(circle, #1d4ed8 0 44%, #3b82f6 46% 62%, transparent 64%),
        repeating-conic-gradient(#fff 0deg 22deg, #3b82f6 22deg 45deg);
    box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.6), 0 1px 2px rgb(0 0 0 / 0.4);
    animation-name: wb-coin;
    animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1);
    animation-fill-mode: both;
}

.wb-flash { box-shadow: inset 0 0 60px 10px rgb(255 60 90 / 0.65); animation: wb-flash 0.5s ease-out both; }

.wb-shake { animation: wb-shake 0.45s 0.05s ease-out; }
.wb-shake-hard { animation: wb-shake-hard 0.7s 0.05s ease-out; }

@keyframes wb-in { from { opacity: 0; } }
@keyframes wb-pop {
    0% { transform: scale(0.3); opacity: 0; }
    55% { transform: scale(1.18); opacity: 1; }
    75% { transform: scale(0.95); }
    100% { transform: scale(1); }
}
@keyframes wb-rise { from { transform: translateY(10px); opacity: 0; } }
@keyframes wb-banner { from { transform: scale(0.2) rotate(-8deg); opacity: 0; } }
@keyframes wb-glow {
    0% { transform: scale(0.3); opacity: 0; }
    30% { transform: scale(1.1); opacity: 1; }
    100% { transform: scale(1); opacity: 0.7; }
}
@keyframes wb-rays {
    from { transform: rotate(0deg) scale(0.6); opacity: 0; }
    15% { opacity: 1; }
    to { transform: rotate(70deg) scale(1); opacity: 0.85; }
}
@keyframes wb-coin {
    0% { transform: translate(0, 0) scale(0.3) rotate(0deg); opacity: 0; }
    12% { opacity: 1; }
    60% { transform: translate(var(--dx), var(--dy)) scale(1) rotate(var(--spin)); opacity: 1; }
    100% { transform: translate(calc(var(--dx) * 1.12), calc(var(--dy) + 90px)) scale(0.85) rotate(var(--spin)); opacity: 0; }
}
@keyframes wb-flash { from { opacity: 0; } 25% { opacity: 1; } to { opacity: 0; } }
@keyframes wb-shake {
    0%, 100% { transform: translate(0, 0); }
    20% { transform: translate(-5px, 2px); }
    40% { transform: translate(5px, -2px); }
    60% { transform: translate(-3px, 1px); }
    80% { transform: translate(2px, 0); }
}
@keyframes wb-shake-hard {
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    12% { transform: translate(-9px, 4px) rotate(-0.6deg); }
    25% { transform: translate(8px, -5px) rotate(0.6deg); }
    40% { transform: translate(-7px, 3px) rotate(-0.4deg); }
    55% { transform: translate(6px, -2px) rotate(0.3deg); }
    70% { transform: translate(-3px, 1px); }
    85% { transform: translate(2px, 0); }
}

@media (prefers-reduced-motion: reduce) {
    .wb-pop, .wb-meta, .wb-banner, .wb-glow, .wb-rays, .wb-shake, .wb-shake-hard { animation: none; }
    .wb-rays { opacity: 0.5; }
    .wb-flash { animation-duration: 0.2s; }
}
</style>
