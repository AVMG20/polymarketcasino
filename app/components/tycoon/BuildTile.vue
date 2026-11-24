<script setup lang="ts">
import { ArrowBigUp, Crown, HardHat, Lock, Clock } from 'lucide-vue-next'
import { formatCoins } from '#shared/money'
import type { BuildKind } from '#shared/tycoon'

/** A square build tile: big art, name, level pips and the cost pill as its button. Tap the art for details. */
const props = defineProps<{ kind: BuildKind, id: string, suggested?: boolean }>()
const emit = defineEmits<{ open: [] }>()

const tycoon = useTycoon()
const v = computed(() => tycoon.view(props.kind, props.id))
const effect = computed(() => buildEffects(props.kind, props.id, v.value.level)[0] ?? null)
/** A new build shows the hard hat, a level-up the up arrow. */
const actionIcon = computed(() => (isNewBuild(props.kind, props.id, v.value.level) ? HardHat : ArrowBigUp))
const costTitle = computed(() => {
    if (!v.value.affordable) return `Need ${formatCoins(v.value.missingChips)} more chips`
    if (v.value.buildersFull) return 'Every builder is busy'
    const time = v.value.cost ? ` (${formatDuration(v.value.cost.buildMs)})` : ''
    return `${isNewBuild(props.kind, props.id, v.value.level) ? 'Build' : 'Upgrade'} ${v.value.name}${time}`
})

/** Hovering the build/upgrade button flips the art to the numbers that step changes (desktop). */
const hovered = ref(false)
const stats = computed(() => (hovered.value && !v.value.lockZone && !v.value.running && !v.value.maxed
    ? buildStats(props.kind, props.id, v.value.level, tycoon.state.value, tycoon.serverTime.value).slice(0, 3)
    : []))

async function tap() {
    if (!v.value.canStart || tycoon.busy.value) return emit('open')
    await tycoon.build(props.kind, props.id)
}
</script>

