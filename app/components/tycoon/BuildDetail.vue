<script setup lang="ts">
import { ArrowBigUp, ArrowRight, ChevronLeft, Clock, Crown, Eye, Footprints, Gem, HardHat, Lock, Move, Package } from 'lucide-vue-next'
import { findGame } from '#shared/games/registry'
import { formatCoins } from '#shared/money'
import { findUpgrade, type BuildKind, type ZoneId } from '#shared/tycoon'

/**
 * One item up close: big art, pips, effect badges and one big BUILD button
 * with the cost and the time on it. The only place with a line of description.
 */
const props = defineProps<{ kind: BuildKind, id: string, back?: boolean }>()
const emit = defineEmits<{ back: [], started: [], play: [slug: string], open: [kind: BuildKind, id: string] }>()

const tycoon = useTycoon()
const v = computed(() => tycoon.view(props.kind, props.id))
// The level the stats start from (-1: maxed), as a number, so the stats are not redone every clock tick.
const statLevel = computed(() => (v.value.maxed ? -1 : v.value.running ? v.value.running.level - 1 : v.value.level))
/** What the next step changes, now → next. */
const stats = computed(() => (statLevel.value < 0 ? [] : buildStats(props.kind, props.id, statLevel.value, tycoon.state.value, tycoon.state.value?.serverNow ?? 0)))
const game = computed(() => (props.kind === 'game' ? findGame(props.id) : undefined))
/** A top machine level: one line above the rows saying it draws richer guests. */
const headline = computed(() => {
    if (statLevel.value >= 0) return buildHeadline(props.kind, props.id, statLevel.value)
    // A maxed machine keeps saying what its top level does.
    return props.kind === 'game' && RICHER_LEVELS.includes(v.value.level) ? 'Max level: draws High Rollers and Whales' : null
})
/** A maxed game still shows its one income number (the same as its tile badge). */
const maxedEarns = computed(() => {
    const s = tycoon.state.value
    if (props.kind !== 'game' || !v.value.maxed || v.value.stored || !s) return null
    return gameIncomePerHour(s, props.id, v.value.level, s.serverNow)
})
const blurb = computed(() => buildLine(props.kind, props.id, v.value.level) ?? (props.kind === 'upgrade' ? findUpgrade(props.id)?.description : null) ?? null)
/** The level the next step (or the running one) reaches. */
const target = computed(() => (v.value.running ? v.value.running.level : v.value.maxed ? v.value.level : v.value.level + 1))
const isNew = computed(() => isNewBuild(props.kind, props.id, v.value.level))
const verb = computed(() => (props.id === 'crew' && props.kind === 'upgrade' ? 'Hire' : isNew.value ? 'Build' : 'Upgrade'))
const soonest = computed(() => tycoon.queue.value[0] ?? null)
const locked = computed(() => !!v.value.lockZone || !!v.value.lockLevel)
const arrange = useArrange()
const shake = ref(0)

async function start() {
    if (!v.value.canStart) {
        shake.value++
        return
    }
    const response = await tycoon.build(props.kind, props.id)
    if (response) emit('started')
}

</script>

