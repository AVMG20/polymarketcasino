<script setup lang="ts">
import { levelUnlocks } from '#shared/casino-level'
import type { DecorType } from '#shared/decor'

/**
 * The casino level went up: a short purple ribbon with the new level and
 * what it unlocks, a jingle and a burst of confetti. When a build's own
 * banner is on screen (the build that earned the XP), it waits its turn.
 */
const tycoon = useTycoon()
const sound = useTycoonSound()
const moment = ref<{ key: number, level: number, games: string[], decor: DecorType[] } | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let wait: ReturnType<typeof setTimeout> | null = null

/** A build banner lasts 2.8 s (Celebration.vue): show after it. */
const BUILD_BANNER_MS = 2_800

watch(() => tycoon.levelUp.value, (up) => {
    if (!up) return
    if (wait) clearTimeout(wait)
    const built = tycoon.lastBuilt.value
    const delay = built ? Math.max(0, built.at + BUILD_BANNER_MS - Date.now()) : 0
    wait = setTimeout(() => show(up.level, up.at), delay)
})

function show(level: number, key: number) {
    wait = null
    const u = levelUnlocks().find(x => x.level === level)
    moment.value = { key, level, games: u?.games ?? [], decor: u?.decor ?? [] }
    sound.play('levelUp')
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (moment.value = null), 3_200)
}
onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    if (wait) clearTimeout(wait)
})

const COLORS = ['#ffc93a', '#a879ff', '#3fd25a', '#4aa6ff', '#ff5470', '#2fe0d0']
const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
    x: Math.round(Math.cos((i / 18) * Math.PI * 2) * (90 + (i % 3) * 40)),
    y: Math.round(Math.sin((i / 18) * Math.PI * 2) * (50 + (i % 4) * 18)) - 30,
    r: (i * 67) % 360,
    d: (i % 5) * 30,
    c: COLORS[i % COLORS.length]
}))
</script>

<template>
  <Transition name="moment">
    <div v-if="moment" :key="moment.key" class="g-ui pointer-events-none absolute inset-x-0 top-[24%] z-[46] flex justify-center px-4" role="status">
      <div class="relative">
        <span
          v-for="(c, i) in CONFETTI"
          :key="i"
          class="confetti absolute top-1/2 left-1/2 h-3 w-1.5 rounded-sm"
          :style="{ background: c.c, '--x': `${c.x}px`, '--y': `${c.y}px`, '--r': `${c.r}deg`, animationDelay: `${c.d}ms` }"
        />
        <div class="ribbon relative flex items-center gap-3 rounded-[22px] py-2 pr-5 pl-2">
          <TycoonLevelBadge :level="moment.level" :progress="1" :size="60" :stroke="5" />
          <span class="flex min-w-0 flex-col items-start">
            <span class="g-title text-2xl leading-none text-white uppercase sm:text-3xl">Casino level {{ moment.level }}!</span>
            <span v-if="moment.games.length || moment.decor.length" class="mt-1.5 flex items-center gap-1">
              <span class="mr-0.5 text-[12px] font-bold text-white/85 uppercase">Unlocked</span>
              <span v-for="slug in moment.games" :key="slug" class="block size-7 overflow-hidden rounded-md border-2 border-black/50"><TycoonGameArt :slug="slug" /></span>
              <span v-for="type in moment.decor" :key="type" class="block size-7 overflow-hidden rounded-md border-2 border-black/50"><TycoonDecorArt :type="type" /></span>
            </span>
          </span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ribbon {
  background: linear-gradient(180deg, #b48cff, #8a5cf0 55%, #6a3fd0);
  border: 3px solid #2d1866;
  box-shadow: 0 5px 0 #2d1866, 0 16px 34px rgb(0 0 0 / 0.45), inset 0 3px 0 rgb(255 255 255 / 0.4);
}
.ribbon .g-title { text-shadow: 0 2px 0 #2d1866, 0 0 1px #2d1866; }
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
@media (prefers-reduced-motion: reduce) {
  .confetti { display: none; }
  .moment-enter-active, .moment-leave-active { transition: opacity 0.2s ease; }
  .moment-enter-from, .moment-leave-to { transform: none; }
}
</style>
