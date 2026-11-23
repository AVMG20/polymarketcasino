<script setup lang="ts">
import { CASINO_STARS } from '#shared/stars'

/**
 * One moment per star rise, in the casino's game style: a golden star bursts
 * in over spinning rays and confetti, with the star's name, the track and the
 * gem bounty, and waits for a tap. A level-up jingle plays. Drops are silent.
 */
const { celebrations } = useWallet()
const sound = useTycoonSound()
const current = computed(() => celebrations.value[0] ?? null)
const star = computed(() => (current.value ? CASINO_STARS[current.value.level - 1] : null))

watch(current, value => value && sound.play('levelUp'))

function dismiss() {
    celebrations.value.shift()
}

const COLORS = ['#ffc93a', '#ff5470', '#3fd25a', '#4aa6ff', '#a879ff', '#2fe0d0']
const CONFETTI = Array.from({ length: 20 }, (_, i) => ({
    x: Math.round(Math.cos((i / 20) * Math.PI * 2) * (110 + (i % 3) * 35)),
    y: Math.round(Math.sin((i / 20) * Math.PI * 2) * (90 + (i % 4) * 20)),
    r: (i * 61) % 360,
    d: 150 + (i % 5) * 30,
    c: COLORS[i % COLORS.length]
}))
</script>

<template>
  <Transition name="star">
    <div v-if="current && star" :key="`${current.previous}-${current.level}`" class="g-ui fixed inset-0 z-50 grid place-items-center overflow-hidden bg-[#0b0712]/65 p-4" role="dialog" :aria-label="`${star.name}: ${current.level} of 10 stars`" @click="dismiss">
      <div class="rays pointer-events-none absolute top-1/2 left-1/2 size-[150vmax]" />
      <div class="relative w-full max-w-xs" @click.stop>
        <span
          v-for="(c, i) in CONFETTI"
          :key="i"
          class="confetti pointer-events-none absolute top-14 left-1/2 h-3 w-1.5 rounded-sm"
          :style="{ background: c.c, '--x': `${c.x}px`, '--y': `${c.y}px`, '--r': `${c.r}deg`, animationDelay: `${c.d}ms` }"
        />
        <div class="g-panel card relative rounded-[28px] px-5 pt-16 pb-5 text-center">
          <svg viewBox="0 0 24 24" class="big-star absolute -top-14 left-1/2 size-32" aria-hidden="true">
            <defs>
              <linearGradient id="star-gold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#fff2a8" />
                <stop offset="0.5" stop-color="#ffc93a" />
                <stop offset="1" stop-color="#e88a00" />
              </linearGradient>
            </defs>
            <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="url(#star-gold)" stroke="#7a4a00" stroke-width="1.1" stroke-linejoin="round" />
            <text x="12" y="14.6" text-anchor="middle" font-size="6" font-family="var(--font-game)" fill="#5a3200">{{ current.level }}</text>
          </svg>
          <p class="g-num text-sm text-[#ffe066] uppercase">{{ current.level }} / 10</p>
          <p class="g-title mt-0.5 text-3xl leading-tight uppercase">{{ star.name }}</p>
          <div class="mt-3 flex justify-center gap-1" :aria-label="`${current.level} of 10 stars`">
            <span v-for="i in 10" :key="i" class="pip block size-4 rounded-[5px] border-2" :class="i <= current.level ? 'border-[#7a4a00] bg-[#ffc93a]' : 'border-black/40 bg-black/30'" :style="{ animationDelay: `${300 + i * 40}ms` }" />
          </div>
          <p v-if="current.bounty" class="g-num mt-3 inline-flex items-center gap-1 rounded-full bg-black/30 px-3 py-1 text-lg text-[#2fe0d0]">
            +{{ current.bounty }} <CasinoGemIcon class="size-5" />
          </p>
          <button type="button" class="g-btn g-green mt-4 h-14 w-full rounded-2xl text-xl uppercase" @click="dismiss">Nice!</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.card {
  border-color: #c3840a;
  box-shadow: 0 5px 0 #7a4a00, 0 0 0 3px rgb(255 201 58 / 0.45), 0 0 40px 8px rgb(255 201 58 / 0.35), inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.big-star {
  filter: drop-shadow(0 4px 0 rgb(0 0 0 / 0.45)) drop-shadow(0 0 18px rgb(255 201 58 / 0.7));
  animation: star-in 0.7s cubic-bezier(0.3, 1.6, 0.5, 1) both, star-bob 2.4s ease-in-out 0.7s infinite;
}
@keyframes star-in {
  0% { transform: translateX(-50%) scale(0) rotate(-120deg); }
  100% { transform: translateX(-50%) scale(1) rotate(0); }
}
@keyframes star-bob {
  0%, 100% { transform: translateX(-50%) translateY(0) rotate(0); }
  50% { transform: translateX(-50%) translateY(-5px) rotate(4deg); }
}
.pip { animation: pip-in 0.35s cubic-bezier(0.3, 1.6, 0.5, 1) both; }
@keyframes pip-in {
  0% { transform: scale(0); }
  100% { transform: scale(1); }
}
.rays {
  transform: translate(-50%, -50%);
  background: repeating-conic-gradient(from 0deg, rgb(255 214 92 / 0.2) 0deg 9deg, transparent 9deg 22deg);
  mask-image: radial-gradient(circle, #000 0%, transparent 40%);
  animation: rays-spin 16s linear infinite;
}
@keyframes rays-spin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
.confetti {
  opacity: 0;
  animation: confetti 1.5s cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
}
@keyframes confetti {
  0% { opacity: 1; transform: translate(-50%, -50%) rotate(0) scale(0.4); }
  60% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y) + 80px)) rotate(calc(var(--r) + 360deg)) scale(1); }
}
.star-enter-active { transition: opacity 0.25s ease; }
.star-enter-active .card { transition: transform 0.45s cubic-bezier(0.3, 1.5, 0.5, 1); }
.star-leave-active { transition: opacity 0.18s ease; }
.star-enter-from, .star-leave-to { opacity: 0; }
.star-enter-from .card { transform: scale(0.7) translateY(30px); }
@media (prefers-reduced-motion: reduce) {
  .confetti { display: none; }
  .rays, .big-star, .pip { animation: none; }
  .star-enter-active .card { transition: none; }
  .star-enter-from .card { transform: none; }
}
</style>