<template>
  <div class="tile relative flex min-w-0 flex-col rounded-[20px] p-1.5" :class="suggested ? 'g-pulse' : ''">
    <button
      type="button"
      class="relative aspect-square w-full overflow-hidden rounded-[14px] border-2 border-black/50"
      :aria-label="`${v.name} details`"
      @click="emit('open')"
    >
      <TycoonItemArt :kind="kind" :id="id" :dim="!!v.lockZone" />
      <!-- Effect badge and coin fee -->
      <span v-if="effect && !v.lockZone && !v.maxed" class="badge absolute top-1 right-1" :title="effect.title">
        <component :is="effect.icon" class="size-3" :style="{ color: effect.color }" :stroke-width="3" />{{ effect.text }}
      </span>
      <!-- Pips -->
      <span v-if="v.maxLevel > 1 && v.level > 0" class="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/75 to-transparent pt-3 pb-1">
        <TycoonPips :level="v.level" :max="v.maxLevel" />
      </span>
      <!-- Locked -->
      <span v-if="v.lockZone" class="absolute inset-0 grid place-items-center">
        <span class="grid size-10 place-items-center rounded-full border-2 border-black/50 bg-[#1b1329]/90 shadow-[0_3px_0_rgb(0_0_0/0.4)]"><Lock class="size-5 text-[#ffc93a]" :stroke-width="3" /></span>
      </span>
      <!-- Building: the progress bar with the time left, over the art -->
      <span v-else-if="v.running" class="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/25 to-black/10 p-1.5">
        <TycoonBuildBar :progress="1 - v.running.leftMs / v.running.total" :left-ms="v.running.leftMs" size="sm" />
      </span>
      <span v-else-if="v.maxed" class="absolute top-1 right-1 grid size-7 place-items-center rounded-full border-2 border-black/50 bg-[#ffc93a]"><Crown class="size-4 text-[#7a4a00]" :stroke-width="3" /></span>
      <!-- Hover: the numbers this step changes -->
      <Transition name="stats-flip">
        <span v-if="hovered && v.cost && !v.lockZone && !v.running" class="absolute inset-0 flex flex-col justify-center gap-1.5 bg-[#140d20]/94 p-2 text-left">
          <span v-for="stat in stats" :key="stat.label" class="flex min-w-0 items-center gap-1.5" :title="stat.title ?? stat.label">
            <component :is="stat.icon" class="size-4 shrink-0" :style="{ color: stat.color }" :stroke-width="2.75" />
            <span class="g-num ml-auto flex min-w-0 items-center gap-1 truncate text-[13px] leading-none">
              <template v-if="stat.now !== null"><span class="text-white/55">{{ stat.now.replace(/\/h$/, '') }}</span><span class="text-white/40">→</span></template>
              <span class="text-[#6ee787]">{{ stat.next }}</span>
            </span>
          </span>
          <!-- How long this step takes to build -->
          <span class="flex min-w-0 items-center gap-1.5" :class="stats.length ? 'mt-0.5 border-t border-white/10 pt-1.5' : ''" :title="`Takes ${formatDuration(v.cost.buildMs)} to build`">
            <Clock class="size-4 shrink-0 text-[#ffc93a]" :stroke-width="2.75" />
            <span class="g-num ml-auto truncate text-[13px] leading-none text-[#ffc93a]">{{ formatDuration(v.cost.buildMs) }}</span>
          </span>
        </span>
      </Transition>
    </button>

    <p class="mt-1 flex h-[30px] items-center justify-center px-0.5 text-center text-[12.5px] leading-[15px] font-semibold sm:text-[13px]" :title="v.name"><span class="line-clamp-2">{{ v.name }}</span></p>

    <span v-if="v.lockZone" class="state-pill mt-1 text-[#ffc93a]" :title="`Open the ${v.lockZone} first`">
      <Lock class="size-3.5 shrink-0" :stroke-width="3" /><span class="line-clamp-2 text-[11px] leading-[13px] sm:text-xs">{{ v.lockZone }}</span>
    </span>
    <TycoonSkipButton v-else-if="v.running" class="mt-1 h-11 w-full rounded-xl px-1 text-[15px]" :left-ms="v.running.leftMs" :target="`${kind}:${id}`" />
    <span v-else-if="v.maxed" class="state-pill mt-1 text-[#ffc93a]"><span class="g-num">MAX</span></span>
    <button
      v-else-if="v.cost"
      type="button"
      @pointerenter="(e: PointerEvent) => (hovered = e.pointerType === 'mouse')"
      @pointerleave="hovered = false"
      @focus="hovered = true"
      @blur="hovered = false"
      class="g-btn mt-1 h-11 w-full rounded-xl px-1 text-[15px]"
      :class="!v.affordable ? 'g-off' : v.buildersFull ? 'g-dark' : 'g-green'"
      :aria-disabled="!v.canStart"
      :disabled="tycoon.busy.value"
      :title="costTitle"
      @click="tap"
    >
      <component :is="actionIcon" class="size-4 shrink-0" :class="v.affordable ? 'opacity-90' : 'opacity-70'" :stroke-width="2.75" />
      <TycoonCost :amount="v.cost.chips" compact />
    </button>
  </div>
</template>

<style scoped>
.stats-flip-enter-active, .stats-flip-leave-active { transition: opacity 0.14s ease, transform 0.14s ease; }
.stats-flip-enter-from, .stats-flip-leave-to { opacity: 0; transform: rotateY(25deg) scale(0.96); }
@media (prefers-reduced-motion: reduce) {
    .stats-flip-enter-active, .stats-flip-leave-active { transition: none; }
}

.tile {
  background: linear-gradient(180deg, #45356a, #33264f 70%);
  border: 2px solid #120c1d;
  box-shadow: 0 4px 0 #120c1d, inset 0 2px 0 rgb(255 255 255 / 0.12);
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgb(18 12 29 / 0.82);
  border: 1.5px solid rgb(0 0 0 / 0.5);
  font-family: var(--font-game);
  font-size: 0.72rem;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
}
.state-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  height: 2.75rem;
  padding: 0 0.4rem;
  border-radius: 0.75rem;
  background: #1b1329;
  box-shadow: inset 0 2px 0 rgb(0 0 0 / 0.35);
  font-size: 0.78rem;
  font-weight: 600;
  min-width: 0;
}
</style>