<template>
  <div class="space-y-3 p-3">
    <div class="flex items-start gap-3">
      <button v-if="back" type="button" class="g-btn g-dark size-11 shrink-0 rounded-full" aria-label="Back" @click="emit('back')">
        <ChevronLeft class="size-6" :stroke-width="3" />
      </button>
      <div class="relative size-24 shrink-0 overflow-hidden rounded-[20px] border-[3px] border-black/50 shadow-[0_4px_0_rgb(0_0_0/0.4)] sm:size-28">
        <TycoonItemArt :kind="kind" :id="id" :dim="locked" />
        <span v-if="locked" class="absolute inset-0 grid place-items-center"><Lock class="size-8 text-[#ffc93a] drop-shadow-[0_2px_0_rgb(0_0_0/0.5)]" :stroke-width="3" /></span>
        <span v-if="v.maxLevel > 1 && v.level > 0" class="g-num absolute bottom-1 left-1 rounded-full border-2 border-black/50 bg-[#1b1329]/90 px-1.5 text-xs leading-4">Lv {{ v.level }}</span>
      </div>
      <div class="min-w-0 flex-1 space-y-1.5 pr-10">
        <h3 class="g-title text-[1.6rem] leading-[1.05]">{{ v.name }}</h3>
        <div v-if="v.maxLevel > 1" class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TycoonPips :level="v.level" :max="v.maxLevel" size="md" :next="!v.maxed" :marks="kind === 'game' ? RICHER_LEVELS : undefined" />
          <span v-if="!v.maxed" class="g-num flex items-center gap-1 text-sm text-[var(--g-muted)]">Lv {{ v.level }}<ArrowRight class="size-3.5" :stroke-width="3" /><span class="text-[#ffc93a]">{{ target }}</span></span>
        </div>
        <p v-if="blurb" class="text-[13px] leading-snug text-[var(--g-muted)]">{{ blurb }}</p>
      </div>
    </div>

    <!-- What the next step changes -->
    <p v-if="headline" class="flex items-center gap-1.5 rounded-xl bg-[#ffc93a]/12 px-3 py-1.5 text-sm font-bold text-[#ffc93a]"><Gem class="size-4 shrink-0" :stroke-width="2.75" />{{ headline }}</p>
    <p v-if="maxedEarns !== null" class="g-well flex min-h-10 items-center gap-2.5 rounded-2xl px-3 py-1" title="Coins an hour this game brings into your cage on average">
      <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-black/30"><CasinoCoinIcon class="size-4" /></span>
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">This game earns</span>
      <span class="g-num text-base text-[#7ee08f]">{{ formatCoins(maxedEarns) }}/h</span>
    </p>
    <ul v-if="stats.length" class="g-well divide-y divide-white/5 rounded-2xl px-3 py-1">
      <li v-for="stat in stats" :key="stat.label" class="flex min-h-10 items-center gap-2.5" :title="stat.title">
        <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-black/30"><component :is="stat.icon" class="size-4" :style="{ color: stat.color }" :stroke-width="2.75" /></span>
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ stat.label }}</span>
        <span class="g-num flex shrink-0 items-center gap-1.5 text-base">
          <template v-if="stat.now !== null && stat.now !== stat.next">
            <span class="text-[var(--g-muted)]">{{ stat.now }}</span>
            <ArrowRight class="size-3.5 text-[var(--g-muted)]" :stroke-width="3" />
          </template>
          <span v-else-if="stat.now === null" class="rounded-full bg-[#3fd25a] px-1.5 text-[10px] leading-4 text-[#0b3a17] [text-shadow:none]">NEW</span>
          <span :class="(stat.trend ?? 1) < 0 ? 'text-[#ff8a8a]' : stat.trend === 0 ? 'text-white' : 'text-[#7ee08f]'">{{ stat.next }}</span>
          <span v-if="stat.arrow && stat.trend" class="text-xs" :class="stat.trend < 0 ? 'text-[#ff8a8a]' : 'text-[#7ee08f]'">{{ stat.trend < 0 ? '▼' : '▲' }}</span>
        </span>
      </li>
    </ul>

    <!-- The one big action -->
    <div v-if="v.running" class="g-well flex items-center gap-2.5 rounded-2xl p-2">
      <TycoonBuildBar class="min-w-0 flex-1" :progress="1 - v.running.leftMs / v.running.total" :left-ms="v.running.leftMs" size="lg" />
      <TycoonSkipButton class="h-12 shrink-0 rounded-xl px-3.5 text-lg" :left-ms="v.running.leftMs" :target="`${v.running.kind}:${v.running.id}`" />
    </div>
    <button
      v-else-if="v.stored"
      type="button"
      class="g-btn g-dark h-14 w-full rounded-2xl px-4 text-lg"
      title="Put away in storage: its seats take no guests until you place it (you can still play it)"
      @click="arrange.carry({ kind: 'game', id })"
    >
      <Package class="size-5 shrink-0 text-[#ffb35c]" :stroke-width="3" />
      <span class="flex min-w-0 flex-col items-start leading-tight">
        <span class="truncate">In storage: place it</span>
        <span class="truncate text-[12px] font-semibold opacity-75 [text-shadow:none]">{{ v.maxed ? 'Its seats take guests again' : 'Place it on the floor to upgrade it' }}</span>
      </span>
      <ArrowRight class="ml-auto size-5 shrink-0" :stroke-width="3" />
    </button>
    <div v-else-if="v.maxed" class="g-btn g-gold h-14 w-full rounded-2xl text-xl" aria-disabled="true"><Crown class="size-6" :stroke-width="3" /> MAX</div>
    <button
      v-else-if="v.lockLevel"
      type="button"
      class="g-btn g-dark h-14 w-full rounded-2xl px-4 text-lg"
      title="Build rooms, games and upgrades to raise your casino level"
      @click="arrange.levelOpen.value = true"
    >
      <Lock class="size-5 shrink-0 text-[#ffc93a]" :stroke-width="3" />
      <span class="truncate">Reach casino level {{ v.lockLevel }}</span>
      <ArrowRight class="ml-auto size-5 shrink-0" :stroke-width="3" />
    </button>
    <button
      v-else-if="v.noRoom"
      type="button"
      class="g-btn g-dark h-14 w-full rounded-2xl px-4 text-lg"
      title="Every room is full: open a new room, or move things to make space"
      @click="arrange.start()"
    >
      <Move class="size-5 shrink-0 text-[#ffb35c]" :stroke-width="3" />
      <span class="flex min-w-0 flex-col items-start leading-tight">
        <span class="truncate">No room for it</span>
        <span class="truncate text-[12px] font-semibold opacity-75 [text-shadow:none]">Open a room or move things</span>
      </span>
      <ArrowRight class="ml-auto size-5 shrink-0" :stroke-width="3" />
    </button>
    <button
      v-else-if="v.lockZone && v.lockZoneId"
      type="button"
      class="g-btn g-dark h-14 w-full rounded-2xl px-4 text-lg"
      :title="`Open the ${v.lockZone} first: see its build card`"
      @click="emit('open', 'zone', v.lockZoneId)"
    >
      <Lock class="size-5 shrink-0 text-[#ffc93a]" :stroke-width="3" />
      <span class="truncate">Needs {{ v.lockZone }}</span>
      <ArrowRight class="ml-auto size-5 shrink-0" :stroke-width="3" />
    </button>
    <template v-else-if="v.cost">
      <button
        :key="shake"
        type="button"
        class="g-btn h-16 w-full rounded-2xl px-4"
        :class="[!v.affordable ? 'g-off' : v.buildersFull ? 'g-dark' : 'g-green', shake ? 'shake' : '']"
        :disabled="tycoon.busy.value"
        :aria-disabled="!v.canStart"
        :title="!v.affordable ? `Need ${formatCoins(v.missingChips)} more chips` : v.buildersFull ? 'Every builder is busy' : undefined"
        @click="start"
      >
        <component :is="isNew ? HardHat : ArrowBigUp" class="size-8 shrink-0" :stroke-width="2.5" />
        <span class="flex flex-col items-start leading-none">
          <span class="text-2xl uppercase">{{ verb }}</span>
          <span class="mt-1 flex items-center gap-1 text-sm opacity-90" title="Construction time"><Clock class="size-3.5" :stroke-width="3" />{{ formatDuration(v.cost.buildMs) }}</span>
        </span>
        <span class="ml-auto flex items-center gap-2 rounded-xl bg-black/25 px-3 py-1.5 text-xl">
          <TycoonCost :amount="v.cost.chips" />
        </span>
      </button>
      <p v-if="!v.affordable" class="flex items-center justify-center gap-1.5 text-sm font-semibold text-[var(--g-muted)]" :title="`Still missing ${formatCoins(v.missingChips)} chips`">
        need <TycoonCost :amount="v.missingChips" compact /> more
      </p>
      <p v-else-if="v.buildersFull && soonest" class="flex items-center justify-center gap-1.5 text-sm font-semibold text-[var(--g-muted)]" title="Every builder is busy: the next one is free in">
        <HardHat class="size-4" :stroke-width="2.75" /> free in <span class="g-num">{{ formatCountdown(soonest.leftMs) }}</span>
      </p>
    </template>

    <TycoonZoneExtras v-if="kind === 'zone'" :id="id as ZoneId" />

    <div v-if="kind === 'game' && game && (v.level > 0 || game.live)" class="flex gap-2">
      <button type="button" class="g-btn g-blue h-11 flex-1 rounded-xl text-base" @click="emit('play', id)">
        <component :is="v.level > 0 ? Footprints : Eye" class="size-5" :stroke-width="2.75" /> {{ v.level > 0 ? 'Play' : 'Watch' }}
      </button>
      <slot name="actions" />
    </div>
    <div v-else-if="$slots.actions" class="flex justify-end gap-2"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.shake { animation: shake 0.36s ease; }
@keyframes shake {
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(3px); }
}
@media (prefers-reduced-motion: reduce) {
  .shake { animation: none; }
}
</style>
