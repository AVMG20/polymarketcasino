<script setup lang="ts">
import type { BuildKind } from '#shared/tycoon'

/**
 * A construction finished: "LIMBO BUILT!", a short banner with confetti and a
 * fanfare (a level-up jingle for a new level). A new zone is the big one:
 * the camera flies there (the page focuses it), light rays, confetti
 * raining over the whole floor and a big "MAIN FLOOR OPEN!".
 */
const tycoon = useTycoon()
const sound = useTycoonSound()

const moment = ref<{ key: number, kind: BuildKind, id: string, title: string, level: number } | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

watch(() => tycoon.lastBuilt.value, (built) => {
    if (!built) return
    const name = buildName(built.kind, built.id)
    const title = built.kind === 'zone' ? `${name} open!` : built.level > 1 || built.kind === 'upgrade' ? `${name} Lv ${built.level}!` : `${name} built!`
    moment.value = { key: built.at, kind: built.kind, id: built.id, title, level: built.level }
    sound.play(built.kind === 'zone' ? 'zone' : built.level > 1 || built.kind === 'upgrade' ? 'levelUp' : 'fanfare')
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (moment.value = null), built.kind === 'zone' ? 4_200 : 2_800)
})
onBeforeUnmount(() => timer && clearTimeout(timer))

const COLORS = ['#ffc93a', '#ff5470', '#3fd25a', '#4aa6ff', '#a879ff', '#2fe0d0']
// Fixed spread so nothing random runs per frame: angle, distance, spin, delay.
const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
    x: Math.round(Math.cos((i / 18) * Math.PI * 2) * (90 + (i % 3) * 40)),
    y: Math.round(Math.sin((i / 18) * Math.PI * 2) * (50 + (i % 4) * 18)) - 30,
    r: (i * 67) % 360,
    d: (i % 5) * 30,
    c: COLORS[i % COLORS.length]
}))
// The zone's rain: pieces across the width, falling at different speeds.
const RAIN = Array.from({ length: 42 }, (_, i) => ({
    left: (i * 37) % 100,
    d: (i % 7) * 140 + Math.floor(i / 7) * 60,
    t: 1.9 + (i % 5) * 0.35,
    r: (i * 83) % 360,
    w: 6 + (i % 3) * 3,
    c: COLORS[i % COLORS.length]
}))
</script>

<template>
  <Transition name="zone">
    <div v-if="moment && moment.kind === 'zone'" :key="moment.key" class="g-ui pointer-events-none absolute inset-0 z-[45] overflow-hidden" role="status">
      <div class="rays absolute top-[38%] left-1/2 size-[160vmax]" />
      <span
        v-for="(c, i) in RAIN"
        :key="i"
        class="rain absolute -top-6 rounded-sm"
        :style="{ left: `${c.left}%`, width: `${c.w}px`, height: `${c.w * 1.8}px`, background: c.c, '--r': `${c.r}deg`, animationDelay: `${c.d}ms`, animationDuration: `${c.t}s` }"
      />
      <div class="absolute inset-x-0 top-[30%] flex flex-col items-center px-4">
        <div class="zone-ribbon relative flex items-center gap-3 rounded-[28px] py-2.5 pr-7 pl-2.5">
          <span class="block size-16 shrink-0 overflow-hidden rounded-2xl border-2 border-black/50 shadow-[0_3px_0_rgb(0_0_0/0.35)] sm:size-20">
            <TycoonItemArt :kind="moment.kind" :id="moment.id" />
          </span>
          <span class="g-title text-3xl leading-none text-white uppercase sm:text-5xl">{{ moment.title }}</span>
        </div>
        <p class="g-title mt-3 text-lg text-[#ffe066] uppercase [text-shadow:0_2px_0_rgb(0_0_0/0.6)]">New games to build</p>
      </div>
    </div>
  </Transition>
  <Transition name="moment">
    <div v-if="moment && moment.kind !== 'zone'" :key="moment.key" class="g-ui pointer-events-none absolute inset-x-0 top-[28%] z-[45] flex justify-center px-4" role="status">
      <div class="relative">
        <span
          v-for="(c, i) in CONFETTI"
          :key="i"
          class="confetti absolute top-1/2 left-1/2 h-3 w-1.5 rounded-sm"
          :style="{ background: c.c, '--x': `${c.x}px`, '--y': `${c.y}px`, '--r': `${c.r}deg`, animationDelay: `${c.d}ms` }"
        />
        <div class="ribbon relative flex items-center gap-3 rounded-[22px] py-2 pr-6 pl-2">
          <span class="block size-14 shrink-0 overflow-hidden rounded-2xl border-2 border-black/50 shadow-[0_3px_0_rgb(0_0_0/0.35)]">
            <TycoonItemArt :kind="moment.kind" :id="moment.id" />
          </span>
          <span class="flex flex-col items-start">
            <span class="g-title text-2xl leading-none text-white uppercase sm:text-3xl">{{ moment.title }}</span>
            <TycoonPips :level="moment.level" :max="5" size="md" class="mt-1.5" />
          </span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ribbon, .zone-ribbon {
  background: linear-gradient(180deg, #ffd65c, #ffb020 55%, #e88a00);
  border: 3px solid #7a4a00;
  box-shadow: 0 5px 0 #7a4a00, 0 16px 34px rgb(0 0 0 / 0.45), inset 0 3px 0 rgb(255 255 255 / 0.5);
}
.ribbon .g-title, .zone-ribbon .g-title { text-shadow: 0 2px 0 #7a4a00, 0 0 1px #7a4a00; }
.zone-ribbon { animation: zone-throb 1.2s ease-in-out 0.5s infinite; }
@keyframes zone-throb {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}
.rays {
  transform: translate(-50%, -50%);
  background: repeating-conic-gradient(from 0deg, rgb(255 214 92 / 0.22) 0deg 9deg, transparent 9deg 22deg);
  mask-image: radial-gradient(circle, #000 0%, transparent 42%);
  animation: rays-spin 14s linear infinite;
}
@keyframes rays-spin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
.rain {
  opacity: 0;
  animation-name: rain;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes rain {
  0% { opacity: 1; transform: translateY(0) rotate(0); }
  85% { opacity: 1; }
  100% { opacity: 0; transform: translateY(105vh) rotate(calc(var(--r) + 540deg)); }
}
.confetti {
  opacity: 0;
  animation: confetti 1.3s cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
}
@keyframes confetti {
  0% { opacity: 1; transform: translate(-50%, -50%) rotate(0) scale(0.4); }
  60% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y) + 60px)) rotate(calc(var(--r) + 360deg)) scale(1); }
}
.moment-enter-active { transition: transform 0.45s cubic-bezier(0.3, 1.6, 0.5, 1), opacity 0.2s ease; }
.moment-leave-active { transition: transform 0.3s ease, opacity 0.3s ease; }
.moment-enter-from { opacity: 0; transform: scale(0.5) translateY(20px); }
.moment-leave-to { opacity: 0; transform: translateY(-16px); }
.zone-enter-active { transition: opacity 0.25s ease; }
.zone-enter-active .zone-ribbon { animation: zone-in 0.6s cubic-bezier(0.3, 1.6, 0.5, 1) both, zone-throb 1.2s ease-in-out 0.6s infinite; }
.zone-leave-active { transition: opacity 0.4s ease; }
.zone-enter-from, .zone-leave-to { opacity: 0; }
@keyframes zone-in {
  0% { transform: scale(0.2) rotate(-8deg); }
  100% { transform: scale(1) rotate(0); }
}
@media (prefers-reduced-motion: reduce) {
  .confetti, .rain { display: none; }
  .rays, .zone-ribbon, .zone-enter-active .zone-ribbon { animation: none; }
  .moment-enter-active, .moment-leave-active { transition: opacity 0.2s ease; }
  .moment-enter-from, .moment-leave-to { transform: none; }
}
</style>
